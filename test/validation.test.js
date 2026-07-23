const test = require('node:test');
const assert = require('node:assert/strict');
const { orderSchema, parseProduct } = require('../src/validation');

test('order schema accepts a valid order', () => {
  const parsed = orderSchema.parse({
    customer: { name: 'Айжан', phone: '+996700000000' },
    items: [{ productId: '8eefedc2-cff0-4bf9-894a-86a30aa1be31', quantity: 2, size: 'M', color: 'Чёрный' }]
  });
  assert.equal(parsed.items[0].quantity, 2);
});

test('order schema rejects excessive quantity', () => {
  assert.throws(() => orderSchema.parse({
    customer: { name: 'Айжан', phone: '+996700000000' },
    items: [{ productId: '8eefedc2-cff0-4bf9-894a-86a30aa1be31', quantity: 21 }]
  }));
});

test('product parser normalizes duplicate lists', () => {
  const product = parseProduct({
    name: 'Абая', price: 1000, sizes: 'M, M, L', colors: ['Чёрный', 'Чёрный']
  });
  assert.deepEqual(product.sizes, ['M', 'L']);
  assert.deepEqual(product.colors, ['Чёрный']);
});
