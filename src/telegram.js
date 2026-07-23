const fs = require('fs');
const path = require('path');
const {
  addProduct,
  deleteProduct,
  getProduct,
  listOrders,
  listProducts,
  readStore,
  updateOrderStatus,
  updateProduct,
  updateSettings
} = require('./store');

const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
const sessions = new Map();
let pollOffset = 0;
let polling = false;

function parseAdminIds(value) {
  return new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean));
}

function createTelegramManager({ token, adminIds, publicBaseUrl, notificationChatId }) {
  const admins = parseAdminIds(adminIds);
  const apiBase = token ? `https://api.telegram.org/bot${token}` : '';
  const fileBase = token ? `https://api.telegram.org/file/bot${token}` : '';

  async function api(method, payload = {}) {
    if (!token) return null;
    const response = await fetch(`${apiBase}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    });
    const data = await response.json();
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || 'unknown error'}`);
    return data.result;
  }

  async function sendMessage(chatId, text, extra = {}) {
    return api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra
    });
  }

  async function answerCallback(callbackQueryId, text = '') {
    return api('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
  }

  function isAdmin(userId) {
    return admins.has(String(userId));
  }

  function mainKeyboard() {
    return {
      inline_keyboard: [
        [{ text: '➕ Добавить товар', callback_data: 'add:start' }, { text: '🛍 Товары', callback_data: 'products:0' }],
        [{ text: '📦 Заказы', callback_data: 'orders:0' }, { text: '⚙️ Настройки', callback_data: 'settings' }],
        [{ text: '🌐 Открыть сайт', url: publicBaseUrl || 'https://example.com' }]
      ]
    };
  }

  function cancelKeyboard() {
    return { inline_keyboard: [[{ text: '✖️ Отменить', callback_data: 'cancel' }]] };
  }

  function productKeyboard(product) {
    return {
      inline_keyboard: [
        [{ text: '✏️ Название', callback_data: `edit:${product.id}:name` }, { text: '💰 Цена', callback_data: `edit:${product.id}:price` }],
        [{ text: '🏷 Старая цена', callback_data: `edit:${product.id}:oldPrice` }, { text: '📝 Описание', callback_data: `edit:${product.id}:description` }],
        [{ text: '🖼 Фото', callback_data: `edit:${product.id}:image` }, { text: '📂 Категория', callback_data: `edit:${product.id}:category` }],
        [{ text: '📏 Размеры', callback_data: `edit:${product.id}:sizes` }, { text: '🎨 Цвета', callback_data: `edit:${product.id}:colors` }],
        [{ text: product.inStock ? '🙈 Скрыть' : '👁 Показать', callback_data: `toggle:${product.id}` }],
        [{ text: product.featured ? '⭐ Убрать из избранного' : '⭐ Сделать избранным', callback_data: `feature:${product.id}` }],
        [{ text: '🗑 Удалить', callback_data: `delete:ask:${product.id}` }, { text: '⬅️ К товарам', callback_data: 'products:0' }]
      ]
    };
  }

  function formatProduct(product) {
    const store = readStore();
    return [
      `<b>${escapeHtml(product.name)}</b>`,
      `${formatMoney(product.price, store.settings.currency)}${product.oldPrice ? `  <s>${formatMoney(product.oldPrice, store.settings.currency)}</s>` : ''}`,
      `Категория: ${escapeHtml(product.category || '—')}`,
      `Размеры: ${escapeHtml((product.sizes || []).join(', ') || '—')}`,
      `Цвета: ${escapeHtml((product.colors || []).join(', ') || '—')}`,
      `На сайте: ${product.inStock ? 'да' : 'нет'}`,
      `Избранный: ${product.featured ? 'да' : 'нет'}`,
      '',
      escapeHtml(product.description || 'Без описания')
    ].join('\n');
  }

  async function showProducts(chatId, page = 0) {
    const products = listProducts();
    const pageSize = 8;
    const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const current = products.slice(safePage * pageSize, safePage * pageSize + pageSize);
    const rows = current.map((product) => [{
      text: `${product.inStock ? '●' : '○'} ${product.name} — ${product.price}`,
      callback_data: `product:${product.id}`
    }]);
    const nav = [];
    if (safePage > 0) nav.push({ text: '◀️', callback_data: `products:${safePage - 1}` });
    nav.push({ text: `${safePage + 1}/${totalPages}`, callback_data: 'noop' });
    if (safePage < totalPages - 1) nav.push({ text: '▶️', callback_data: `products:${safePage + 1}` });
    rows.push(nav);
    rows.push([{ text: '➕ Добавить', callback_data: 'add:start' }, { text: '🏠 Меню', callback_data: 'home' }]);
    await sendMessage(chatId, products.length ? '<b>Товары</b>\nВыберите товар для редактирования:' : 'Товаров пока нет.', { reply_markup: { inline_keyboard: rows } });
  }

  async function showOrders(chatId, page = 0) {
    const orders = listOrders(100);
    const pageSize = 8;
    const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const current = orders.slice(safePage * pageSize, safePage * pageSize + pageSize);
    const rows = current.map((order) => [{
      text: `${statusIcon(order.status)} ${order.id} · ${order.customer.name} · ${order.total}`,
      callback_data: `order:${order.id}`
    }]);
    const nav = [];
    if (safePage > 0) nav.push({ text: '◀️', callback_data: `orders:${safePage - 1}` });
    nav.push({ text: `${safePage + 1}/${totalPages}`, callback_data: 'noop' });
    if (safePage < totalPages - 1) nav.push({ text: '▶️', callback_data: `orders:${safePage + 1}` });
    rows.push(nav);
    rows.push([{ text: '🏠 Меню', callback_data: 'home' }]);
    await sendMessage(chatId, orders.length ? '<b>Последние заказы</b>' : 'Заказов пока нет.', { reply_markup: { inline_keyboard: rows } });
  }

  function statusIcon(status) {
    return ({ new: '🆕', confirmed: '✅', sent: '🚚', completed: '🏁', cancelled: '❌' })[status] || '•';
  }

  async function showOrder(chatId, id) {
    const order = listOrders(1000).find((entry) => entry.id === id);
    if (!order) return sendMessage(chatId, 'Заказ не найден.');
    const lines = order.items.map((item) => `• ${escapeHtml(item.name)} × ${item.quantity} — ${item.lineTotal}\n  ${escapeHtml([item.size, item.color].filter(Boolean).join(' · '))}`);
    const text = [
      `<b>Заказ ${order.id}</b>`,
      `Статус: ${statusIcon(order.status)} ${order.status}`,
      `Клиент: ${escapeHtml(order.customer.name)}`,
      `Телефон: ${escapeHtml(order.customer.phone)}`,
      `Адрес: ${escapeHtml(order.customer.address || '—')}`,
      `Комментарий: ${escapeHtml(order.customer.comment || '—')}`,
      '',
      ...lines,
      '',
      `<b>Итого: ${order.total} ${escapeHtml(readStore().settings.currency)}</b>`
    ].join('\n');
    await sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Подтвердить', callback_data: `orderstatus:${id}:confirmed` }, { text: '🚚 Отправлен', callback_data: `orderstatus:${id}:sent` }],
          [{ text: '🏁 Завершить', callback_data: `orderstatus:${id}:completed` }, { text: '❌ Отменить', callback_data: `orderstatus:${id}:cancelled` }],
          [{ text: '⬅️ К заказам', callback_data: 'orders:0' }]
        ]
      }
    });
  }

  async function startAdd(chatId, userId) {
    sessions.set(String(userId), { type: 'add', step: 'name', draft: {} });
    await sendMessage(chatId, '<b>Новый товар</b>\n1/8. Отправьте название товара.', { reply_markup: cancelKeyboard() });
  }

  async function processAddStep(message, session) {
    const chatId = message.chat.id;
    const text = String(message.text || '').trim();

    if (session.step === 'name') {
      if (!text) return sendMessage(chatId, 'Название не может быть пустым.');
      session.draft.name = text;
      session.step = 'price';
      return sendMessage(chatId, '2/8. Отправьте цену числом, например: <b>4200</b>.', { reply_markup: cancelKeyboard() });
    }
    if (session.step === 'price') {
      const price = Number(text.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(price) || price < 0) return sendMessage(chatId, 'Нужна корректная цена числом.');
      session.draft.price = price;
      session.step = 'category';
      return sendMessage(chatId, '3/8. Отправьте категорию, например: <b>Абая</b> или <b>Комплекты</b>.', { reply_markup: cancelKeyboard() });
    }
    if (session.step === 'category') {
      session.draft.category = text || 'Коллекция';
      session.step = 'sizes';
      return sendMessage(chatId, '4/8. Отправьте размеры через запятую, например: <b>S, M, L</b>.', { reply_markup: cancelKeyboard() });
    }
    if (session.step === 'sizes') {
      session.draft.sizes = text;
      session.step = 'colors';
      return sendMessage(chatId, '5/8. Отправьте цвета через запятую.', { reply_markup: cancelKeyboard() });
    }
    if (session.step === 'colors') {
      session.draft.colors = text;
      session.step = 'description';
      return sendMessage(chatId, '6/8. Отправьте описание товара.', { reply_markup: cancelKeyboard() });
    }
    if (session.step === 'description') {
      session.draft.description = text;
      session.step = 'image';
      return sendMessage(chatId, '7/8. Отправьте фотографию товара. Можно отправить <b>пропустить</b>.', { reply_markup: cancelKeyboard() });
    }
    if (session.step === 'image') {
      if (message.photo?.length) {
        session.draft.image = await downloadTelegramPhoto(message.photo.at(-1).file_id);
      } else if (text.toLowerCase() !== 'пропустить') {
        return sendMessage(chatId, 'Отправьте фотографию или слово <b>пропустить</b>.');
      }
      session.step = 'featured';
      return sendMessage(chatId, '8/8. Показывать товар в подборке «Новинки»?', {
        reply_markup: { inline_keyboard: [[{ text: '⭐ Да', callback_data: 'add:featured:yes' }, { text: 'Нет', callback_data: 'add:featured:no' }], [{ text: '✖️ Отменить', callback_data: 'cancel' }]] }
      });
    }
  }

  async function finishAdd(chatId, userId, featured) {
    const session = sessions.get(String(userId));
    if (!session || session.type !== 'add') return;
    session.draft.featured = featured;
    const product = addProduct(session.draft);
    sessions.delete(String(userId));
    await sendMessage(chatId, `✅ Товар добавлен.\n\n${formatProduct(product)}`, { reply_markup: productKeyboard(product) });
  }

  async function startEdit(chatId, userId, id, field) {
    const product = getProduct(id);
    if (!product) return sendMessage(chatId, 'Товар не найден.');
    sessions.set(String(userId), { type: 'edit', productId: id, field });
    const labels = { name: 'новое название', price: 'новую цену', oldPrice: 'старую цену (0 — убрать скидку)', description: 'новое описание', category: 'новую категорию', sizes: 'размеры через запятую', colors: 'цвета через запятую', image: 'новую фотографию' };
    await sendMessage(chatId, `Отправьте ${labels[field] || 'новое значение'} для «${escapeHtml(product.name)}».`, { reply_markup: cancelKeyboard() });
  }

  async function processEdit(message, session) {
    const chatId = message.chat.id;
    const field = session.field;
    let value = String(message.text || '').trim();
    if (field === 'image') {
      if (!message.photo?.length) return sendMessage(chatId, 'Отправьте фотографию.');
      value = await downloadTelegramPhoto(message.photo.at(-1).file_id);
    }
    if (field === 'price' || field === 'oldPrice') {
      value = Number(value.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) return sendMessage(chatId, 'Нужна корректная цена числом.');
    }
    const product = updateProduct(session.productId, { [field]: value });
    sessions.delete(String(message.from.id));
    if (!product) return sendMessage(chatId, 'Товар не найден.');
    await sendMessage(chatId, `✅ Изменение сохранено.\n\n${formatProduct(product)}`, { reply_markup: productKeyboard(product) });
  }

  async function downloadTelegramPhoto(fileId) {
    fs.mkdirSync(uploadDir, { recursive: true });
    const file = await api('getFile', { file_id: fileId });
    const extension = path.extname(file.file_path || '') || '.jpg';
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
    const response = await fetch(`${fileBase}/${file.file_path}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Не удалось скачать фотографию из Telegram.');
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    return `/uploads/${fileName}`;
  }

  async function showSettings(chatId) {
    const settings = readStore().settings;
    const rows = [
      ['brand', 'Название бренда'], ['headline', 'Главный заголовок'], ['subheadline', 'Подзаголовок'],
      ['announcement', 'Верхнее объявление'], ['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'],
      ['currency', 'Валюта'], ['deliveryText', 'Текст доставки'], ['aboutText', 'Текст о бренде']
    ].map(([key, label]) => [{ text: label, callback_data: `setting:${key}` }]);
    rows.push([{ text: '🏠 Меню', callback_data: 'home' }]);
    await sendMessage(chatId, `<b>Настройки магазина</b>\n\nБренд: ${escapeHtml(settings.brand)}\nЗаголовок: ${escapeHtml(settings.headline)}\nВалюта: ${escapeHtml(settings.currency)}`, { reply_markup: { inline_keyboard: rows } });
  }

  async function processSetting(message, session) {
    const rawValue = String(message.text || '').trim();
    const value = rawValue === '-' ? '' : rawValue;
    updateSettings({ [session.field]: value });
    sessions.delete(String(message.from.id));
    await sendMessage(message.chat.id, '✅ Настройка сохранена.', { reply_markup: mainKeyboard() });
  }

  async function handleMessage(message) {
    if (!message?.from || !message?.chat) return;
    const userId = String(message.from.id);
    const chatId = message.chat.id;
    if (!isAdmin(userId)) {
      return sendMessage(chatId, 'Доступ закрыт. Передайте владельцу бота ваш Telegram ID: <code>' + escapeHtml(userId) + '</code>.');
    }

    const command = String(message.text || '').split(/\s+/)[0].toLowerCase();
    if (command === '/start' || command === '/menu') {
      sessions.delete(userId);
      return sendMessage(chatId, '<b>AILUU.CLO — управление магазином</b>\nДобавляйте товары, меняйте цены и обрабатывайте заказы прямо здесь.', { reply_markup: mainKeyboard() });
    }
    if (command === '/cancel') {
      sessions.delete(userId);
      return sendMessage(chatId, 'Действие отменено.', { reply_markup: mainKeyboard() });
    }
    if (command === '/products') return showProducts(chatId, 0);
    if (command === '/orders') return showOrders(chatId, 0);
    if (command === '/add') return startAdd(chatId, userId);
    if (command === '/settings') return showSettings(chatId);

    const session = sessions.get(userId);
    if (session?.type === 'add') return processAddStep(message, session);
    if (session?.type === 'edit') return processEdit(message, session);
    if (session?.type === 'setting') return processSetting(message, session);

    return sendMessage(chatId, 'Используйте кнопки меню или команду /start.', { reply_markup: mainKeyboard() });
  }

  async function handleCallback(query) {
    if (!query?.from || !query?.message) return;
    const userId = String(query.from.id);
    const chatId = query.message.chat.id;
    if (!isAdmin(userId)) return answerCallback(query.id, 'Нет доступа');
    const data = String(query.data || '');
    await answerCallback(query.id);

    if (data === 'noop') return;
    if (data === 'home') return sendMessage(chatId, '<b>Главное меню</b>', { reply_markup: mainKeyboard() });
    if (data === 'cancel') {
      sessions.delete(userId);
      return sendMessage(chatId, 'Действие отменено.', { reply_markup: mainKeyboard() });
    }
    if (data === 'add:start') return startAdd(chatId, userId);
    if (data.startsWith('add:featured:')) return finishAdd(chatId, userId, data.endsWith(':yes'));
    if (data.startsWith('products:')) return showProducts(chatId, Number(data.split(':')[1]) || 0);
    if (data.startsWith('orders:')) return showOrders(chatId, Number(data.split(':')[1]) || 0);
    if (data === 'settings') return showSettings(chatId);
    if (data.startsWith('setting:')) {
      const field = data.split(':')[1];
      sessions.set(userId, { type: 'setting', field });
      return sendMessage(chatId, 'Отправьте новое значение. Для очистки отправьте дефис: <b>-</b>', { reply_markup: cancelKeyboard() });
    }
    if (data.startsWith('product:')) {
      const product = getProduct(data.slice('product:'.length));
      if (!product) return sendMessage(chatId, 'Товар не найден.');
      return sendMessage(chatId, formatProduct(product), { reply_markup: productKeyboard(product) });
    }
    if (data.startsWith('edit:')) {
      const [, id, field] = data.split(':');
      return startEdit(chatId, userId, id, field);
    }
    if (data.startsWith('toggle:')) {
      const id = data.slice('toggle:'.length);
      const product = getProduct(id);
      if (!product) return sendMessage(chatId, 'Товар не найден.');
      const updated = updateProduct(id, { inStock: !product.inStock });
      return sendMessage(chatId, formatProduct(updated), { reply_markup: productKeyboard(updated) });
    }
    if (data.startsWith('feature:')) {
      const id = data.slice('feature:'.length);
      const product = getProduct(id);
      if (!product) return sendMessage(chatId, 'Товар не найден.');
      const updated = updateProduct(id, { featured: !product.featured });
      return sendMessage(chatId, formatProduct(updated), { reply_markup: productKeyboard(updated) });
    }
    if (data.startsWith('delete:ask:')) {
      const id = data.slice('delete:ask:'.length);
      return sendMessage(chatId, 'Удалить товар без возможности восстановления?', {
        reply_markup: { inline_keyboard: [[{ text: 'Да, удалить', callback_data: `delete:yes:${id}` }, { text: 'Нет', callback_data: `product:${id}` }]] }
      });
    }
    if (data.startsWith('delete:yes:')) {
      const id = data.slice('delete:yes:'.length);
      deleteProduct(id);
      return sendMessage(chatId, '🗑 Товар удалён.', { reply_markup: mainKeyboard() });
    }
    if (data.startsWith('order:')) return showOrder(chatId, data.slice('order:'.length));
    if (data.startsWith('orderstatus:')) {
      const [, id, status] = data.split(':');
      updateOrderStatus(id, status);
      return showOrder(chatId, id);
    }
  }

  async function handleUpdate(update) {
    try {
      if (update.message) await handleMessage(update.message);
      if (update.callback_query) await handleCallback(update.callback_query);
    } catch (error) {
      console.error('Telegram update error:', error);
      const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
      if (chatId) await sendMessage(chatId, `Ошибка: ${escapeHtml(error.message)}`).catch(() => {});
    }
  }

  async function startPolling() {
    if (!token || polling) return;
    polling = true;
    console.log('Telegram bot polling started');
    while (polling) {
      try {
        const updates = await api('getUpdates', {
          offset: pollOffset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query']
        });
        for (const update of updates || []) {
          pollOffset = update.update_id + 1;
          await handleUpdate(update);
        }
      } catch (error) {
        console.error('Telegram polling error:', error.message);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  async function notifyOrder(order) {
    const chatId = notificationChatId || [...admins][0];
    if (!token || !chatId) return;
    const items = order.items.map((item) => `• ${escapeHtml(item.name)} × ${item.quantity} — ${item.lineTotal}`).join('\n');
    await sendMessage(chatId, [
      `🆕 <b>Новый заказ ${order.id}</b>`,
      `Клиент: ${escapeHtml(order.customer.name)}`,
      `Телефон: ${escapeHtml(order.customer.phone)}`,
      `Адрес: ${escapeHtml(order.customer.address || '—')}`,
      '', items, '',
      `<b>Итого: ${order.total} ${escapeHtml(readStore().settings.currency)}</b>`
    ].join('\n'), {
      reply_markup: { inline_keyboard: [[{ text: 'Открыть заказ', callback_data: `order:${order.id}` }]] }
    });
  }

  return { startPolling, notifyOrder };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

function formatMoney(value, currency) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ${escapeHtml(currency || 'сом')}`;
}

module.exports = { createTelegramManager };
