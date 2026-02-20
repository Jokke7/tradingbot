import { EventEmitter } from 'events';
import type { TradingDecision } from './decision-engine.js';
import { createDecisionEngine } from './decision-engine.js';
import { createPortfolioManager, type PortfolioRecommendation } from './portfolio-manager.js';
import { BinanceClient } from '../tools/binance/client.js';
import { executeTrade } from '../tools/binance/trade.js';
import type { BotConfig, BinanceConfig } from '../config.js';
import { loadState, saveState, recordTradePnl, updatePosition, type BotState } from '../storage/state.js';
import { logDecision, logExecution, logError } from '../storage/trade-log.js';
import { logExecutedRecommendation, logRejectedRecommendation } from '../storage/portfolio-log.js';

export interface SchedulerConfig {
  pairs: string[];
  intervalMs: number;
  confidenceThreshold: number;
  maxTradeUsd: number;
  dailyLossLimitUsd: number;
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
  private portfolioIntervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private circuitBreakers: Map<string, { errors: number; skipUntil: number }>;
  private portfolioManager: ReturnType<typeof createPortfolioManager>;

  private static readonly PORTFOLIO_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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
    this.circuitBreakers = new Map();
    this.portfolioManager = createPortfolioManager(client, config.pairs);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('loop:start');
    console.log(`[Scheduler] Started - checking ${this.config.pairs.join(', ')} every ${this.config.intervalMs / 1000}s`);
    console.log(`[PortfolioManager] Will consult Dexter every ${Scheduler.PORTFOLIO_INTERVAL_MS / 60000} minutes`);

    this.runLoop();
    this.intervalId = setInterval(() => this.runLoop(), this.config.intervalMs);

    // Start portfolio manager (run immediately, then hourly)
    this.runPortfolioManager();
    this.portfolioIntervalId = setInterval(() => this.runPortfolioManager(), Scheduler.PORTFOLIO_INTERVAL_MS);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.portfolioIntervalId) {
      clearInterval(this.portfolioIntervalId);
      this.portfolioIntervalId = null;
    }
    this.emit('loop:stop');
    console.log('[Scheduler] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async runLoop(): Promise<void> {
    const state = loadState();
    const heldPairs = state.positions.map(p => p.symbol);

    if (heldPairs.length === 0) {
      console.log('[Scheduler] No positions held, skipping pair evaluation (portfolio manager handles new entries)');
      return;
    }

    console.log(`[Scheduler] Evaluating ${heldPairs.length} held position(s): ${heldPairs.join(', ')}`);

    for (const pair of heldPairs) {
      if (!this.running) break;
      await this.evaluatePair(pair);
    }
  }

  private async runPortfolioManager(): Promise<void> {
    if (!this.running) return;
    
    const state = loadState();
    if (state.emergencyStop) {
      console.log('[PortfolioManager] Emergency stop active, skipping');
      return;
    }

    console.log('[PortfolioManager] Consulting Dexter for portfolio advice...');
    
    try {
      const recommendations = await this.portfolioManager.consult();
      
      if (recommendations.length === 0) {
        console.log('[PortfolioManager] No changes recommended');
        return;
      }

      console.log(`[PortfolioManager] Received ${recommendations.length} recommendations`);

      for (const rec of recommendations) {
        if (!this.running) break;
        
        console.log(`[PortfolioManager] ${rec.symbol}: ${rec.action} - ${rec.reasoning}`);
        
        // Execute SELL recommendations immediately
        if (rec.action === 'SELL') {
          await this.executePortfolioSell(rec.symbol);
        }
        // Execute BUY recommendations (respecting position limit)
        else if (rec.action === 'BUY') {
          await this.executePortfolioBuy(rec);
        }
      }
    } catch (error) {
      console.error('[PortfolioManager] Error:', error instanceof Error ? error.message : String(error));
    }
  }

  private async executePortfolioSell(symbol: string): Promise<void> {
    const state = loadState();
    const position = state.positions.find(p => p.symbol === symbol);
    
    if (!position) {
      console.log(`[PortfolioManager] Cannot sell ${symbol} - no position held`);
      logRejectedRecommendation(symbol, 'SELL', 0, 'No position held', 'No position held');
      return;
    }

    try {
      const ticker = await this.client.publicGet<{ price: string }>('/v3/ticker/price', { symbol });
      const price = parseFloat(ticker.price);
      const value = position.quantity * price;
      
      const decision = {
        action: 'SELL' as const,
        confidence: 100,
        conviction: 5,
        reasoning: 'Portfolio manager recommendation',
        size_usd: value,
      };

      const result = await this.executeTrade(symbol, decision);
      
      if (result.executed) {
        // Remove position
        state.positions = state.positions.filter(p => p.symbol !== symbol);
        recordTradePnl(state, value - position!.avgPrice * position!.quantity);
        saveState(state);
        console.log(`[PortfolioManager] Sold ${symbol} - executed`);
        logExecutedRecommendation(symbol, 'SELL', value, 'Portfolio manager recommendation');
      }
    } catch (error) {
      console.error(`[PortfolioManager] Failed to sell ${symbol}:`, error instanceof Error ? error.message : String(error));
    }
  }

  private async executePortfolioBuy(rec: { symbol: string; amountUsd: number }): Promise<void> {
    const state = loadState();
    
    // Check position limit
    if (state.positions.length >= 5) {
      console.log(`[PortfolioManager] Cannot buy ${rec.symbol} - max positions (5) reached`);
      logRejectedRecommendation(rec.symbol, 'BUY', rec.amountUsd, 'Portfolio manager recommendation', 'Max positions (5) reached');
      return;
    }

    try {
      const ticker = await this.client.publicGet<{ price: string }>('/v3/ticker/price', { symbol: rec.symbol });
      const price = parseFloat(ticker.price);
      const quantity = rec.amountUsd / price;
      
      const decision = {
        action: 'BUY' as const,
        confidence: 100,
        conviction: 5,
        reasoning: 'Portfolio manager recommendation',
        size_usd: rec.amountUsd,
      };

      const result = await this.executeTrade(rec.symbol, decision);
      
      if (result.executed && result.avgPrice) {
        updatePosition(state, rec.symbol, quantity, result.avgPrice);
        saveState(state);
        console.log(`[PortfolioManager] Bought ${rec.symbol} - executed`);
        logExecutedRecommendation(rec.symbol, 'BUY', rec.amountUsd, 'Portfolio manager recommendation');
      }
    } catch (error) {
      console.error(`[PortfolioManager] Failed to buy ${rec.symbol}:`, error instanceof Error ? error.message : String(error));
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
    if (state.dailyPnl < -this.config.dailyLossLimitUsd) {
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

      // Get position context for this pair
      const position = state.positions.find(p => p.symbol === pair);

      const engine = createDecisionEngine(this.client, {
        confidenceThreshold: this.config.confidenceThreshold,
        maxTradeUsd: this.config.maxTradeUsd,
      }, this.model);

      const decision = await engine.evaluatePair(pair, position);
      this.emit('decision', pair, decision);
      console.log(`[Scheduler] ${pair}: ${decision.action} (confidence: ${decision.confidence}%, conviction: ${decision.conviction}/5) - ${decision.reasoning}`);

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
          // Calculate P&L for this trade
          const price = result.avgPrice || 0;
          const quantity = decision.size_usd / price;
          let tradePnl = 0;

          if (decision.action === 'SELL') {
            // Calculate realized P&L: (sellPrice - avgEntryPrice) * quantity
            const position = state.positions.find(p => p.symbol === pair);
            if (position && position.quantity >= quantity) {
              tradePnl = (price - position.avgPrice) * quantity;
            }
          }
          // For BUY trades, P&L is 0 until we sell (unrealized)

          // Update position tracking
          if (decision.action === 'BUY') {
            updatePosition(state, pair, quantity, price);
          } else {
            // For SELL, reduce position (negative quantity)
            updatePosition(state, pair, -quantity, price);
          }

          // Record P&L
          recordTradePnl(state, tradePnl);
          saveState(state);

          // Log the executed trade
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

          console.log(`[Scheduler] ${pair} P&L: $${tradePnl.toFixed(4)} | Cumulative: $${state.cumulativePnl.toFixed(4)} | Daily: $${state.dailyPnl.toFixed(4)}`);
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
      // Fetch last 2 candles (5m interval) to calculate recent change
      const klines = await this.client.publicGet<[number, string, string, string, string, string, number, string, number, string, string, string][]>('/v3/klines', {
        symbol: pair,
        interval: '5m',
        limit: 2
      });

      if (klines.length < 2) {
        return { safe: true, change: 0 };
      }

      const prevClose = parseFloat(klines[0][4]);
      const currentClose = parseFloat(klines[1][4]);
      const change = Math.abs((currentClose - prevClose) / prevClose * 100);

      return { safe: change <= 5, change };
    } catch (error) {
      console.error(`[Scheduler] Volatility check failed for ${pair}:`, error);
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
    dailyLossLimitUsd: botConfig.dailyLossLimitUsd,
  }, model, client, botConfig.tradingMode);
}
