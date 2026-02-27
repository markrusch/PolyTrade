/**
 * Shared Formatting Utilities
 * Centralized formatting functions to eliminate code duplication
 */

/**
 * Format a price value with appropriate decimal places
 */
export function formatPrice(price: number | string, decimals: number = 4): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return '-';
  return num.toFixed(decimals);
}

/**
 * Format a volume/size with K/M suffixes
 */
export function formatVolume(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
}

/**
 * Format size for order book display
 */
export function formatSize(size: number | string, decimals: number = 0): string {
  const num = typeof size === 'string' ? parseFloat(size) : size;
  if (isNaN(num)) return '-';
  return num.toFixed(decimals);
}

/**
 * Format currency with $ prefix
 */
export function formatCurrency(value: number | string, decimals: number = 2): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  const prefix = num >= 0 ? '$' : '-$';
  return `${prefix}${Math.abs(num).toFixed(decimals)}`;
}

/**
 * Format percentage with % suffix
 */
export function formatPercent(value: number | string, decimals: number = 2): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  const prefix = num >= 0 ? '+' : '';
  return `${prefix}${num.toFixed(decimals)}%`;
}

/**
 * Format a number with sign prefix
 */
export function formatSigned(value: number | string, decimals: number = 4): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  const prefix = num >= 0 ? '+' : '';
  return `${prefix}${num.toFixed(decimals)}`;
}

/**
 * Format timestamp to locale time string
 */
export function formatTime(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toLocaleTimeString();
}

/**
 * Format timestamp to locale date time string
 */
export function formatDateTime(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Format market title for display (truncate if needed)
 */
export function formatMarketTitle(title: string, maxLength: number = 40): string {
  return truncateText(title, maxLength);
}

/**
 * Calculate depth bar width percentage
 */
export function calculateDepthWidth(size: number | string, maxSize: number): string {
  const num = typeof size === 'string' ? parseFloat(size) : size;
  if (isNaN(num) || maxSize <= 0) return '0%';
  return `${Math.min((num / maxSize) * 100, 100)}%`;
}

/**
 * Get CSS class for positive/negative values
 */
export function getValueClass(value: number | string): 'positive' | 'negative' | '' {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return '';
  return num > 0 ? 'positive' : 'negative';
}
