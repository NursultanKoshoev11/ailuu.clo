const { Pool } = require('pg');
const { config } = require('./config');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: config.DATABASE_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: config.DATABASE_CONNECTION_TIMEOUT_MS,
  allowExitOnIdle: false,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false,
  application_name: 'ailuu-clo-store'
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function healthcheck() {
  const result = await pool.query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, transaction, healthcheck, close };
