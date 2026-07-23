const test = require('node:test');
const assert = require('node:assert/strict');
const { orderSchema, parseProduct } = require('../src/validation');

test('order schema accepts a valid order with a height size', () => {
  const parsed = orderSchema.parse({
    customer: { name: 'Айжан', phone: '+996700000000' },
    items: [{ productId: '8eefedc2-cff0-4bf9-894a-86a30aa1be31', quantity: 2, size: '80-90 см' }]
  });
  assert.equal(parsed.items[0].quantity, 2);
  assert.equal(parsed.items[0].size, '80-90 см');
});

test('order schema rejects excessive quantity', () => {
  assert.throws(() => orderSchema.parse({
    customer: { name: 'Айжан', phone: '+996700000000' },
    items: [{ productId: '8eefedc2-cff0-4bf9-894a-86a30aa1be31', quantity: 21 }]
  }));
});

test('product parser normalizes sizes and multiple images', () => {
  const product = parseProduct({
    name: 'Платье',
    price: 1000,
    sizes: '80-90 см, 80-90 см, 100-110 см',
    images: ['/uploads/one.jpg', '/uploads/one.jpg', '/uploads/two.jpg']
  });
  assert.deepEqual(product.sizes, ['80-90 см', '100-110 см']);
  assert.deepEqual(product.images, ['/uploads/one.jpg', '/uploads/two.jpg']);
  assert.equal(product.image, '/uploads/one.jpg');
});
