import { loadState, saveState, setEmergencyStop, type BotState } from '../storage/state.js';
import { BinanceClient } from '../tools/binance/client.js';
import type { BotConfig, BinanceConfig } from '../config.js';
import type { Server } from 'bun';

export interface ApiConfig {
  port: number;
  apiKey: string;
  corsOrigin: string;
}

interface ApiContext {
  req: Request;
  params: Record<string, string>;
}

let schedulerRef: { isRunning: () => boolean; stop: () => void } | null = null;
let stateRef: BotState | null = null;
let clientRef: BinanceClient | null = null;

export function setScheduler(scheduler: { isRunning: () => boolean; stop: () => void }): void {
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

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function handleHealth(_ctx: ApiContext): Promise<Response> {
  return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
}

async function handleStatus(_ctx: ApiContext, _config: ApiConfig): Promise<Response> {
  const state = stateRef || loadState();
  
  return jsonResponse({
    running: schedulerRef?.isRunning() ?? false,
    emergencyStop: state.emergencyStop,
    mode: process.env.TRADING_MODE || 'paper',
    pairs: (process.env.BOT_PAIRS || 'BTCUSDT,ETHUSDT').split(','),
    lastUpdated: state.lastUpdated,
  });
}

async function handlePortfolio(_ctx: ApiContext, _config: ApiConfig): Promise<Response> {
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

async function handleTrades(_ctx: ApiContext): Promise<Response> {
  const state = loadState();
  const today = new Date().toISOString().split('T')[0];
  
  const { readFileSync, existsSync } = await import('fs');
  const logFile = `logs/trades-${today}.jsonl`;
  
  if (!existsSync(logFile)) {
    return jsonResponse({ trades: [], date: today });
  }

  try {
    const content = readFileSync(logFile, 'utf-8');
    const trades = content.trim().split('\n').map(line => JSON.parse(line));
    return jsonResponse({ trades, date: today });
  } catch {
    return jsonResponse({ trades: [], date: today });
  }
}

async function handleSignals(ctx: ApiContext, _config: ApiConfig): Promise<Response> {
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
    return jsonResponse({ emergencyStop: false, message: 'Trading can resume' });
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
    '/trades': handleTrades,
    '/signals/:pair': handleSignals,
    '/emergency-stop': handleEmergencyStop,
    '/config': handleConfig,
  };

  const server = Bun.serve({
    port: config.port,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      for (const [route, handler] of Object.entries(routes)) {
        const match = path.match(new RegExp('^' + route.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'));
        if (match) {
          const ctx: ApiContext = {
            req,
            params: match.groups || {},
          };
          
          const response = handler(ctx, config);
          
          if (config.corsOrigin) {
            return response.then(res => {
              res.headers.set('Access-Control-Allow-Origin', config.corsOrigin);
              res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
              res.headers.set('Access-Control-Allow-Headers', 'X-API-Key, Content-Type');
              return res;
            });
          }
          
          return response;
        }
      }

      return errorResponse('Not found', 404);
    },
  });

  console.log(`[API] Server running on port ${config.port}`);
  return server;
}
