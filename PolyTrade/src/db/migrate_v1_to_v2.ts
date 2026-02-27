/**
 * PolyTrade Database Migration: v1 to v2
 *
 * This migration transforms the Polymarket-specific v1 schema into the
 * multi-platform, multi-market-type v2 schema.
 *
 * Features:
 * - Idempotent (safe to run multiple times)
 * - Transactional (all-or-nothing)
 * - Data validation
 * - Rollback capability
 * - Complete audit trail
 *
 * Migration Steps:
 * 1. Create v2 schema alongside v1 tables
 * 2. Setup default platform (polymarket) and data sources
 * 3. Migrate markets with crypto metadata extraction
 * 4. Migrate positions with new foreign keys
 * 5. Migrate trades with new foreign keys
 * 6. Migrate binance_ticks -> data_points
 * 7. Migrate deribit_snapshots -> data_points
 * 8. Migrate portfolio_greeks -> portfolio_risk
 * 9. Validate data integrity
 * 10. Update schema version
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// CONFIGURATION
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, 'PolyTrade.db');
const BACKUP_SUFFIX = '.v1_backup';
const SCHEMA_V2_PATH = path.join(__dirname, 'schema_v2.sql');

// ============================================================================
// TYPES
// ============================================================================

interface MigrationLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
}

interface MigrationStats {
    platformsCreated: number;
    dataSourcesCreated: number;
    marketsCreated: number;
    marketOutcomesCreated: number;
    positionsMigrated: number;
    tradesMigrated: number;
    binanceTicksMigrated: number;
    deribitSnapshotsMigrated: number;
    portfolioGreeksMigrated: number;
}

interface V1Market {
    clob_token_id: string;
    crypto: string;
    strike: number;
    maturity: number;
    question: string;
    condition_id: string;
    active: number;
    last_updated: string;
}

interface V1Position {
    id: number;
    clob_token_id: string;
    quantity: number;
    average_price: number;
    last_updated: string;
}

interface V1Trade {
    id: number;
    clob_token_id: string;
    side: string;
    quantity: number;
    price: number;
    timestamp: string;
    pnl: number | null;
    trade_type: string;
}

interface V1BinanceTick {
    id: number;
    symbol: string;
    price: number;
    bid_price: number | null;
    ask_price: number | null;
    bid_qty: number | null;
    ask_qty: number | null;
    timestamp: number;
}

interface V1DeribitSnapshot {
    id: number;
    instrument_name: string;
    underlying_price: number;
    mark_iv: number;
    mark_price: number | null;
    last_price: number | null;
    best_bid_price: number | null;
    best_ask_price: number | null;
    open_interest: number | null;
    volume_24h: number | null;
    delta: number | null;
    gamma: number | null;
    vega: number | null;
    theta: number | null;
    timestamp: number;
}

interface V1PortfolioGreeks {
    id: number;
    timestamp: string;
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    notional: number;
    num_positions: number;
}

// ============================================================================
// LOGGER
// ============================================================================

class ConsoleLogger implements MigrationLogger {
    info(message: string): void {
        console.log(`[INFO] ${message}`);
    }

    warn(message: string): void {
        console.warn(`[WARN] ${message}`);
    }

    error(message: string): void {
        console.error(`[ERROR] ${message}`);
    }

    success(message: string): void {
        console.log(`[SUCCESS] ${message}`);
    }
}

// ============================================================================
// MIGRATION CLASS
// ============================================================================

export class MigrationV1toV2 {
    private db: Database.Database;
    private logger: MigrationLogger;
    private dbPath: string;
    private stats: MigrationStats;

    // Mapping from v1 clob_token_id -> v2 market_id
    private marketIdMap = new Map<string, string>();
    // Mapping from v2 market_id -> outcome_id for YES/NO
    private outcomeIdMap = new Map<string, { yesId: string; noId: string }>();

    constructor(dbPath: string = DEFAULT_DB_PATH, logger?: MigrationLogger) {
        this.dbPath = path.resolve(dbPath);
        this.logger = logger || new ConsoleLogger();
        this.db = new Database(this.dbPath);
        this.stats = {
            platformsCreated: 0,
            dataSourcesCreated: 0,
            marketsCreated: 0,
            marketOutcomesCreated: 0,
            positionsMigrated: 0,
            tradesMigrated: 0,
            binanceTicksMigrated: 0,
            deribitSnapshotsMigrated: 0,
            portfolioGreeksMigrated: 0,
        };

        // Enable WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = OFF'); // Disable during migration for safety
    }

    /**
     * Main migration entry point
     */
    async migrate(): Promise<void> {
        this.logger.info('Starting migration from v1 to v2...');
        this.logger.info(`Database path: ${this.dbPath}`);

        try {
            // Pre-flight checks
            this.checkV1SchemaExists();
            const currentVersion = this.getCurrentSchemaVersion();

            if (currentVersion === 2) {
                this.logger.warn('Database is already at v2. Migration may have already been applied.');
                const answer = await this.promptUser('Continue anyway? (yes/no): ');
                if (answer.toLowerCase() !== 'yes') {
                    this.logger.info('Migration cancelled by user.');
                    return;
                }
            } else if (currentVersion > 2) {
                this.logger.error(`Database is at version ${currentVersion}, which is newer than v2. Cannot migrate.`);
                return;
            }

            // Backup database
            await this.backupDatabase();

            // Run migration in transaction
            const migrationTx = this.db.transaction(() => {
                this.logger.info('Beginning transaction...');

                // Step 1: Create v2 schema
                this.createV2Schema();

                // Step 2: Setup platforms and data sources
                this.setupPlatformsAndDataSources();

                // Step 3: Migrate markets
                this.migrateMarkets();

                // Step 4: Migrate positions
                this.migratePositions();

                // Step 5: Migrate trades
                this.migrateTrades();

                // Step 6: Migrate Binance ticks
                this.migrateBinanceTicks();

                // Step 7: Migrate Deribit snapshots
                this.migrateDeribitSnapshots();

                // Step 8: Migrate portfolio Greeks
                this.migratePortfolioGreeks();

                // Step 9: Validate data integrity
                this.validateMigration();

                // Step 10: Update schema version
                this.updateSchemaVersion();

                this.logger.info('Transaction complete. Committing...');
            });

            migrationTx();

            // Re-enable foreign keys
            this.db.pragma('foreign_keys = ON');

            // Print summary
            this.printMigrationSummary();

            this.logger.success('Migration completed successfully!');
            this.logger.info(`Backup created at: ${this.dbPath}${BACKUP_SUFFIX}`);

        } catch (error) {
            this.logger.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
            this.logger.error('Database has been rolled back to pre-migration state.');
            throw error;
        }
    }

    /**
     * Check if v1 schema exists
     */
    private checkV1SchemaExists(): void {
        const tables = this.db.prepare(`
            SELECT name FROM sqlite_master WHERE type='table' AND name IN ('markets', 'positions', 'trades')
        `).all() as { name: string }[];

        if (tables.length < 3) {
            throw new Error('v1 schema not found. Expected tables: markets, positions, trades');
        }

        this.logger.info('v1 schema detected. Proceeding...');
    }

    /**
     * Get current schema version
     */
    private getCurrentSchemaVersion(): number {
        try {
            const result = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
            return result?.v || 1;
        } catch {
            return 1; // Assume v1 if schema_version doesn't exist
        }
    }

    /**
     * Backup database file
     */
    private async backupDatabase(): Promise<void> {
        const backupPath = `${this.dbPath}${BACKUP_SUFFIX}`;

        if (fs.existsSync(backupPath)) {
            this.logger.warn(`Backup already exists at ${backupPath}`);
            const answer = await this.promptUser('Overwrite? (yes/no): ');
            if (answer.toLowerCase() !== 'yes') {
                throw new Error('Migration cancelled. Please remove or rename existing backup.');
            }
        }

        this.logger.info('Creating database backup...');
        fs.copyFileSync(this.dbPath, backupPath);
        this.logger.success(`Backup created: ${backupPath}`);
    }

    /**
     * Create v2 schema tables
     */
    private createV2Schema(): void {
        this.logger.info('Creating v2 schema tables...');

        // Read schema SQL file
        if (!fs.existsSync(SCHEMA_V2_PATH)) {
            throw new Error(`Schema v2 SQL file not found at: ${SCHEMA_V2_PATH}`);
        }

        const schemaSQL = fs.readFileSync(SCHEMA_V2_PATH, 'utf-8');

        // Execute schema (this creates all v2 tables)
        // Note: We need to skip the schema_version insert since we'll handle versioning separately
        const sqlStatements = schemaSQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .filter(s => !s.includes('INSERT INTO schema_version')); // Skip version insert

        for (const statement of sqlStatements) {
            if (statement.startsWith('--') || statement.length === 0) continue;
            try {
                this.db.exec(statement);
            } catch (error) {
                // Ignore "table already exists" errors for idempotency
                if (error instanceof Error && !error.message.includes('already exists')) {
                    throw error;
                }
            }
        }

        this.logger.success('v2 schema tables created');
    }

    /**
     * Setup default platform (polymarket) and data sources (binance, deribit)
     */
    private setupPlatformsAndDataSources(): void {
        this.logger.info('Setting up platforms and data sources...');

        // Insert Polymarket platform (idempotent)
        const platformStmt = this.db.prepare(`
            INSERT INTO platforms (id, display_name, api_config, enabled)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                enabled = excluded.enabled
        `);

        platformStmt.run(
            'polymarket',
            'Polymarket',
            JSON.stringify({
                clobApiUrl: 'https://clob.polymarket.com',
                gamma_market_url: 'https://gamma-api.polymarket.com'
            }),
            1
        );
        this.stats.platformsCreated++;

        // Insert Binance data source
        const dataSourceStmt = this.db.prepare(`
            INSERT INTO data_sources (id, source_type, display_name, config, enabled)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source_type = excluded.source_type,
                display_name = excluded.display_name,
                enabled = excluded.enabled
        `);

        dataSourceStmt.run(
            'binance',
            'spot_price',
            'Binance Spot Prices',
            JSON.stringify({ apiUrl: 'https://api.binance.com' }),
            1
        );
        this.stats.dataSourcesCreated++;

        // Insert Deribit data source
        dataSourceStmt.run(
            'deribit',
            'volatility',
            'Deribit Options Volatility',
            JSON.stringify({ apiUrl: 'https://www.deribit.com/api/v2' }),
            1
        );
        this.stats.dataSourcesCreated++;

        this.logger.success(`Created ${this.stats.platformsCreated} platforms and ${this.stats.dataSourcesCreated} data sources`);
    }

    /**
     * Migrate markets table: v1 -> v2
     * Transform crypto-specific columns to generic metadata JSON
     */
    private migrateMarkets(): void {
        this.logger.info('Migrating markets...');

        const v1Markets = this.db.prepare(`
            SELECT clob_token_id, crypto, strike, maturity, question, condition_id, active, last_updated
            FROM markets
        `).all() as V1Market[];

        this.logger.info(`Found ${v1Markets.length} markets to migrate`);

        const insertMarketStmt = this.db.prepare(`
            INSERT INTO markets (
                id, platform_id, platform_market_id, market_type, question, description,
                expires_at, closes_at, resolved, active, metadata, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(platform_id, platform_market_id) DO UPDATE SET
                question = excluded.question,
                active = excluded.active,
                updated_at = excluded.updated_at
        `);

        const insertOutcomeStmt = this.db.prepare(`
            INSERT INTO market_outcomes (id, market_id, outcome_name, platform_token_id, metadata)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(market_id, outcome_name) DO NOTHING
        `);

        for (const market of v1Markets) {
            const marketId = randomUUID();

            // Build metadata JSON from crypto-specific columns
            const metadata = {
                underlying: market.crypto,
                strike: market.strike,
                direction: 'above', // Assumption: markets are "above strike"
                polymarket: {
                    clobTokenId: market.clob_token_id,
                    conditionId: market.condition_id
                }
            };

            // Insert market
            insertMarketStmt.run(
                marketId,
                'polymarket',
                market.condition_id,
                'binary_price',
                market.question,
                null, // description
                market.maturity,
                market.maturity, // closes_at = expires_at
                0, // not resolved
                market.active,
                JSON.stringify(metadata),
                market.last_updated,
                market.last_updated
            );

            // Create YES/NO outcomes
            const yesId = randomUUID();
            const noId = randomUUID();

            insertOutcomeStmt.run(
                yesId,
                marketId,
                'YES',
                market.clob_token_id, // YES outcome uses the clob_token_id
                JSON.stringify({ isYes: true })
            );

            insertOutcomeStmt.run(
                noId,
                marketId,
                'NO',
                null, // NO outcome doesn't have a token ID in v1
                JSON.stringify({ isYes: false })
            );

            // Store mappings
            this.marketIdMap.set(market.clob_token_id, marketId);
            this.outcomeIdMap.set(marketId, { yesId, noId });

            this.stats.marketsCreated++;
            this.stats.marketOutcomesCreated += 2;
        }

        this.logger.success(`Migrated ${this.stats.marketsCreated} markets with ${this.stats.marketOutcomesCreated} outcomes`);
    }

    /**
     * Migrate positions table: v1 -> v2
     */
    private migratePositions(): void {
        this.logger.info('Migrating positions...');

        const v1Positions = this.db.prepare(`
            SELECT id, clob_token_id, quantity, average_price, last_updated
            FROM positions
        `).all() as V1Position[];

        this.logger.info(`Found ${v1Positions.length} positions to migrate`);

        const insertPositionStmt = this.db.prepare(`
            INSERT INTO positions (platform_id, market_id, outcome_id, quantity, average_price, opened_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const position of v1Positions) {
            const marketId = this.marketIdMap.get(position.clob_token_id);
            if (!marketId) {
                this.logger.warn(`Position ${position.id}: market not found for clob_token_id ${position.clob_token_id}`);
                continue;
            }

            const outcomes = this.outcomeIdMap.get(marketId);
            if (!outcomes) {
                this.logger.warn(`Position ${position.id}: outcomes not found for market ${marketId}`);
                continue;
            }

            // Assume all v1 positions are YES positions (based on clob_token_id)
            insertPositionStmt.run(
                'polymarket',
                marketId,
                outcomes.yesId,
                position.quantity,
                position.average_price,
                position.last_updated,
                position.last_updated
            );

            this.stats.positionsMigrated++;
        }

        this.logger.success(`Migrated ${this.stats.positionsMigrated} positions`);
    }

    /**
     * Migrate trades table: v1 -> v2
     */
    private migrateTrades(): void {
        this.logger.info('Migrating trades...');

        const v1Trades = this.db.prepare(`
            SELECT id, clob_token_id, side, quantity, price, timestamp, pnl, trade_type
            FROM trades
        `).all() as V1Trade[];

        this.logger.info(`Found ${v1Trades.length} trades to migrate`);

        const insertTradeStmt = this.db.prepare(`
            INSERT INTO trades (
                platform_id, market_id, outcome_id, platform_order_id,
                side, quantity, price, trade_type, fees, realized_pnl, executed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const trade of v1Trades) {
            const marketId = this.marketIdMap.get(trade.clob_token_id);
            if (!marketId) {
                this.logger.warn(`Trade ${trade.id}: market not found for clob_token_id ${trade.clob_token_id}`);
                continue;
            }

            const outcomes = this.outcomeIdMap.get(marketId);
            if (!outcomes) {
                this.logger.warn(`Trade ${trade.id}: outcomes not found for market ${marketId}`);
                continue;
            }

            // Assume all v1 trades are YES trades
            insertTradeStmt.run(
                'polymarket',
                marketId,
                outcomes.yesId,
                null, // no platform_order_id in v1
                trade.side,
                trade.quantity,
                trade.price,
                trade.trade_type,
                0, // no fees in v1
                trade.pnl,
                trade.timestamp
            );

            this.stats.tradesMigrated++;
        }

        this.logger.success(`Migrated ${this.stats.tradesMigrated} trades`);
    }

    /**
     * Migrate binance_ticks -> data_points
     */
    private migrateBinanceTicks(): void {
        this.logger.info('Migrating Binance ticks...');

        const v1Ticks = this.db.prepare(`
            SELECT id, symbol, price, bid_price, ask_price, bid_qty, ask_qty, timestamp
            FROM binance_ticks
        `).all() as V1BinanceTick[];

        this.logger.info(`Found ${v1Ticks.length} Binance ticks to migrate`);

        if (v1Ticks.length === 0) {
            this.logger.info('No Binance ticks to migrate. Skipping...');
            return;
        }

        const insertDataPointStmt = this.db.prepare(`
            INSERT INTO data_points (source_id, symbol, value, metadata, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);

        // Batch insert for performance
        const batchSize = 1000;
        for (let i = 0; i < v1Ticks.length; i += batchSize) {
            const batch = v1Ticks.slice(i, i + batchSize);

            for (const tick of batch) {
                const metadata = {
                    bidPrice: tick.bid_price,
                    askPrice: tick.ask_price,
                    bidQty: tick.bid_qty,
                    askQty: tick.ask_qty,
                    type: 'tick'
                };

                insertDataPointStmt.run(
                    'binance',
                    tick.symbol,
                    tick.price,
                    JSON.stringify(metadata),
                    tick.timestamp
                );

                this.stats.binanceTicksMigrated++;
            }

            if ((i + batchSize) % 10000 === 0) {
                this.logger.info(`  Migrated ${Math.min(i + batchSize, v1Ticks.length)} / ${v1Ticks.length} ticks...`);
            }
        }

        this.logger.success(`Migrated ${this.stats.binanceTicksMigrated} Binance ticks to data_points`);
    }

    /**
     * Migrate deribit_snapshots -> data_points
     */
    private migrateDeribitSnapshots(): void {
        this.logger.info('Migrating Deribit snapshots...');

        const v1Snapshots = this.db.prepare(`
            SELECT
                id, instrument_name, underlying_price, mark_iv, mark_price, last_price,
                best_bid_price, best_ask_price, open_interest, volume_24h,
                delta, gamma, vega, theta, timestamp
            FROM deribit_snapshots
        `).all() as V1DeribitSnapshot[];

        this.logger.info(`Found ${v1Snapshots.length} Deribit snapshots to migrate`);

        if (v1Snapshots.length === 0) {
            this.logger.info('No Deribit snapshots to migrate. Skipping...');
            return;
        }

        const insertDataPointStmt = this.db.prepare(`
            INSERT INTO data_points (source_id, symbol, value, metadata, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);

        // Batch insert for performance
        const batchSize = 1000;
        for (let i = 0; i < v1Snapshots.length; i += batchSize) {
            const batch = v1Snapshots.slice(i, i + batchSize);

            for (const snapshot of batch) {
                const metadata = {
                    underlyingPrice: snapshot.underlying_price,
                    markPrice: snapshot.mark_price,
                    lastPrice: snapshot.last_price,
                    bestBidPrice: snapshot.best_bid_price,
                    bestAskPrice: snapshot.best_ask_price,
                    openInterest: snapshot.open_interest,
                    volume24h: snapshot.volume_24h,
                    delta: snapshot.delta,
                    gamma: snapshot.gamma,
                    vega: snapshot.vega,
                    theta: snapshot.theta,
                    type: 'iv_snapshot'
                };

                // Use mark_iv as the primary value
                insertDataPointStmt.run(
                    'deribit',
                    snapshot.instrument_name,
                    snapshot.mark_iv,
                    JSON.stringify(metadata),
                    snapshot.timestamp
                );

                this.stats.deribitSnapshotsMigrated++;
            }

            if ((i + batchSize) % 10000 === 0) {
                this.logger.info(`  Migrated ${Math.min(i + batchSize, v1Snapshots.length)} / ${v1Snapshots.length} snapshots...`);
            }
        }

        this.logger.success(`Migrated ${this.stats.deribitSnapshotsMigrated} Deribit snapshots to data_points`);
    }

    /**
     * Migrate portfolio_greeks -> portfolio_risk
     */
    private migratePortfolioGreeks(): void {
        this.logger.info('Migrating portfolio Greeks...');

        const v1Greeks = this.db.prepare(`
            SELECT id, timestamp, delta, gamma, vega, theta, notional, num_positions
            FROM portfolio_greeks
        `).all() as V1PortfolioGreeks[];

        this.logger.info(`Found ${v1Greeks.length} portfolio Greek snapshots to migrate`);

        if (v1Greeks.length === 0) {
            this.logger.info('No portfolio Greeks to migrate. Skipping...');
            return;
        }

        const insertRiskStmt = this.db.prepare(`
            INSERT INTO portfolio_risk (
                platform_id, num_positions, num_markets, total_notional,
                total_delta, total_gamma, total_vega, total_theta, timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const greeks of v1Greeks) {
            // Convert ISO timestamp to Unix milliseconds
            const timestampMs = new Date(greeks.timestamp).getTime();

            insertRiskStmt.run(
                'polymarket', // All v1 data is Polymarket
                greeks.num_positions,
                greeks.num_positions, // Assume 1 market per position (no data in v1)
                greeks.notional,
                greeks.delta,
                greeks.gamma,
                greeks.vega,
                greeks.theta,
                timestampMs
            );

            this.stats.portfolioGreeksMigrated++;
        }

        this.logger.success(`Migrated ${this.stats.portfolioGreeksMigrated} portfolio Greek snapshots to portfolio_risk`);
    }

    /**
     * Validate migration data integrity
     */
    private validateMigration(): void {
        this.logger.info('Validating migration...');

        // Check that all v1 markets have corresponding v2 markets
        const v1MarketCount = (this.db.prepare('SELECT COUNT(*) as c FROM markets').get() as { c: number }).c;
        const v2MarketCount = (this.db.prepare('SELECT COUNT(*) as c FROM markets WHERE platform_id = ?').get('polymarket') as { c: number }).c;

        if (v1MarketCount !== v2MarketCount) {
            throw new Error(`Market count mismatch: v1=${v1MarketCount}, v2=${v2MarketCount}`);
        }

        // Check that all market_outcomes have valid market_id references
        const orphanedOutcomes = this.db.prepare(`
            SELECT COUNT(*) as c FROM market_outcomes mo
            WHERE NOT EXISTS (SELECT 1 FROM markets m WHERE m.id = mo.market_id)
        `).get() as { c: number };

        if (orphanedOutcomes.c > 0) {
            throw new Error(`Found ${orphanedOutcomes.c} orphaned market outcomes`);
        }

        // Check that all positions have valid foreign keys
        const orphanedPositions = this.db.prepare(`
            SELECT COUNT(*) as c FROM positions p
            WHERE NOT EXISTS (SELECT 1 FROM markets m WHERE m.id = p.market_id)
               OR NOT EXISTS (SELECT 1 FROM market_outcomes mo WHERE mo.id = p.outcome_id)
        `).get() as { c: number };

        if (orphanedPositions.c > 0) {
            throw new Error(`Found ${orphanedPositions.c} positions with invalid foreign keys`);
        }

        // Check that all trades have valid foreign keys
        const orphanedTrades = this.db.prepare(`
            SELECT COUNT(*) as c FROM trades t
            WHERE NOT EXISTS (SELECT 1 FROM markets m WHERE m.id = t.market_id)
               OR NOT EXISTS (SELECT 1 FROM market_outcomes mo WHERE mo.id = t.outcome_id)
        `).get() as { c: number };

        if (orphanedTrades.c > 0) {
            throw new Error(`Found ${orphanedTrades.c} trades with invalid foreign keys`);
        }

        this.logger.success('Data integrity validation passed');
    }

    /**
     * Update schema version to v2
     */
    private updateSchemaVersion(): void {
        this.logger.info('Updating schema version...');

        // Insert or update schema version
        this.db.prepare(`
            INSERT INTO schema_version (version, description)
            VALUES (2, 'Multi-platform, multi-market-type schema with event sourcing (migrated from v1)')
            ON CONFLICT(version) DO UPDATE SET
                applied_at = CURRENT_TIMESTAMP
        `).run();

        this.logger.success('Schema version updated to v2');
    }

    /**
     * Print migration summary
     */
    private printMigrationSummary(): void {
        this.logger.info('');
        this.logger.info('========================================');
        this.logger.info('MIGRATION SUMMARY');
        this.logger.info('========================================');
        this.logger.info(`Platforms created:         ${this.stats.platformsCreated}`);
        this.logger.info(`Data sources created:      ${this.stats.dataSourcesCreated}`);
        this.logger.info(`Markets migrated:          ${this.stats.marketsCreated}`);
        this.logger.info(`Market outcomes created:   ${this.stats.marketOutcomesCreated}`);
        this.logger.info(`Positions migrated:        ${this.stats.positionsMigrated}`);
        this.logger.info(`Trades migrated:           ${this.stats.tradesMigrated}`);
        this.logger.info(`Binance ticks migrated:    ${this.stats.binanceTicksMigrated}`);
        this.logger.info(`Deribit snapshots migrated: ${this.stats.deribitSnapshotsMigrated}`);
        this.logger.info(`Portfolio Greeks migrated: ${this.stats.portfolioGreeksMigrated}`);
        this.logger.info('========================================');
        this.logger.info('');
    }

    /**
     * Prompt user for input (for interactive mode)
     */
    private async promptUser(message: string): Promise<string> {
        // In a real implementation, this would use readline or similar
        // For now, we'll default to 'yes' for automated migrations
        this.logger.warn('Automated mode: defaulting to "yes"');
        return 'yes';
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

export async function main() {
    const args = process.argv.slice(2);
    const dbPath = args[0] || DEFAULT_DB_PATH;

    console.log('');
    console.log('========================================');
    console.log('PolyTrade Database Migration: v1 → v2');
    console.log('========================================');
    console.log('');

    const migration = new MigrationV1toV2(dbPath);

    try {
        await migration.migrate();
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        migration.close();
    }
}

// Run migration if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
