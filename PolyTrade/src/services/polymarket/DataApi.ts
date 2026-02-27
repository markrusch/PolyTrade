import axios from 'axios';

// Use dedicated Data API env var; default to official Polymarket Data API.
// Avoid using CORE/CLOB host here to prevent 404s on positions endpoints.
const DATA_API = process.env.POLYMARKET_DATA_API_URL || 'https://data-api.polymarket.com';

/**
 * Get ACTIVE open positions (currently held, unrealized PnL)
 * Official endpoint: GET /positions
 * @param userAddress - Wallet address (0x-prefixed)
 */
export async function getOpenPositions(userAddress: string) {
  const url = `${DATA_API}/positions?user=${userAddress}`;
  const { data } = await axios.get(url);
  // Data API returns array directly
  return Array.isArray(data) ? data : [];
}

/**
 * Get CLOSED positions (settled/exited, realized PnL)
 * Official endpoint: GET /closed-positions
 * @param userAddress - Wallet address (0x-prefixed)
 */
export async function getClosedPositions(userAddress: string) {
  const url = `${DATA_API}/closed-positions?user=${userAddress}`;
  const { data } = await axios.get(url);
  // Data API returns array directly
  return Array.isArray(data) ? data : [];
}

/**
 * Get user activity (trades, splits, merges, redeems)
 * Official endpoint: GET /activity
 * Filter for type=TRADE to get executed trades
 * @param userAddress - Wallet address (0x-prefixed)
 * @param limit - Max results (default 500)
 */
export async function getTrades(userAddress: string, limit = 500) {
  const url = `${DATA_API}/activity?user=${userAddress}&type=TRADE&limit=${limit}`;
  const { data } = await axios.get(url);
  return data;
}

/**
 * Get total portfolio value (sum of all open positions in USD)
 * Official endpoint: GET /value
 * @param userAddress - Wallet address (0x-prefixed)
 */
export async function getPortfolioValue(userAddress: string) {
  const url = `${DATA_API}/value?user=${userAddress}`;
  const { data } = await axios.get(url);
  return data;
}

/**
 * Get user activity (comprehensive)
 * Official endpoint: GET /activity
 * @param userAddress - Wallet address (0x-prefixed)
 * @param limit - Max results
 * @param offset - Pagination offset
 */
export async function getUserActivity(
  userAddress: string,
  limit = 100,
  offset = 0
) {
  const url = `${DATA_API}/activity?user=${userAddress}&limit=${limit}&offset=${offset}`;
  const { data } = await axios.get(url);
  return data;
}

/**
 * Get open orders (authenticated CLOB endpoint)
 * Requires CLOB client with valid API credentials
 * @param clobClient - Initialized ClobClientWrapper
 */
export async function getOpenOrders(clobClient: any) {
  if (typeof clobClient.getOpenOrders === 'function') {
    return clobClient.getOpenOrders();
  }
  const client = clobClient.getClient();
  return client.getOpenOrders();
}
