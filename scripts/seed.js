const fs = require('node:fs/promises');
const path = require('node:path');
const { pool, query } = require('../src/db');
const { addProduct, countProducts, updateSettings } = require('../src/repository');

const SEED_NAME = 'initial-store-v1';
const SEED_LOCK_ID = 74118343;

async function seed() {
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_ID]);
    const applied = await query('SELECT 1 FROM seed_markers WHERE name = $1', [SEED_NAME]);
    if (applied.rowCount) {
      console.log(`Seed already applied: ${SEED_NAME}`);
      return;
    }

    const file = path.join(__dirname, '..', 'data', 'store.seed.json');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    await updateSettings(data.settings || {}, { type: 'seed', id: SEED_NAME });

    const existing = await countProducts();
    if (existing === 0) {
      for (const product of data.products || []) {
        await addProduct({
          name: product.name,
          price: product.price,
          oldPrice: product.oldPrice || 0,
          category: product.category,
          description: product.description,
          sizes: product.sizes,
          images: product.images || [],
          inStock: product.inStock !== false,
          featured: Boolean(product.featured),
          stockQuantity: null
        }, { type: 'seed', id: SEED_NAME });
      }
    }

    await query('INSERT INTO seed_markers (name) VALUES ($1) ON CONFLICT DO NOTHING', [SEED_NAME]);
    console.log(`Seed applied: ${SEED_NAME}`);
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_ID]).catch(() => {});
    lockClient.release();
  }
}

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error);
      await pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { seed };
