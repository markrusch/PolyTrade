import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const dbPath = process.env.DB_PATH || path.join(PROJECT_ROOT, 'PolyTrade.db');

function log(msg) {
  console.log(msg);
}

function ensureTablesHaveData() {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const nowMs = Date.now();
  const nowIso = new Date().toISOString();

  const count = (table) => db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;

  // markets
  if (count('markets') === 0) {
    db.prepare(`
      INSERT INTO markets (clob_token_id, crypto, strike, maturity, question, condition_id, active, last_updated)
      VALUES (@id, @crypto, @strike, @maturity, @question, @conditionId, 1, @lastUpdated)
    `).run({
      id: 'TEST-ETH-20260120',
      crypto: 'ETH',
      strike: 3000,
      maturity: nowMs + 30 * 24 * 3600 * 1000,
      question: 'Test market',
      conditionId: 'TEST-CONDITION',
      lastUpdated: nowIso
    });
    log('Inserted markets: 1');
  }

  // positions
  if (count('positions') === 0) {
    db.prepare(`
      INSERT INTO positions (clob_token_id, quantity, average_price, last_updated)
      VALUES (@id, @qty, @avg, @lastUpdated)
    `).run({
      id: 'TEST-ETH-20260120',
      qty: 1.5,
      avg: 2500,
      lastUpdated: nowIso
    });
    log('Inserted positions: 1');
  }

  // trades
  if (count('trades') === 0) {
    db.prepare(`
      INSERT INTO trades (clob_token_id, side, quantity, price, timestamp, pnl, trade_type)
      VALUES (@id, 'BUY', 1.5, 2500, @ts, 0, 'MAKER')
    `).run({ id: 'TEST-ETH-20260120', ts: nowIso });
    log('Inserted trades: 1');
  }

  // portfolio_greeks
  if (count('portfolio_greeks') === 0) {
    db.prepare(`
      INSERT INTO portfolio_greeks (timestamp, delta, gamma, vega, theta, notional, num_positions)
      VALUES (@ts, 0.5, 0.1, 0.2, -0.05, 10000, 1)
    `).run({ ts: nowIso });
    log('Inserted portfolio_greeks: 1');
  }

  // binance_ticks
  if (count('binance_ticks') === 0) {
    db.prepare(`
      INSERT INTO binance_ticks (symbol, price, bid_price, ask_price, bid_qty, ask_qty, timestamp)
      VALUES ('ETHUSDT', 3456.78, 3456.5, 3457.1, 12.3, 10.1, @ts)
    `).run({ ts: nowMs });
    log('Inserted binance_ticks: 1');
  }

  // binance_snapshots_24h
  if (count('binance_snapshots_24h') === 0) {
    db.prepare(`
      INSERT INTO binance_snapshots_24h (
        symbol, open_price, high_price, low_price, close_price, volume, quote_volume,
        price_change_percent, num_trades, timestamp
      )
      VALUES ('ETHUSDT', 3400, 3500, 3380, 3450, 12345.6, 42000000, 1.5, 123456, @ts)
    `).run({ ts: nowMs });
    log('Inserted binance_snapshots_24h: 1');
  }

  // deribit_instruments
  const instrumentName = 'ETH-28MAR25-3000-C';
  if (count('deribit_instruments') === 0) {
    db.prepare(`
      INSERT INTO deribit_instruments (instrument_name, currency, strike, expiration_timestamp, option_type)
      VALUES (@name, 'ETH', 3000, @expiry, 'call')
    `).run({ name: instrumentName, expiry: nowMs + 60 * 24 * 3600 * 1000 });
    log('Inserted deribit_instruments: 1');
  }

  // deribit_snapshots
  if (count('deribit_snapshots') === 0) {
    db.prepare(`
      INSERT INTO deribit_snapshots (
        instrument_name, underlying_price, mark_iv, mark_price, last_price,
        best_bid_price, best_ask_price, open_interest, volume_24h,
        delta, gamma, vega, theta, timestamp
      )
      VALUES (
        @name, 3450, 0.65, 120, 119.5,
        118.9, 120.5, 1234, 98765,
        0.52, 0.08, 12.3, -0.04, @ts
      )
    `).run({ name: instrumentName, ts: nowMs });
    log('Inserted deribit_snapshots: 1');
  }

  // schema_version ensured by DB init; no action needed

  // checkpoint WAL so data is visible in main file
  db.pragma('wal_checkpoint(FULL)');
  db.close();

  // Report counts
  const db2 = new Database(dbPath);
  const tables = [
    'markets',
    'positions',
    'trades',
    'portfolio_greeks',
    'binance_ticks',
    'binance_snapshots_24h',
    'deribit_instruments',
    'deribit_snapshots',
    'schema_version'
  ];
  const counts = Object.fromEntries(
    tables.map((t) => [t, db2.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c])
  );
  console.log('Row counts:', counts);
  db2.close();
}

log(`Seeding database at: ${dbPath}`);
ensureTablesHaveData();
log('Done.');
