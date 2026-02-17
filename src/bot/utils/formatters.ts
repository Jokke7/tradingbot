/**
 * Formatting helpers for prices, volumes, and percentages.
 */

/** Format a number as USD with appropriate precision */
export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(6)}`;
}

/** Format a percentage with sign */
export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** Format a crypto quantity (8 decimal places, trim trailing zeros) */
export function formatQuantity(value: number): string {
  return parseFloat(value.toFixed(8)).toString();
}

/** Format a timestamp as ISO string */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}
