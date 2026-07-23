const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'store.json');
const seedPath = path.join(dataDir, 'store.seed.json');

function ensureStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storePath)) {
    fs.copyFileSync(seedPath, storePath);
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch (error) {
    throw new Error(`Не удалось прочитать data/store.json: ${error.message}`);
  }
}

function writeStore(data) {
  ensureStore();
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, storePath);
  return data;
}

function sanitizeText(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function toList(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeText(item, 80)).filter(Boolean);
  return sanitizeText(value, 500)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProduct(input, existing = {}) {
  const price = Number(input.price ?? existing.price ?? 0);
  const oldPrice = Number(input.oldPrice ?? existing.oldPrice ?? 0);

  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    name: sanitizeText(input.name ?? existing.name, 120),
    price: Number.isFinite(price) && price >= 0 ? Math.round(price) : 0,
    oldPrice: Number.isFinite(oldPrice) && oldPrice >= 0 ? Math.round(oldPrice) : 0,
    category: sanitizeText(input.category ?? existing.category, 80) || 'Коллекция',
    description: sanitizeText(input.description ?? existing.description, 1500),
    sizes: toList(input.sizes ?? existing.sizes ?? []),
    colors: toList(input.colors ?? existing.colors ?? []),
    image: sanitizeText(input.image ?? existing.image, 500),
    inStock: typeof input.inStock === 'boolean' ? input.inStock : existing.inStock !== false,
    featured: typeof input.featured === 'boolean' ? input.featured : Boolean(existing.featured),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function getPublicCatalog() {
  const data = readStore();
  return {
    settings: data.settings,
    products: data.products
      .filter((product) => product.inStock)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || new Date(b.createdAt) - new Date(a.createdAt))
  };
}

function listProducts() {
  return readStore().products;
}

function getProduct(id) {
  return readStore().products.find((product) => product.id === id) || null;
}

function addProduct(input) {
  const data = readStore();
  const product = normalizeProduct(input);
  if (!product.name) throw new Error('Название товара обязательно.');
  data.products.unshift(product);
  writeStore(data);
  return product;
}

function updateProduct(id, patch) {
  const data = readStore();
  const index = data.products.findIndex((product) => product.id === id);
  if (index === -1) return null;
  const updated = normalizeProduct(patch, data.products[index]);
  if (!updated.name) throw new Error('Название товара обязательно.');
  data.products[index] = updated;
  writeStore(data);
  return updated;
}

function deleteProduct(id) {
  const data = readStore();
  const index = data.products.findIndex((product) => product.id === id);
  if (index === -1) return false;
  data.products.splice(index, 1);
  writeStore(data);
  return true;
}

function updateSettings(patch) {
  const data = readStore();
  const allowed = [
    'brand', 'eyebrow', 'headline', 'subheadline', 'announcement', 'instagram',
    'whatsapp', 'telegram', 'currency', 'deliveryText', 'aboutTitle', 'aboutText'
  ];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      data.settings[key] = sanitizeText(patch[key], key === 'aboutText' ? 2000 : 500);
    }
  }
  writeStore(data);
  return data.settings;
}

function createOrder(input) {
  const data = readStore();
  const items = Array.isArray(input.items) ? input.items.slice(0, 30) : [];
  if (!items.length) throw new Error('Корзина пуста.');

  const normalizedItems = items.map((item) => {
    const product = data.products.find((entry) => entry.id === item.productId);
    if (!product || !product.inStock) throw new Error('Один из товаров больше недоступен.');
    const quantity = Math.max(1, Math.min(20, Number(item.quantity) || 1));
    return {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity,
      size: sanitizeText(item.size, 60),
      color: sanitizeText(item.color, 60),
      lineTotal: product.price * quantity
    };
  });

  const order = {
    id: `A-${Date.now().toString().slice(-8)}`,
    customer: {
      name: sanitizeText(input.customer?.name, 120),
      phone: sanitizeText(input.customer?.phone, 50),
      address: sanitizeText(input.customer?.address, 300),
      comment: sanitizeText(input.customer?.comment, 500)
    },
    items: normalizedItems,
    total: normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0),
    status: 'new',
    createdAt: new Date().toISOString()
  };

  if (!order.customer.name || !order.customer.phone) {
    throw new Error('Укажите имя и телефон.');
  }

  data.orders.unshift(order);
  data.orders = data.orders.slice(0, 1000);
  writeStore(data);
  return order;
}

function listOrders(limit = 20) {
  return readStore().orders.slice(0, limit);
}

function updateOrderStatus(id, status) {
  const allowed = ['new', 'confirmed', 'sent', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return null;
  const data = readStore();
  const order = data.orders.find((entry) => entry.id === id);
  if (!order) return null;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  writeStore(data);
  return order;
}

module.exports = {
  addProduct,
  createOrder,
  deleteProduct,
  getProduct,
  getPublicCatalog,
  listOrders,
  listProducts,
  readStore,
  updateOrderStatus,
  updateProduct,
  updateSettings
};
