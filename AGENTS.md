# Trading Bot — Agent Guidelines

> Guidelines for agentic coding agents working on this repository.
> See TODO.md for current task list and PLAN.md for architecture context.

---

## Project Overview

- **Type**: Autonomous crypto trading bot extending Dexter (AI agent framework)
- **Runtime**: Bun (TypeScript/ESM)
- **Entry point**: `src/bot/index.ts`
- **Dexter location**: `src/dexter/` (read-only upstream — never modify)
- **Current phase**: Phase 1 — Interactive Trading Tools

---

## Build, Test & Development Commands

| Command | Description |
|---------|-------------|
| `bun run src/bot/index.ts --check` | Connectivity check (Binance + API keys, no LLM) |
| `bun run src/bot/index.ts` | Interactive REPL mode |
| `bun run src/bot/index.ts --autonomous` | Autonomous trading loop |
| `bun run typecheck` | Type-check bot code |
| `bun test` | Run all tests |
| `bun test path/to/file.test.ts` | Run single test file |
| `bun test --grep "name"` | Run tests matching pattern |
| `bun test --watch` | Run tests in watch mode |

**CI pipeline**: Runs `bun run typecheck` and `bun test` on push/PR.

---

## Code Style Guidelines

### General Principles

- **Language**: TypeScript (ESM, strict mode). No `any` — use `unknown` + type guards.
- **Files**: Keep concise (<200 lines). Extract helpers to avoid duplication.
- **Comments**: Brief comments for non-obvious logic only.
- **Documentation**: Do not create README or docs unless explicitly asked.

### Imports & Path Aliases

Use path aliases configured in `tsconfig.json`:
- `@dexter/*` → `./src/dexter/src/*`
- `@bot/*` → `./src/bot/*`

```typescript
// Good
import { Agent } from '@dexter/agent';
import { getBinancePrice } from '@bot/tools/binance';
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `trade-execution.ts` |
| Types/Interfaces | PascalCase | `TradeRequest` |
| Functions | camelCase | `executeTrade()` |
| Constants | UPPER_SNAKE_CASE | `MAX_TRADE_USD` |
| Enums | PascalCase | `TradingMode.Paper` |

### TypeScript & Zod

- Use Zod for runtime validation (config, API responses, tool schemas)
- Prefer `z.infer<typeof Schema>` over manual type definitions

```typescript
export const MySchema = z.object({ field: z.string() });
export type MyType = z.infer<typeof MySchema>;
```

### Error Handling

- Use typed errors with `Error` subclasses for specific failure modes
- Never swallow errors silently — at minimum log and re-throw
- Binance API errors: parse error codes, provide actionable messages
- Graceful degradation: paper mode fallback if testnet fails

### Formatting

- 2-space indentation, no tabs
- Trailing commas in multiline objects/arrays
- Single quotes for strings
- Semicolons at end of statements
- Max line length: 100 characters (soft limit)

---

## Project Structure

```
src/bot/
├── index.ts              # Entry point (CLI)
├── config.ts             # Zod config schemas + env parsing
├── agent/
│   ├── trading-agent.ts  # Core agent (wraps Dexter)
│   └── trading-prompts.ts
├── tools/
│   ├── registry.ts       # Merges Dexter + trading tools
│   ├── binance/          # Binance API client + tools
│   │   ├── client.ts     # HTTP client with HMAC signing
│   │   ├── market-data.ts # get_binance_price, get_binance_klines
│   │   ├── account.ts    # get_binance_balance
│   │   └── trade.ts      # execute_binance_trade
│   └── signals/          # Technical indicators (RSI, MA, momentum)
src/dexter/               # Upstream (READ-ONLY)
```

---

## Trading Bot Guidelines

### Safety First

- **Never modify `src/dexter/`** — import from it, don't patch it
- **Paper mode first** — all new features test in paper mode
- **Hard limits** — $20 max trade (enforced in code), $10 daily loss limit
- **Testnet before live** — verify on Binance testnet before real trades

### Tool Development

- All trading tools must have Zod input schemas
- Document tool purpose in JSDoc for system prompt injection
- Return structured responses for parsing reliability
- Include `_paper: boolean` in trade responses

### Environment Variables

Required in `.env` (never commit):
```
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
OPENROUTER_API_KEY=...
TRADING_MODE=paper  # paper | testnet | live
```

Optional: `MAX_TRADE_USD`, `API_PORT`, `BOT_API_KEY`

---

## Testing Guidelines

- Tests colocated as `*.test.ts` next to source files
- Use Bun's built-in test runner
- Mock external APIs (Binance, LLM) for unit tests
- Test indicator calculations against known values

```typescript
import { describe, it, expect } from 'bun:test';

describe('RSI calculation', () => {
  it('returns correct value for known input', () => {
    const result = calculateRsi([...], 14);
    expect(result).toBe(65.2);
  });
});
```

---

## Git Workflow

1. **Never commit to main without user approval**
2. **Run typecheck + tests before committing**
3. **Use clear commit messages**: "Add RSI tool", not "fix stuff"
4. **Push only after authentication**: `gh auth status`

---

## Security

- Never commit API keys, tokens, or credentials
- Use `.env` files (gitignored) for secrets
- Validate all external input with Zod
- Sanitize error messages before exposing to users
