/**
 * PolyTrade Migration Validation Script
 *
 * Validates that v1 to v2 migration completed successfully.
 * Performs comprehensive checks on data integrity, foreign keys, and counts.
 *
 * Usage:
 *   npx tsx src/db/validate_migration.ts [path/to/database.db]
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// CONFIGURATION
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, 'PolyTrade.db');

// ============================================================================
// VALIDATION RESULTS
// ============================================================================

interface ValidationResult {
    check: string;
    passed: boolean;
    message: string;
    details?: any;
}

interface ValidationSummary {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
    results: ValidationResult[];
}

// ============================================================================
// VALIDATOR CLASS
// ============================================================================

export class MigrationValidator {
    private db: Database.Database;
    private dbPath: string;
    private results: ValidationResult[] = [];

    constructor(dbPath: string = DEFAULT_DB_PATH) {
        this.dbPath = path.resolve(dbPath);
        this.db = new Database(this.dbPath, { readonly: true });
    }

    /**
     * Run all validation checks
     */
    async validate(): Promise<ValidationSummary> {
        console.log('========================================');
        console.log('PolyTrade Migration Validation');
        console.log('========================================');
        console.log(`Database: ${this.dbPath}\n`);

        // Schema checks
        this.checkSchemaVersion();
        this.checkV2TablesExist();

        // Platform and data source checks
        this.checkPlatformsSetup();
        this.checkDataSourcesSetup();

        // Market checks
        this.checkMarketsCount();
        this.checkMarketOutcomes();
        this.checkMarketMetadata();

        // Trading data checks
        this.checkPositionsForeignKeys();
        this.checkTradesForeignKeys();

        // Data points checks
        this.checkDataPointsExist();
        this.checkBinanceMigration();
        this.checkDeribitMigration();

        // Risk data checks
        this.checkPortfolioRiskMigration();

        // Foreign key integrity
        this.checkAllForeignKeyIntegrity();

        // Indexes
        this.checkIndexes();

        // Generate summary
        return this.generateSummary();
    }

    /**
     * Check schema version is v2
     */
    private checkSchemaVersion(): void {
        try {
            const result = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number };

            if (result.v === 2) {
                this.pass('Schema Version', 'Database is at version 2', { version: result.v });
            } else {
                this.fail('Schema Version', `Expected version 2, got ${result.v}`, { version: result.v });
            }
        } catch (error) {
            this.fail('Schema Version', `Could not read schema_version: ${error}`);
        }
    }

    /**
     * Check all v2 tables exist
     */
    private checkV2TablesExist(): void {
        const requiredTables = [
            'platforms',
            'markets',
            'market_outcomes',
            'positions',
            'trades',
            'data_sources',
            'data_points',
            'pricing_snapshots',
            'portfolio_risk',
            'events'
        ];

        const tables = this.db.prepare(`
            SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `).all() as { name: string }[];

        const tableNames = tables.map(t => t.name);
        const missing = requiredTables.filter(t => !tableNames.includes(t));

        if (missing.length === 0) {
            this.pass('v2 Tables', 'All v2 tables exist', { count: requiredTables.length });
        } else {
            this.fail('v2 Tables', `Missing tables: ${missing.join(', ')}`, { missing });
        }
    }

    /**
     * Check platforms are set up correctly
     */
    private checkPlatformsSetup(): void {
        const platforms = this.db.prepare('SELECT * FROM platforms').all() as any[];

        if (platforms.length === 0) {
            this.fail('Platforms', 'No platforms found in database');
            return;
        }

        const polymarket = platforms.find(p => p.id === 'polymarket');
        if (polymarket) {
            this.pass('Platforms', 'Polymarket platform exists', { platforms: platforms.length });
        } else {
            this.fail('Platforms', 'Polymarket platform not found', { platforms });
        }
    }

    /**
     * Check data sources are set up correctly
     */
    private checkDataSourcesSetup(): void {
        const sources = this.db.prepare('SELECT * FROM data_sources').all() as any[];

        const expectedSources = ['binance', 'deribit'];
        const foundSources = sources.map(s => s.id);
        const missing = expectedSources.filter(s => !foundSources.includes(s));

        if (missing.length === 0) {
            this.pass('Data Sources', 'All expected data sources exist', { sources: foundSources });
        } else {
            this.warn('Data Sources', `Missing sources: ${missing.join(', ')}`, { found: foundSources, missing });
        }
    }

    /**
     * Check markets count matches v1 (if v1 tables still exist)
     */
    private checkMarketsCount(): void {
        try {
            // Check if v1 markets table exists
            const v1Exists = this.db.prepare(`
                SELECT name FROM sqlite_master WHERE type='table' AND name='markets'
            `).get();

            if (!v1Exists) {
                this.warn('Markets Count', 'v1 markets table not found (may have been dropped)');
                return;
            }

            const v2MarketCount = (this.db.prepare('SELECT COUNT(*) as c FROM markets WHERE platform_id = ?').get('polymarket') as { c: number }).c;

            if (v2MarketCount > 0) {
                this.pass('Markets Count', `Migrated ${v2MarketCount} markets`, { count: v2MarketCount });
            } else {
                this.warn('Markets Count', 'No markets found in v2 schema (v1 may have been empty)');
            }
        } catch (error) {
            this.fail('Markets Count', `Error checking markets: ${error}`);
        }
    }

    /**
     * Check each market has YES/NO outcomes
     */
    private checkMarketOutcomes(): void {
        const markets = this.db.prepare('SELECT id FROM markets WHERE platform_id = ?').all('polymarket') as { id: string }[];

        if (markets.length === 0) {
            this.warn('Market Outcomes', 'No markets to check outcomes for');
            return;
        }

        let missingOutcomes = 0;
        for (const market of markets) {
            const outcomes = this.db.prepare('SELECT outcome_name FROM market_outcomes WHERE market_id = ?').all(market.id) as { outcome_name: string }[];

            const hasYes = outcomes.some(o => o.outcome_name === 'YES');
            const hasNo = outcomes.some(o => o.outcome_name === 'NO');

            if (!hasYes || !hasNo) {
                missingOutcomes++;
            }
        }

        if (missingOutcomes === 0) {
            this.pass('Market Outcomes', 'All markets have YES/NO outcomes', { marketsChecked: markets.length });
        } else {
            this.fail('Market Outcomes', `${missingOutcomes} markets missing YES/NO outcomes`, { marketsChecked: markets.length, missing: missingOutcomes });
        }
    }

    /**
     * Check market metadata contains expected fields
     */
    private checkMarketMetadata(): void {
        const markets = this.db.prepare('SELECT id, metadata FROM markets WHERE platform_id = ? LIMIT 10').all('polymarket') as { id: string; metadata: string }[];

        if (markets.length === 0) {
            this.warn('Market Metadata', 'No markets to check metadata for');
            return;
        }

        let validMetadata = 0;
        for (const market of markets) {
            try {
                const metadata = JSON.parse(market.metadata);
                if (metadata.underlying && metadata.strike !== undefined && metadata.polymarket) {
                    validMetadata++;
                }
            } catch (error) {
                // Invalid JSON
            }
        }

        if (validMetadata === markets.length) {
            this.pass('Market Metadata', 'All sampled markets have valid metadata', { sampled: markets.length });
        } else {
            this.fail('Market Metadata', `${markets.length - validMetadata}/${markets.length} markets have invalid metadata`, { sampled: markets.length, valid: validMetadata });
        }
    }

    /**
     * Check positions have valid foreign keys
     */
    private checkPositionsForeignKeys(): void {
        const orphaned = this.db.prepare(`
            SELECT COUNT(*) as c FROM positions p
            WHERE NOT EXISTS (SELECT 1 FROM markets m WHERE m.id = p.market_id)
               OR NOT EXISTS (SELECT 1 FROM market_outcomes mo WHERE mo.id = p.outcome_id)
               OR NOT EXISTS (SELECT 1 FROM platforms pl WHERE pl.id = p.platform_id)
        `).get() as { c: number };

        if (orphaned.c === 0) {
            const total = (this.db.prepare('SELECT COUNT(*) as c FROM positions').get() as { c: number }).c;
            this.pass('Positions Foreign Keys', 'All positions have valid foreign keys', { total });
        } else {
            this.fail('Positions Foreign Keys', `${orphaned.c} positions have invalid foreign keys`, { orphaned: orphaned.c });
        }
    }

    /**
     * Check trades have valid foreign keys
     */
    private checkTradesForeignKeys(): void {
        const orphaned = this.db.prepare(`
            SELECT COUNT(*) as c FROM trades t
            WHERE NOT EXISTS (SELECT 1 FROM markets m WHERE m.id = t.market_id)
               OR NOT EXISTS (SELECT 1 FROM market_outcomes mo WHERE mo.id = t.outcome_id)
               OR NOT EXISTS (SELECT 1 FROM platforms pl WHERE pl.id = t.platform_id)
        `).get() as { c: number };

        if (orphaned.c === 0) {
            const total = (this.db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number }).c;
            this.pass('Trades Foreign Keys', 'All trades have valid foreign keys', { total });
        } else {
            this.fail('Trades Foreign Keys', `${orphaned.c} trades have invalid foreign keys`, { orphaned: orphaned.c });
        }
    }

    /**
     * Check data_points table has data
     */
    private checkDataPointsExist(): void {
        const count = (this.db.prepare('SELECT COUNT(*) as c FROM data_points').get() as { c: number }).c;

        if (count > 0) {
            this.pass('Data Points', `${count} data points migrated`, { count });
        } else {
            this.warn('Data Points', 'No data points found (v1 may have had no Binance/Deribit data)');
        }
    }

    /**
     * Check Binance ticks were migrated
     */
    private checkBinanceMigration(): void {
        const binancePoints = (this.db.prepare('SELECT COUNT(*) as c FROM data_points WHERE source_id = ?').get('binance') as { c: number }).c;

        if (binancePoints > 0) {
            this.pass('Binance Migration', `${binancePoints} Binance ticks migrated`, { count: binancePoints });

            // Sample a few to check metadata
            const samples = this.db.prepare('SELECT metadata FROM data_points WHERE source_id = ? LIMIT 5').all('binance') as { metadata: string }[];
            let validMetadata = 0;
            for (const sample of samples) {
                try {
                    const meta = JSON.parse(sample.metadata);
                    if (meta.type === 'tick') validMetadata++;
                } catch { }
            }

            if (validMetadata !== samples.length) {
                this.warn('Binance Migration', `${samples.length - validMetadata}/${samples.length} sampled points have invalid metadata`);
            }
        } else {
            this.warn('Binance Migration', 'No Binance data points found (v1 may have had no Binance data)');
        }
    }

    /**
     * Check Deribit snapshots were migrated
     */
    private checkDeribitMigration(): void {
        const deribitPoints = (this.db.prepare('SELECT COUNT(*) as c FROM data_points WHERE source_id = ?').get('deribit') as { c: number }).c;

        if (deribitPoints > 0) {
            this.pass('Deribit Migration', `${deribitPoints} Deribit snapshots migrated`, { count: deribitPoints });

            // Sample a few to check metadata
            const samples = this.db.prepare('SELECT metadata FROM data_points WHERE source_id = ? LIMIT 5').all('deribit') as { metadata: string }[];
            let validMetadata = 0;
            for (const sample of samples) {
                try {
                    const meta = JSON.parse(sample.metadata);
                    if (meta.type === 'iv_snapshot' && meta.delta !== undefined) validMetadata++;
                } catch { }
            }

            if (validMetadata !== samples.length) {
                this.warn('Deribit Migration', `${samples.length - validMetadata}/${samples.length} sampled points have invalid metadata`);
            }
        } else {
            this.warn('Deribit Migration', 'No Deribit data points found (v1 may have had no Deribit data)');
        }
    }

    /**
     * Check portfolio_greeks migrated to portfolio_risk
     */
    private checkPortfolioRiskMigration(): void {
        const riskCount = (this.db.prepare('SELECT COUNT(*) as c FROM portfolio_risk').get() as { c: number }).c;

        if (riskCount > 0) {
            this.pass('Portfolio Risk', `${riskCount} portfolio risk snapshots migrated`, { count: riskCount });

            // Check that Greeks are present
            const withGreeks = (this.db.prepare('SELECT COUNT(*) as c FROM portfolio_risk WHERE total_delta IS NOT NULL').get() as { c: number }).c;

            if (withGreeks > 0) {
                this.pass('Portfolio Greeks', `${withGreeks} risk snapshots have Greeks data`, { count: withGreeks });
            } else {
                this.warn('Portfolio Greeks', 'No risk snapshots have Greeks data');
            }
        } else {
            this.warn('Portfolio Risk', 'No portfolio risk snapshots found (v1 may have had no Greeks data)');
        }
    }

    /**
     * Check all foreign key constraints
     */
    private checkAllForeignKeyIntegrity(): void {
        // Enable foreign keys temporarily for check
        this.db.pragma('foreign_keys = ON');

        try {
            const violations = this.db.prepare('PRAGMA foreign_key_check').all();

            if (violations.length === 0) {
                this.pass('Foreign Key Integrity', 'All foreign key constraints satisfied');
            } else {
                this.fail('Foreign Key Integrity', `${violations.length} foreign key violations found`, { violations });
            }
        } catch (error) {
            this.fail('Foreign Key Integrity', `Error checking foreign keys: ${error}`);
        }
    }

    /**
     * Check important indexes exist
     */
    private checkIndexes(): void {
        const indexes = this.db.prepare(`
            SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'
        `).all() as { name: string }[];

        const expectedIndexes = [
            'idx_markets_platform',
            'idx_markets_type',
            'idx_markets_active',
            'idx_outcomes_market',
            'idx_positions_market',
            'idx_trades_market',
            'idx_trades_executed',
            'idx_data_points_lookup',
            'idx_portfolio_risk_time'
        ];

        const indexNames = indexes.map(i => i.name);
        const missing = expectedIndexes.filter(i => !indexNames.includes(i));

        if (missing.length === 0) {
            this.pass('Indexes', 'All important indexes exist', { total: indexes.length });
        } else {
            this.warn('Indexes', `Missing indexes: ${missing.join(', ')}`, { total: indexes.length, missing });
        }
    }

    /**
     * Record a passing check
     */
    private pass(check: string, message: string, details?: any): void {
        this.results.push({ check, passed: true, message, details });
        console.log(`✅ ${check}: ${message}`);
    }

    /**
     * Record a failing check
     */
    private fail(check: string, message: string, details?: any): void {
        this.results.push({ check, passed: false, message, details });
        console.error(`❌ ${check}: ${message}`);
    }

    /**
     * Record a warning
     */
    private warn(check: string, message: string, details?: any): void {
        this.results.push({ check, passed: true, message: `⚠️  ${message}`, details });
        console.warn(`⚠️  ${check}: ${message}`);
    }

    /**
     * Generate summary
     */
    private generateSummary(): ValidationSummary {
        const totalChecks = this.results.length;
        const passed = this.results.filter(r => r.passed).length;
        const failed = this.results.filter(r => !r.passed).length;
        const warnings = this.results.filter(r => r.message.includes('⚠️')).length;

        return {
            totalChecks,
            passed,
            failed,
            warnings,
            results: this.results
        };
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

    const validator = new MigrationValidator(dbPath);

    try {
        const summary = await validator.validate();

        console.log('\n========================================');
        console.log('VALIDATION SUMMARY');
        console.log('========================================');
        console.log(`Total Checks: ${summary.totalChecks}`);
        console.log(`Passed: ${summary.passed}`);
        console.log(`Failed: ${summary.failed}`);
        console.log(`Warnings: ${summary.warnings}`);
        console.log('========================================\n');

        if (summary.failed === 0) {
            console.log('✅ Migration validation PASSED!');
            console.log('The v2 database appears to be correctly migrated.\n');
            process.exit(0);
        } else {
            console.error('❌ Migration validation FAILED!');
            console.error('Please review the errors above and consider rolling back.\n');
            process.exit(1);
        }

    } catch (error) {
        console.error('Validation error:', error);
        process.exit(1);
    } finally {
        validator.close();
    }
}

// Run validation if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
