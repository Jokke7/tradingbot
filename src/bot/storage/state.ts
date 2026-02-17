import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
}

export interface BotState {
  version: number;
  positions: Position[];
  lastCheckTimes: Record<string, string>;
  cumulativePnl: number;
  dailyPnl: number;
  dailyLossCount: number;
  lastDailyReset: string;
  errorCounts: Record<string, number>;
  emergencyStop: boolean;
  lastUpdated: string;
}

const STATE_FILE = 'logs/bot-state.json';

function ensureStateDir(): void {
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadState(): BotState {
  ensureStateDir();
  
  if (!existsSync(STATE_FILE)) {
    return createDefaultState();
  }

  try {
    const data = readFileSync(STATE_FILE, 'utf-8');
    const state = JSON.parse(data) as BotState;
    checkDailyReset(state);
    return state;
  } catch {
    return createDefaultState();
  }
}

export function saveState(state: BotState): void {
  ensureStateDir();
  state.lastUpdated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function createDefaultState(): BotState {
  return {
    version: 1,
    positions: [],
    lastCheckTimes: {},
    cumulativePnl: 0,
    dailyPnl: 0,
    dailyLossCount: 0,
    lastDailyReset: new Date().toISOString().split('T')[0],
    errorCounts: {},
    emergencyStop: false,
    lastUpdated: new Date().toISOString(),
  };
}

function checkDailyReset(state: BotState): void {
  const today = new Date().toISOString().split('T')[0];
  if (state.lastDailyReset !== today) {
    state.dailyPnl = 0;
    state.dailyLossCount = 0;
    state.lastDailyReset = today;
  }
}

export function updatePosition(state: BotState, symbol: string, quantity: number, price: number): void {
  const existing = state.positions.find(p => p.symbol === symbol);
  
  if (quantity <= 0) {
    if (existing) {
      state.positions = state.positions.filter(p => p.symbol !== symbol);
    }
    return;
  }

  if (existing) {
    const totalQty = existing.quantity + quantity;
    const totalValue = (existing.quantity * existing.avgPrice) + (quantity * price);
    existing.avgPrice = totalValue / totalQty;
    existing.quantity = totalQty;
  } else {
    state.positions.push({ symbol, quantity, avgPrice: price });
  }
}

export function recordTradePnl(state: BotState, pnl: number): void {
  state.cumulativePnl += pnl;
  state.dailyPnl += pnl;
  if (pnl < 0) {
    state.dailyLossCount++;
  }
}

export function setEmergencyStop(state: BotState, stop: boolean): void {
  state.emergencyStop = stop;
}

export function incrementErrorCount(state: BotState, pair: string): void {
  state.errorCounts[pair] = (state.errorCounts[pair] || 0) + 1;
}

export function resetErrorCount(state: BotState, pair: string): void {
  delete state.errorCounts[pair];
}
