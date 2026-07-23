const { z } = require('zod');

const text = (max) => z.string().trim().max(max);
const optionalText = (max) => z.string().trim().max(max).optional().default('');

const orderSchema = z.object({
  website: z.string().max(200).optional().default(''),
  customer: z.object({
    name: text(160).min(2, 'Укажите имя.'),
    phone: text(60).min(5, 'Укажите телефон.'),
    address: optionalText(500),
    comment: optionalText(1000)
  }),
  items: z.array(z.object({
    productId: z.string().uuid('Некорректный товар.'),
    quantity: z.coerce.number().int().min(1).max(20),
    size: optionalText(80)
  })).min(1, 'Корзина пуста.').max(30)
}).strict();

const productInputSchema = z.object({
  name: text(160).min(1),
  price: z.coerce.number().int().min(0).max(100_000_000),
  oldPrice: z.coerce.number().int().min(0).max(100_000_000).optional().default(0),
  category: text(100).optional().default('Коллекция'),
  description: optionalText(3000),
  sizes: z.union([z.array(text(80)), z.string()]).optional().default([]),
  images: z.union([z.array(text(1000)), z.string()]).optional().default([]),
  // Legacy single-image input remains accepted during upgrades.
  image: optionalText(1000),
  inStock: z.boolean().optional().default(true),
  featured: z.boolean().optional().default(false),
  stockQuantity: z.coerce.number().int().min(0).nullable().optional().default(null),
  sortOrder: z.coerce.number().int().min(-1_000_000).max(1_000_000).optional().default(0)
});

function normalizeList(value, limit = 40) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))].slice(0, limit);
}

function parseProduct(input) {
  const parsed = productInputSchema.parse(input);
  const imageSource = normalizeList(parsed.images, 10);
  const images = imageSource.length ? imageSource : normalizeList(parsed.image ? [parsed.image] : [], 10);
  return {
    ...parsed,
    sizes: normalizeList(parsed.sizes),
    images,
    image: images[0] || ''
  };
}

module.exports = { orderSchema, productInputSchema, parseProduct, normalizeList };
