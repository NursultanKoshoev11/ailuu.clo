const state = {
  settings: {},
  products: [],
  category: 'Все',
  activeProduct: null,
  selectedSize: '',
  selectedColor: '',
  quantity: 1,
  cart: loadCart()
};

const elements = {
  announcement: document.querySelector('#announcement'),
  brandName: document.querySelector('#brandName'),
  eyebrow: document.querySelector('#eyebrow'),
  headline: document.querySelector('#headline'),
  subheadline: document.querySelector('#subheadline'),
  filters: document.querySelector('#filters'),
  productGrid: document.querySelector('#productGrid'),
  emptyState: document.querySelector('#emptyState'),
  productModal: document.querySelector('#productModal'),
  modalImage: document.querySelector('#modalImage'),
  modalCategory: document.querySelector('#modalCategory'),
  modalTitle: document.querySelector('#modalTitle'),
  modalPrice: document.querySelector('#modalPrice'),
  modalDescription: document.querySelector('#modalDescription'),
  sizeGroup: document.querySelector('#sizeGroup'),
  colorGroup: document.querySelector('#colorGroup'),
  qtyValue: document.querySelector('#qtyValue'),
  addToCart: document.querySelector('#addToCart'),
  cartDrawer: document.querySelector('#cartDrawer'),
  cartCount: document.querySelector('#cartCount'),
  cartItems: document.querySelector('#cartItems'),
  cartEmpty: document.querySelector('#cartEmpty'),
  cartFooter: document.querySelector('#cartFooter'),
  cartTotal: document.querySelector('#cartTotal'),
  checkoutModal: document.querySelector('#checkoutModal'),
  checkoutForm: document.querySelector('#checkoutForm'),
  formStatus: document.querySelector('#formStatus'),
  submitOrder: document.querySelector('#submitOrder'),
  toast: document.querySelector('#toast')
};

async function init() {
  bindEvents();
  observeReveal();
  try {
    const response = await fetch('/api/catalog', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить каталог');
    const data = await response.json();
    state.settings = data.settings || {};
    state.products = data.products || [];
    applySettings();
    renderFilters();
    renderProducts();
    renderCart();
  } catch (error) {
    elements.productGrid.innerHTML = `<div class="empty-state"><h3>Каталог временно недоступен</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function applySettings() {
  const s = state.settings;
  document.title = `${s.brand || 'AILUU.CLO'} — одежда с достоинством`;
  setText(elements.announcement, s.announcement);
  setText(elements.brandName, s.brand);
  setText(elements.eyebrow, s.eyebrow);
  setText(elements.headline, s.headline);
  setText(elements.subheadline, s.subheadline);
  setText(document.querySelector('#aboutTitle'), s.aboutTitle);
  setText(document.querySelector('#aboutText'), s.aboutText);
  setText(document.querySelector('#deliveryText'), s.deliveryText);
  document.querySelectorAll('.footer-brand span').forEach((node) => setText(node, s.brand));
  document.querySelectorAll('#instagramLink, #aboutInstagram, #footerInstagram').forEach((link) => {
    if (s.instagram) link.href = s.instagram;
  });
  const actions = [];
  if (s.whatsapp) actions.push(`<a href="https://wa.me/${sanitizePhone(s.whatsapp)}" target="_blank" rel="noreferrer">WhatsApp ↗</a>`);
  if (s.telegram) actions.push(`<a href="${escapeAttribute(normalizeTelegram(s.telegram))}" target="_blank" rel="noreferrer">Telegram ↗</a>`);
  if (s.instagram) actions.push(`<a href="${escapeAttribute(s.instagram)}" target="_blank" rel="noreferrer">Instagram ↗</a>`);
  document.querySelector('#contactActions').innerHTML = actions.join('');
}

function renderFilters() {
  const categories = ['Все', ...new Set(state.products.map((product) => product.category).filter(Boolean))];
  elements.filters.innerHTML = categories.map((category) => `<button class="filter-button ${category === state.category ? 'active' : ''}" type="button" data-category="${escapeAttribute(category)}">${escapeHtml(category)}</button>`).join('');
}

function renderProducts() {
  const products = state.category === 'Все' ? state.products : state.products.filter((product) => product.category === state.category);
  elements.emptyState.hidden = products.length > 0;
  elements.productGrid.innerHTML = products.map(productCard).join('');
}

function productCard(product) {
  const image = product.image
    ? `<img src="${escapeAttribute(product.image)}" alt="${escapeAttribute(product.name)}" loading="lazy">`
    : '<div class="product-placeholder" aria-hidden="true"></div>';
  return `<article class="product-card reveal visible" data-product-id="${escapeAttribute(product.id)}" tabindex="0" role="button" aria-label="Открыть ${escapeAttribute(product.name)}">
    <div class="product-image">
      ${product.featured ? '<span class="product-badge">Новинка</span>' : ''}
      ${image}
      <button class="quick-add" type="button" data-quick-add="${escapeAttribute(product.id)}" aria-label="Добавить в корзину">+</button>
    </div>
    <div class="product-info">
      <div class="product-meta"><span>${escapeHtml(product.category || 'Коллекция')}</span><span>${escapeHtml((product.colors || []).slice(0, 2).join(' · '))}</span></div>
      <h3>${escapeHtml(product.name)}</h3>
      <div class="price"><span>${money(product.price)}</span>${product.oldPrice ? `<s>${money(product.oldPrice)}</s>` : ''}</div>
    </div>
  </article>`;
}

function openProduct(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  state.activeProduct = product;
  state.selectedSize = product.sizes?.[0] || '';
  state.selectedColor = product.colors?.[0] || '';
  state.quantity = 1;
  elements.modalImage.innerHTML = product.image
    ? `<img src="${escapeAttribute(product.image)}" alt="${escapeAttribute(product.name)}">`
    : '<div class="product-placeholder" aria-hidden="true"></div>';
  setText(elements.modalCategory, product.category || 'Коллекция');
  setText(elements.modalTitle, product.name);
  elements.modalPrice.innerHTML = `${money(product.price)} ${product.oldPrice ? `<s>${money(product.oldPrice)}</s>` : ''}`;
  setText(elements.modalDescription, product.description || 'Описание появится скоро.');
  renderOptions(elements.sizeGroup, 'Размер', product.sizes || [], 'size');
  renderOptions(elements.colorGroup, 'Цвет', product.colors || [], 'color');
  elements.qtyValue.textContent = '1';
  elements.productModal.hidden = false;
  lockScroll();
}

function renderOptions(container, label, options, type) {
  if (!options.length) {
    container.innerHTML = '';
    return;
  }
  const selected = type === 'size' ? state.selectedSize : state.selectedColor;
  container.innerHTML = `<span>${label}</span><div class="option-list">${options.map((option) => `<button class="option-chip ${option === selected ? 'active' : ''}" type="button" data-option-type="${type}" data-option-value="${escapeAttribute(option)}">${escapeHtml(option)}</button>`).join('')}</div>`;
}

function closeProduct() {
  elements.productModal.hidden = true;
  state.activeProduct = null;
  unlockScrollIfClear();
}

function addActiveToCart() {
  if (!state.activeProduct) return;
  addCartItem({
    productId: state.activeProduct.id,
    name: state.activeProduct.name,
    price: state.activeProduct.price,
    image: state.activeProduct.image,
    size: state.selectedSize,
    color: state.selectedColor,
    quantity: state.quantity
  });
  closeProduct();
  openCart();
  showToast('Товар добавлен в корзину');
}

function quickAdd(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  addCartItem({ productId: product.id, name: product.name, price: product.price, image: product.image, size: product.sizes?.[0] || '', color: product.colors?.[0] || '', quantity: 1 });
  showToast('Товар добавлен в корзину');
}

function addCartItem(item) {
  const key = cartKey(item);
  const existing = state.cart.find((entry) => cartKey(entry) === key);
  if (existing) existing.quantity = Math.min(20, existing.quantity + item.quantity);
  else state.cart.push(item);
  persistCart();
  renderCart();
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  elements.cartCount.textContent = String(count);
  elements.cartEmpty.hidden = state.cart.length > 0;
  elements.cartFooter.hidden = state.cart.length === 0;
  elements.cartTotal.textContent = money(total);
  elements.cartItems.innerHTML = state.cart.map((item, index) => `<div class="cart-item">
    <div class="cart-thumb">${item.image ? `<img src="${escapeAttribute(item.image)}" alt="">` : '<div class="product-placeholder"></div>'}</div>
    <div><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml([item.size, item.color].filter(Boolean).join(' · '))}</p><p>Количество: ${item.quantity}</p><strong>${money(item.price * item.quantity)}</strong></div>
    <button class="cart-remove" type="button" data-remove-index="${index}" aria-label="Удалить">×</button>
  </div>`).join('');
}

function openCart() {
  elements.cartDrawer.classList.add('open');
  elements.cartDrawer.setAttribute('aria-hidden', 'false');
  lockScroll();
}
function closeCart() {
  elements.cartDrawer.classList.remove('open');
  elements.cartDrawer.setAttribute('aria-hidden', 'true');
  unlockScrollIfClear();
}
function openCheckout() {
  if (!state.cart.length) return;
  closeCart();
  elements.checkoutModal.hidden = false;
  elements.formStatus.textContent = '';
  lockScroll();
}
function closeCheckout() {
  elements.checkoutModal.hidden = true;
  unlockScrollIfClear();
}

async function submitOrder(event) {
  event.preventDefault();
  const form = new FormData(elements.checkoutForm);
  elements.submitOrder.disabled = true;
  elements.submitOrder.textContent = 'Отправляем…';
  elements.formStatus.textContent = '';
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer: { name: form.get('name'), phone: form.get('phone'), address: form.get('address'), comment: form.get('comment') },
        website: form.get('website'),
        items: state.cart.map(({ productId, quantity, size, color }) => ({ productId, quantity, size, color }))
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось отправить заказ');
    state.cart = [];
    persistCart();
    renderCart();
    elements.checkoutForm.reset();
    elements.formStatus.textContent = `Заказ ${data.orderId} принят. Мы скоро свяжемся с вами.`;
    elements.submitOrder.textContent = 'Заказ принят ✓';
    setTimeout(() => { closeCheckout(); elements.submitOrder.textContent = 'Отправить заказ'; }, 2200);
  } catch (error) {
    elements.formStatus.textContent = error.message;
    elements.submitOrder.textContent = 'Отправить заказ';
  } finally {
    elements.submitOrder.disabled = false;
  }
}

function bindEvents() {
  elements.filters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    state.category = button.dataset.category;
    renderFilters();
    renderProducts();
  });
  elements.productGrid.addEventListener('click', (event) => {
    const quick = event.target.closest('[data-quick-add]');
    if (quick) { event.stopPropagation(); quickAdd(quick.dataset.quickAdd); return; }
    const card = event.target.closest('[data-product-id]');
    if (card) openProduct(card.dataset.productId);
  });
  elements.productGrid.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      const card = event.target.closest('[data-product-id]');
      if (card) { event.preventDefault(); openProduct(card.dataset.productId); }
    }
  });
  document.querySelectorAll('[data-close-modal]').forEach((node) => node.addEventListener('click', closeProduct));
  document.querySelector('#qtyMinus').addEventListener('click', () => { state.quantity = Math.max(1, state.quantity - 1); elements.qtyValue.textContent = state.quantity; });
  document.querySelector('#qtyPlus').addEventListener('click', () => { state.quantity = Math.min(20, state.quantity + 1); elements.qtyValue.textContent = state.quantity; });
  elements.productModal.addEventListener('click', (event) => {
    const option = event.target.closest('[data-option-type]');
    if (!option) return;
    if (option.dataset.optionType === 'size') state.selectedSize = option.dataset.optionValue;
    else state.selectedColor = option.dataset.optionValue;
    if (state.activeProduct) {
      renderOptions(elements.sizeGroup, 'Размер', state.activeProduct.sizes || [], 'size');
      renderOptions(elements.colorGroup, 'Цвет', state.activeProduct.colors || [], 'color');
    }
  });
  elements.addToCart.addEventListener('click', addActiveToCart);
  document.querySelector('#openCart').addEventListener('click', openCart);
  document.querySelector('#closeCart').addEventListener('click', closeCart);
  document.querySelector('#cartBackdrop').addEventListener('click', closeCart);
  elements.cartItems.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-index]');
    if (!remove) return;
    state.cart.splice(Number(remove.dataset.removeIndex), 1);
    persistCart(); renderCart();
  });
  document.querySelector('#checkoutButton').addEventListener('click', openCheckout);
  document.querySelectorAll('[data-close-checkout]').forEach((node) => node.addEventListener('click', closeCheckout));
  elements.checkoutForm.addEventListener('submit', submitOrder);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeProduct(); closeCheckout(); closeCart(); }
  });
}

function observeReveal() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach((node) => node.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
  }, { threshold: .12 });
  document.querySelectorAll('.reveal').forEach((node) => observer.observe(node));
}

function money(value) { return `${Number(value || 0).toLocaleString('ru-RU')} ${state.settings.currency || 'сом'}`; }
function cartKey(item) { return `${item.productId}|${item.size}|${item.color}`; }
function loadCart() { try { const value = JSON.parse(localStorage.getItem('ailuu-cart') || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
function persistCart() { localStorage.setItem('ailuu-cart', JSON.stringify(state.cart)); }
function setText(node, value) { if (node && value) node.textContent = value; }
function sanitizePhone(value) { return String(value || '').replace(/\D/g, ''); }
function normalizeTelegram(value) { const v = String(value || '').trim(); return v.startsWith('http') ? v : `https://t.me/${v.replace(/^@/, '')}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }
function escapeAttribute(value) { return escapeHtml(value); }
function lockScroll() { document.body.classList.add('no-scroll'); }
function unlockScrollIfClear() { if (elements.productModal.hidden && elements.checkoutModal.hidden && !elements.cartDrawer.classList.contains('open')) document.body.classList.remove('no-scroll'); }
let toastTimer;
function showToast(message) { clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.classList.add('show'); toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200); }

init();
