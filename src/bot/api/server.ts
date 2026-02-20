import { loadState, saveState, setEmergencyStop, type BotState } from '../storage/state.js';
import { BinanceClient } from '../tools/binance/client.js';
import type { BotConfig, BinanceConfig } from '../config.js';
import type { Server } from 'bun';

export interface ApiConfig {
  port: number;
  apiKey: string;
  corsOrigin: string;
  tls?: {
    certFile: string;
    keyFile: string;
  };
}

interface ApiContext {
  req: Request;
  params: Record<string, string>;
}

let schedulerRef: { isRunning: () => boolean; stop: () => void; start: () => void } | null = null;
let stateRef: BotState | null = null;
let clientRef: BinanceClient | null = null;

export function setScheduler(scheduler: { isRunning: () => boolean; stop: () => void; start: () => void }): void {
  schedulerRef = scheduler;
}

export function setState(state: BotState): void {
  stateRef = state;
}

export function setBinanceClient(client: BinanceClient): void {
  clientRef = client;
}

function parseAuthHeader(req: Request, config: ApiConfig): boolean {
  const authHeader = req.headers.get('X-API-Key');
  return authHeader === config.apiKey;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function addCorsHeaders(res: Response, corsOrigin: string | undefined): Response {
  if (corsOrigin) {
    res.headers.set('Access-Control-Allow-Origin', corsOrigin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'X-API-Key, Content-Type');
  }
  return res;
}

function errorResponse(message: string, status = 400, corsOrigin?: string): Response {
  const res = jsonResponse({ error: message }, status);
  return addCorsHeaders(res, corsOrigin);
}

async function handleHealth(_ctx: ApiContext): Promise<Response> {
  return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
}

async function handleStatus(_ctx: ApiContext, _config: ApiConfig): Promise<Response> {
  const state = loadState();
  const schedulerRunning = schedulerRef?.isRunning() ?? false;
  
  return jsonResponse({
    running: schedulerRunning && !state.emergencyStop,
    emergencyStop: state.emergencyStop,
    mode: process.env.TRADING_MODE || 'paper',
    pairs: (process.env.BOT_PAIRS || 'BTCUSDT,ETHUSDT').split(','),
    lastUpdated: state.lastUpdated,
  });
}

async function handlePortfolio(ctx: ApiContext, config: ApiConfig): Promise<Response> {
  if (!parseAuthHeader(ctx.req, config)) {
    return errorResponse('Unauthorized', 401);
  }

  if (!clientRef) {
    return errorResponse('Binance client not available', 503);
  }

  try {
    const account = await clientRef.signedGet('/v3/account', {});
    const balances = (account as { balances: { asset: string; free: string; locked: string }[] })
      .balances
      .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
      .map(b => ({
        asset: b.asset,
        free: b.free,
        locked: b.locked,
      }));

    return jsonResponse({ balances });
  } catch (e) {
    return errorResponse(`Failed to fetch portfolio: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handlePositions(ctx: ApiContext, config: ApiConfig): Promise<Response> {
  if (!parseAuthHeader(ctx.req, config)) {
    return errorResponse('Unauthorized', 401);
  }

  if (!clientRef) {
    return errorResponse('Binance client not available', 503);
  }

  try {
    const state = loadState();
    const positionsWithPrice = await Promise.all(
      state.positions.map(async (pos) => {
        try {
          const ticker = await clientRef!.publicGet('/v3/ticker/price', { symbol: pos.symbol });
          const price = parseFloat((ticker as { price: string }).price);
          const value = pos.quantity * price;
          return {
            symbol: pos.symbol,
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: price,
            value: value,
            pnl: value - (pos.quantity * pos.avgPrice),
            pnlPercent: ((price - pos.avgPrice) / pos.avgPrice) * 100,
          };
        } catch {
          return {
            symbol: pos.symbol,
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: pos.avgPrice,
            value: pos.quantity * pos.avgPrice,
            pnl: 0,
            pnlPercent: 0,
          };
        }
      })
    );

    return jsonResponse({ positions: positionsWithPrice });
  } catch (e) {
    return errorResponse(`Failed to fetch positions: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleRecommendations(ctx: ApiContext, config: ApiConfig): Promise<Response> {
  if (!parseAuthHeader(ctx.req, config)) {
    return errorResponse('Unauthorized', 401);
  }

  const { readFileSync, existsSync } = await import('fs');
  const today = new Date().toISOString().split('T')[0];
  const logFile = `logs/portfolio-recommendations.jsonl`;

  if (!existsSync(logFile)) {
    return jsonResponse({ recommendations: [], date: today });
  }

  try {
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.trim().split('\n').slice(-50);
    const recommendations = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
    return jsonResponse({ recommendations, date: today });
  } catch {
    return jsonResponse({ recommendations: [], date: today });
  }
}

async function handleTrades(ctx: ApiContext, config: ApiConfig): Promise<Response> {
  if (!parseAuthHeader(ctx.req, config)) {
    return errorResponse('Unauthorized', 401);
  }

  const state = loadState();
  const today = new Date().toISOString().split('T')[0];

  const { readFileSync, existsSync } = await import('fs');
  const logFile = `logs/trades-${today}.jsonl`;
  console.log(`[API] Reading trades from: ${logFile}, exists: ${existsSync(logFile)}`);

  if (!existsSync(logFile)) {
    return jsonResponse({ trades: [], date: today });
  }

  try {
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.trim().split('\n');
    console.log(`[API] Read ${lines.length} lines from ${logFile}`);
    const trades = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
    return jsonResponse({ trades, date: today });
  } catch (e) {
    console.error(`[API] Error reading trades: ${e}`);
    return jsonResponse({ trades: [], date: today });
  }
}

async function handleSignals(ctx: ApiContext, config: ApiConfig): Promise<Response> {
  if (!parseAuthHeader(ctx.req, config)) {
    return errorResponse('Unauthorized', 401);
  }

  const symbol = ctx.params.pair?.toUpperCase();
  if (!symbol) {
    return errorResponse('Missing pair parameter');
  }

  if (!clientRef) {
    return errorResponse('Binance client not available', 503);
  }

  try {
    const [ticker, klines] = await Promise.all([
      clientRef.publicGet('/v3/ticker/24hr', { symbol }),
      clientRef.publicGet('/v3/klines', { symbol, interval: '1h', limit: 200 }),
    ]);

    const closes = (klines as number[][]).map(k => parseFloat(k[4] as unknown as string));

    const { rsi, sma, macd } = await import('../utils/indicators.js');

    const data = {
      symbol,
      price: (ticker as { lastPrice: string }).lastPrice,
      change24h: (ticker as { priceChangePercent: string }).priceChangePercent,
      rsi: rsi(closes, 14),
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      macd: macd(closes),
    };

    return jsonResponse(data);
  } catch (e) {
    return errorResponse(`Failed to fetch signals: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleEmergencyStop(ctx: ApiContext, config: ApiConfig): Promise<Response> {
  if (!parseAuthHeader(ctx.req, config)) {
    return errorResponse('Unauthorized', 401);
  }

  const { action } = ctx.req.method === 'POST' 
    ? await ctx.req.json().catch(() => ({ action: 'status' }))
    : { action: 'status' };

  const state = loadState();
  
  if (action === 'stop') {
    setEmergencyStop(state, true);
    saveState(state);
    schedulerRef?.stop();
    return jsonResponse({ emergencyStop: true, message: 'Trading stopped' });
  } else if (action === 'start') {
    setEmergencyStop(state, false);
    saveState(state);
    schedulerRef?.start();
    return jsonResponse({ emergencyStop: false, message: 'Trading can resume', running: schedulerRef?.isRunning() ?? false });
  }

  return jsonResponse({ emergencyStop: state.emergencyStop });
}

async function handleConfig(ctx: ApiContext, config: ApiConfig): Promise<Response> {
  if (!parseAuthHeader(ctx.req, config)) {
    return errorResponse('Unauthorized', 401);
  }

  if (ctx.req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const updates = await ctx.req.json().catch(() => ({}));
  
  const allowedKeys = ['BOT_PAIRS', 'BOT_CHECK_INTERVAL_MS', 'BOT_CONFIDENCE_THRESHOLD'];
  let message = 'Config updated: ';
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedKeys.includes(key)) {
      process.env[key] = String(value);
      message += `${key}=${value}, `;
    }
  }

  return jsonResponse({ success: true, message: message.slice(0, -2) });
}

export async function startApiServer(config: ApiConfig): Promise<unknown> {
  const routes: Record<string, (ctx: ApiContext, config: ApiConfig) => Promise<Response>> = {
    '/health': handleHealth,
    '/status': handleStatus,
    '/portfolio': handlePortfolio,
    '/positions': handlePositions,
    '/recommendations': handleRecommendations,
    '/trades': handleTrades,
    '/signals/:pair': handleSignals,
    '/emergency-stop': handleEmergencyStop,
    '/config': handleConfig,
  };

  const serverOptions: Bun.ServeOptions = {
    port: config.port,
    fetch(req: Request) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': config.corsOrigin || '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      for (const [route, handler] of Object.entries(routes)) {
        const match = path.match(new RegExp('^' + route.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'));
        if (match) {
          const ctx: ApiContext = {
            req,
            params: match.groups || {},
          };

          const response = handler(ctx, config);

          return response.then(res => addCorsHeaders(res, config.corsOrigin));
        }
      }

      return errorResponse('Not found', 404, config.corsOrigin);
    },
  };

  if (config.tls) {
    Object.assign(serverOptions, {
      tls: {
        cert: await Bun.file(config.tls.certFile).text(),
        key: await Bun.file(config.tls.keyFile).text(),
      },
    });
  }

  const server = Bun.serve(serverOptions);

  console.log(`[API] Server running on port ${config.port}${config.tls ? ' (HTTPS)' : ''}`);
  return server;
}
