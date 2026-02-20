/**
 * Technical indicator calculations.
 * Pure functions — no I/O, no external dependencies.
 * All price inputs are number arrays (typically close prices).
 */

/**
 * Simple Moving Average.
 * Returns NaN if not enough data points.
 */
export function sma(prices: number[], period: number): number {
  if (prices.length < period) return NaN;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Exponential Moving Average.
 * Uses standard smoothing factor: 2 / (period + 1).
 */
export function ema(prices: number[], period: number): number {
  if (prices.length < period) return NaN;
  const k = 2 / (period + 1);

  // Seed with SMA of first `period` values
  let emaCurrent = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;

  for (let i = period; i < prices.length; i++) {
    emaCurrent = prices[i] * k + emaCurrent * (1 - k);
  }
  return emaCurrent;
}

/**
 * Compute EMA values for all points in a single O(n) pass.
 * Returns array of EMA values (same length as input, with NaN for first period-1).
 */
function emaSeries(prices: number[], period: number): number[] {
  if (prices.length < period) return [];

  const k = 2 / (period + 1);
  const result: number[] = new Array(prices.length).fill(NaN);

  // Seed with SMA of first `period` values
  let emaCurrent = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;

  for (let i = period; i < prices.length; i++) {
    result[i] = emaCurrent;
    emaCurrent = prices[i] * k + emaCurrent * (1 - k);
  }
  result[prices.length - 1] = emaCurrent;

  return result;
}

/**
 * Relative Strength Index (RSI).
 * Standard Wilder's RSI with smoothed moving average of gains/losses.
 * Returns value between 0-100.
 */
export function rsi(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return NaN;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Initial average gain/loss from first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining changes
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * MACD (Moving Average Convergence Divergence).
 * Returns MACD line, signal line, and histogram.
 */
export function macd(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } {
  const fastEma = ema(prices, fastPeriod);
  const slowEma = ema(prices, slowPeriod);
  const macdLine = fastEma - slowEma;

  // Compute MACD series in O(n) using incremental EMA
  const fastEmaSeries = emaSeries(prices, fastPeriod);
  const slowEmaSeries = emaSeries(prices, slowPeriod);

  const macdValues: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (!isNaN(fastEmaSeries[i]) && !isNaN(slowEmaSeries[i])) {
      macdValues.push(fastEmaSeries[i] - slowEmaSeries[i]);
    }
  }

  const signalLine = macdValues.length >= signalPeriod
    ? ema(macdValues, signalPeriod)
    : NaN;

  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine,
  };
}

/**
 * Bollinger Bands.
 * Returns middle (SMA), upper, and lower bands.
 */
export function bollingerBands(
  prices: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number; middle: number; lower: number } {
  const middle = sma(prices, period);
  if (isNaN(middle)) return { upper: NaN, middle: NaN, lower: NaN };

  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, p) => sum + (p - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + stdDev * stdDevMultiplier,
    middle,
    lower: middle - stdDev * stdDevMultiplier,
  };
}

/**
 * Rate of Change (ROC) — percentage change over N periods.
 */
export function roc(prices: number[], period: number = 10): number {
  if (prices.length < period + 1) return NaN;
  const current = prices[prices.length - 1];
  const previous = prices[prices.length - 1 - period];
  return ((current - previous) / previous) * 100;
}
