# PolyTrade Database Migration Scripts

This directory contains all database migration scripts and utilities for upgrading from v1 to v2 schema.

## Quick Start

### Run Migration

```bash
# Using npm script (recommended)
npm run db:migrate

# Or directly with tsx
npx tsx src/db/migrate_v1_to_v2.ts

# With custom database path
npx tsx src/db/migrate_v1_to_v2.ts /path/to/database.db
```

### Validate Migration

```bash
# Using npm script
npm run db:validate

# Or directly
npx tsx src/db/validate_migration.ts
```

### Rollback (if needed)

```bash
# Using npm script
npm run db:rollback

# Or directly
npx tsx src/db/rollback_v2_to_v1.ts
```

## Files

| File | Purpose |
|------|---------|
| `schema_v2.sql` | Complete v2 schema definition |
| `migrate_v1_to_v2.ts` | Main migration script (v1 → v2) |
| `rollback_v2_to_v1.ts` | Rollback script (v2 → v1) |
| `validate_migration.ts` | Post-migration validation script |
| `MIGRATION_GUIDE.md` | Comprehensive migration guide |
| `Database.ts` | v1 database class (legacy) |
| `DatabaseV2.ts` | v2 database class (new) |

## Migration Overview

### What's New in v2?

- **Multi-Platform Support**: Trade on Polymarket, Kalshi, PredictIt, and more
- **Multiple Market Types**: binary_price, binary_event, categorical, continuous
- **Flexible Metadata**: JSON-based platform-specific data storage
- **Enhanced Event Sourcing**: Complete audit trail with events table
- **Generic Data Points**: Unified storage for Binance, Deribit, and other data sources
- **CQRS Views**: Pre-built read-optimized views

### Migration Steps

1. **Backup**: Automatic backup created at `PolyTrade.db.v1_backup`
2. **Create v2 Schema**: All new tables created alongside v1
3. **Data Transformation**:
   - Markets: crypto/strike columns → JSON metadata
   - Positions/Trades: New foreign keys to market_outcomes
   - Binance/Deribit data → Generic data_points
4. **Validation**: Automatic integrity checks
5. **Version Update**: Schema version updated to v2

### Safety Features

- ✅ **Transactional**: All-or-nothing (rolls back on error)
- ✅ **Idempotent**: Safe to run multiple times
- ✅ **Automatic Backup**: Creates `.v1_backup` before migration
- ✅ **Data Validation**: Checks foreign keys and counts
- ✅ **Rollback Available**: Easy restoration to v1

## Example: Complete Migration Workflow

```bash
# 1. Check current database state
sqlite3 PolyTrade.db "SELECT * FROM schema_version;"

# 2. Manual backup (optional, automatic backup is created)
cp PolyTrade.db PolyTrade.db.manual_backup

# 3. Run migration
npm run db:migrate

# 4. Validate migration
npm run db:validate

# 5. If something's wrong, rollback
npm run db:rollback

# 6. Check v2 database
sqlite3 PolyTrade.db "
  SELECT 'Platforms:', COUNT(*) FROM platforms
  UNION ALL SELECT 'Markets:', COUNT(*) FROM markets
  UNION ALL SELECT 'Outcomes:', COUNT(*) FROM market_outcomes
  UNION ALL SELECT 'Data Points:', COUNT(*) FROM data_points;
"
```

## Common Use Cases

### Inspect v2 Schema

```bash
sqlite3 PolyTrade.db .schema
```

### Check Migration Status

```bash
sqlite3 PolyTrade.db "SELECT version, description, applied_at FROM schema_version ORDER BY version;"
```

### View Migrated Data

```sql
-- View active markets
SELECT * FROM v_active_markets LIMIT 10;

-- View portfolio summary
SELECT * FROM v_portfolio_summary;

-- View recent trades
SELECT * FROM v_recent_trades LIMIT 20;

-- Check data sources
SELECT id, source_type, display_name, enabled FROM data_sources;

-- Sample data points
SELECT source_id, symbol, value, timestamp
FROM data_points
ORDER BY timestamp DESC
LIMIT 10;
```

### Performance Queries

```sql
-- Count records by table
SELECT
  'platforms' as table_name, COUNT(*) as count FROM platforms
UNION ALL SELECT 'markets', COUNT(*) FROM markets
UNION ALL SELECT 'market_outcomes', COUNT(*) FROM market_outcomes
UNION ALL SELECT 'positions', COUNT(*) FROM positions
UNION ALL SELECT 'trades', COUNT(*) FROM trades
UNION ALL SELECT 'data_points', COUNT(*) FROM data_points
UNION ALL SELECT 'portfolio_risk', COUNT(*) FROM portfolio_risk;

-- Check database size
SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();
```

## Troubleshooting

### Migration Fails: "v1 schema not found"

**Solution:** Ensure database is at v1. Check with:
```bash
sqlite3 PolyTrade.db "SELECT name FROM sqlite_master WHERE type='table';"
```

### Migration Fails: Foreign key errors

**Solution:** Clean orphaned records before migration:
```sql
DELETE FROM positions WHERE clob_token_id NOT IN (SELECT clob_token_id FROM markets);
DELETE FROM trades WHERE clob_token_id NOT IN (SELECT clob_token_id FROM markets);
```

### Migration Hangs

**Solution:** Check database size. Large databases (>10GB) may take several minutes. Monitor progress in logs.

### Validation Fails After Migration

**Solution:** Review validation output. Common issues:
- Missing market outcomes (check `market_outcomes` table)
- Orphaned foreign keys (run `PRAGMA foreign_key_check;`)
- Invalid JSON metadata (check `markets.metadata` column)

### Need to Re-run Migration

The migration is **idempotent** and safe to run multiple times. It uses `ON CONFLICT` clauses to avoid duplicates.

```bash
# Safe to re-run
npm run db:migrate
```

## Development

### Adding a New Migration

When creating v3, follow this pattern:

1. Create `schema_v3.sql` with new schema
2. Create `migrate_v2_to_v3.ts` migration script
3. Create `rollback_v3_to_v2.ts` rollback script
4. Update `MIGRATION_GUIDE.md`
5. Add npm scripts to `package.json`

### Testing Migrations Locally

```bash
# Copy production database to test
cp PolyTrade.db PolyTrade.test.db

# Run migration on test database
npx tsx src/db/migrate_v1_to_v2.ts PolyTrade.test.db

# Validate test database
npx tsx src/db/validate_migration.ts PolyTrade.test.db

# Compare v1 and v2 schemas
sqlite3 PolyTrade.db.v1_backup .schema > v1_schema.sql
sqlite3 PolyTrade.test.db .schema > v2_schema.sql
diff v1_schema.sql v2_schema.sql
```

## Schema Version History

| Version | Date | Description |
|---------|------|-------------|
| 1 | 2026-01 | Initial Polymarket-specific schema |
| 2 | 2026-01 | Multi-platform, multi-market-type schema with event sourcing |

## Support

For migration issues:

1. Check the [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
2. Run validation script: `npm run db:validate`
3. Review error logs in console output
4. Check SQLite error codes: https://www.sqlite.org/rescode.html

## Best Practices

1. **Always backup** before migration (automatic backup is created)
2. **Test migrations** on a copy of production database first
3. **Validate after migration** using validation script
4. **Monitor performance** on large databases
5. **Keep v1 backup** until confident in v2 stability
6. **Use transactions** for all schema changes
7. **Document** any custom migrations or modifications

---

**Migration Scripts Version:** 1.0.0
**Last Updated:** 2026-01-24
**Maintained By:** PolyTrade Database Team
