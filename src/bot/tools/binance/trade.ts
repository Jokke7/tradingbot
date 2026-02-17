import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { BinanceClient } from './client.js';
import type { BotConfig } from '../../config.js';
import type { OrderResponse, PaperTradeResult, PriceTicker } from './types.js';

/**
 * Create trade execution tools with safety gates.
 *
 * CRITICAL SAFETY DESIGN:
 * - Paper mode: simulates trade, returns mock response, logs intent
 * - Testnet mode: executes on Binance testnet (fake money)
 * - Live mode: executes on production (real money, with hard USD cap)
 * - All modes enforce maxTradeUsd from config
 */
export function createTradeTools(client: BinanceClient, config: BotConfig) {
  const executeBinanceTrade = new DynamicStructuredTool({
    name: 'execute_binance_trade',
    description:
      'Execute a buy or sell trade on Binance. IMPORTANT: Always check portfolio balance ' +
      'and current price before executing. The trade amount in USD must not exceed the ' +
      `configured limit ($${config.maxTradeUsd}). ` +
      `Current mode: ${config.tradingMode}. ` +
      (config.tradingMode === 'paper'
        ? 'Trades are SIMULATED — no real orders are placed.'
        : config.tradingMode === 'testnet'
          ? 'Trades execute on Binance TESTNET (fake money).'
          : 'Trades execute on LIVE Binance (real money).'),
    schema: z.object({
      symbol: z.string().describe("Trading pair symbol, e.g. 'BTCUSDT'"),
      side: z.enum(['BUY', 'SELL']).describe('Order side: BUY or SELL'),
      quoteAmountUsd: z
        .number()
        .positive()
        .describe('Amount in quote currency (USDT) to spend/receive'),
      type: z
        .enum(['MARKET', 'LIMIT'])
        .default('MARKET')
        .describe("Order type. Default 'MARKET'."),
      price: z
        .string()
        .optional()
        .describe('Limit price (required for LIMIT orders)'),
    }),
    func: async ({ symbol, side, quoteAmountUsd, type, price }) => {
      // Safety gate 1: enforce hard USD cap
      if (quoteAmountUsd > config.maxTradeUsd) {
        return JSON.stringify({
          error: `Trade rejected: $${quoteAmountUsd} exceeds maximum allowed ($${config.maxTradeUsd})`,
          maxTradeUsd: config.maxTradeUsd,
        });
      }

      // Safety gate 2: paper mode simulation
      if (config.tradingMode === 'paper') {
        return await simulatePaperTrade(client, symbol, side, quoteAmountUsd, type);
      }

      // Testnet and live modes: execute real API call
      const params: Record<string, string | number> = {
        symbol: symbol.toUpperCase(),
        side,
        type,
      };

      if (type === 'MARKET') {
        // For market orders, use quoteOrderQty to specify USD amount
        params.quoteOrderQty = quoteAmountUsd.toString();
      } else if (type === 'LIMIT') {
        if (!price) {
          return JSON.stringify({ error: 'Limit orders require a price' });
        }
        params.price = price;
        params.quantity = (quoteAmountUsd / parseFloat(price)).toFixed(8);
        params.timeInForce = 'GTC';
      }

      const order = await client.signedPost<OrderResponse>('/v3/order', params);

      return JSON.stringify({
        mode: config.tradingMode,
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        status: order.status,
        executedQty: order.executedQty,
        quoteQty: order.cummulativeQuoteQty,
        avgPrice:
          parseFloat(order.executedQty) > 0
            ? (
                parseFloat(order.cummulativeQuoteQty) /
                parseFloat(order.executedQty)
              ).toFixed(2)
            : 'N/A',
        fills: order.fills?.length ?? 0,
      });
    },
  });

  const cancelBinanceOrder = new DynamicStructuredTool({
    name: 'cancel_binance_order',
    description: 'Cancel an open order on Binance by order ID.',
    schema: z.object({
      symbol: z.string().describe("Trading pair symbol, e.g. 'BTCUSDT'"),
      orderId: z.number().describe('The order ID to cancel'),
    }),
    func: async ({ symbol, orderId }) => {
      if (config.tradingMode === 'paper') {
        return JSON.stringify({
          mode: 'paper',
          message: `Simulated cancel of order ${orderId} for ${symbol}`,
        });
      }

      const result = await client.signedDelete<OrderResponse>('/v3/order', {
        symbol: symbol.toUpperCase(),
        orderId,
      });

      return JSON.stringify({
        mode: config.tradingMode,
        orderId: result.orderId,
        symbol: result.symbol,
        status: result.status,
      });
    },
  });

  return [executeBinanceTrade, cancelBinanceOrder];
}

/**
 * Simulate a paper trade by fetching the current price and generating
 * a mock fill response. No API call to Binance order endpoint.
 */
async function simulatePaperTrade(
  client: BinanceClient,
  symbol: string,
  side: string,
  quoteAmountUsd: number,
  type: string
): Promise<string> {
  // Fetch current price for realistic simulation
  const ticker = await client.publicGet<PriceTicker>('/v3/ticker/price', {
    symbol: symbol.toUpperCase(),
  });
  const currentPrice = parseFloat(ticker.price);
  const quantity = quoteAmountUsd / currentPrice;

  const result: PaperTradeResult = {
    symbol: symbol.toUpperCase(),
    orderId: Math.floor(Math.random() * 1_000_000),
    clientOrderId: `paper_${Date.now()}`,
    transactTime: Date.now(),
    price: currentPrice.toString(),
    origQty: quantity.toFixed(8),
    executedQty: quantity.toFixed(8),
    cummulativeQuoteQty: quoteAmountUsd.toFixed(2),
    status: 'FILLED',
    type: type as PaperTradeResult['type'],
    side: side as PaperTradeResult['side'],
    fills: [
      {
        price: currentPrice.toString(),
        qty: quantity.toFixed(8),
        commission: '0',
        commissionAsset: 'USDT',
      },
    ],
    _paper: true,
  };

  return JSON.stringify({
    mode: 'paper',
    message: 'Trade SIMULATED — no real order placed',
    result,
  });
}
