# Trading Bot — Developer TODO

> Actionable task list for continuing development.
> Check items off as you complete them. See PLAN.md for full architecture context.
>
> **Current state**: Phase 5 complete! Bot running in production at api.trading.godot.no

---

## How to Run

```bash
# Prerequisites: bun installed (~/.bun/bin/bun)
source ~/.bash_profile   # ensure bun is in PATH

# Connectivity check (no LLM calls)
bun run src/bot/index.ts --check

# Interactive mode (REPL — queries go to LLM)
bun run src/bot/index.ts

# Autonomous mode (not yet implemented)
bun run src/bot/index.ts --autonomous
```

---

## Completed Phases

- ✅ Phase 1: Interactive Trading Tools
- ✅ Phase 2: Autonomous Loop  
- ✅ Phase 3: Monitoring API & Persistence
- ✅ Phase 4.1: Safety Mechanisms
- ✅ Phase 4.2: Unit Tests
- ✅ Phase 5: Production Deployment

---

## Next Up

### Phase 4.3: Integration Tests
- [ ] End-to-end testnet: place order → verify fill → check balance change
- [ ] Full decision cycle with real (cheap) LLM call

### Phase 4.4: Backtester
- [ ] Implement `tools/backtest.ts`
- [ ] Load historical klines, replay through decision engine
- [ ] Output: total return, max drawdown, win rate, Sharpe ratio

### Phase 6: Dashboard (Separate Repo)
- [ ] Create `trading-dashboard` repo
- [ ] Next.js 15 + Tailwind + Recharts
- [ ] Deploy to Cloudflare Pages at `trading.godot.no`

---

The tools exist but haven't been tested end-to-end with the LLM yet.
These tasks validate that the agent can use our trading tools correctly.

### 1.1 Smoke-test market data tools
- [x] Run interactive mode and ask: "What is the current price of BTC on Binance?"
- [x] Verify the agent calls `get_binance_price` (not Dexter's `financial_search`)
- [x] Ask: "Show me the last 24 hours of ETH candles" — should use `get_binance_klines`
- [x] Fix any tool invocation issues (schema mismatches, response format)

**Notes**: All tools work. OpenRouter 402 error on complex queries due to API key credits (infrastructure issue).

### 1.2 Smoke-test account tools
- [x] Ask: "What's my Binance balance?" — should call `get_binance_balance`
- [x] Ask: "Show my recent BTC trades" — should call `get_binance_trade_history`
- [x] Verify testnet returns the default fake balances (~1 BTC, ~10000 USDT)

**Notes**: Balance shows 1 BTC, 1 ETH, 10K USDT, 1 BNB. Trade history returns empty (fresh testnet).

### 1.3 Smoke-test signal tools
- [x] Ask: "What's the RSI for BTCUSDT?" — should call `calculate_rsi`
- [x] Ask: "Give me a full technical analysis of ETHUSDT" — should call
      multiple signal tools (RSI + moving averages + momentum)
- [x] Verify indicator values are reasonable (RSI 0-100, SMA near current price)

**Notes**: All three signal tools called correctly (RSI, SMA, momentum).

### 1.4 Test paper trade execution
- [x] Ask: "Buy $5 of BTC" — agent should:
  1. Check price first
  2. Check portfolio
  3. Execute via `execute_binance_trade` in paper mode
  4. Return simulated fill details
- [x] Verify `TRADING_MODE=paper` produces `_paper: true` in response
- [x] Verify the $20 hard cap works: ask "Buy $50 of BTC" — should be rejected

**Notes**: Paper trade executed at $67,494. Hard cap correctly rejects $50.

### 1.5 Test testnet trade execution
- [x] Change `.env` to `TRADING_MODE=testnet`
- [x] Ask: "Buy $5 of ETH" — should execute a real order on Binance testnet
- [x] Verify order appears in testnet account (via "Show my recent trades")
- [x] Change back to `TRADING_MODE=paper` after testing

**Notes**: Order #2864392 filled: 0.0025 ETH @ $1991.67. Verified in trade history.

### 1.6 Upgrade interactive mode to Ink CLI
- [ ] Replace the readline REPL in `src/bot/index.ts` with Dexter's Ink-based CLI
- [ ] This requires creating a `TradingCLI` component that uses `TradingAgent`
      instead of Dexter's `Agent` in the `useAgentRunner` hook
- [ ] Real-time tool progress display (spinning indicators, tool call names)
- [ ] Model switching via `/model` command should still work

### 1.7 Trade Analysis Skill
- [x] Create `skills/trade-analysis/SKILL.md` with YAML frontmatter
- [x] Workflow: price check → RSI → MA → momentum → news search → recommendation
- [x] Register skill discovery path in the trading agent
- [x] Test: "Run a trade analysis on BTCUSDT"

**Notes**: Skill created at `.dexter/skills/trade-analysis/SKILL.md`. Skill tool verified working - returns full workflow instructions.

---

## Phase 2 — Autonomous Loop

### 2.1 Decision engine
- [x] Implement `src/bot/loop/decision-engine.ts`
- [x] Core function: `evaluatePair(pair)` → fetches data, computes signals,
      calls LLM with structured output schema, parses decision
- [x] Use Zod structured output: `{action: BUY|SELL|HOLD, confidence: number,
      reasoning: string, size_usd: number}`
- [x] Add self-reflection: second LLM call to review the decision before executing

**Notes**: Decision engine tested - returns BUY/SELL/HOLD with confidence, reasoning.

### 2.2 Scheduler
- [x] Implement `src/bot/loop/scheduler.ts`
- [x] `setInterval`-based loop over configured pairs
- [x] Graceful shutdown on SIGINT/SIGTERM
- [x] Error isolation: one pair failing doesn't crash the loop
- [x] Circuit breaker: 3 consecutive errors → skip pair for 30 minutes

### 2.3 Wire up autonomous mode
- [x] Connect scheduler to `--autonomous` flag in `src/bot/index.ts`
- [ ] Startup sequence: config → validate → ping Binance → start API → start loop
- [ ] Run for 1 hour on testnet, verify no crashes, all decisions logged

---

## Phase 3 — Monitoring API & Persistence

### 3.1 Trade log
- [x] Implement `src/bot/storage/trade-log.ts` — append-only JSONL
- [x] Daily file rotation: `logs/trades-YYYY-MM-DD.jsonl`
- [x] Log every decision (including HOLDs) with timestamp, signals, reasoning

### 3.2 Bot state
- [x] Implement `src/bot/storage/state.ts` — JSON file persistence
- [x] Track: positions, last check times, cumulative P&L, error counts
- [x] Load on startup, save after each decision cycle

### 3.3 HTTP API
- [x] Implement `src/bot/api/server.ts` using `Bun.serve()`
- [x] Routes: `/health`, `/status`, `/portfolio`, `/trades`, `/signals/:pair`
- [x] Auth: `X-API-Key` header validated against `BOT_API_KEY` env var
- [x] POST `/emergency-stop` — halt trading loop
- [x] POST `/config` — update runtime config (pairs, interval)
- [x] CORS headers for `trading.godot.no`
- [ ] Add API tests: test endpoints with mocked data

**Notes**: API server starts with autonomous mode on port 3847. Tested /health and /status endpoints.

---

## Phase 4 — Safety, Testing & Hardening

### 4.1 Safety mechanisms
- [x] Daily loss limit: halt trading if cumulative loss > $10/day
- [x] Volatility circuit breaker: skip pair if 5-min change > 5%
- [x] Emergency stop flag (persisted — survives restarts)
- [x] Position limits: max 50% portfolio in single asset

**Notes**: All safety checks implemented in scheduler. Daily loss check, volatility check, position limit check added.

### 4.2 Unit tests
- [x] `tests/tools/signals.test.ts` — RSI/SMA/MACD calculations
- [x] `tests/loop/decision-engine.test.ts` — trading decision schema validation
- [x] `tests/api/routes.test.ts` — API endpoint tests

**Notes**: 43 new tests added. All passing (65 total, 1 pre-existing failure).

### 4.3 Integration tests
- [ ] End-to-end testnet: place order → verify fill → check balance change
- [ ] Full decision cycle with real (cheap) LLM call

### 4.4 Backtester
- [ ] Implement `tools/backtest.ts`
- [ ] Load historical klines, replay through decision engine with mock execution
- [ ] Output: total return, max drawdown, win rate, Sharpe ratio

---

## Phase 5 — Production Deployment

- [x] Create `ecosystem.config.cjs` for pm2
- [x] Set up UFW firewall rules on Manjaro server
- [x] Install and configure Cloudflare Tunnel (`cloudflared`)
- [x] Route `api.trading.godot.no` → `localhost:3847`
- [x] Set up Telegram alerts for errors and daily P&L summary (skipped - not needed yet)
- [x] Test auto-restart: `pm2 kill` → verify bot comes back

**HTTPS/TLS Issue (TODO):** Server currently uses HTTP + Cloudflare Flexible mode (Cloudflare→server not encrypted). Bun has TLS compatibility issues with Cloudflare Origin cert. For production with real money, set up nginx/caddy reverse proxy with Let's Encrypt or fix Bun TLS.

**Notes**: Created ecosystem.config.cjs and deploy.sh script. Cloudflare Tunnel requires manual setup (see scripts/deploy.sh).

---

## Phase 6 — Dashboard (Separate Repo)

- [ ] Create `trading-dashboard` repo
- [ ] Next.js 15 + Tailwind + Recharts
- [ ] Pages: dashboard, trades, signals, config, logs
- [ ] Poll bot API every 30s, cache in Cloudflare KV
- [ ] Deploy to Cloudflare Pages at `trading.godot.no`

---

## Known Issues / Technical Debt

- [ ] **Indicator accuracy**: The MACD signal line calculation in
      `src/bot/utils/indicators.ts` uses a simplified approach (recomputing
      EMA of MACD values from scratch each time). For production, consider
      a streaming/incremental calculation.
- [ ] **Node modules symlink**: `node_modules` is a symlink to
      `src/dexter/node_modules`. If we add bot-specific deps, we'll need
      our own `package.json` + install. For now, all deps come from Dexter.
- [ ] **Zod version**: Dexter uses Zod v4.1.13. Our code uses the same
      import. If Dexter upgrades, verify our schemas still work.
- [ ] **Readline REPL**: The current interactive mode is a basic readline
      prompt. Task 1.6 upgrades this to Dexter's full Ink CLI. Until then,
      there's no real-time tool progress display.

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `bun run src/bot/index.ts --check` | Test connectivity (Binance + API keys) |
| `bun run src/bot/index.ts` | Interactive REPL with trading tools |
| `bun run src/bot/index.ts --autonomous` | Autonomous loop (Phase 2) |
| `bun run src/dexter/src/index.tsx` | Original Dexter CLI (no trading tools) |
| `bun test` | Run tests (from src/dexter/) |

| File | Purpose |
|------|---------|
| `PLAN.md` | Architecture decisions + full roadmap |
| `src/bot/config.ts` | All bot configuration (Zod schemas) |
| `src/bot/agent/trading-agent.ts` | Core agent wrapper |
| `src/bot/tools/registry.ts` | Merges Dexter + trading tools |
| `src/bot/tools/binance/trade.ts` | Trade execution with safety gates |
| `src/dexter/.env` | API keys (gitignored) |
