/**
 * Safe number formatting with null/undefined/NaN handling
 * Prevents "Cannot read properties of null (reading 'toFixed')" crashes
 */

/**
 * Safely format a number as a price
 * @param value - The number to format (can be null/undefined)
 * @param decimals - Number of decimal places (default: 2)
 * @param fallback - Fallback string if value is invalid (default: '-')
 * @returns Formatted price string or fallback
 */
export function formatPrice(
  value: number | null | undefined,
  decimals: number = 2,
  fallback: string = '-'
): string {
  if (value == null || !isFinite(value)) return fallback;
  return value.toFixed(decimals);
}

/**
 * Safely format a number as a percentage
 * @param value - The decimal number to format (e.g., 0.25 for 25%)
 * @param decimals - Number of decimal places (default: 1)
 * @param fallback - Fallback string if value is invalid (default: '-')
 * @returns Formatted percentage string or fallback
 */
export function formatPercent(
  value: number | null | undefined,
  decimals: number = 1,
  fallback: string = '-'
): string {
  if (value == null || !isFinite(value)) return fallback;
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Safely format a Greek value (Delta, Gamma, Vega, Theta)
 * @param value - The Greek value to format
 * @param decimals - Number of decimal places (default: 4)
 * @param fallback - Fallback string if value is invalid (default: '-')
 * @returns Formatted Greek string or fallback
 */
export function formatGreek(
  value: number | null | undefined,
  decimals: number = 4,
  fallback: string = '-'
): string {
  if (value == null || !isFinite(value)) return fallback;
  return value.toFixed(decimals);
}

/**
 * Safely parse a float, returning null instead of NaN
 * @param value - The value to parse
 * @returns Parsed number or null if invalid
 */
export function safeParseFloat(value: any): number | null {
  const parsed = parseFloat(value);
  return isFinite(parsed) ? parsed : null;
}

/**
 * Safely format basis points
 * @param value - The value in decimal form (e.g., 0.0025 for 25 bps)
 * @param decimals - Number of decimal places (default: 0)
 * @param fallback - Fallback string if value is invalid (default: '-')
 * @returns Formatted basis points string or fallback
 */
export function formatBps(
  value: number | null | undefined,
  decimals: number = 0,
  fallback: string = '-'
): string {
  if (value == null || !isFinite(value)) return fallback;
  return `${(value * 10000).toFixed(decimals)} bps`;
}

/**
 * Safely format a dollar amount
 * @param value - The dollar amount to format
 * @param decimals - Number of decimal places (default: 2)
 * @param fallback - Fallback string if value is invalid (default: '-')
 * @returns Formatted dollar string or fallback
 */
export function formatDollar(
  value: number | null | undefined,
  decimals: number = 2,
  fallback: string = '-'
): string {
  if (value == null || !isFinite(value)) return fallback;
  return `$${value.toFixed(decimals)}`;
}
