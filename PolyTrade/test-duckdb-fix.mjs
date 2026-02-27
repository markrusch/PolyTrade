import { Database } from 'duckdb-async';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'prediction-market-data', 'data');
console.log('Data dir:', dataDir);

const subdirs = [
  { name: 'polymarket_markets', subdir: ['polymarket', 'markets'] },
  { name: 'polymarket_trades', subdir: ['polymarket', 'trades'] },
  { name: 'polymarket_legacy_trades', subdir: ['polymarket', 'legacy_trades'] },
];

const db = await Database.create(':memory:');

for (const { name, subdir } of subdirs) {
  const fullPath = path.join(dataDir, ...subdir);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`SKIP ${name}: not found`);
    continue;
  }
  
  // Exclude ._* files
  const files = fs.readdirSync(fullPath)
    .filter(f => f.endsWith('.parquet') && !f.startsWith('._'));
  
  console.log(`\n${name}: ${files.length} files`);
  
  if (files.length === 0) continue;
  
  // Build explicit file list
  const filePaths = files.map(f => path.join(fullPath, f).replace(/\\/g, '/'));
  const fileListSql = filePaths.map(f => `'${f}'`).join(', ');
  
  try {
    await db.run(`CREATE VIEW ${name} AS SELECT * FROM read_parquet([${fileListSql}])`);
    const r = await db.all(`SELECT COUNT(*) as cnt FROM ${name}`);
    console.log(`  OK: ${r[0].cnt} rows`);
  } catch (e) {
    console.log(`  FAILED: ${e.message.substring(0, 300)}`);
  }
}

// Test a query
try {
  const r = await db.all(`SELECT question, volume FROM polymarket_markets ORDER BY volume DESC LIMIT 5`);
  console.log('\nTop 5 markets by volume:');
  for (const row of r) {
    console.log(`  $${Math.round(row.volume)} - ${row.question?.toString().substring(0, 80)}`);
  }
} catch (e) {
  console.log('Query failed:', e.message);
}

await db.close();
console.log('\nAll tables registered successfully!');
