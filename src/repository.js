const crypto = require('node:crypto');
const { query, transaction } = require('./db');
const { orderSchema, parseProduct, normalizeList } = require('./validation');

const SETTING_COLUMNS = {
  brand: 'brand',
  eyebrow: 'eyebrow',
  headline: 'headline',
  subheadline: 'subheadline',
  announcement: 'announcement',
  instagram: 'instagram',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  currency: 'currency',
  deliveryText: 'delivery_text',
  aboutTitle: 'about_title',
  aboutText: 'about_text'
};

function mapSettings(row = {}) {
  return {
    brand: row.brand || 'AILUU.CLO',
    eyebrow: row.eyebrow || '',
    headline: row.headline || '',
    subheadline: row.subheadline || '',
    announcement: row.announcement || '',
    instagram: row.instagram || '',
    whatsapp: row.whatsapp || '',
    telegram: row.telegram || '',
    currency: row.currency || 'сом',
    deliveryText: row.delivery_text || '',
    aboutTitle: row.about_title || '',
    aboutText: row.about_text || ''
  };
}

function mapProduct(row) {
  if (!row) return null;
  const images = Array.isArray(row.image_urls) && row.image_urls.length
    ? row.image_urls.filter(Boolean)
    : (row.image_url ? [row.image_url] : []);
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    oldPrice: row.old_price,
    category: row.category,
    description: row.description,
    sizes: row.sizes || [],
    images,
    image: images[0] || '',
    isActive: row.is_active,
    inStock: row.is_active && (row.stock_quantity === null || row.stock_quantity > 0),
    featured: row.featured,
    stockQuantity: row.stock_quantity,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapOrder(row, items = []) {
  if (!row) return null;
  return {
    id: row.order_number,
    databaseId: row.id,
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      address: row.customer_address,
      comment: row.customer_comment
    },
    items: items.map((item) => ({
      productId: item.product_id,
      name: item.product_name,
      price: item.unit_price,
      quantity: item.quantity,
      size: item.selected_size,
      lineTotal: item.line_total
    })),
    total: row.total,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getSettings(client = { query }) {
  const result = await client.query('SELECT * FROM store_settings WHERE id = 1');
  return mapSettings(result.rows[0]);
}

async function getPublicCatalog() {
  const [settings, products] = await Promise.all([
    getSettings(),
    query(`
      SELECT * FROM products
      WHERE is_active = true AND (stock_quantity IS NULL OR stock_quantity > 0)
      ORDER BY featured DESC, sort_order DESC, created_at DESC
    `)
  ]);
  return { settings, products: products.rows.map(mapProduct) };
}

async function listProducts(limit = 100, offset = 0) {
  const result = await query(
    'SELECT * FROM products ORDER BY is_active DESC, featured DESC, sort_order DESC, created_at DESC LIMIT $1 OFFSET $2',
    [Math.min(Math.max(Number(limit) || 100, 1), 500), Math.max(Number(offset) || 0, 0)]
  );
  return result.rows.map(mapProduct);
}

async function countProducts() {
  const result = await query('SELECT count(*)::int AS count FROM products');
  return result.rows[0].count;
}

async function getProduct(id) {
  const result = await query('SELECT * FROM products WHERE id = $1', [id]);
  return mapProduct(result.rows[0]);
}

async function writeAudit(client, actor, action, entityType, entityId, metadata = {}) {
  await client.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [actor?.type || 'system', String(actor?.id || ''), action, entityType || '', String(entityId || ''), JSON.stringify(metadata)]
  );
}

async function addProduct(input, actor = { type: 'system', id: '' }) {
  const product = parseProduct(input);
  const id = crypto.randomUUID();
  return transaction(async (client) => {
    const result = await client.query(`
      INSERT INTO products (
        id, name, price, old_price, category, description, sizes, image_url, image_urls,
        is_active, featured, stock_quantity, sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      id, product.name, product.price, product.oldPrice, product.category || 'Коллекция',
      product.description, product.sizes, product.image, product.images,
      product.inStock, product.featured, product.stockQuantity, product.sortOrder
    ]);
    await writeAudit(client, actor, 'product.created', 'product', id, { name: product.name });
    return mapProduct(result.rows[0]);
  });
}

async function updateProduct(id, patch, actor = { type: 'system', id: '' }) {
  return transaction(async (client) => {
    const currentResult = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id]);
    const current = mapProduct(currentResult.rows[0]);
    if (!current) return null;

    const merged = parseProduct({
      name: patch.name ?? current.name,
      price: patch.price ?? current.price,
      oldPrice: patch.oldPrice ?? current.oldPrice,
      category: patch.category ?? current.category,
      description: patch.description ?? current.description,
      sizes: patch.sizes ?? current.sizes,
      images: patch.images ?? (patch.image === undefined ? current.images : (patch.image ? [patch.image] : [])),
      inStock: patch.inStock ?? current.isActive,
      featured: patch.featured ?? current.featured,
      stockQuantity: patch.stockQuantity === undefined ? current.stockQuantity : patch.stockQuantity,
      sortOrder: patch.sortOrder ?? current.sortOrder
    });

    const result = await client.query(`
      UPDATE products SET
        name=$2, price=$3, old_price=$4, category=$5, description=$6, sizes=$7,
        image_url=$8, image_urls=$9, colors='{}'::text[], is_active=$10, featured=$11,
        stock_quantity=$12, sort_order=$13
      WHERE id=$1 RETURNING *
    `, [
      id, merged.name, merged.price, merged.oldPrice, merged.category, merged.description,
      merged.sizes, merged.image, merged.images, merged.inStock, merged.featured,
      merged.stockQuantity, merged.sortOrder
    ]);
    await writeAudit(client, actor, 'product.updated', 'product', id, { fields: Object.keys(patch) });
    return mapProduct(result.rows[0]);
  });
}

async function deleteProduct(id, actor = { type: 'system', id: '' }) {
  return transaction(async (client) => {
    const result = await client.query('DELETE FROM products WHERE id = $1 RETURNING name', [id]);
    if (!result.rowCount) return false;
    await writeAudit(client, actor, 'product.deleted', 'product', id, { name: result.rows[0].name });
    return true;
  });
}

async function updateSettings(patch, actor = { type: 'system', id: '' }) {
  return transaction(async (client) => {
    const currentResult = await client.query('SELECT * FROM store_settings WHERE id = 1 FOR UPDATE');
    const next = mapSettings(currentResult.rows[0]);
    for (const [key] of Object.entries(SETTING_COLUMNS)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        const max = key === 'aboutText' ? 3000 : key === 'deliveryText' ? 1000 : 700;
        next[key] = String(patch[key] ?? '').trim().slice(0, max);
      }
    }

    const result = await client.query(`
      INSERT INTO store_settings (
        id, brand, eyebrow, headline, subheadline, announcement, instagram, whatsapp,
        telegram, currency, delivery_text, about_title, about_text
      ) VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        brand=EXCLUDED.brand, eyebrow=EXCLUDED.eyebrow, headline=EXCLUDED.headline,
        subheadline=EXCLUDED.subheadline, announcement=EXCLUDED.announcement,
        instagram=EXCLUDED.instagram, whatsapp=EXCLUDED.whatsapp, telegram=EXCLUDED.telegram,
        currency=EXCLUDED.currency, delivery_text=EXCLUDED.delivery_text,
        about_title=EXCLUDED.about_title, about_text=EXCLUDED.about_text
      RETURNING *
    `, [
      next.brand, next.eyebrow, next.headline, next.subheadline, next.announcement,
      next.instagram, next.whatsapp, next.telegram, next.currency, next.deliveryText,
      next.aboutTitle, next.aboutText
    ]);
    await writeAudit(client, actor, 'settings.updated', 'settings', '1', { fields: Object.keys(patch) });
    return mapSettings(result.rows[0]);
  });
}

async function createOrder(rawInput) {
  const input = orderSchema.parse(rawInput);
  if (input.website) return { honeypot: true };

  return transaction(async (client) => {
    const idempotencyPayload = {
      customer: input.customer,
      items: [...input.items].sort((a, b) => `${a.productId}|${a.size}`.localeCompare(`${b.productId}|${b.size}`))
    };
    const timeBucket = Math.floor(Date.now() / (10 * 60 * 1000));
    const idempotencyKey = crypto.createHash('sha256')
      .update(JSON.stringify(idempotencyPayload))
      .update(String(timeBucket))
      .digest('hex');
    const claimed = await client.query(
      'INSERT INTO order_idempotency (idempotency_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING idempotency_key',
      [idempotencyKey]
    );
    if (!claimed.rowCount) {
      const existing = await client.query(`
        SELECT o.* FROM order_idempotency i
        JOIN orders o ON o.id = i.order_id
        WHERE i.idempotency_key = $1
      `, [idempotencyKey]);
      if (existing.rowCount) {
        const items = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [existing.rows[0].id]);
        return { ...mapOrder(existing.rows[0], items.rows), duplicate: true };
      }
      throw new Error('Заказ уже обрабатывается. Подождите несколько секунд.');
    }

    const ids = [...new Set(input.items.map((item) => item.productId))];
    const productResult = await client.query(
      `SELECT * FROM products WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [ids]
    );
    const products = new Map(productResult.rows.map((row) => [row.id, row]));

    const requestedTotals = new Map();
    for (const item of input.items) {
      requestedTotals.set(item.productId, (requestedTotals.get(item.productId) || 0) + item.quantity);
    }

    for (const [productId, quantity] of requestedTotals) {
      const product = products.get(productId);
      if (!product || !product.is_active) throw new Error('Один из товаров больше недоступен.');
      if (product.stock_quantity !== null && product.stock_quantity < quantity) {
        throw new Error(`Недостаточно товара «${product.name}» на складе.`);
      }
    }

    const normalizedItems = input.items.map((item) => {
      const product = products.get(item.productId);
      if (product.sizes.length && (!item.size || !product.sizes.includes(item.size))) {
        throw new Error(`Выберите доступный размер товара «${product.name}».`);
      }
      return {
        product,
        quantity: item.quantity,
        size: item.size,
        lineTotal: product.price * item.quantity
      };
    });

    const total = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const seq = await client.query("SELECT nextval('order_number_seq')::bigint AS value");
    const orderNumber = `AILUU-${new Date().getUTCFullYear()}-${String(seq.rows[0].value).padStart(6, '0')}`;
    const orderId = crypto.randomUUID();

    const orderResult = await client.query(`
      INSERT INTO orders (
        id, order_number, customer_name, customer_phone, customer_address,
        customer_comment, total, status, source
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'new','website') RETURNING *
    `, [
      orderId, orderNumber, input.customer.name, input.customer.phone,
      input.customer.address, input.customer.comment, total
    ]);

    for (const item of normalizedItems) {
      await client.query(`
        INSERT INTO order_items (
          order_id, product_id, product_name, unit_price, quantity,
          selected_size, selected_color, line_total
        ) VALUES ($1,$2,$3,$4,$5,$6,'',$7)
      `, [
        orderId, item.product.id, item.product.name, item.product.price, item.quantity,
        item.size, item.lineTotal
      ]);
      if (item.product.stock_quantity !== null) {
        await client.query('UPDATE products SET stock_quantity = stock_quantity - $2 WHERE id = $1', [item.product.id, item.quantity]);
      }
    }

    await client.query('UPDATE order_idempotency SET order_id = $2 WHERE idempotency_key = $1', [idempotencyKey, orderId]);
    const customerFingerprint = crypto.createHash('sha256').update(input.customer.phone).digest('hex').slice(0, 16);
    await writeAudit(client, { type: 'customer', id: customerFingerprint }, 'order.created', 'order', orderId, { orderNumber, total });
    return mapOrder(orderResult.rows[0], normalizedItems.map((item) => ({
      product_id: item.product.id,
      product_name: item.product.name,
      unit_price: item.product.price,
      quantity: item.quantity,
      selected_size: item.size,
      selected_color: '',
      line_total: item.lineTotal
    })));
  });
}

async function listOrders(limit = 20, offset = 0) {
  const orderResult = await query(
    'SELECT * FROM orders ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [Math.min(Math.max(Number(limit) || 20, 1), 200), Math.max(Number(offset) || 0, 0)]
  );
  if (!orderResult.rowCount) return [];
  const ids = orderResult.rows.map((row) => row.id);
  const itemResult = await query('SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY id', [ids]);
  const grouped = new Map();
  for (const item of itemResult.rows) {
    if (!grouped.has(item.order_id)) grouped.set(item.order_id, []);
    grouped.get(item.order_id).push(item);
  }
  return orderResult.rows.map((row) => mapOrder(row, grouped.get(row.id) || []));
}

async function getOrder(identifier) {
  const orderResult = await query('SELECT * FROM orders WHERE id::text = $1 OR order_number = $1', [identifier]);
  if (!orderResult.rowCount) return null;
  const itemResult = await query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderResult.rows[0].id]);
  return mapOrder(orderResult.rows[0], itemResult.rows);
}

async function updateOrderStatus(identifier, status, actor = { type: 'system', id: '' }) {
  const allowed = new Set(['new', 'confirmed', 'sent', 'completed', 'cancelled']);
  if (!allowed.has(status)) return null;
  return transaction(async (client) => {
    const result = await client.query(
      'UPDATE orders SET status = $2 WHERE id::text = $1 OR order_number = $1 RETURNING *',
      [identifier, status]
    );
    if (!result.rowCount) return null;
    await writeAudit(client, actor, 'order.status_changed', 'order', result.rows[0].id, { status });
    const items = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [result.rows[0].id]);
    return mapOrder(result.rows[0], items.rows);
  });
}

async function getTelegramSession(userId) {
  const result = await query(
    'SELECT state FROM telegram_sessions WHERE user_id = $1 AND expires_at > now()',
    [String(userId)]
  );
  return result.rows[0]?.state || null;
}

async function setTelegramSession(userId, chatId, state, ttlMinutes = 60) {
  await query(`
    INSERT INTO telegram_sessions (user_id, chat_id, state, expires_at)
    VALUES ($1,$2,$3::jsonb,now() + $4::int * interval '1 minute')
    ON CONFLICT (user_id) DO UPDATE SET
      chat_id=EXCLUDED.chat_id, state=EXCLUDED.state, expires_at=EXCLUDED.expires_at
  `, [String(userId), String(chatId), JSON.stringify(state), String(ttlMinutes)]);
}

async function clearTelegramSession(userId) {
  await query('DELETE FROM telegram_sessions WHERE user_id = $1', [String(userId)]);
}

async function claimTelegramUpdate(updateId) {
  const result = await query(
    'INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id',
    [String(updateId)]
  );
  return result.rowCount === 1;
}

async function releaseTelegramUpdate(updateId) {
  await query('DELETE FROM telegram_updates WHERE update_id = $1', [String(updateId)]);
}

async function pruneOperationalData() {
  await query('DELETE FROM telegram_sessions WHERE expires_at <= now()');
  await query("DELETE FROM telegram_updates WHERE claimed_at < now() - interval '30 days'");
  await query("DELETE FROM order_idempotency WHERE created_at < now() - interval '1 day'");
}

module.exports = {
  addProduct,
  claimTelegramUpdate,
  clearTelegramSession,
  countProducts,
  createOrder,
  deleteProduct,
  getOrder,
  getProduct,
  getPublicCatalog,
  getSettings,
  getTelegramSession,
  listOrders,
  listProducts,
  normalizeList,
  pruneOperationalData,
  releaseTelegramUpdate,
  setTelegramSession,
  updateOrderStatus,
  updateProduct,
  updateSettings
};
