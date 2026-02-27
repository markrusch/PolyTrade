# PolyTrade Database Migration Guide: v1 to v2

## Overview

This guide describes the migration process from the Polymarket-specific v1 schema to the multi-platform v2 schema.

### What Changes in v2?

**v1 Schema (Polymarket-specific):**
- Hardcoded for Polymarket binary price markets
- Crypto-specific columns (crypto, strike, maturity)
- Single platform assumed
- Limited market type support

**v2 Schema (Multi-platform):**
- Platform-agnostic design
- Support for multiple market types (binary_price, binary_event, categorical, continuous)
- Flexible JSON metadata for platform-specific data
- Enhanced event sourcing and CQRS support
- Generic data_points table for multi-source data
- Improved foreign key relationships

## Migration Process

### 1. Pre-Migration Checklist

- [ ] Backup your database manually (just in case)
- [ ] Ensure no active trading operations
- [ ] Close all database connections
- [ ] Have at least 2x current database size free disk space
- [ ] Review the schema changes in `schema_v2.sql`

### 2. Run Migration

```bash
# From project root
cd PolyTrade

# Option 1: Default database path (PolyTrade.db in project root)
npx tsx src/db/migrate_v1_to_v2.ts

# Option 2: Custom database path
npx tsx src/db/migrate_v1_to_v2.ts /path/to/your/database.db
```

### 3. What the Migration Does

The migration performs these steps **atomically in a transaction**:

1. **Creates v2 Schema** - All new tables are created alongside existing v1 tables
2. **Setup Platforms** - Inserts default platform (polymarket)
3. **Setup Data Sources** - Inserts Binance and Deribit data sources
4. **Migrate Markets**:
   - Creates new market records with UUID primary keys
   - Transforms `crypto`, `strike` columns into JSON metadata
   - Creates YES/NO outcomes for each market
5. **Migrate Positions**:
   - Links to new market/outcome structure
   - Maintains all quantity and price data
6. **Migrate Trades**:
   - Links to new market/outcome structure
   - Preserves all trade history
7. **Migrate Binance Ticks**:
   - Transforms to generic data_points format
   - Preserves bid/ask data in JSON metadata
8. **Migrate Deribit Snapshots**:
   - Transforms to generic data_points format
   - Preserves Greeks in JSON metadata
9. **Migrate Portfolio Greeks**:
   - Transforms to portfolio_risk table
   - Adds platform_id reference
10. **Validate Data Integrity**:
    - Checks foreign key relationships
    - Verifies row counts match
11. **Update Schema Version** to v2

### 4. Data Transformations

#### Markets Transformation

**v1 (crypto-specific columns):**
```sql
clob_token_id: "0xabc123"
crypto: "ETH"
strike: 4000
maturity: 1735689600000
question: "Will ETH be above $4000 on Jan 1, 2025?"
```

**v2 (JSON metadata):**
```sql
id: "550e8400-e29b-41d4-a716-446655440000"  -- New UUID
platform_id: "polymarket"
platform_market_id: "0x1234..."  -- conditionId
market_type: "binary_price"
question: "Will ETH be above $4000 on Jan 1, 2025?"
metadata: {
  "underlying": "ETH",
  "strike": 4000,
  "direction": "above",
  "polymarket": {
    "clobTokenId": "0xabc123",
    "conditionId": "0x1234..."
  }
}
```

#### Data Points Transformation

**v1 Binance Tick:**
```sql
id: 1
symbol: "ETHUSDT"
price: 3500.25
bid_price: 3500.20
ask_price: 3500.30
timestamp: 1735689600000
```

**v2 Data Point:**
```sql
id: 1
source_id: "binance"
symbol: "ETHUSDT"
value: 3500.25
metadata: {
  "bidPrice": 3500.20,
  "askPrice": 3500.30,
  "type": "tick"
}
timestamp: 1735689600000
```

### 5. Post-Migration Validation

After migration completes, the script automatically validates:

- ✅ All markets migrated
- ✅ All market outcomes created
- ✅ No orphaned foreign keys
- ✅ Data integrity constraints satisfied

You can also manually verify:

```bash
# Check schema version
sqlite3 PolyTrade.db "SELECT * FROM schema_version;"

# Count records
sqlite3 PolyTrade.db "
  SELECT 'markets' as table_name, COUNT(*) as count FROM markets
  UNION ALL
  SELECT 'market_outcomes', COUNT(*) FROM market_outcomes
  UNION ALL
  SELECT 'positions', COUNT(*) FROM positions
  UNION ALL
  SELECT 'trades', COUNT(*) FROM trades
  UNION ALL
  SELECT 'data_points', COUNT(*) FROM data_points;
"

# Check platforms
sqlite3 PolyTrade.db "SELECT * FROM platforms;"

# Check data sources
sqlite3 PolyTrade.db "SELECT * FROM data_sources;"
```

### 6. Rollback (If Needed)

If something goes wrong, you can rollback to v1:

```bash
# Restore from automatic backup
npx tsx src/db/rollback_v2_to_v1.ts

# Or manually restore
cp PolyTrade.db.v1_backup PolyTrade.db
```

## Troubleshooting

### Migration Fails with "v1 schema not found"

**Cause:** Database is missing v1 tables (markets, positions, trades)

**Solution:** Ensure you're running migration on a v1 database

### Migration Fails with "Market count mismatch"

**Cause:** Data integrity issue during migration

**Solution:** Check migration logs for specific errors. May need to clean up corrupted v1 data.

### Foreign Key Constraint Errors

**Cause:** Orphaned records in v1 database

**Solution:** Run data cleanup before migration:
```sql
-- Delete orphaned positions
DELETE FROM positions
WHERE clob_token_id NOT IN (SELECT clob_token_id FROM markets);

-- Delete orphaned trades
DELETE FROM trades
WHERE clob_token_id NOT IN (SELECT clob_token_id FROM markets);
```

### Migration Hangs on Large Datasets

**Cause:** Large number of Binance/Deribit data points

**Solution:** Migration uses batch processing (1000 records/batch). Monitor progress in logs. This is expected for databases with millions of ticks.

## Performance Considerations

### Expected Migration Times

| Database Size | Estimated Time |
|--------------|----------------|
| < 100 MB | 1-5 seconds |
| 100 MB - 1 GB | 5-30 seconds |
| 1 GB - 10 GB | 30 seconds - 5 minutes |
| > 10 GB | 5+ minutes |

**Note:** Migration time is mostly I/O bound. Large numbers of data_points (Binance ticks, Deribit snapshots) will increase migration time.

### Optimization Tips

- Run migration when system is under low load
- Ensure database is on SSD for faster I/O
- Close all other database connections
- Don't interrupt the migration (it's transactional)

## Post-Migration Code Changes

After migration, update your application code to use v2 schema:

### Old v1 Code:
```typescript
import { DB } from './db/Database.js';

const db = new DB();
const markets = db.getMarkets();
// markets[0].crypto, markets[0].strike
```

### New v2 Code:
```typescript
import { DatabaseV2 } from './db/DatabaseV2.js';

const db = new DatabaseV2();
const markets = db.getActiveMarkets('polymarket');
// markets[0].metadata.underlying, markets[0].metadata.strike
```

## Safety Features

The migration script includes:

1. **Automatic Backup** - Creates `PolyTrade.db.v1_backup` before migration
2. **Transaction Safety** - All changes in single transaction (rollback on error)
3. **Idempotency** - Safe to run multiple times (uses ON CONFLICT clauses)
4. **Data Validation** - Validates integrity before committing
5. **Rollback Script** - Easy restoration to v1 if needed

## Support

If you encounter issues not covered in this guide:

1. Check the migration logs for detailed error messages
2. Review the `validate_migration.ts` test script output
3. Manually inspect the v1_backup file to ensure data preservation
4. Contact the development team with error logs

## Next Steps

After successful migration:

1. Test your application thoroughly with v2 schema
2. Update any custom queries to use new table structure
3. Review the new CQRS views (v_active_markets, v_portfolio_summary)
4. Consider implementing event sourcing for new state changes
5. Remove v1 tables once confident in v2 (keep backup!)

---

**Migration Author:** PolyTrade Database Team
**Schema Version:** v2.0
**Last Updated:** 2026-01-24
