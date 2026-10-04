require('dotenv').config();
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running the migration.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/002-mobile-cart.sql'), 'utf8'));
    console.log('Shared cart and mobile login migration applied.');
  } finally { await pool.end(); }
}
main().catch(error => { console.error('Migration failed:', error.code || 'Check your database connection'); process.exitCode = 1; });
