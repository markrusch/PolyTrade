/**
 * ParquetQueryService - DuckDB-powered SQL query engine for Parquet research data
 * Queries prediction market analysis data (Polymarket + Kalshi) from Parquet files
 * Uses DuckDB which can read Parquet files directly without conversion
 */

import { Database } from "duckdb-async";
import path from "path";
import fs from "fs";
import { Logger } from "../lib/logger/index.js";

// Available tables that map to Parquet file directories
export interface TableInfo {
  name: string;
  description: string;
  parquetGlob: string;
  columns: Array<{ name: string; type: string; description: string }>;
  rowCount?: number;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
  truncated: boolean;
}

const MAX_ROWS = 1000; // Limit results to prevent memory issues

// SQL keywords that are dangerous for write operations
const WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "REPLACE",
  "MERGE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "COPY",
  "ATTACH",
  "DETACH",
  "LOAD",
  "INSTALL",
];

export class ParquetQueryService {
  private db: Database | null = null;
  private logger: Logger;
  private dataDir: string;
  private initialized = false;
  private tables: Map<string, TableInfo> = new Map();

  constructor(logger: Logger, dataDir?: string) {
    this.logger = logger.child("ParquetQueryService");
    // Default to prediction-market-data/data directory
    this.dataDir =
      dataDir || path.join(process.cwd(), "prediction-market-data", "data");
  }

  /**
   * Initialize DuckDB and register Parquet tables as views
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Create in-memory DuckDB instance
      this.db = await Database.create(":memory:");

      this.logger.info("DuckDB initialized", { dataDir: this.dataDir });

      // Check if data directory exists
      if (!fs.existsSync(this.dataDir)) {
        this.logger.warn(
          "Data directory not found. Run: python scripts/download-research-data.py",
          {
            dataDir: this.dataDir,
          },
        );
        this.initialized = true;
        return;
      }

      // Register all available Parquet file sets as views
      await this.registerTables();
      this.initialized = true;

      this.logger.info("ParquetQueryService ready", {
        tables: Array.from(this.tables.keys()),
        tableCount: this.tables.size,
      });
    } catch (error) {
      this.logger.error(
        "Failed to initialize ParquetQueryService",
        error as Error,
      );
      throw error;
    }
  }

  /**
   * Scan data directory and register Parquet files as DuckDB views
   */
  private async registerTables(): Promise<void> {
    if (!this.db) throw new Error("DuckDB not initialized");

    const tableConfigs: Array<{
      name: string;
      description: string;
      subdir: string;
      columns: Array<{ name: string; type: string; description: string }>;
    }> = [
      {
        name: "polymarket_markets",
        description:
          "Polymarket prediction markets with outcomes, volumes, and resolution status",
        subdir: path.join("polymarket", "markets"),
        columns: [
          { name: "id", type: "VARCHAR", description: "Market identifier" },
          {
            name: "condition_id",
            type: "VARCHAR",
            description: "Condition hex hash",
          },
          {
            name: "question",
            type: "VARCHAR",
            description: "Market question text",
          },
          { name: "slug", type: "VARCHAR", description: "URL-friendly name" },
          {
            name: "outcomes",
            type: "VARCHAR",
            description: "JSON outcome names",
          },
          {
            name: "outcome_prices",
            type: "VARCHAR",
            description: "JSON pricing data",
          },
          {
            name: "volume",
            type: "DOUBLE",
            description: "Total trading volume (USD)",
          },
          {
            name: "liquidity",
            type: "DOUBLE",
            description: "Available liquidity (USD)",
          },
          { name: "active", type: "BOOLEAN", description: "Is market active" },
          { name: "closed", type: "BOOLEAN", description: "Is market closed" },
          {
            name: "end_date",
            type: "TIMESTAMP",
            description: "Market end date",
          },
          {
            name: "created_at",
            type: "TIMESTAMP",
            description: "Creation time",
          },
          {
            name: "_fetched_at",
            type: "TIMESTAMP",
            description: "Data fetch time",
          },
        ],
      },
      {
        name: "polymarket_trades",
        description:
          "Polymarket CTF exchange trade fills with maker/taker details",
        subdir: path.join("polymarket", "trades"),
        columns: [
          {
            name: "block_number",
            type: "INTEGER",
            description: "Polygon block number",
          },
          {
            name: "transaction_hash",
            type: "VARCHAR",
            description: "Transaction hash",
          },
          {
            name: "log_index",
            type: "INTEGER",
            description: "Event log index",
          },
          {
            name: "order_hash",
            type: "VARCHAR",
            description: "Order identifier",
          },
          { name: "maker", type: "VARCHAR", description: "Maker address" },
          { name: "taker", type: "VARCHAR", description: "Taker address" },
          {
            name: "maker_asset_id",
            type: "VARCHAR",
            description: "Maker asset token ID (string — can exceed BIGINT range)",
          },
          {
            name: "taker_asset_id",
            type: "VARCHAR",
            description: "Taker asset token ID (string — can exceed BIGINT range)",
          },
          {
            name: "maker_amount",
            type: "BIGINT",
            description: "Maker amount (6 decimals)",
          },
          {
            name: "taker_amount",
            type: "BIGINT",
            description: "Taker amount (6 decimals)",
          },
          {
            name: "fee",
            type: "BIGINT",
            description: "Fee amount (6 decimals)",
          },
          {
            name: "_fetched_at",
            type: "TIMESTAMP",
            description: "Data fetch time",
          },
          { name: "_contract", type: "VARCHAR", description: "Contract type" },
        ],
      },
      {
        name: "kalshi_markets",
        description:
          "Kalshi prediction markets with bid/ask, volume, and resolution",
        subdir: path.join("kalshi", "markets"),
        columns: [
          { name: "ticker", type: "VARCHAR", description: "Market ticker" },
          {
            name: "event_ticker",
            type: "VARCHAR",
            description: "Parent event ticker",
          },
          { name: "market_type", type: "VARCHAR", description: "Market type" },
          { name: "title", type: "VARCHAR", description: "Market title" },
          {
            name: "yes_sub_title",
            type: "VARCHAR",
            description: "Yes outcome label",
          },
          {
            name: "no_sub_title",
            type: "VARCHAR",
            description: "No outcome label",
          },
          { name: "status", type: "VARCHAR", description: "Market status" },
          {
            name: "yes_bid",
            type: "INTEGER",
            description: "Best yes bid (cents)",
          },
          {
            name: "yes_ask",
            type: "INTEGER",
            description: "Best yes ask (cents)",
          },
          {
            name: "no_bid",
            type: "INTEGER",
            description: "Best no bid (cents)",
          },
          {
            name: "no_ask",
            type: "INTEGER",
            description: "Best no ask (cents)",
          },
          {
            name: "last_price",
            type: "INTEGER",
            description: "Last trade price (cents)",
          },
          { name: "volume", type: "INTEGER", description: "Total volume" },
          { name: "volume_24h", type: "INTEGER", description: "24h volume" },
          {
            name: "open_interest",
            type: "INTEGER",
            description: "Open interest",
          },
          {
            name: "result",
            type: "VARCHAR",
            description: "Resolution: yes/no/unresolved",
          },
          {
            name: "created_time",
            type: "TIMESTAMP",
            description: "Created time",
          },
          { name: "open_time", type: "TIMESTAMP", description: "Open time" },
          { name: "close_time", type: "TIMESTAMP", description: "Close time" },
          {
            name: "_fetched_at",
            type: "TIMESTAMP",
            description: "Data fetch time",
          },
        ],
      },
      {
        name: "kalshi_trades",
        description: "Kalshi individual trade executions",
        subdir: path.join("kalshi", "trades"),
        columns: [
          {
            name: "trade_id",
            type: "VARCHAR",
            description: "Trade identifier",
          },
          { name: "ticker", type: "VARCHAR", description: "Market ticker" },
          { name: "count", type: "INTEGER", description: "Contracts traded" },
          {
            name: "yes_price",
            type: "INTEGER",
            description: "Yes price (cents)",
          },
          {
            name: "no_price",
            type: "INTEGER",
            description: "No price (cents)",
          },
          {
            name: "taker_side",
            type: "VARCHAR",
            description: "Taker side: yes/no",
          },
          {
            name: "created_time",
            type: "TIMESTAMP",
            description: "Trade time",
          },
          {
            name: "_fetched_at",
            type: "TIMESTAMP",
            description: "Data fetch time",
          },
        ],
      },
      {
        name: "polymarket_legacy_trades",
        description:
          "Polymarket legacy FPMM trades (pre-CTF Exchange era, AMM-based)",
        subdir: path.join("polymarket", "legacy_trades"),
        columns: [
          {
            name: "block_number",
            type: "INTEGER",
            description: "Polygon block number",
          },
          {
            name: "transaction_hash",
            type: "VARCHAR",
            description: "Transaction hash",
          },
          {
            name: "log_index",
            type: "INTEGER",
            description: "Log index within block",
          },
          {
            name: "fpmm_address",
            type: "VARCHAR",
            description: "FPMM contract address",
          },
          {
            name: "trader",
            type: "VARCHAR",
            description: "Trader wallet address",
          },
          {
            name: "amount",
            type: "VARCHAR",
            description: "Investment amount (6 decimals USDC)",
          },
          {
            name: "fee_amount",
            type: "VARCHAR",
            description: "Fee amount (6 decimals USDC)",
          },
          {
            name: "outcome_index",
            type: "INTEGER",
            description: "Outcome index (0=No, 1=Yes typically)",
          },
          {
            name: "outcome_tokens",
            type: "VARCHAR",
            description: "Outcome tokens received (18 decimals)",
          },
          {
            name: "is_buy",
            type: "BOOLEAN",
            description: "True for buy, false for sell/redeem",
          },
          {
            name: "timestamp",
            type: "INTEGER",
            description: "Unix timestamp of the trade",
          },
          {
            name: "_fetched_at",
            type: "TIMESTAMP",
            description: "Data fetch time",
          },
        ],
      },
      {
        name: "polymarket_blocks",
        description:
          "Polygon block number to ISO timestamp mapping (join key for legacy trades)",
        subdir: path.join("polymarket", "blocks"),
        columns: [
          {
            name: "block_number",
            type: "INTEGER",
            description: "Polygon block number",
          },
          {
            name: "timestamp",
            type: "VARCHAR",
            description: "ISO 8601 UTC timestamp for the block",
          },
        ],
      },
    ];

    for (const config of tableConfigs) {
      const fullPath = path.join(this.dataDir, config.subdir);

      if (!fs.existsSync(fullPath)) {
        this.logger.debug(
          `Skipping ${config.name}: directory not found at ${fullPath}`,
        );
        continue;
      }

      // Find Parquet files (exclude macOS ._* resource fork files which are
      // invalid Parquet and cause DuckDB "No magic bytes" errors)
      const files = fs
        .readdirSync(fullPath)
        .filter((f) => f.endsWith(".parquet") && !f.startsWith("._"));
      if (files.length === 0) {
        this.logger.debug(
          `Skipping ${config.name}: no Parquet files in ${fullPath}`,
        );
        continue;
      }

      // Build explicit file list to avoid ._* resource fork files in glob
      const filePaths = files.map((f) =>
        path.join(fullPath, f).replace(/\\/g, "/"),
      );
      const globPattern = path.join(fullPath, "*.parquet").replace(/\\/g, "/");

      try {
        // Create a view that reads all valid Parquet files in the directory
        // Use explicit file list instead of glob to avoid macOS ._* files
        const fileListSql = filePaths.map((f) => `'${f}'`).join(", ");
        await this.db.run(
          `CREATE VIEW ${config.name} AS SELECT * FROM read_parquet([${fileListSql}])`,
        );

        // Get approximate row count
        const countResult = await this.db.all(
          `SELECT COUNT(*) as cnt FROM ${config.name}`,
        );
        const rowCount = countResult[0]?.cnt as number;

        const tableInfo: TableInfo = {
          name: config.name,
          description: config.description,
          parquetGlob: globPattern,
          columns: config.columns,
          rowCount,
        };

        this.tables.set(config.name, tableInfo);
        this.logger.info(`Registered table: ${config.name}`, {
          files: files.length,
          rowCount,
        });
      } catch (error) {
        this.logger.error(
          `Failed to register table ${config.name}`,
          error as Error,
        );
      }
    }
  }

  /**
   * Validate that a query is read-only (SELECT only)
   */
  private validateQuery(sql: string): { valid: boolean; error?: string } {
    const trimmed = sql.trim().toUpperCase();

    // Must start with SELECT or WITH (CTE)
    if (
      !trimmed.startsWith("SELECT") &&
      !trimmed.startsWith("WITH") &&
      !trimmed.startsWith("EXPLAIN")
    ) {
      return {
        valid: false,
        error: "Only SELECT, WITH (CTE), and EXPLAIN queries are allowed",
      };
    }

    // Check for dangerous keywords
    for (const keyword of WRITE_KEYWORDS) {
      // Check for keyword as whole word (not inside a string or identifier)
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(sql)) {
        // But allow if inside single quotes (string literal)
        const withoutStrings = sql.replace(/'[^']*'/g, "");
        if (new RegExp(`\\b${keyword}\\b`, "i").test(withoutStrings)) {
          return {
            valid: false,
            error: `Write operation "${keyword}" is not allowed. Only SELECT queries are permitted.`,
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Execute a SQL query against the Parquet data
   */
  async executeQuery(sql: string): Promise<QueryResult> {
    if (!this.db) {
      await this.initialize();
    }
    if (!this.db) throw new Error("DuckDB not initialized");

    // Validate query is read-only
    const validation = this.validateQuery(sql);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const startTime = Date.now();

    try {
      // Add LIMIT if not present to prevent huge result sets
      const hasLimit = /\bLIMIT\b/i.test(sql);
      const querySql = hasLimit ? sql : `${sql} LIMIT ${MAX_ROWS + 1}`;

      const results = await this.db.all(querySql);
      const executionTimeMs = Date.now() - startTime;

      const truncated = results.length > MAX_ROWS;
      const rows = truncated ? results.slice(0, MAX_ROWS) : results;

      // Extract column names from first row
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      this.logger.debug("Query executed", {
        rowCount: rows.length,
        truncated,
        executionTimeMs,
        sql: sql.substring(0, 200),
      });

      return {
        columns,
        rows: rows as Record<string, unknown>[],
        rowCount: rows.length,
        executionTimeMs,
        truncated,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      this.logger.error("Query failed", error as Error);
      throw new Error(
        `Query failed (${executionTimeMs}ms): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get all available tables and their metadata
   */
  getTables(): TableInfo[] {
    return Array.from(this.tables.values());
  }

  /**
   * Get data status - is data downloaded?
   */
  getDataStatus(): {
    dataExists: boolean;
    dataDir: string;
    tables: string[];
    totalRows: number;
  } {
    const dataExists = fs.existsSync(this.dataDir);
    const tables = Array.from(this.tables.keys());
    const totalRows = Array.from(this.tables.values()).reduce(
      (sum, t) => sum + (t.rowCount || 0),
      0,
    );

    return { dataExists, dataDir: this.dataDir, tables, totalRows };
  }

  /**
   * Get example queries for each table
   */
  getExampleQueries(): Array<{
    name: string;
    description: string;
    sql: string;
  }> {
    const available = new Set(this.tables.keys());

    const allExamples: Array<{
      name: string;
      description: string;
      sql: string;
      tables: string[];
    }> = [
      {
        name: "Kalshi Win Rate by Price",
        description:
          "Compare expected vs actual win rates across price buckets (longshot bias)",
        tables: ["kalshi_markets"],
        sql: `SELECT
  FLOOR(last_price / 10) * 10 as price_bucket,
  COUNT(*) as total_markets,
  COUNT(CASE WHEN result = 'yes' THEN 1 END) as wins,
  ROUND(COUNT(CASE WHEN result = 'yes' THEN 1 END) * 100.0 / COUNT(*), 2) as actual_win_pct,
  FLOOR(last_price / 10) * 10 + 5 as expected_win_pct
FROM kalshi_markets
WHERE result IN ('yes', 'no') AND last_price IS NOT NULL AND last_price > 0
GROUP BY price_bucket
HAVING COUNT(*) >= 10
ORDER BY price_bucket`,
      },
      {
        name: "Polymarket Top Markets by Volume",
        description: "Highest volume Polymarket markets",
        tables: ["polymarket_markets"],
        sql: `SELECT question, volume, liquidity, active, closed
FROM polymarket_markets
ORDER BY volume DESC
LIMIT 50`,
      },
      {
        name: "Kalshi Market Categories",
        description: "Distribution of market types on Kalshi",
        tables: ["kalshi_markets"],
        sql: `SELECT
  SPLIT_PART(event_ticker, '-', 1) as category,
  COUNT(*) as market_count,
  SUM(volume) as total_volume,
  ROUND(AVG(CASE WHEN result = 'yes' THEN 1 WHEN result = 'no' THEN 0 END) * 100, 2) as avg_yes_pct
FROM kalshi_markets
WHERE result IN ('yes', 'no')
GROUP BY category
HAVING COUNT(*) >= 5
ORDER BY total_volume DESC
LIMIT 20`,
      },
      {
        name: "Kalshi Mispricing by Price Range",
        description:
          "Find price ranges where markets are systematically mispriced",
        tables: ["kalshi_trades"],
        sql: `SELECT
  FLOOR(yes_price / 5) * 5 as price_bucket,
  COUNT(*) as trades,
  ROUND(AVG(yes_price), 2) as avg_price,
  ROUND(AVG(CASE WHEN taker_side = 'yes' THEN 1.0 ELSE 0.0 END) * 100, 2) as pct_taker_yes
FROM kalshi_trades
WHERE yes_price > 0 AND yes_price < 100
GROUP BY price_bucket
HAVING COUNT(*) >= 100
ORDER BY price_bucket`,
      },
      {
        name: "Polymarket Closed Markets Summary",
        description: "Summary statistics for resolved Polymarket markets",
        tables: ["polymarket_markets"],
        sql: `SELECT
  COUNT(*) as total_markets,
  COUNT(CASE WHEN closed THEN 1 END) as closed_count,
  COUNT(CASE WHEN active THEN 1 END) as active_count,
  ROUND(AVG(volume), 2) as avg_volume,
  ROUND(MEDIAN(volume), 2) as median_volume,
  ROUND(MAX(volume), 2) as max_volume
FROM polymarket_markets`,
      },
      {
        name: "Kalshi Trade Activity Over Time",
        description: "Kalshi trading activity by month",
        tables: ["kalshi_trades"],
        sql: `SELECT
  DATE_TRUNC('month', created_time) as month,
  COUNT(*) as trade_count,
  SUM(count) as contracts_traded,
  ROUND(AVG(yes_price), 2) as avg_yes_price
FROM kalshi_trades
WHERE created_time IS NOT NULL
GROUP BY month
ORDER BY month`,
      },
      {
        name: "Polymarket Trade Volume by Maker",
        description: "Top market makers by trade volume on Polymarket",
        tables: ["polymarket_trades"],
        sql: `SELECT
  maker,
  COUNT(*) as trade_count,
  ROUND(SUM(maker_amount) / 1e6, 2) as total_maker_usd,
  ROUND(AVG(fee) / 1e6, 4) as avg_fee_usd
FROM polymarket_trades
GROUP BY maker
ORDER BY total_maker_usd DESC
LIMIT 25`,
      },
      {
        name: "Polymarket Active High-Volume Markets",
        description:
          "Currently active markets with highest volume and liquidity",
        tables: ["polymarket_markets"],
        sql: `SELECT question, volume, liquidity,
  ROUND(volume / NULLIF(liquidity, 0), 2) as volume_to_liquidity
FROM polymarket_markets
WHERE active = true AND closed = false AND volume > 0
ORDER BY volume DESC
LIMIT 50`,
      },
      {
        name: "Polymarket Calibration — Win Rate by Price Bucket",
        description:
          "Calibration curve: compare implied probability (last traded price) vs actual resolution rate. Reveals longshot bias and systematic mispricing across the full 0-100 cent range. Uses clob_token_ids to join markets to trade asset IDs.",
        tables: ["polymarket_markets", "polymarket_trades"],
        sql: `-- Calibration: implied price vs actual win rate for resolved YES outcomes
-- outcome_prices is a JSON array like ["0.72","0.28"]; index 0 = YES final price
WITH resolved_markets AS (
  SELECT
    id,
    condition_id,
    question,
    clob_token_ids,
    TRY_CAST(json_extract_string(outcome_prices, '$[0]') AS DOUBLE) AS final_yes_price
  FROM polymarket_markets
  WHERE closed = true
    AND outcome_prices IS NOT NULL
    AND clob_token_ids IS NOT NULL
),
-- Derive implied price at trade time from taker_amount / (maker_amount + taker_amount)
-- maker_asset_id = '0' means maker paid USDC → taker bought YES tokens
trades_with_price AS (
  SELECT
    t.maker_asset_id,
    t.taker_asset_id,
    TRY_CAST(t.maker_amount AS DOUBLE) AS maker_amt,
    TRY_CAST(t.taker_amount AS DOUBLE) AS taker_amt
  FROM polymarket_trades t
  WHERE t.maker_asset_id = '0' OR t.taker_asset_id = '0'
),
priced AS (
  SELECT
    CASE
      WHEN maker_asset_id = '0' THEN taker_asset_id  -- taker bought YES token
      ELSE maker_asset_id                              -- maker bought YES token
    END AS yes_token_id,
    CASE
      WHEN maker_asset_id = '0'
        THEN maker_amt / NULLIF(maker_amt + taker_amt, 0)  -- price paid per token
      ELSE taker_amt / NULLIF(taker_amt + maker_amt, 0)
    END AS implied_price
  FROM trades_with_price
  WHERE maker_amt > 0 AND taker_amt > 0
)
SELECT
  FLOOR(p.implied_price * 20) / 20 AS price_bucket,
  COUNT(*) AS trade_count,
  ROUND(AVG(CASE WHEN m.final_yes_price >= 0.9 THEN 1.0 ELSE 0.0 END) * 100, 2) AS pct_resolved_yes,
  ROUND(AVG(p.implied_price) * 100, 2) AS avg_implied_pct
FROM priced p
JOIN resolved_markets m
  ON p.yes_token_id = json_extract_string(m.clob_token_ids, '$[0]')
WHERE p.implied_price BETWEEN 0.01 AND 0.99
GROUP BY price_bucket
HAVING COUNT(*) >= 500
ORDER BY price_bucket`,
      },
      {
        name: "Polymarket Legacy Trade Volume Over Time",
        description:
          "Monthly trading volume from the legacy FPMM (AMM) era of Polymarket, before the CTF Exchange order book system launched.",
        tables: ["polymarket_legacy_trades"],
        sql: `SELECT
  DATE_TRUNC('month', TO_TIMESTAMP(timestamp)) AS month,
  COUNT(*) AS trade_count,
  COUNT(DISTINCT fpmm_address) AS unique_markets,
  COUNT(DISTINCT trader) AS unique_traders,
  ROUND(SUM(TRY_CAST(amount AS DOUBLE)) / 1e6, 2) AS total_volume_usdc,
  COUNT(CASE WHEN is_buy THEN 1 END) AS buys,
  COUNT(CASE WHEN NOT is_buy THEN 1 END) AS sells
FROM polymarket_legacy_trades
WHERE timestamp > 0
GROUP BY month
ORDER BY month`,
      },
      {
        name: "Polymarket CTF vs Legacy Trade Era Comparison",
        description:
          "Compare trade counts between the legacy FPMM era and the modern CTF Exchange era to understand market evolution.",
        tables: ["polymarket_trades", "polymarket_legacy_trades"],
        sql: `-- Modern CTF Exchange trades (sampled — full dataset is very large)
SELECT
  'CTF Exchange' AS era,
  COUNT(*) AS total_trades,
  COUNT(DISTINCT maker) AS unique_makers,
  COUNT(DISTINCT taker) AS unique_takers,
  MIN(_fetched_at) AS earliest_fetch,
  MAX(_fetched_at) AS latest_fetch
FROM polymarket_trades
UNION ALL
-- Legacy FPMM trades
SELECT
  'Legacy FPMM' AS era,
  COUNT(*) AS total_trades,
  COUNT(DISTINCT trader) AS unique_traders,
  0 AS unique_takers,
  TO_TIMESTAMP(MIN(timestamp)) AS earliest,
  TO_TIMESTAMP(MAX(timestamp)) AS latest
FROM polymarket_legacy_trades
WHERE timestamp > 0`,
      },
    ];

    // Only return examples whose required tables are all registered
    return allExamples
      .filter((ex) => ex.tables.every((t) => available.has(t)))
      .map(({ tables: _tables, ...rest }) => rest);
  }

  /**
   * Destroy DuckDB instance
   */
  async destroy(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.initialized = false;
      this.tables.clear();
      this.logger.info("ParquetQueryService destroyed");
    }
  }
}
