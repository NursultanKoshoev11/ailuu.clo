const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pool } = require('../src/db');

const MIGRATION_LOCK_ID = 74118342;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const directory = path.join(__dirname, '..', 'migrations');
    const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.sql')).sort();

    for (const filename of files) {
      const sql = await fs.readFile(path.join(directory, filename), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM schema_migrations WHERE filename = $1', [filename]);

      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Migration ${filename} was changed after it was applied`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, checksum]
        );
        await client.query('COMMIT');
        console.log(`Applied migration: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error);
      await pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { migrate };
