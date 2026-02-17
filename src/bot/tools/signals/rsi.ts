import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { rsi } from '../../utils/indicators.js';
import { BinanceClient } from '../binance/client.js';

/**
 * RSI calculation tool.
 * Fetches klines from Binance, computes RSI, and returns a structured signal.
 */
export function createRsiTool(client: BinanceClient) {
  return new DynamicStructuredTool({
    name: 'calculate_rsi',
    description:
      'Calculate the Relative Strength Index (RSI) for a Binance trading pair. ' +
      'RSI < 30 = oversold (potential buy), RSI > 70 = overbought (potential sell). ' +
      'Uses 1h candles by default.',
    schema: z.object({
      symbol: z.string().describe("Trading pair symbol, e.g. 'BTCUSDT'"),
      period: z
        .number()
        .min(2)
        .max(50)
        .default(14)
        .describe('RSI period. Default 14.'),
      interval: z
        .enum(['5m', '15m', '1h', '4h', '1d'])
        .default('1h')
        .describe("Candle interval for RSI calculation. Default '1h'."),
    }),
    func: async ({ symbol, period, interval }) => {
      // Fetch enough candles: period + 1 for RSI calculation, plus buffer
      const limit = period + 50;
      const raw = await client.publicGet<unknown[][]>('/v3/klines', {
        symbol: symbol.toUpperCase(),
        interval,
        limit,
      });

      const closePrices = raw.map((k) => parseFloat(k[4] as string));
      const rsiValue = rsi(closePrices, period);

      let signal: 'oversold' | 'overbought' | 'neutral';
      if (rsiValue < 30) signal = 'oversold';
      else if (rsiValue > 70) signal = 'overbought';
      else signal = 'neutral';

      return JSON.stringify({
        symbol: symbol.toUpperCase(),
        interval,
        period,
        rsi: parseFloat(rsiValue.toFixed(2)),
        signal,
        interpretation:
          signal === 'oversold'
            ? `RSI ${rsiValue.toFixed(1)} — oversold territory. Potential buying opportunity.`
            : signal === 'overbought'
              ? `RSI ${rsiValue.toFixed(1)} — overbought territory. Consider taking profits or selling.`
              : `RSI ${rsiValue.toFixed(1)} — neutral range. No strong signal.`,
      });
    },
  });
}
