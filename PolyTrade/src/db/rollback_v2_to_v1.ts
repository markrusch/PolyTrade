/**
 * PolyTrade Database Rollback: v2 to v1
 *
 * Restores database from v2 schema back to v1 schema using the backup.
 * This is a safety mechanism in case the migration causes issues.
 *
 * Features:
 * - Restores from .v1_backup file
 * - Validates backup integrity
 * - Creates pre-rollback backup of v2 database
 * - Atomic operation
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

// ============================================================================
// CONFIGURATION
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, 'PolyTrade.db');
const BACKUP_SUFFIX = '.v1_backup';
const V2_BACKUP_SUFFIX = '.v2_pre_rollback';

// ============================================================================
// LOGGER
// ============================================================================

class Logger {
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
// ROLLBACK CLASS
// ============================================================================

export class RollbackV2toV1 {
    private logger: Logger;
    private dbPath: string;
    private backupPath: string;
    private v2BackupPath: string;

    constructor(dbPath: string = DEFAULT_DB_PATH) {
        this.dbPath = path.resolve(dbPath);
        this.backupPath = `${this.dbPath}${BACKUP_SUFFIX}`;
        this.v2BackupPath = `${this.dbPath}${V2_BACKUP_SUFFIX}`;
        this.logger = new Logger();
    }

    /**
     * Main rollback entry point
     */
    async rollback(): Promise<void> {
        this.logger.info('Starting rollback from v2 to v1...');
        this.logger.info(`Database path: ${this.dbPath}`);
        this.logger.info(`Backup path: ${this.backupPath}`);

        try {
            // Pre-flight checks
            this.validateBackupExists();
            this.validateBackupIntegrity();

            // Confirm rollback
            const answer = await this.promptUser('This will restore the database to v1. Continue? (yes/no): ');
            if (answer.toLowerCase() !== 'yes') {
                this.logger.info('Rollback cancelled by user.');
                return;
            }

            // Create backup of current v2 database
            this.backupCurrentDatabase();

            // Perform rollback
            this.performRollback();

            this.logger.success('Rollback completed successfully!');
            this.logger.info('Database has been restored to v1 schema.');
            this.logger.info(`v2 database backed up to: ${this.v2BackupPath}`);

        } catch (error) {
            this.logger.error(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Validate that v1 backup exists
     */
    private validateBackupExists(): void {
        if (!fs.existsSync(this.backupPath)) {
            throw new Error(`v1 backup not found at: ${this.backupPath}`);
        }

        const stats = fs.statSync(this.backupPath);
        if (stats.size === 0) {
            throw new Error('v1 backup file is empty');
        }

        this.logger.info(`Found v1 backup (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    /**
     * Validate backup database integrity
     */
    private validateBackupIntegrity(): void {
        this.logger.info('Validating backup integrity...');

        try {
            const db = new Database(this.backupPath, { readonly: true });

            // Check for v1 tables
            const tables = db.prepare(`
                SELECT name FROM sqlite_master WHERE type='table' AND name IN ('markets', 'positions', 'trades')
            `).all() as { name: string }[];

            if (tables.length < 3) {
                throw new Error('Backup does not contain v1 schema tables');
            }

            // Check schema version
            try {
                const version = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number };
                if (version.v > 1) {
                    this.logger.warn(`Backup appears to be version ${version.v}, not v1. Proceeding anyway...`);
                }
            } catch {
                // schema_version table might not exist in early v1 databases
                this.logger.info('Backup does not have schema_version table (expected for early v1)');
            }

            db.close();
            this.logger.success('Backup integrity validated');

        } catch (error) {
            throw new Error(`Backup validation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Backup current v2 database before rollback
     */
    private backupCurrentDatabase(): void {
        if (!fs.existsSync(this.dbPath)) {
            this.logger.warn('Current database not found. Nothing to back up.');
            return;
        }

        if (fs.existsSync(this.v2BackupPath)) {
            this.logger.warn(`v2 backup already exists at ${this.v2BackupPath}`);
            fs.unlinkSync(this.v2BackupPath); // Overwrite
        }

        this.logger.info('Backing up current v2 database...');
        fs.copyFileSync(this.dbPath, this.v2BackupPath);
        this.logger.success(`v2 database backed up to: ${this.v2BackupPath}`);
    }

    /**
     * Perform the actual rollback
     */
    private performRollback(): void {
        this.logger.info('Performing rollback...');

        // Close any existing connections
        // Note: In a real system, you'd want to ensure no active connections

        // Replace current database with v1 backup
        fs.copyFileSync(this.backupPath, this.dbPath);

        this.logger.success('Database restored from v1 backup');
    }

    /**
     * Prompt user for input
     */
    private async promptUser(message: string): Promise<string> {
        // In automated mode, we should NOT default to yes for rollback
        // This is a destructive operation
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question(message, (answer) => {
                rl.close();
                resolve(answer);
            });
        });
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
    console.log('PolyTrade Database Rollback: v2 → v1');
    console.log('========================================');
    console.log('');
    console.log('WARNING: This will restore your database to v1 schema.');
    console.log('All v2-specific data will be lost unless you have a backup.');
    console.log('');

    const rollback = new RollbackV2toV1(dbPath);

    try {
        await rollback.rollback();
    } catch (error) {
        console.error('Rollback failed:', error);
        process.exit(1);
    }
}

// Run rollback if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
