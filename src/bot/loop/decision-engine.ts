import { z } from 'zod';
import type { MarketDataProvider } from '../data/provider.js';
import { rsi } from '../utils/indicators.js';
import { sma } from '../utils/indicators.js';
import { macd } from '../utils/indicators.js';
import { TradingAgent } from '../agent/trading-agent.js';
import { InMemoryChatHistory } from '../../dexter/src/utils/in-memory-chat-history.js';
import { loadBotConfig, loadBinanceConfig } from '../config.js';

export const TradingDecisionSchema = z.object({
  action: z.enum(['BUY', 'SELL', 'HOLD']),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  size_usd: z.number().min(0).max(100),
});

export type TradingDecision = z.infer<typeof TradingDecisionSchema>;

export interface MarketData {
  symbol: string;
  currentPrice: number;
  priceChange24h: number;
  rsi: number;
  sma20: number;
  sma50: number;
  sma200: number;
  macd: { macd: number; signal: number; histogram: number };
  momentum: number;
}

export interface DecisionEngineConfig {
  confidenceThreshold: number;
  maxTradeUsd: number;
}

export class DecisionEngine {
  private dataProvider: MarketDataProvider;
  private config: DecisionEngineConfig;
  private model: string;
  private analystChat: InMemoryChatHistory;
  private riskManagerChat: InMemoryChatHistory;

  constructor(dataProvider: MarketDataProvider, config: DecisionEngineConfig, model: string) {
    this.dataProvider = dataProvider;
    this.config = config;
    this.model = model;
    this.analystChat = new InMemoryChatHistory(model);
    this.riskManagerChat = new InMemoryChatHistory(model);
  }

  async evaluatePair(symbol: string): Promise<TradingDecision> {
    const marketData = await this.fetchMarketData(symbol);

    // Analyst agent proposes a trade
    const analystProposal = await this.getAnalystProposal(symbol, marketData);
    const validatedProposal = TradingDecisionSchema.parse(this.parseDecision(analystProposal));

    if (validatedProposal.action === 'HOLD' || validatedProposal.confidence < this.config.confidenceThreshold) {
      return validatedProposal;
    }

    // Risk Manager reviews the proposal
    const riskManagerReview = await this.getRiskManagerReview(symbol, marketData, validatedProposal);
    return TradingDecisionSchema.parse(riskManagerReview);
  }

  private async fetchMarketData(symbol: string): Promise<MarketData> {
    const [ticker, klines] = await Promise.all([
      this.dataProvider.getTicker(symbol),
      this.dataProvider.getKlines(symbol, '1h', 200),
    ]);

    const closes = klines.map((k) => k.close);

    const macdResult = macd(closes);

    return {
      symbol,
      currentPrice: ticker.lastPrice,
      priceChange24h: ticker.priceChangePercent,
      rsi: rsi(closes, 14),
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      macd: macdResult,
      momentum: closes[closes.length - 1] - closes[closes.length - 14],
    };
  }

  private async getAnalystProposal(symbol: string, data: MarketData): Promise<string> {
    const prompt = this.buildAnalystPrompt(symbol, data);

    const botConfig = loadBotConfig();
    const binanceConfig = loadBinanceConfig();

    const analystAgent = TradingAgent.create(
      { model: this.model, maxIterations: 10 },
      botConfig,
      binanceConfig,
      'You are an aggressive crypto trading analyst looking for opportunities. Respond with ONLY JSON matching the TradingDecision schema.'
    );

    let lastResponse = '';
    for await (const event of analystAgent.run(prompt, this.analystChat)) {
      if (event.type === 'done') {
        lastResponse = event.answer;
      }
    }

    this.analystChat.addMessage('user', prompt);
    this.analystChat.addMessage('assistant', lastResponse);

    return lastResponse;
  }

  private buildAnalystPrompt(symbol: string, data: MarketData): string {
    return `
Analyze ${symbol} and decide whether to BUY, SELL, or HOLD.

Current market data:
- Price: $${data.currentPrice.toFixed(2)}
- 24h Change: ${data.priceChange24h.toFixed(2)}%
- RSI(14): ${data.rsi.toFixed(1)}
- SMA(20): $${data.sma20.toFixed(2)}
- SMA(50): $${data.sma50.toFixed(2)}
- SMA(200): $${data.sma200.toFixed(2)}
- MACD Histogram: ${data.macd.histogram.toFixed(4)}
- Momentum (14h): ${data.momentum.toFixed(2)}

Respond with ONLY a JSON object:
{"action": "BUY"|"SELL"|"HOLD", "confidence": 0-100, "reasoning": "brief explanation", "size_usd": 0-${this.config.maxTradeUsd}}

Rules:
- Only BUY if RSI < 40 (oversold) or price above major MAs
- Only SELL if RSI > 60 (overbought) or price below major MAs
- size_usd should be 0 for HOLD
`;
  }

  private parseDecision(text: string): TradingDecision {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { action: 'HOLD', confidence: 0, reasoning: 'Failed to parse LLM response', size_usd: 0 };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return TradingDecisionSchema.parse(parsed);
    } catch {
      return { action: 'HOLD', confidence: 0, reasoning: 'Invalid decision format', size_usd: 0 };
    }
  }

  private async getRiskManagerReview(
    symbol: string,
    data: MarketData,
    decision: TradingDecision
  ): Promise<TradingDecision> {
    const prompt = `
The Analyst proposed the following trade:
Asset: ${symbol}
Price: $${data.currentPrice.toFixed(2)}
RSI: ${data.rsi.toFixed(1)}
MACD Histogram: ${data.macd.histogram.toFixed(4)}

Proposed Action: ${decision.action}
Size: $${decision.size_usd}
Confidence: ${decision.confidence}
Reasoning: ${decision.reasoning}

Review this proposal critically. If it is too risky or violates safety parameters, reject it by returning an action of HOLD.
Respond with ONLY JSON matching the TradingDecision schema, providing your own reasoning and adjusting size/confidence if necessary.
`;

    const botConfig = loadBotConfig();
    const binanceConfig = loadBinanceConfig();

    const riskManagerAgent = TradingAgent.create(
      { model: this.model, maxIterations: 10 },
      botConfig,
      binanceConfig,
      'You are a conservative crypto risk manager focused on capital preservation. Respond with ONLY JSON matching the TradingDecision schema.'
    );

    let lastResponse = '';
    for await (const event of riskManagerAgent.run(prompt, this.riskManagerChat)) {
      if (event.type === 'done') {
        lastResponse = event.answer;
      }
    }

    this.riskManagerChat.addMessage('user', prompt);
    this.riskManagerChat.addMessage('assistant', lastResponse);

    return this.parseDecision(lastResponse);
  }
}

export function createDecisionEngine(
  dataProvider: MarketDataProvider,
  botConfig: { confidenceThreshold: number; maxTradeUsd: number },
  model: string
): DecisionEngine {
  return new DecisionEngine(dataProvider, {
    confidenceThreshold: botConfig.confidenceThreshold,
    maxTradeUsd: botConfig.maxTradeUsd,
  }, model);
}
