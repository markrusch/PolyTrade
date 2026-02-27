# PolyTrade Database Migration: v1 to v2 - Complete Package

## Overview

A comprehensive, production-ready migration system to upgrade PolyTrade from the Polymarket-specific v1 schema to the multi-platform v2 schema.

## Files Created

### Core Migration Scripts

1. **`src/db/migrate_v1_to_v2.ts`** (Main Migration Script)
   - Transforms v1 schema to v2 in a single atomic transaction
   - Creates v2 tables alongside existing v1 tables
   - Migrates all data with proper transformations
   - Validates data integrity before committing
   - Safe to run multiple times (idempotent)

2. **`src/db/rollback_v2_to_v1.ts`** (Rollback Script)
   - Restores database from automatic `.v1_backup` file
   - Creates pre-rollback backup of v2 database
   - Interactive confirmation for safety
   - Validates backup integrity before rollback

3. **`src/db/validate_migration.ts`** (Validation Script)
   - 15+ comprehensive validation checks
   - Foreign key integrity verification
   - Row count comparisons
   - Metadata structure validation
   - Index existence checks
   - Detailed pass/fail reporting

4. **`src/db/test_migration.ts`** (Test Script)
   - Creates sample v1 database with realistic data
   - Runs full migration on test database
   - Validates results automatically
   - Safe testing without touching production data

### Documentation

5. **`src/db/MIGRATION_GUIDE.md`** (Complete Guide)
   - Step-by-step migration instructions
   - Pre-migration checklist
   - Data transformation examples
   - Post-migration validation steps
   - Troubleshooting common issues
   - Performance considerations
   - Rollback procedures

6. **`src/db/README.md`** (Quick Reference)
   - Quick start commands
   - File descriptions
   - Common use cases
   - SQL query examples
   - Development guidelines
   - Best practices

7. **`MIGRATION_SUMMARY.md`** (This file)
   - High-level overview
   - Usage examples
   - Architecture decisions
   - Testing procedures

### Updated Files

8. **`package.json`**
   - Added npm scripts for easy migration:
     - `npm run db:migrate` - Run migration
     - `npm run db:rollback` - Rollback to v1
     - `npm run db:validate` - Validate migration
     - `npm run db:test-migration` - Test migration on sample data

## Migration Architecture

### Design Principles

1. **Safety First**
   - Automatic backup before migration
   - All changes in single transaction (rollback on error)
   - Foreign key validation
   - Row count verification
   - Idempotent design (safe to re-run)

2. **Data Integrity**
   - Parameterized SQL (zero SQL injection risk)
   - Foreign key constraints enforced
   - Unique constraints preserved
   - JSON validation for metadata
   - Comprehensive integrity checks

3. **Event Sourcing Ready**
   - Immutable event log structure
   - Complete audit trail capability
   - Replay-friendly design
   - Correlation ID support

4. **CQRS Compatible**
   - Separate read/write models
   - Pre-built materialized views
   - Optimized query indexes
   - Platform-agnostic queries

### Data Transformations

#### Markets (Crypto-Specific → Generic)

**Before (v1):**
```sql
clob_token_id | crypto | strike | maturity  | question
0xabc123      | ETH    | 4000   | 173568... | Will ETH be above $4000?
```

**After (v2):**
```sql
id (UUID) | platform_id | market_type   | metadata (JSON)
550e8400  | polymarket  | binary_price  | {"underlying": "ETH", "strike": 4000, ...}
```

#### Positions (Single Outcome → Multi-Outcome)

**Before (v1):**
```sql
clob_token_id | quantity | average_price
0xabc123      | 100      | 0.65
```

**After (v2):**
```sql
platform_id | market_id | outcome_id | quantity | average_price
polymarket  | 550e8400  | abc-yes    | 100      | 0.65
```

#### Data Points (Specialized → Generic)

**Before (v1):**
```sql
-- binance_ticks table
symbol   | price   | bid_price | ask_price | timestamp
ETHUSDT  | 3500.25 | 3500.20   | 3500.30   | 1735689600000

-- deribit_snapshots table
instrument_name  | mark_iv | delta | gamma | ...
ETH-28MAR26-4000-C | 0.65  | 0.5   | 0.002 | ...
```

**After (v2):**
```sql
-- data_points table (unified)
source_id | symbol               | value | metadata (JSON)              | timestamp
binance   | ETHUSDT              | 3500  | {"bidPrice": 3500.20, ...}   | 1735689600000
deribit   | ETH-28MAR26-4000-C   | 0.65  | {"delta": 0.5, "gamma": ...} | 1735689600000
```

## Usage Examples

### Basic Migration Workflow

```bash
# 1. Test migration on sample database first
npm run db:test-migration

# 2. Backup production database (manual, in addition to automatic)
cp PolyTrade.db PolyTrade.db.manual_backup

# 3. Run migration on production
npm run db:migrate

# 4. Validate results
npm run db:validate

# 5. If issues found, rollback
npm run db:rollback
```

### Advanced Usage

```bash
# Migrate custom database location
npx tsx src/db/migrate_v1_to_v2.ts /path/to/custom.db

# Validate custom database
npx tsx src/db/validate_migration.ts /path/to/custom.db

# Test migration multiple times
for i in {1..5}; do npm run db:test-migration; done
```

### Inspection Queries

```sql
-- Check schema version
SELECT version, description, applied_at FROM schema_version;

-- View all platforms
SELECT id, display_name, enabled FROM platforms;

-- View market distribution
SELECT
    platform_id,
    market_type,
    COUNT(*) as count,
    COUNT(CASE WHEN active = 1 THEN 1 END) as active_count
FROM markets
GROUP BY platform_id, market_type;

-- Check data source statistics
SELECT
    ds.id,
    ds.display_name,
    COUNT(dp.id) as data_points,
    MIN(dp.timestamp) as oldest,
    MAX(dp.timestamp) as newest
FROM data_sources ds
LEFT JOIN data_points dp ON ds.id = dp.source_id
GROUP BY ds.id;

-- Portfolio summary
SELECT * FROM v_portfolio_summary;

-- Recent trades
SELECT * FROM v_recent_trades LIMIT 20;
```

## Testing Procedures

### Unit Testing

```bash
# Create and test migration on sample database
npm run db:test-migration

# Expected output:
# - 3 markets created
# - 6 market outcomes (YES/NO for each market)
# - 2 positions migrated
# - 5 trades migrated
# - 100 Binance ticks migrated
# - 50 Deribit snapshots migrated
# - All validation checks pass
```

### Integration Testing

```bash
# 1. Copy production database to test environment
cp PolyTrade.db test_env/PolyTrade.db

# 2. Run migration in test environment
cd test_env
npx tsx ../src/db/migrate_v1_to_v2.ts PolyTrade.db

# 3. Validate results
npx tsx ../src/db/validate_migration.ts PolyTrade.db

# 4. Compare row counts
sqlite3 PolyTrade.db.v1_backup "SELECT COUNT(*) FROM markets;"
sqlite3 PolyTrade.db "SELECT COUNT(*) FROM markets WHERE platform_id='polymarket';"

# 5. Test application queries against v2 schema
# (Application-specific tests go here)
```

### Performance Testing

```bash
# Create large test database
sqlite3 large_test.db < create_large_v1_dataset.sql

# Time migration
time npx tsx src/db/migrate_v1_to_v2.ts large_test.db

# Expected times:
# - 100 MB: ~5 seconds
# - 1 GB: ~30 seconds
# - 10 GB: ~5 minutes
```

## Migration Statistics

For a typical PolyTrade database:

| Metric | v1 → v2 Ratio | Notes |
|--------|--------------|-------|
| Tables | 9 → 15 | New: platforms, market_outcomes, data_sources, data_points, events, portfolio_risk |
| Indexes | 8 → 20 | Enhanced indexing for multi-platform queries |
| Constraints | 4 → 12 | Additional foreign keys and checks |
| Views | 0 → 3 | CQRS read-optimized views |
| Row Count | 1:1 to 1:2 | Markets get 2 outcomes each |
| Storage | +5-10% | JSON metadata overhead |

## Rollback Capability

### Automatic Backup

Every migration creates `PolyTrade.db.v1_backup` automatically.

### Rollback Procedure

```bash
# Option 1: Use rollback script (recommended)
npm run db:rollback

# Option 2: Manual rollback
cp PolyTrade.db.v1_backup PolyTrade.db

# Option 3: Use manual backup (if created)
cp PolyTrade.db.manual_backup PolyTrade.db
```

### Recovery from Failed Migration

If migration fails mid-transaction:
- Database automatically rolls back to pre-migration state
- No data loss occurs
- v1 backup remains untouched
- Safe to re-run migration after fixing issues

## Production Deployment Checklist

- [ ] Review MIGRATION_GUIDE.md thoroughly
- [ ] Test migration on database copy in staging environment
- [ ] Verify application compatibility with v2 schema
- [ ] Schedule maintenance window (estimate: 5 minutes per GB)
- [ ] Create manual backup in addition to automatic backup
- [ ] Notify team of migration schedule
- [ ] Close all application database connections
- [ ] Run migration: `npm run db:migrate`
- [ ] Run validation: `npm run db:validate`
- [ ] Verify application functionality with v2 schema
- [ ] Monitor performance for 24 hours
- [ ] Keep v1 backup for at least 7 days
- [ ] Document any issues encountered

## Support and Maintenance

### Common Issues

1. **Migration hangs**: Large databases take time. Monitor progress in logs.
2. **Foreign key errors**: Clean orphaned v1 records before migration.
3. **Validation warnings**: Usually safe if only warnings, review case-by-case.
4. **Rollback needed**: Use `npm run db:rollback` immediately.

### Debugging

```bash
# Enable WAL checkpoint (if database locked)
sqlite3 PolyTrade.db "PRAGMA wal_checkpoint(TRUNCATE);"

# Check for active connections
lsof PolyTrade.db  # Linux/Mac
# or use Process Explorer on Windows

# Verify database integrity
sqlite3 PolyTrade.db "PRAGMA integrity_check;"

# Check foreign key violations
sqlite3 PolyTrade.db "PRAGMA foreign_key_check;"
```

## Future Enhancements

Potential improvements for future migrations:

1. **Streaming Migration**: For databases >50GB, chunk processing
2. **Progress Bar**: Real-time migration progress indicator
3. **Dry Run Mode**: Preview changes without committing
4. **Incremental Migration**: Migrate in stages over multiple runs
5. **Migration Hooks**: Pre/post migration custom scripts
6. **Automated Rollback**: Auto-rollback on validation failure
7. **Cloud Backup**: Automated backup to S3/cloud storage

## License and Credits

- **Migration Scripts**: PolyTrade Database Team
- **Schema Design**: Event Sourcing & CQRS patterns
- **Database Engine**: SQLite 3 with WAL mode
- **Language**: TypeScript with better-sqlite3

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-24 | Initial migration package (v1 → v2) |

---

**For detailed documentation, see:**
- [MIGRATION_GUIDE.md](src/db/MIGRATION_GUIDE.md) - Complete migration guide
- [README.md](src/db/README.md) - Quick reference and commands
- [schema_v2.sql](src/db/schema_v2.sql) - v2 schema definition

**Questions or issues?** Contact PolyTrade Database Team
