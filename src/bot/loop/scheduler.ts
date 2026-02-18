import { EventEmitter } from 'events';
import type { TradingDecision } from './decision-engine.js';
import { createDecisionEngine } from './decision-engine.js';
import { BinanceClient } from '../tools/binance/client.js';
import { executeTrade } from '../tools/binance/trade.js';
import type { BotConfig, BinanceConfig } from '../config.js';
import { loadState, saveState, recordTradePnl, type BotState } from '../storage/state.js';
import { logDecision, logExecution, logError } from '../storage/trade-log.js';

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
  avgPrice?: number;
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
    // Safety check: emergency stop
    const state = loadState();
    if (state.emergencyStop) {
      console.log(`[Scheduler] Emergency stop active, skipping ${pair}`);
      return;
    }

    // Safety check: daily loss limit
    if (state.dailyPnl < -10) {
      console.log(`[Scheduler] Daily loss limit exceeded ($${state.dailyPnl}), halting trading`);
      return;
    }

    // Safety check: circuit breaker
    const breaker = this.circuitBreakers.get(pair);
    if (breaker && Date.now() < breaker.skipUntil) {
      console.log(`[Scheduler] ${pair} - circuit breaker active, skipping`);
      return;
    }

    try {
      // Safety check: volatility
      const volatilityCheck = await this.checkVolatility(pair);
      if (!volatilityCheck.safe) {
        console.log(`[Scheduler] ${pair} - volatility too high (${volatilityCheck.change}%), skipping`);
        return;
      }

      const engine = createDecisionEngine(this.client, {
        confidenceThreshold: this.config.confidenceThreshold,
        maxTradeUsd: this.config.maxTradeUsd,
      }, this.model);

      const decision = await engine.evaluatePair(pair);
      this.emit('decision', pair, decision);
      console.log(`[Scheduler] ${pair}: ${decision.action} (confidence: ${decision.confidence}%) - ${decision.reasoning}`);

      // Log the decision (including HOLDs)
      logDecision(
        pair,
        decision.action,
        decision.confidence,
        decision.reasoning,
        decision.size_usd,
        this.tradingMode
      );

      if (decision.action !== 'HOLD' && decision.size_usd > 0) {
        // Safety check: position limit
        const positionCheck = await this.checkPositionLimit(pair, decision.size_usd, decision.action);
        if (!positionCheck.allowed) {
          console.log(`[Scheduler] ${pair} - position limit would be exceeded: ${positionCheck.reason}`);
          return;
        }

        const result = await this.executeTrade(pair, decision);
        this.emit('trade', pair, result);

        if (result.executed && result.orderId) {
          // Record P&L and log successful trade
          recordTradePnl(state, decision.action === 'BUY' ? 0 : -decision.size_usd * 0.001);
          saveState(state);

          // Log the executed trade
          const price = result.avgPrice || 0;
          logExecution(
            pair,
            decision.action,
            decision.confidence,
            decision.reasoning,
            decision.size_usd,
            result.orderId,
            price,
            this.tradingMode
          );
        } else if (result.error) {
          // Log trade error
          logError(pair, decision.action, result.error, this.tradingMode);
        }
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

  private async checkVolatility(pair: string): Promise<{ safe: boolean; change: number }> {
    try {
      const ticker = await this.client.publicGet<{ priceChangePercent: string }>('/v3/ticker/24hr', { symbol: pair });
      const change = Math.abs(parseFloat(ticker.priceChangePercent));
      return { safe: change <= 5, change };
    } catch {
      return { safe: true, change: 0 };
    }
  }

  private async checkPositionLimit(
    pair: string,
    sizeUsd: number,
    action: 'BUY' | 'SELL'
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (action === 'SELL') {
      return { allowed: true };
    }

    try {
      const account = await this.client.signedGet<{ balances: { asset: string; free: string; locked: string }[] }>('/v3/account', {});

      // Get current prices for all assets
      const balances = account.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
      let totalPortfolioValue = 0;

      for (const balance of balances) {
        const amount = parseFloat(balance.free) + parseFloat(balance.locked);
        if (amount <= 0) continue;

        if (balance.asset === 'USDT') {
          totalPortfolioValue += amount;
        } else {
          // Get price in USDT
          try {
            const symbol = `${balance.asset}USDT`;
            const ticker = await this.client.publicGet<{ price: string }>('/v3/ticker/price', { symbol });
            const price = parseFloat(ticker.price);
            totalPortfolioValue += amount * price;
          } catch {
            // Skip assets we can't price
            continue;
          }
        }
      }

      // Add the proposed trade size to calculate post-trade concentration
      const postTradeValue = totalPortfolioValue + sizeUsd;
      const assetSymbol = pair.replace('USDT', '');
      const assetBalance = balances.find(b => b.asset === assetSymbol);
      const currentAssetAmount = assetBalance ? parseFloat(assetBalance.free) + parseFloat(assetBalance.locked) : 0;

      // Get current price of the asset
      let currentAssetValue = 0;
      if (currentAssetAmount > 0) {
        const ticker = await this.client.publicGet<{ price: string }>('/v3/ticker/price', { symbol: pair });
        const price = parseFloat(ticker.price);
        currentAssetValue = currentAssetAmount * price;
      }

      // Calculate post-trade position: current + new
      const postTradeAssetValue = currentAssetValue + sizeUsd;
      const positionPercent = (postTradeAssetValue / postTradeValue) * 100;

      if (positionPercent > 50) {
        return {
          allowed: false,
          reason: `Would be ${positionPercent.toFixed(1)}% of portfolio (max 50%). Current: $${currentAssetValue.toFixed(2)}, Post-trade: $${postTradeAssetValue.toFixed(2)}, Total portfolio: $${postTradeValue.toFixed(2)}`
        };
      }

      return { allowed: true };
    } catch (error) {
      console.error('[Scheduler] Position limit check failed:', error);
      return { allowed: true }; // Allow on error to prevent blocking trading
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
        avgPrice: parseFloat(result.avgPrice),
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
