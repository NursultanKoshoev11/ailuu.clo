const state = {
  settings: {},
  products: [],
  category: 'Все',
  activeProduct: null,
  activeImageIndex: 0,
  openRequestId: 0,
  selectedSize: '',
  quantity: 1,
  cart: loadCart()
};

// Keep decoded images and complete gallery DOM nodes alive for the whole page session.
// Reopening a product reuses the exact same elements instead of recreating <img> tags.
const imageMemoryCache = new Map();
const galleryNodeCache = new Map();

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
    preloadCatalogImages(state.products);
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
  const imageUrl = primaryImage(product);
  const image = imageUrl
    ? `<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(product.name)}" loading="eager" decoding="async" fetchpriority="high">`
    : '<div class="product-placeholder" aria-hidden="true"></div>';
  const photoCount = productImages(product).length;
  return `<article class="product-card reveal visible" data-product-id="${escapeAttribute(product.id)}" tabindex="0" role="button" aria-label="Открыть ${escapeAttribute(product.name)}">
    <div class="product-image">
      ${product.featured ? '<span class="product-badge">Новинка</span>' : ''}
      ${photoCount > 1 ? `<span class="photo-count" aria-label="Фотографий: ${photoCount}">1/${photoCount}</span>` : ''}
      ${image}
      <button class="quick-add" type="button" data-quick-add="${escapeAttribute(product.id)}" aria-label="Добавить в корзину">+</button>
    </div>
    <div class="product-info">
      <div class="product-meta"><span>${escapeHtml(product.category || 'Коллекция')}</span><span>${product.sizes?.length || 0} размера</span></div>
      <h3>${escapeHtml(product.name)}</h3>
      <div class="price"><span>${money(product.price)}</span>${product.oldPrice ? `<s>${money(product.oldPrice)}</s>` : ''}</div>
    </div>
  </article>`;
}

function productImages(product) {
  const images = Array.isArray(product?.images) ? product.images.filter(Boolean) : [];
  if (images.length) return images;
  return product?.image ? [product.image] : [];
}

function primaryImage(product) {
  return productImages(product)[0] || '';
}


function getCachedImage(url, priority = 'auto') {
  const source = String(url || '');
  if (!source) return { image: null, promise: Promise.resolve(null) };
  const existing = imageMemoryCache.get(source);
  if (existing) {
    if (priority === 'high' && existing.image) existing.image.fetchPriority = 'high';
    return existing;
  }

  const image = new Image();
  image.decoding = 'async';
  image.fetchPriority = priority;
  const promise = new Promise((resolve) => {
    const complete = async () => {
      try {
        await image.decode?.();
      } catch {
        // The browser may reject decode() even when the image is already usable.
      }
      resolve(image);
    };
    image.addEventListener('load', complete, { once: true });
    image.addEventListener('error', () => resolve(null), { once: true });
  });
  image.src = source;
  const entry = { image, promise };
  imageMemoryCache.set(source, entry);
  return entry;
}

function preloadCatalogImages(products) {
  const primary = [...new Set(products.map(primaryImage).filter(Boolean))];
  primary.forEach((url) => getCachedImage(url, 'high'));

  const all = [...new Set(products.flatMap(productImages).filter(Boolean))]
    .filter((url) => !primary.includes(url));
  const loadRemaining = () => all.forEach((url) => getCachedImage(url, 'low'));
  if ('requestIdleCallback' in window) requestIdleCallback(loadRemaining, { timeout: 1200 });
  else setTimeout(loadRemaining, 0);
}

function createGalleryNode(product) {
  const images = productImages(product);
  if (!images.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'product-placeholder gallery-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    return placeholder;
  }

  const gallery = document.createElement('div');
  gallery.className = 'product-gallery';
  gallery.dataset.galleryProductId = product.id;

  const main = document.createElement('div');
  main.className = 'gallery-main';
  const mainImage = document.createElement('img');
  mainImage.alt = product.name;
  mainImage.decoding = 'async';
  mainImage.fetchPriority = 'high';
  mainImage.dataset.galleryMainImage = '';
  main.append(mainImage);
  gallery.append(main);

  if (images.length > 1) {
    const thumbnails = document.createElement('div');
    thumbnails.className = 'gallery-thumbnails';
    thumbnails.setAttribute('aria-label', 'Фотографии товара');
    images.forEach((imageUrl, index) => {
      const button = document.createElement('button');
      button.className = 'gallery-thumb';
      button.type = 'button';
      button.dataset.galleryIndex = String(index);
      button.setAttribute('aria-label', `Открыть фотографию ${index + 1}`);

      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'eager';
      image.decoding = 'async';
      button.append(image);
      thumbnails.append(button);
    });
    gallery.append(thumbnails);
  }

  return gallery;
}

function renderProductGallery(product) {
  const images = productImages(product);
  let gallery = galleryNodeCache.get(product.id);
  if (!gallery) {
    gallery = createGalleryNode(product);
    galleryNodeCache.set(product.id, gallery);
  }

  if (images.length) {
    state.activeImageIndex = Math.max(0, Math.min(state.activeImageIndex, images.length - 1));
    const activeUrl = images[state.activeImageIndex];
    const mainImage = gallery.querySelector('[data-gallery-main-image]');
    const absoluteUrl = new URL(activeUrl, document.baseURI).href;
    if (mainImage && mainImage.src !== absoluteUrl) mainImage.src = activeUrl;
    gallery.querySelectorAll('[data-gallery-index]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.galleryIndex) === state.activeImageIndex);
    });
  }

  if (elements.modalImage.firstElementChild !== gallery) {
    elements.modalImage.replaceChildren(gallery);
  }
}

async function openProduct(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  const requestId = ++state.openRequestId;
  const images = productImages(product);

  // Wait for this product's images to be decoded once before showing the modal.
  // Subsequent opens resolve immediately from imageMemoryCache.
  await Promise.all(images.map((url, index) => getCachedImage(url, index === 0 ? 'high' : 'auto').promise));
  if (requestId !== state.openRequestId) return;

  state.activeProduct = product;
  state.activeImageIndex = 0;
  state.selectedSize = product.sizes?.[0] || '';
  state.quantity = 1;
  renderProductGallery(product);
  setText(elements.modalCategory, product.category || 'Коллекция');
  setText(elements.modalTitle, product.name);
  elements.modalPrice.innerHTML = `${money(product.price)} ${product.oldPrice ? `<s>${money(product.oldPrice)}</s>` : ''}`;
  setText(elements.modalDescription, product.description || 'Описание появится скоро.');
  renderOptions(elements.sizeGroup, 'Рост, см', product.sizes || []);
  elements.qtyValue.textContent = '1';
  elements.productModal.hidden = false;
  lockScroll();
}

function renderOptions(container, label, options) {
  if (!options.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `<span>${label}</span><div class="option-list">${options.map((option) => `<button class="option-chip ${option === state.selectedSize ? 'active' : ''}" type="button" data-size-value="${escapeAttribute(option)}">${escapeHtml(option)}</button>`).join('')}</div>`;
}

function closeProduct() {
  state.openRequestId += 1;
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
    image: primaryImage(state.activeProduct),
    size: state.selectedSize,
    quantity: state.quantity
  });
  closeProduct();
  openCart();
  showToast('Товар добавлен в корзину');
}

function quickAdd(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  addCartItem({ productId: product.id, name: product.name, price: product.price, image: primaryImage(product), size: product.sizes?.[0] || '', quantity: 1 });
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
    <div><h4>${escapeHtml(item.name)}</h4>${item.size ? `<p>Рост: ${escapeHtml(item.size)}</p>` : ''}<p>Количество: ${item.quantity}</p><strong>${money(item.price * item.quantity)}</strong></div>
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
        items: state.cart.map(({ productId, quantity, size }) => ({ productId, quantity, size }))
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
    const option = event.target.closest('[data-size-value]');
    if (!option) return;
    state.selectedSize = option.dataset.sizeValue;
    if (state.activeProduct) renderOptions(elements.sizeGroup, 'Рост, см', state.activeProduct.sizes || []);
  });
  elements.modalImage.addEventListener('click', (event) => {
    const thumbnail = event.target.closest('[data-gallery-index]');
    if (!thumbnail || !state.activeProduct) return;
    state.activeImageIndex = Number(thumbnail.dataset.galleryIndex) || 0;
    renderProductGallery(state.activeProduct);
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
function cartKey(item) { return `${item.productId}|${item.size}`; }
function loadCart() {
  try {
    const value = JSON.parse(localStorage.getItem('ailuu-cart') || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && item.productId).map((item) => ({
      productId: item.productId,
      name: item.name,
      price: Number(item.price || 0),
      image: item.image || '',
      size: item.size || '',
      quantity: Math.max(1, Math.min(20, Number(item.quantity) || 1))
    }));
  } catch {
    return [];
  }
}
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
