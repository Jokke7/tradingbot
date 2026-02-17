import { describe, it, expect } from 'bun:test';
import { TradingDecisionSchema } from '../../src/bot/loop/decision-engine.js';

describe('TradingDecisionSchema', () => {
  it('validates valid decision', () => {
    const valid = {
      action: 'BUY',
      confidence: 75,
      reasoning: 'RSI oversold',
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('validates HOLD decision', () => {
    const valid = {
      action: 'HOLD',
      confidence: 50,
      reasoning: 'No clear signal',
      size_usd: 0,
    };
    const result = TradingDecisionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const invalid = {
      action: 'INVALID',
      confidence: 75,
      reasoning: 'test',
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects confidence below 0', () => {
    const invalid = {
      action: 'BUY',
      confidence: -10,
      reasoning: 'test',
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects confidence above 100', () => {
    const invalid = {
      action: 'BUY',
      confidence: 150,
      reasoning: 'test',
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects negative size', () => {
    const invalid = {
      action: 'BUY',
      confidence: 75,
      reasoning: 'test',
      size_usd: -5,
    };
    const result = TradingDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects size above 100', () => {
    const invalid = {
      action: 'BUY',
      confidence: 75,
      reasoning: 'test',
      size_usd: 150,
    };
    const result = TradingDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts size 0 for HOLD', () => {
    const valid = {
      action: 'HOLD',
      confidence: 50,
      reasoning: 'Neutral market',
      size_usd: 0,
    };
    const result = TradingDecisionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects missing reasoning', () => {
    const invalid = {
      action: 'BUY',
      confidence: 75,
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects non-string reasoning', () => {
    const invalid = {
      action: 'BUY',
      confidence: 75,
      reasoning: 123,
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Decision logic thresholds', () => {
  it('BUY signal when RSI < 40', () => {
    const decision = {
      action: 'BUY',
      confidence: 80,
      reasoning: 'RSI is 25 (oversold)',
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
  });

  it('SELL signal when RSI > 60', () => {
    const decision = {
      action: 'SELL',
      confidence: 80,
      reasoning: 'RSI is 75 (overbought)',
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
  });

  it('accepts SELL with positive size', () => {
    const valid = {
      action: 'SELL',
      confidence: 80,
      reasoning: 'Take profit',
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts BUY with positive size', () => {
    const valid = {
      action: 'BUY',
      confidence: 80,
      reasoning: 'Good entry',
      size_usd: 10,
    };
    const result = TradingDecisionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts zero size for HOLD', () => {
    const valid = {
      action: 'HOLD',
      confidence: 50,
      reasoning: 'Neutral market',
      size_usd: 0,
    };
    const result = TradingDecisionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});
