import { BinanceClient } from '../tools/binance/client.js';
import { callLlm } from '../../dexter/src/model/llm.js';
import { loadState } from '../storage/state.js';

export const PortfolioRecommendationSchema = {
  symbol: '',
  action: '',
  amount: 0,
  reasoning: '',
};

export interface PortfolioRecommendation {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  amountUsd: number;
  reasoning: string;
}

export interface PortfolioManagerConfig {
  maxPositions: number;
  maxTradeUsd: number;
  model: string;
}

export class PortfolioManager {
  private client: BinanceClient;
  private config: PortfolioManagerConfig;

  constructor(client: BinanceClient, config: PortfolioManagerConfig) {
    this.client = client;
    this.config = config;
  }

  async consult(): Promise<PortfolioRecommendation[]> {
    const state = loadState();
    const positions = state.positions || [];
    
    const portfolioText = await this.buildPortfolioText(positions);
    const prompt = this.buildPrompt(portfolioText);

    try {
      const result = await callLlm(prompt, {
        model: this.config.model,
        systemPrompt: 'You are a crypto portfolio manager. Respond with ONLY JSON.',
      });

      const response = typeof result.response === 'string'
        ? result.response
        : (result.response as { content: string }).content;

      return this.parseRecommendations(response, positions);
    } catch (error) {
      console.error('[PortfolioManager] Failed to consult Dexter:', error);
      return [];
    }
  }

  private async buildPortfolioText(positions: Array<{ symbol: string; quantity: number; avgPrice: number }>): Promise<string> {
    if (positions.length === 0) {
      return 'Current portfolio is empty.';
    }

    const lines = await Promise.all(positions.map(async (pos) => {
      try {
        const ticker = await this.client.publicGet<{ lastPrice: string }>('/v3/ticker/24hr', { symbol: pos.symbol });
        const currentPrice = parseFloat(ticker.lastPrice);
        const value = pos.quantity * currentPrice;
        const pnl = ((currentPrice - pos.avgPrice) / pos.avgPrice) * 100;
        
        return `- ${pos.symbol}: ${pos.quantity.toFixed(6)} @ $${currentPrice.toFixed(2)} ($${value.toFixed(2)}, ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%)`;
      } catch {
        return `- ${pos.symbol}: ${pos.quantity.toFixed(6)} @ $${pos.avgPrice.toFixed(2)}`;
      }
    }));

    return lines.join('\n');
  }

  private buildPrompt(portfolioText: string): string {
    return `
You are a crypto portfolio manager. Analyze the current portfolio and recommend changes.

Current portfolio:
${portfolioText}

Rules:
- Maximum ${this.config.maxPositions} positions allowed
- Maximum $${this.config.maxTradeUsd} per trade
- Consider: RSI, MACD, trend, volume, news sentiment
- Be selective - only recommend if strong conviction

Respond with ONLY a JSON array of recommendations:
[
  {"symbol": "BTCUSDT", "action": "BUY", "amount": 20, "reasoning": "strong uptrend, oversold RSI"},
  {"symbol": "ETHUSDT", "action": "SELL", "reasoning": "bearish signals, take profit"},
  {"symbol": "SOLUSDT", "action": "HOLD", "reasoning": "no clear signal"}
]

If no changes needed, return: []
`;
  }

  private parseRecommendations(text: string, currentPositions: Array<{ symbol: string }>): PortfolioRecommendation[] {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const recommendations: PortfolioRecommendation[] = [];
      const currentSymbols = new Set(currentPositions.map(p => p.symbol));

      for (const rec of parsed) {
        if (rec.action === 'HOLD') continue;
        
        const symbol = (rec.symbol || '').toUpperCase();
        if (!symbol || symbol === 'USDT') continue;

        if (rec.action === 'BUY' && currentSymbols.size >= this.config.maxPositions) {
          console.log(`[PortfolioManager] Cannot add ${symbol} - max positions (${this.config.maxPositions}) reached`);
          continue;
        }

        recommendations.push({
          symbol,
          action: rec.action,
          amountUsd: Math.min(rec.amount || this.config.maxTradeUsd, this.config.maxTradeUsd),
          reasoning: rec.reasoning || 'No reasoning provided',
        });
      }

      return recommendations;
    } catch {
      console.error('[PortfolioManager] Failed to parse recommendations');
      return [];
    }
  }
}

export function createPortfolioManager(client: BinanceClient): PortfolioManager {
  return new PortfolioManager(client, {
    maxPositions: 5,
    maxTradeUsd: 20,
    model: process.env.BOT_MODEL || 'openrouter:qwen/qwen3-235b-a22b',
  });
}
