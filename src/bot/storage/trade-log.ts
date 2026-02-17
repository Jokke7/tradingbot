import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface TradeLogEntry {
  timestamp: string;
  pair: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
  size_usd: number;
  executed: boolean;
  orderId?: number;
  price?: number;
  error?: string;
  mode: 'paper' | 'testnet' | 'live';
}

interface LogEntryWithoutTimestamp {
  pair: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
  size_usd: number;
  executed: boolean;
  orderId?: number;
  price?: number;
  error?: string;
  mode: 'paper' | 'testnet' | 'live';
}

const LOG_DIR = 'logs';

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFilename(): string {
  const date = new Date().toISOString().split('T')[0];
  return `${LOG_DIR}/trades-${date}.jsonl`;
}

export function logTrade(entry: TradeLogEntry): void {
  ensureLogDir();
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(getLogFilename(), line);
}

export function logDecision(
  pair: string,
  action: 'BUY' | 'SELL' | 'HOLD',
  confidence: number,
  reasoning: string,
  size_usd: number,
  mode: 'paper' | 'testnet' | 'live'
): void {
  logTrade({
    timestamp: new Date().toISOString(),
    pair,
    action,
    confidence,
    reasoning,
    size_usd,
    executed: false,
    mode,
  });
}

export function logExecution(
  pair: string,
  action: 'BUY' | 'SELL',
  confidence: number,
  reasoning: string,
  size_usd: number,
  orderId: number,
  price: number,
  mode: 'paper' | 'testnet' | 'live'
): void {
  logTrade({
    timestamp: new Date().toISOString(),
    pair,
    action,
    confidence,
    reasoning,
    size_usd,
    executed: true,
    orderId,
    price,
    mode,
  });
}

export function logError(
  pair: string,
  action: 'BUY' | 'SELL' | 'HOLD',
  error: string,
  mode: 'paper' | 'testnet' | 'live'
): void {
  logTrade({
    timestamp: new Date().toISOString(),
    pair,
    action,
    confidence: 0,
    reasoning: error,
    size_usd: 0,
    executed: false,
    error,
    mode,
  });
}
