import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { BinanceClient } from './client.js';
import type { PriceTicker, Ticker24hr, Kline, KlineInterval, OrderBook } from './types.js';

/**
 * Create market data tools that use the provided Binance client.
 * Returns an array of LangChain tools for the agent to use.
 */
export function createMarketDataTools(client: BinanceClient) {
  const getBinancePrice = new DynamicStructuredTool({
    name: 'get_binance_price',
    description:
      'Get the current price and 24h statistics for a Binance trading pair. ' +
      "Returns last price, 24h change %, volume, high, and low. Use symbol format like 'BTCUSDT', 'ETHUSDT'.",
    schema: z.object({
      symbol: z.string().describe("Binance trading pair symbol, e.g. 'BTCUSDT'"),
    }),
    func: async ({ symbol }) => {
      const ticker = await client.publicGet<Ticker24hr>('/v3/ticker/24hr', {
        symbol: symbol.toUpperCase(),
      });
      return JSON.stringify({
        symbol: ticker.symbol,
        lastPrice: ticker.lastPrice,
        priceChange24h: ticker.priceChange,
        priceChangePercent24h: ticker.priceChangePercent + '%',
        high24h: ticker.highPrice,
        low24h: ticker.lowPrice,
        volume24h: ticker.volume,
        quoteVolume24h: ticker.quoteVolume,
      });
    },
  });

  const getBinanceKlines = new DynamicStructuredTool({
    name: 'get_binance_klines',
    description:
      'Get historical candlestick (OHLCV) data for a Binance trading pair. ' +
      'Returns open, high, low, close prices and volume for each candle. ' +
      "Intervals: '1m', '5m', '15m', '1h', '4h', '1d'. Default 100 candles.",
    schema: z.object({
      symbol: z.string().describe("Binance trading pair symbol, e.g. 'BTCUSDT'"),
      interval: z
        .enum(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'])
        .default('1h')
        .describe("Candle interval. Default '1h'."),
      limit: z
        .number()
        .min(1)
        .max(1000)
        .default(100)
        .describe('Number of candles to return (1-1000). Default 100.'),
    }),
    func: async ({ symbol, interval, limit }) => {
      const raw = await client.publicGet<unknown[][]>('/v3/klines', {
        symbol: symbol.toUpperCase(),
        interval: interval as KlineInterval,
        limit,
      });

      // Binance returns klines as arrays — map to readable objects
      const klines: Kline[] = raw.map((k) => ({
        openTime: k[0] as number,
        open: k[1] as string,
        high: k[2] as string,
        low: k[3] as string,
        close: k[4] as string,
        volume: k[5] as string,
        closeTime: k[6] as number,
        quoteVolume: k[7] as string,
        trades: k[8] as number,
      }));

      return JSON.stringify({
        symbol: symbol.toUpperCase(),
        interval,
        count: klines.length,
        klines: klines.map((k) => ({
          time: new Date(k.openTime).toISOString(),
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        })),
      });
    },
  });

  const getBinanceOrderbook = new DynamicStructuredTool({
    name: 'get_binance_orderbook',
    description:
      'Get the current order book (bids and asks) for a Binance trading pair. ' +
      'Shows market depth — useful for assessing liquidity and spread.',
    schema: z.object({
      symbol: z.string().describe("Binance trading pair symbol, e.g. 'BTCUSDT'"),
      limit: z
        .number()
        .min(5)
        .max(100)
        .default(10)
        .describe('Number of price levels to return (5-100). Default 10.'),
    }),
    func: async ({ symbol, limit }) => {
      const book = await client.publicGet<OrderBook>('/v3/depth', {
        symbol: symbol.toUpperCase(),
        limit,
      });

      return JSON.stringify({
        symbol: symbol.toUpperCase(),
        bids: book.bids.slice(0, limit).map(([price, qty]) => ({ price, quantity: qty })),
        asks: book.asks.slice(0, limit).map(([price, qty]) => ({ price, quantity: qty })),
        spread: book.asks[0] && book.bids[0]
          ? (parseFloat(book.asks[0][0]) - parseFloat(book.bids[0][0])).toFixed(2)
          : 'N/A',
      });
    },
  });

  return [getBinancePrice, getBinanceKlines, getBinanceOrderbook];
}
