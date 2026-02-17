import { z } from 'zod';
import { BinanceClient } from '../tools/binance/client.js';
import type { BotConfig } from '../config.js';
import { callLlm } from '../../dexter/src/model/llm.js';
import { rsi } from '../utils/indicators.js';
import { sma } from '../utils/indicators.js';
import { macd } from '../utils/indicators.js';

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
  private client: BinanceClient;
  private config: DecisionEngineConfig;
  private model: string;

  constructor(client: BinanceClient, config: DecisionEngineConfig, model: string) {
    this.client = client;
    this.config = config;
    this.model = model;
  }

  async evaluatePair(symbol: string): Promise<TradingDecision> {
    const marketData = await this.fetchMarketData(symbol);
    const decision = await this.getLlmDecision(symbol, marketData);
    const validated = TradingDecisionSchema.parse(decision);

    if (validated.action !== 'HOLD' && validated.confidence >= this.config.confidenceThreshold) {
      const reflected = await this.selfReflect(symbol, marketData, validated);
      return reflected;
    }

    return validated;
  }

  private async fetchMarketData(symbol: string): Promise<MarketData> {
    const [ticker, klines] = await Promise.all([
      this.client.publicGet<{ lastPrice: string; priceChangePercent: string }>('/v3/ticker/24hr', { symbol }),
      this.client.publicGet<{ [index: number]: string }[]>('/v3/klines', { symbol, interval: '1h', limit: 200 }),
    ]);

    const closes = klines.map((k) => parseFloat(k[4]));

    const macdResult = macd(closes);

    return {
      symbol,
      currentPrice: parseFloat(ticker.lastPrice),
      priceChange24h: parseFloat(ticker.priceChangePercent),
      rsi: rsi(closes, 14),
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      macd: macdResult,
      momentum: closes[closes.length - 1] - closes[closes.length - 14],
    };
  }

  private async getLlmDecision(symbol: string, data: MarketData): Promise<TradingDecision> {
    const prompt = this.buildDecisionPrompt(symbol, data);

    const result = await callLlm(prompt, {
      model: this.model,
      systemPrompt: 'You are a crypto trading assistant. Respond with ONLY JSON.',
    });

    const response = typeof result.response === 'string' 
      ? result.response 
      : (result.response as { content: string }).content;

    return this.parseDecision(response);
  }

  private buildDecisionPrompt(symbol: string, data: MarketData): string {
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

  private async selfReflect(
    symbol: string,
    data: MarketData,
    decision: TradingDecision
  ): Promise<TradingDecision> {
    const reflectionPrompt = `
Review this trading decision:

Asset: ${symbol}
Price: $${data.currentPrice.toFixed(2)}
RSI: ${data.rsi.toFixed(1)}
MACD Histogram: ${data.macd.histogram.toFixed(4)}

Proposed: ${decision.action} $${decision.size_usd} (confidence: ${decision.confidence})
Reasoning: ${decision.reasoning}

Respond with ONLY JSON:
{"approved": true|false, "reason": "why or why not"}
`;

    const result = await callLlm(reflectionPrompt, {
      model: this.model,
      systemPrompt: 'You are a trading risk reviewer.',
    });

    const response = typeof result.response === 'string' 
      ? result.response 
      : (result.response as { content: string }).content;

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.approved === false) {
          return { 
            action: 'HOLD', 
            size_usd: 0, 
            confidence: decision.confidence,
            reasoning: `Rejected: ${parsed.reason}`
          };
        }
      }
    } catch {
      // Ignore parse errors
    }

    return decision;
  }
}

export function createDecisionEngine(
  client: BinanceClient,
  botConfig: { confidenceThreshold: number; maxTradeUsd: number },
  model: string
): DecisionEngine {
  return new DecisionEngine(client, {
    confidenceThreshold: botConfig.confidenceThreshold,
    maxTradeUsd: botConfig.maxTradeUsd,
  }, model);
}
