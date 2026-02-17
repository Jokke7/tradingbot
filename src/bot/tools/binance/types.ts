/**
 * Binance API types.
 * Covers REST responses for spot trading on both testnet and production.
 */

/** Base URLs for Binance environments */
export const BINANCE_URLS = {
  testnet: {
    rest: 'https://testnet.binance.vision/api',
    ws: 'wss://testnet.binance.vision/ws',
  },
  production: {
    rest: 'https://api.binance.com/api',
    ws: 'wss://stream.binance.com:9443/ws',
  },
} as const;

/** Order side */
export type OrderSide = 'BUY' | 'SELL';

/** Order type */
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT_LIMIT';

/** Order status from Binance */
export type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'PENDING_CANCEL'
  | 'REJECTED'
  | 'EXPIRED';

/** Time in force for limit orders */
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

/** Kline/candlestick interval */
export type KlineInterval =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h'
  | '1d' | '3d' | '1w' | '1M';

/** Price ticker response */
export interface PriceTicker {
  symbol: string;
  price: string;
}

/** 24hr ticker statistics */
export interface Ticker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  highPrice: string;
  lowPrice: string;
}

/** Kline/candlestick data (array format from Binance) */
export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
}

/** Order book entry [price, quantity] */
export type OrderBookEntry = [string, string];

/** Order book response */
export interface OrderBook {
  lastUpdateId: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

/** Account balance for a single asset */
export interface AssetBalance {
  asset: string;
  free: string;
  locked: string;
}

/** Account information response */
export interface AccountInfo {
  balances: AssetBalance[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
}

/** New order response */
export interface OrderResponse {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: OrderStatus;
  type: OrderType;
  side: OrderSide;
  fills: OrderFill[];
}

/** Order fill detail */
export interface OrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
}

/** Trade history entry */
export interface TradeRecord {
  id: number;
  symbol: string;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}

/** Parameters for placing a new order */
export interface NewOrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity?: string;
  quoteOrderQty?: string;
  price?: string;
  timeInForce?: TimeInForce;
}

/** Paper trade simulation result (mirrors OrderResponse shape) */
export interface PaperTradeResult {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: 'FILLED';
  type: OrderType;
  side: OrderSide;
  fills: OrderFill[];
  /** Marker that this was a simulated trade */
  _paper: true;
}

/** Binance API error response */
export interface BinanceApiError {
  code: number;
  msg: string;
}
