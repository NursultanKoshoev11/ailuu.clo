const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';

async function main() {
  const ready = await fetch(`${baseUrl}/ready`);
  if (!ready.ok) throw new Error(`Readiness failed: ${ready.status}`);

  const catalogResponse = await fetch(`${baseUrl}/api/catalog`);
  if (!catalogResponse.ok) throw new Error(`Catalog failed: ${catalogResponse.status}`);
  const catalog = await catalogResponse.json();
  if (!Array.isArray(catalog.products) || !catalog.products.length) throw new Error('Catalog has no seeded products');

  const product = catalog.products[0];
  const orderResponse = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customer: { name: 'CI Smoke Test', phone: '+996000000000', address: 'CI' },
      items: [{ productId: product.id, quantity: 1, size: product.sizes?.[0] || '', color: product.colors?.[0] || '' }]
    })
  });
  if (!orderResponse.ok) throw new Error(`Order failed: ${orderResponse.status} ${await orderResponse.text()}`);
  const order = await orderResponse.json();
  if (!order.orderId) throw new Error('Order response has no orderId');
  console.log(`Smoke test passed: ${order.orderId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
