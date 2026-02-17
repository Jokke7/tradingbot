import { EventEmitter } from 'events';
import type { TradingDecision } from './decision-engine.js';
import { createDecisionEngine } from './decision-engine.js';
import { BinanceClient } from '../tools/binance/client.js';
import { executeTrade, simulatePaperTrade } from '../tools/binance/trade.js';
import type { BotConfig, BinanceConfig } from '../config.js';

export interface SchedulerConfig {
  pairs: string[];
  intervalMs: number;
  confidenceThreshold: number;
  maxTradeUsd: number;
}

export interface TradeResult {
  decision: TradingDecision;
  executed: boolean;
  orderId?: number;
  error?: string;
}

export interface SchedulerEvents {
  'decision': (pair: string, decision: TradingDecision) => void;
  'trade': (pair: string, result: TradeResult) => void;
  'error': (pair: string, error: Error) => void;
  'loop:start': () => void;
  'loop:stop': () => void;
}

export class Scheduler extends EventEmitter {
  private config: SchedulerConfig;
  private model: string;
  private client: BinanceClient;
  private tradingMode: 'paper' | 'testnet' | 'live';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private circuitBreakers = new Map<string, { errors: number; skipUntil: number }>();

  constructor(
    config: SchedulerConfig,
    model: string,
    client: BinanceClient,
    tradingMode: 'paper' | 'testnet' | 'live'
  ) {
    super();
    this.config = config;
    this.model = model;
    this.client = client;
    this.tradingMode = tradingMode;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('loop:start');
    console.log(`[Scheduler] Started - checking ${this.config.pairs.join(', ')} every ${this.config.intervalMs / 1000}s`);

    this.runLoop();
    this.intervalId = setInterval(() => this.runLoop(), this.config.intervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.emit('loop:stop');
    console.log('[Scheduler] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async runLoop(): Promise<void> {
    for (const pair of this.config.pairs) {
      if (!this.running) break;
      await this.evaluatePair(pair);
    }
  }

  private async evaluatePair(pair: string): Promise<void> {
    const breaker = this.circuitBreakers.get(pair);
    if (breaker && Date.now() < breaker.skipUntil) {
      console.log(`[Scheduler] ${pair} - circuit breaker active, skipping`);
      return;
    }

    try {
      const engine = createDecisionEngine(this.client, {
        confidenceThreshold: this.config.confidenceThreshold,
        maxTradeUsd: this.config.maxTradeUsd,
      }, this.model);

      const decision = await engine.evaluatePair(pair);
      this.emit('decision', pair, decision);
      console.log(`[Scheduler] ${pair}: ${decision.action} (confidence: ${decision.confidence}%) - ${decision.reasoning}`);

      if (decision.action !== 'HOLD' && decision.size_usd > 0) {
        const result = await this.executeTrade(pair, decision);
        this.emit('trade', pair, result);
      }

      this.circuitBreakers.set(pair, { errors: 0, skipUntil: 0 });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[Scheduler] ${pair} error:`, err.message);
      this.emit('error', pair, err);

      const current = this.circuitBreakers.get(pair) || { errors: 0, skipUntil: 0 };
      current.errors++;
      if (current.errors >= 3) {
        current.skipUntil = Date.now() + 30 * 60 * 1000;
        console.log(`[Scheduler] ${pair} - circuit breaker triggered (3 errors), skipping for 30min`);
      }
      this.circuitBreakers.set(pair, current);
    }
  }

  private async executeTrade(pair: string, decision: TradingDecision): Promise<TradeResult> {
    try {
      const side = decision.action as 'BUY' | 'SELL';
      
      let result: { orderId: number; executedQty: string; avgPrice: string; mode: string };
      
      if (this.tradingMode === 'paper') {
        const ticker = await this.client.publicGet<{ price: string }>('/v3/ticker/price', { symbol: pair });
        const price = parseFloat(ticker.price);
        const quantity = decision.size_usd / price;
        
        result = {
          orderId: Math.floor(Math.random() * 1_000_000),
          executedQty: quantity.toFixed(8),
          avgPrice: price.toFixed(2),
          mode: 'paper',
        };
      } else {
        result = await executeTrade(
          this.client,
          pair,
          side,
          decision.size_usd,
          'MARKET'
        );
      }

      return {
        decision,
        executed: true,
        orderId: result.orderId,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        decision,
        executed: false,
        error: err.message,
      };
    }
  }
}

export function createScheduler(
  botConfig: BotConfig,
  binanceConfig: BinanceConfig,
  model: string
): Scheduler {
  const client = new BinanceClient(binanceConfig);
  return new Scheduler({
    pairs: botConfig.pairs,
    intervalMs: botConfig.checkIntervalMs,
    confidenceThreshold: botConfig.confidenceThreshold,
    maxTradeUsd: botConfig.maxTradeUsd,
  }, model, client, botConfig.tradingMode);
}
