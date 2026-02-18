import { BinanceClient } from './binance/client.js';
import { rsi, sma, macd, roc } from '../utils/indicators.js';

interface BacktestConfig {
  symbol: string;
  interval: string;
  days: number;
  initialBalance: number;
  maxTradeUsd: number;
}

interface Trade {
  type: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  value: number;
  timestamp: number;
}

interface BacktestResult {
  totalReturn: number;
  totalReturnPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  sharpeRatio: number;
  trades: Trade[];
  finalBalance: number;
}

function parseKlines(raw: unknown[][]): Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> {
  return raw.map((k) => ({
    time: k[0] as number,
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

function calculateIndicators(candles: Array<{ close: number }>, currentIndex: number) {
  const lookback = Math.min(currentIndex, 200);
  const closes = candles.slice(currentIndex - lookback, currentIndex + 1).map((c) => c.close);
  
  const currentRsi = rsi(closes, 14);
  const currentSma20 = sma(closes.slice(-20), 20);
  const currentSma50 = sma(closes.slice(-50), 50);
  const currentSma200 = lookback >= 200 ? sma(closes.slice(-200), 200) : currentSma50;
  const currentMacd = macd(closes, 12, 26, 9);
  const currentRoc = roc(closes, 14);
  
  return { rsi: currentRsi, sma20: currentSma20, sma50: currentSma50, sma200: currentSma200, macd: currentMacd, momentum: currentRoc };
}

function generateSignal(price: number, indicators: ReturnType<typeof calculateIndicators>, volume: number, avgVolume: number, position: number, entryPrice: number): 'BUY' | 'SELL' | 'HOLD' {
  const { rsi, sma20, sma50, sma200, macd, momentum } = indicators;
  
  const priceAboveAllMas = price > sma20 && price > sma50 && (price > sma200 || isNaN(sma200));
  const priceBelowAllMas = price < sma20 && price < sma50 && (price < sma200 || isNaN(sma200));
  const strongUptrend = sma20 > sma50;
  const strongDowntrend = sma20 < sma50;
  const rsiOversold = rsi < 25;
  const rsiOverbought = rsi > 75;
  const rsiFavorable = rsi < 35 || rsi > 65;
  const bullishMacd = macd.histogram > 0;
  const bearishMacd = macd.histogram < 0;
  const highVolume = volume > avgVolume;
  
  if (position > 0) {
    const pnlPercent = ((price - entryPrice) / entryPrice) * 100;
    if (pnlPercent > 3 || (priceBelowAllMas && bearishMacd)) {
      return 'SELL';
    }
    if (pnlPercent < -2 && (rsiOverbought || bearishMacd)) {
      return 'SELL';
    }
  }
  
  if (rsiOversold && priceAboveAllMas && (bullishMacd || momentum > 0) && highVolume) {
    return 'BUY';
  }
  if (rsiOverbought && priceBelowAllMas && bearishMacd) {
    return 'SELL';
  }
  if (strongDowntrend && priceBelowAllMas && bearishMacd && rsiFavorable) {
    return 'SELL';
  }
  if (strongUptrend && priceAboveAllMas && bullishMacd && rsiFavorable && highVolume) {
    return 'BUY';
  }
  return 'HOLD';
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const client = new BinanceClient({
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    testnet: process.env.BINANCE_TESTNET === 'true',
  });

  const limit = Math.min(config.days * 24, 1000);
  const raw = await client.publicGet<unknown[][]>('/v3/klines', {
    symbol: config.symbol.toUpperCase(),
    interval: config.interval,
    limit,
  });

  const candles = parseKlines(raw);
  console.log(`Loaded ${candles.length} candles for ${config.symbol}`);

  let balance = config.initialBalance;
  let position = 0;
  let entryPrice = 0;
  const trades: Trade[] = [];
  const equityCurve: number[] = [];
  const returns: number[] = [];

  for (let i = 50; i < candles.length; i++) {
    const candle = candles[i];
    const indicators = calculateIndicators(candles, i);
    const avgVolume = candles.slice(Math.max(0, i - 20), i).reduce((sum, c) => sum + c.volume, 0) / 20;
    const signal = generateSignal(candle.close, indicators, candle.volume, avgVolume, position, entryPrice);

    const currentValue = balance + position * candle.close;
    equityCurve.push(currentValue);

    if (signal === 'BUY' && position === 0 && balance >= config.maxTradeUsd) {
      const quantity = config.maxTradeUsd / candle.close;
      position = quantity;
      entryPrice = candle.close;
      balance -= config.maxTradeUsd;
      trades.push({ type: 'BUY', price: candle.close, quantity, value: config.maxTradeUsd, timestamp: candle.time });
    } else if (signal === 'SELL' && position > 0) {
      const sellValue = position * candle.close;
      const pnl = sellValue - entryPrice * position;
      balance += sellValue;
      trades.push({ type: 'SELL', price: candle.close, quantity: position, value: sellValue, timestamp: candle.time });
      returns.push(pnl / (entryPrice * position));
      position = 0;
      entryPrice = 0;
    }
  }

  const finalBalance = balance + position * candles[candles.length - 1].close;
  const totalReturn = finalBalance - config.initialBalance;
  const totalReturnPercent = (totalReturn / config.initialBalance) * 100;

  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let peak = config.initialBalance;

  for (const equity of equityCurve) {
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    const drawdownPercent = (drawdown / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
    }
  }

  const winningTrades = returns.filter((r) => r > 0).length;
  const losingTrades = returns.filter((r) => r < 0).length;
  const totalTrades = returns.length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 0
    ? Math.sqrt(returns.map((r) => Math.pow(r - avgReturn, 2)).reduce((a, b) => a + b, 0) / returns.length)
    : 0;
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  return {
    totalReturn,
    totalReturnPercent,
    maxDrawdown,
    maxDrawdownPercent,
    winRate,
    totalTrades,
    winningTrades,
    losingTrades,
    sharpeRatio,
    trades,
    finalBalance,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const symbol = args[0] || 'BTCUSDT';
  const interval = args[1] || '1h';
  const days = parseInt(args[2] || '30', 10);

  console.log(`\nRunning backtest: ${symbol} ${interval} ${days} days\n`);

  const result = await runBacktest({
    symbol,
    interval,
    days,
    initialBalance: 10000,
    maxTradeUsd: 20,
  });

  console.log('='.repeat(50));
  console.log(`Backtest Results: ${symbol} (${days} days, ${interval})`);
  console.log('='.repeat(50));
  console.log(`Initial Balance:     $10,000.00`);
  console.log(`Final Balance:      $${result.finalBalance.toFixed(2)}`);
  console.log(`Total Return:       $${result.totalReturn.toFixed(2)} (${result.totalReturnPercent.toFixed(2)}%)`);
  console.log(`Max Drawdown:       $${result.maxDrawdown.toFixed(2)} (${result.maxDrawdownPercent.toFixed(2)}%)`);
  console.log(`Win Rate:           ${result.winRate.toFixed(1)}%`);
  console.log(`Sharpe Ratio:       ${result.sharpeRatio.toFixed(2)}`);
  console.log(`Total Trades:       ${result.totalTrades}`);
  console.log(`  Winning:          ${result.winningTrades}`);
  console.log(`  Losing:           ${result.losingTrades}`);
  console.log('='.repeat(50));

  if (result.trades.length > 0) {
    console.log('\nTrade History:');
    result.trades.forEach((trade, i) => {
      const date = new Date(trade.timestamp).toISOString().slice(0, 10);
      console.log(`  ${i + 1}. ${trade.type} ${trade.quantity.toFixed(6)} @ $${trade.price.toFixed(2)} (${date})`);
    });
  }
}
