import { Database } from 'duckdb-async';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'prediction-market-data', 'data');
console.log('Data dir:', dataDir);
console.log('Exists:', fs.existsSync(dataDir));

const subdirs = [
  ['polymarket', 'markets'],
  ['polymarket', 'trades'],
  ['polymarket', 'legacy_trades'],
  ['polymarket', 'blocks'],
  ['kalshi', 'markets'],
  ['kalshi', 'trades'],
];

const db = await Database.create(':memory:');

for (const parts of subdirs) {
  const fullPath = path.join(dataDir, ...parts);
  const tableName = parts.join('_').replace('/', '_');
  
  if (!fs.existsSync(fullPath)) {
    console.log(`SKIP ${tableName}: directory not found at ${fullPath}`);
    continue;
  }
  
  const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.parquet'));
  const dotFiles = files.filter(f => f.startsWith('._'));
  const realFiles = files.filter(f => !f.startsWith('._'));
  
  console.log(`\n${tableName}: ${realFiles.length} real + ${dotFiles.length} dot files`);
  
  if (realFiles.length === 0) {
    console.log(`  SKIP: no real parquet files`);
    continue;
  }
  
  // Try with ALL files (including ._*)
  const globAll = path.join(fullPath, '*.parquet').replace(/\\/g, '/');
  try {
    await db.run(`CREATE VIEW ${tableName}_all AS SELECT * FROM read_parquet('${globAll}')`);
    const r = await db.all(`SELECT COUNT(*) as cnt FROM ${tableName}_all`);
    console.log(`  ALL glob OK: ${r[0].cnt} rows`);
  } catch (e) {
    console.log(`  ALL glob FAILED: ${e.message.substring(0, 200)}`);
  }
  
  // Try with only real files (exclude ._*)  
  const globClean = path.join(fullPath, '[!._]*.parquet').replace(/\\/g, '/');
  try {
    await db.run(`CREATE VIEW ${tableName}_clean AS SELECT * FROM read_parquet('${globClean}')`);
    const r = await db.all(`SELECT COUNT(*) as cnt FROM ${tableName}_clean`);
    console.log(`  CLEAN glob OK: ${r[0].cnt} rows`);
  } catch (e) {
    console.log(`  CLEAN glob FAILED: ${e.message.substring(0, 200)}`);
  }
}

await db.close();
console.log('\nDone.');
