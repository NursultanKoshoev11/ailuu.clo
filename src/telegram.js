const crypto = require('node:crypto');
const { Telegraf, Markup } = require('telegraf');
const {
  addProduct,
  claimTelegramUpdate,
  clearTelegramSession,
  countProducts,
  deleteProduct,
  getOrder,
  getProduct,
  getSettings,
  getTelegramSession,
  listOrders,
  listProducts,
  releaseTelegramUpdate,
  setTelegramSession,
  updateOrderStatus,
  updateProduct,
  updateSettings
} = require('./repository');
const { downloadTelegramImage, removeLocalImage } = require('./storage');

const PRODUCT_PAGE_SIZE = 8;
const ORDER_PAGE_SIZE = 8;
const MAX_PRODUCT_IMAGES = 10;
const STANDARD_SIZES = ['80-90 см', '100-110 см', '120-130 см', '140-150 см'];

function createTelegramManager(config) {
  if (config.TELEGRAM_MODE === 'disabled') return createDisabledManager();

  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN, {
    handlerTimeout: 45_000
  });
  let pollingPromise = null;
  const sessionQueues = new Map();
  const actor = (ctx) => ({ type: 'telegram_admin', id: String(ctx.from?.id || '') });
  const enqueueSession = async (userId, task) => {
    const key = String(userId);
    const previous = sessionQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    sessionQueues.set(key, current);
    try {
      return await current;
    } finally {
      if (sessionQueues.get(key) === current) sessionQueues.delete(key);
    }
  };

  bot.use(async (ctx, next) => {
    const updateId = ctx.update?.update_id;
    if (updateId === undefined) return next();
    const claimed = await claimTelegramUpdate(updateId);
    if (!claimed) return;
    try {
      await next();
    } catch (error) {
      await releaseTelegramUpdate(updateId).catch(() => {});
      throw error;
    }
  });

  bot.use(async (ctx, next) => {
    if (!ctx.from || !config.telegramAdminIds.has(String(ctx.from.id))) {
      if (ctx.chat?.type === 'private') await ctx.reply('Доступ запрещён.');
      return;
    }
    return next();
  });

  bot.start(async (ctx) => showHome(ctx));
  bot.command('menu', async (ctx) => showHome(ctx));
  bot.command('products', async (ctx) => showProducts(ctx, 0));
  bot.command('orders', async (ctx) => showOrders(ctx, 0));
  bot.command('settings', async (ctx) => showSettings(ctx));
  bot.command('add', async (ctx) => startAdd(ctx));
  bot.command('cancel', async (ctx) => cancelCurrentSession(ctx));

  bot.on('callback_query', async (ctx) => {
    const data = String(ctx.callbackQuery?.data || '');
    await ctx.answerCbQuery().catch(() => {});
    if (!data || data === 'noop') return;

    if (data === 'home') return showHome(ctx);
    if (data === 'cancel') return cancelCurrentSession(ctx);
    if (data === 'add:start') return startAdd(ctx);
    if (data.startsWith('add:featured:')) return finishAdd(ctx, data.endsWith(':yes'));
    if (data.startsWith('products:')) return showProducts(ctx, Number(data.split(':')[1]) || 0);
    if (data.startsWith('product:')) return showProduct(ctx, data.slice('product:'.length));
    if (data.startsWith('edit:')) {
      const [, id, field] = data.split(':');
      return startEdit(ctx, id, field);
    }
    if (data.startsWith('toggle:')) return toggleProduct(ctx, data.slice('toggle:'.length));
    if (data.startsWith('feature:')) return toggleFeatured(ctx, data.slice('feature:'.length));
    if (data.startsWith('delete:ask:')) return askDelete(ctx, data.slice('delete:ask:'.length));
    if (data.startsWith('delete:confirm:')) return confirmDelete(ctx, data.slice('delete:confirm:'.length));
    if (data.startsWith('orders:')) return showOrders(ctx, Number(data.split(':')[1]) || 0);
    if (data.startsWith('order:')) return showOrder(ctx, data.slice('order:'.length));
    if (data.startsWith('orderstatus:')) {
      const [, id, status] = data.split(':');
      return changeOrderStatus(ctx, id, status);
    }
    if (data === 'settings') return showSettings(ctx);
    if (data.startsWith('setting:')) return startSettingEdit(ctx, data.slice('setting:'.length));
  });

  bot.on(['text', 'photo'], async (ctx) => enqueueSession(ctx.from.id, async () => {
    const session = await getTelegramSession(ctx.from.id);
    if (!session) return;
    if (session.type === 'add') return processAddStep(ctx, session);
    if (session.type === 'edit') return processEdit(ctx, session);
    if (session.type === 'setting') return processSettingEdit(ctx, session);
  }));

  bot.catch(async (error, ctx) => {
    console.error('Telegram handler error', { updateId: ctx.update?.update_id, error });
    if (ctx.chat?.id) await ctx.reply('Произошла ошибка. Попробуйте ещё раз или отправьте /cancel.').catch(() => {});
  });

  async function cancelCurrentSession(ctx) {
    const session = await getTelegramSession(ctx.from.id);
    const unsavedImages = session?.type === 'add'
      ? (session.draft?.images || [])
      : (session?.type === 'edit' ? (session.addedImages || []) : []);
    await removeImages(unsavedImages);
    await clearTelegramSession(ctx.from.id);
    return ctx.reply('Действие отменено.', mainKeyboard(config.PUBLIC_BASE_URL));
  }

  async function showHome(ctx) {
    const session = await getTelegramSession(ctx.from.id);
    const unsavedImages = session?.type === 'add'
      ? (session.draft?.images || [])
      : (session?.type === 'edit' ? (session.addedImages || []) : []);
    await removeImages(unsavedImages);
    await clearTelegramSession(ctx.from.id);
    const [productCount, orders] = await Promise.all([countProducts(), listOrders(1)]);
    const lastOrder = orders[0] ? `\nПоследний заказ: ${escapeHtml(orders[0].id)} · ${statusLabel(orders[0].status)}` : '';
    await ctx.reply(
      `<b>AILUU.CLO — управление магазином</b>\nТоваров: ${productCount}${lastOrder}`,
      { parse_mode: 'HTML', ...mainKeyboard(config.PUBLIC_BASE_URL) }
    );
  }

  async function showProducts(ctx, page) {
    const count = await countProducts();
    const totalPages = Math.max(1, Math.ceil(count / PRODUCT_PAGE_SIZE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const products = await listProducts(PRODUCT_PAGE_SIZE, safePage * PRODUCT_PAGE_SIZE);
    const rows = products.map((product) => [
      Markup.button.callback(
        `${product.inStock ? '●' : '○'} ${truncate(product.name, 28)} — ${product.price}`,
        `product:${product.id}`
      )
    ]);
    rows.push(paginationRow('products', safePage, totalPages));
    rows.push([Markup.button.callback('➕ Добавить', 'add:start'), Markup.button.callback('🏠 Меню', 'home')]);
    await ctx.reply(count ? '<b>Товары</b>\nВыберите товар:' : 'Товаров пока нет.', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(rows)
    });
  }

  async function showProduct(ctx, id) {
    const product = await getProduct(id);
    if (!product) return ctx.reply('Товар не найден.');
    await ctx.reply(await formatProduct(product), {
      parse_mode: 'HTML',
      ...productKeyboard(product)
    });
  }

  async function startAdd(ctx) {
    await setTelegramSession(ctx.from.id, ctx.chat.id, { type: 'add', step: 'name', draft: { sizes: STANDARD_SIZES, images: [] } });
    await ctx.reply('<b>Новый товар</b>\n1/8. Отправьте название.', { parse_mode: 'HTML', ...cancelKeyboard() });
  }

  async function processAddStep(ctx, session) {
    const text = String(ctx.message?.text || '').trim();
    const normalizedText = text.toLowerCase();
    const draft = session.draft || { sizes: STANDARD_SIZES, images: [] };
    const next = async (step, message) => {
      await setTelegramSession(ctx.from.id, ctx.chat.id, { ...session, step, draft });
      return ctx.reply(message, { parse_mode: 'HTML', ...cancelKeyboard() });
    };

    if (session.step === 'name') {
      if (!text) return ctx.reply('Название не может быть пустым.');
      draft.name = text;
      return next('price', '2/8. Отправьте цену числом, например <b>4200</b>.');
    }
    if (session.step === 'price') {
      const price = parseMoney(text);
      if (price === null) return ctx.reply('Нужна корректная цена числом.');
      draft.price = price;
      return next('oldPrice', '3/8. Отправьте старую цену или <b>0</b>, если скидки нет.');
    }
    if (session.step === 'oldPrice') {
      const oldPrice = parseMoney(text);
      if (oldPrice === null) return ctx.reply('Нужна корректная цена числом.');
      draft.oldPrice = oldPrice;
      return next('category', '4/8. Отправьте категорию, например <b>Платья</b>.');
    }
    if (session.step === 'category') {
      draft.category = text || 'Коллекция';
      draft.sizes = STANDARD_SIZES;
      return next('stock', `5/8. Размеры установлены автоматически: <b>${STANDARD_SIZES.join(', ')}</b>.\nТеперь отправьте остаток числом или <b>∞</b> для неограниченного остатка.`);
    }
    if (session.step === 'stock') {
      if (text === '∞' || /^без/i.test(text)) draft.stockQuantity = null;
      else {
        const stock = Number(text);
        if (!Number.isInteger(stock) || stock < 0) return ctx.reply('Отправьте целое число от 0 или символ ∞.');
        draft.stockQuantity = stock;
      }
      return next('description', '6/8. Отправьте описание товара.');
    }
    if (session.step === 'description') {
      draft.description = text;
      draft.images = Array.isArray(draft.images) ? draft.images : [];
      return next('images', `7/8. Отправляйте фотографии по одной, максимум ${MAX_PRODUCT_IMAGES}. Когда закончите, напишите <b>готово</b>. Если фото пока нет — <b>пропустить</b>.`);
    }
    if (session.step === 'images') {
      const photo = ctx.message?.photo?.at(-1);
      draft.images = Array.isArray(draft.images) ? draft.images : [];
      if (photo) {
        if (draft.images.length >= MAX_PRODUCT_IMAGES) return ctx.reply(`Можно добавить не больше ${MAX_PRODUCT_IMAGES} фотографий. Напишите «готово».`);
        const image = await downloadTelegramImage(bot, photo.file_id);
        draft.images.push(image);
        await setTelegramSession(ctx.from.id, ctx.chat.id, { ...session, step: 'images', draft });
        return ctx.reply(`✅ Фото добавлено: ${draft.images.length}/${MAX_PRODUCT_IMAGES}. Отправьте ещё одно или напишите <b>готово</b>.`, { parse_mode: 'HTML', ...cancelKeyboard() });
      }
      if (!['готово', 'завершить', 'пропустить'].includes(normalizedText)) {
        return ctx.reply('Отправьте фотографию или напишите «готово».');
      }
      await setTelegramSession(ctx.from.id, ctx.chat.id, { ...session, step: 'featured', draft });
      return ctx.reply('8/8. Показывать товар в подборке «Новинки»?', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⭐ Да', 'add:featured:yes'), Markup.button.callback('Нет', 'add:featured:no')],
          [Markup.button.callback('✖️ Отменить', 'cancel')]
        ])
      });
    }
  }

  async function finishAdd(ctx, featured) {
    const session = await getTelegramSession(ctx.from.id);
    if (!session || session.type !== 'add' || session.step !== 'featured') return ctx.reply('Сессия добавления истекла. Начните заново: /add');
    const product = await addProduct({ ...session.draft, featured }, actor(ctx));
    await clearTelegramSession(ctx.from.id);
    await ctx.reply(`✅ Товар добавлен.\n\n${await formatProduct(product)}`, {
      parse_mode: 'HTML',
      ...productKeyboard(product)
    });
  }

  async function startEdit(ctx, id, field) {
    const product = await getProduct(id);
    if (!product) return ctx.reply('Товар не найден.');
    const labels = {
      name: 'новое название', price: 'новую цену', oldPrice: 'старую цену (0 — убрать скидку)',
      description: 'новое описание', category: 'новую категорию',
      sizes: 'размеры в сантиметрах через запятую, например 80-90 см, 100-110 см',
      stockQuantity: 'остаток числом или ∞', sortOrder: 'порядок сортировки числом'
    };
    if (field === 'images') {
      await setTelegramSession(ctx.from.id, ctx.chat.id, {
        type: 'edit', productId: id, field, images: product.images || [], addedImages: []
      });
      return ctx.reply(
        `Сейчас фотографий: <b>${product.images?.length || 0}</b>. Отправляйте новые фото по одному — они добавятся к текущим.\nНапишите <b>очистить</b>, чтобы убрать все фото, или <b>готово</b>, чтобы сохранить.`,
        { parse_mode: 'HTML', ...cancelKeyboard() }
      );
    }
    if (!labels[field]) return ctx.reply('Неизвестное поле.');
    await setTelegramSession(ctx.from.id, ctx.chat.id, { type: 'edit', productId: id, field });
    await ctx.reply(`Отправьте ${labels[field]} для «${escapeHtml(product.name)}».`, { parse_mode: 'HTML', ...cancelKeyboard() });
  }

  async function processEdit(ctx, session) {
    const product = await getProduct(session.productId);
    if (!product) {
      await removeImages(session.addedImages || []);
      await clearTelegramSession(ctx.from.id);
      return ctx.reply('Товар не найден.');
    }
    const text = String(ctx.message?.text || '').trim();
    const normalizedText = text.toLowerCase();

    if (session.field === 'images') {
      const images = Array.isArray(session.images) ? session.images : (product.images || []);
      const addedImages = Array.isArray(session.addedImages) ? session.addedImages : [];
      const photo = ctx.message?.photo?.at(-1);
      if (photo) {
        if (images.length >= MAX_PRODUCT_IMAGES) return ctx.reply(`Можно сохранить не больше ${MAX_PRODUCT_IMAGES} фотографий. Напишите «готово» или «очистить».`);
        const image = await downloadTelegramImage(bot, photo.file_id);
        images.push(image);
        addedImages.push(image);
        await setTelegramSession(ctx.from.id, ctx.chat.id, { ...session, images, addedImages });
        return ctx.reply(`✅ Фото добавлено: ${images.length}/${MAX_PRODUCT_IMAGES}. Отправьте ещё или напишите <b>готово</b>.`, { parse_mode: 'HTML', ...cancelKeyboard() });
      }
      if (['очистить', 'удалить все', 'удалить'].includes(normalizedText)) {
        await removeImages(addedImages);
        await setTelegramSession(ctx.from.id, ctx.chat.id, { ...session, images: [], addedImages: [] });
        return ctx.reply('Все текущие фото будут удалены после сохранения. Отправьте новые фото или напишите <b>готово</b>.', { parse_mode: 'HTML', ...cancelKeyboard() });
      }
      if (!['готово', 'завершить'].includes(normalizedText)) {
        return ctx.reply('Отправьте фотографию, «очистить» или «готово».');
      }
      const updated = await updateProduct(product.id, { images }, actor(ctx));
      await removeImages((product.images || []).filter((image) => !images.includes(image)));
      await clearTelegramSession(ctx.from.id);
      return ctx.reply(`✅ Фотографии сохранены: ${updated.images.length}.\n\n${await formatProduct(updated)}`, {
        parse_mode: 'HTML',
        ...productKeyboard(updated)
      });
    }

    let value = text;
    if (['price', 'oldPrice'].includes(session.field)) {
      value = parseMoney(text);
      if (value === null) return ctx.reply('Нужна корректная цена числом.');
    }
    if (session.field === 'stockQuantity') {
      if (text === '∞' || /^без/i.test(text)) value = null;
      else {
        value = Number(text);
        if (!Number.isInteger(value) || value < 0) return ctx.reply('Отправьте целое число от 0 или символ ∞.');
      }
    }
    if (session.field === 'sortOrder') {
      value = Number(text);
      if (!Number.isInteger(value)) return ctx.reply('Отправьте целое число.');
    }

    const updated = await updateProduct(product.id, { [session.field]: value }, actor(ctx));
    await clearTelegramSession(ctx.from.id);
    await ctx.reply(`✅ Изменение сохранено.\n\n${await formatProduct(updated)}`, {
      parse_mode: 'HTML',
      ...productKeyboard(updated)
    });
  }

  async function toggleProduct(ctx, id) {
    const product = await getProduct(id);
    if (!product) return ctx.reply('Товар не найден.');
    const updated = await updateProduct(id, { inStock: !product.isActive }, actor(ctx));
    return showProduct(ctx, updated.id);
  }

  async function toggleFeatured(ctx, id) {
    const product = await getProduct(id);
    if (!product) return ctx.reply('Товар не найден.');
    const updated = await updateProduct(id, { featured: !product.featured }, actor(ctx));
    return showProduct(ctx, updated.id);
  }

  async function askDelete(ctx, id) {
    const product = await getProduct(id);
    if (!product) return ctx.reply('Товар не найден.');
    await ctx.reply(`Удалить «${escapeHtml(product.name)}»? Это действие нельзя отменить.`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🗑 Да, удалить', `delete:confirm:${id}`)],
        [Markup.button.callback('⬅️ Назад', `product:${id}`)]
      ])
    });
  }

  async function confirmDelete(ctx, id) {
    const product = await getProduct(id);
    const deleted = await deleteProduct(id, actor(ctx));
    if (!deleted) return ctx.reply('Товар уже удалён.');
    await removeImages(product?.images || []);
    await ctx.reply('Товар удалён.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ К товарам', 'products:0')]]));
  }

  async function showOrders(ctx, page) {
    const safePage = Math.max(0, page);
    const orders = await listOrders(ORDER_PAGE_SIZE + 1, safePage * ORDER_PAGE_SIZE);
    const hasNext = orders.length > ORDER_PAGE_SIZE;
    const visible = orders.slice(0, ORDER_PAGE_SIZE);
    const rows = visible.map((order) => [
      Markup.button.callback(`${statusIcon(order.status)} ${order.id} · ${truncate(order.customer.name, 18)} · ${order.total}`, `order:${order.id}`)
    ]);
    const nav = [];
    if (safePage > 0) nav.push(Markup.button.callback('◀️', `orders:${safePage - 1}`));
    nav.push(Markup.button.callback(`${safePage + 1}`, 'noop'));
    if (hasNext) nav.push(Markup.button.callback('▶️', `orders:${safePage + 1}`));
    rows.push(nav);
    rows.push([Markup.button.callback('🏠 Меню', 'home')]);
    await ctx.reply(visible.length ? '<b>Последние заказы</b>' : 'Заказов пока нет.', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  }

  async function showOrder(ctx, id) {
    const order = await getOrder(id);
    if (!order) return ctx.reply('Заказ не найден.');
    const settings = await getSettings();
    const lines = order.items.map((item) => {
      const size = item.size ? `\n  Размер: ${escapeHtml(item.size)}` : '';
      return `• ${escapeHtml(item.name)} × ${item.quantity} — ${formatMoney(item.lineTotal, settings.currency)}${size}`;
    });
    const text = [
      `<b>Заказ ${escapeHtml(order.id)}</b>`,
      `Статус: ${statusIcon(order.status)} ${statusLabel(order.status)}`,
      `Клиент: ${escapeHtml(order.customer.name)}`,
      `Телефон: <code>${escapeHtml(order.customer.phone)}</code>`,
      `Адрес: ${escapeHtml(order.customer.address || '—')}`,
      `Комментарий: ${escapeHtml(order.customer.comment || '—')}`,
      '', ...lines, '', `<b>Итого: ${formatMoney(order.total, settings.currency)}</b>`
    ].join('\n');
    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Подтвердить', `orderstatus:${order.id}:confirmed`), Markup.button.callback('🚚 Отправлен', `orderstatus:${order.id}:sent`)],
        [Markup.button.callback('🏁 Завершить', `orderstatus:${order.id}:completed`), Markup.button.callback('❌ Отменить', `orderstatus:${order.id}:cancelled`)],
        [Markup.button.callback('⬅️ К заказам', 'orders:0')]
      ])
    });
  }

  async function changeOrderStatus(ctx, id, status) {
    const order = await updateOrderStatus(id, status, actor(ctx));
    if (!order) return ctx.reply('Заказ не найден или статус некорректен.');
    return showOrder(ctx, order.id);
  }

  async function showSettings(ctx) {
    const settings = await getSettings();
    await ctx.reply([
      '<b>Настройки сайта</b>',
      `Бренд: ${escapeHtml(settings.brand)}`,
      `Заголовок: ${escapeHtml(settings.headline)}`,
      `Валюта: ${escapeHtml(settings.currency)}`,
      `Instagram: ${escapeHtml(settings.instagram || '—')}`,
      `WhatsApp: ${escapeHtml(settings.whatsapp || '—')}`,
      `Telegram: ${escapeHtml(settings.telegram || '—')}`
    ].join('\n'), { parse_mode: 'HTML', ...settingsKeyboard() });
  }

  async function startSettingEdit(ctx, field) {
    const allowed = new Set(['brand', 'eyebrow', 'headline', 'subheadline', 'announcement', 'instagram', 'whatsapp', 'telegram', 'currency', 'deliveryText', 'aboutTitle', 'aboutText']);
    if (!allowed.has(field)) return ctx.reply('Неизвестная настройка.');
    await setTelegramSession(ctx.from.id, ctx.chat.id, { type: 'setting', field });
    await ctx.reply('Отправьте новое значение. Чтобы очистить поле, отправьте один дефис: <b>-</b>', { parse_mode: 'HTML', ...cancelKeyboard() });
  }

  async function processSettingEdit(ctx, session) {
    const text = String(ctx.message?.text || '').trim();
    if (!text && session.field !== 'whatsapp' && session.field !== 'telegram') return ctx.reply('Значение не может быть пустым. Используйте «-», чтобы очистить поле.');
    const value = text === '-' ? '' : text;
    await updateSettings({ [session.field]: value }, actor(ctx));
    await clearTelegramSession(ctx.from.id);
    await ctx.reply('✅ Настройка сохранена.');
    return showSettings(ctx);
  }

  async function formatProduct(product) {
    const settings = await getSettings();
    return [
      `<b>${escapeHtml(product.name)}</b>`,
      `${formatMoney(product.price, settings.currency)}${product.oldPrice ? `  <s>${formatMoney(product.oldPrice, settings.currency)}</s>` : ''}`,
      `Категория: ${escapeHtml(product.category || '—')}`,
      `Размеры: ${escapeHtml(product.sizes.join(', ') || '—')}`,
      `Фотографий: ${product.images?.length || 0}`,
      `Остаток: ${product.stockQuantity === null ? '∞' : product.stockQuantity}`,
      `На сайте: ${product.isActive ? 'да' : 'нет'}`,
      `Новинка: ${product.featured ? 'да' : 'нет'}`,
      `Сортировка: ${product.sortOrder}`,
      '', escapeHtml(product.description || 'Без описания')
    ].join('\n');
  }

  async function registerWebhookRoute(app) {
    if (config.TELEGRAM_MODE !== 'webhook') return;
    app.post(config.TELEGRAM_WEBHOOK_PATH, { config: { rateLimit: false } }, async (request, reply) => {
      const secret = String(request.headers['x-telegram-bot-api-secret-token'] || '');
      if (!safeEqual(secret, config.TELEGRAM_WEBHOOK_SECRET)) return reply.code(401).send({ error: 'Unauthorized' });
      await bot.handleUpdate(request.body);
      return reply.code(200).send({ ok: true });
    });
  }

  async function start() {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Главное меню' },
      { command: 'add', description: 'Добавить товар' },
      { command: 'products', description: 'Товары' },
      { command: 'orders', description: 'Заказы' },
      { command: 'settings', description: 'Настройки' },
      { command: 'cancel', description: 'Отменить действие' }
    ]);
    if (config.TELEGRAM_MODE === 'webhook') {
      const url = new URL(config.TELEGRAM_WEBHOOK_PATH, config.PUBLIC_BASE_URL).toString();
      await bot.telegram.setWebhook(url, {
        secret_token: config.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false
      });
      console.log(`Telegram webhook configured: ${url}`);
      return;
    }
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    pollingPromise = bot.launch({ allowedUpdates: ['message', 'callback_query'] });
    pollingPromise.catch((error) => {
      console.error('Telegram polling stopped unexpectedly', error);
      process.exitCode = 1;
    });
    console.log('Telegram polling started');
  }

  async function stop(reason = 'shutdown') {
    if (config.TELEGRAM_MODE === 'polling') {
      bot.stop(reason);
      await pollingPromise?.catch(() => {});
    }
  }

  async function notifyOrder(order) {
    const chatId = config.ORDER_NOTIFICATION_CHAT_ID || [...config.telegramAdminIds][0];
    if (!chatId || order.honeypot) return;
    const settings = await getSettings();
    const items = order.items.map((item) => {
      const size = item.size ? ` · ${escapeHtml(item.size)}` : '';
      return `• ${escapeHtml(item.name)} × ${item.quantity}${size} — ${formatMoney(item.lineTotal, settings.currency)}`;
    }).join('\n');
    await bot.telegram.sendMessage(chatId, [
      `🆕 <b>Новый заказ ${escapeHtml(order.id)}</b>`,
      `Клиент: ${escapeHtml(order.customer.name)}`,
      `Телефон: <code>${escapeHtml(order.customer.phone)}</code>`,
      `Адрес: ${escapeHtml(order.customer.address || '—')}`,
      '', items, '', `<b>Итого: ${formatMoney(order.total, settings.currency)}</b>`
    ].join('\n'), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть заказ', callback_data: `order:${order.id}` }]] }
    });
  }

  return { bot, notifyOrder, registerWebhookRoute, start, stop };
}

function createDisabledManager() {
  return {
    bot: null,
    notifyOrder: async () => {},
    registerWebhookRoute: async () => {},
    start: async () => {},
    stop: async () => {}
  };
}

function mainKeyboard(publicBaseUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Добавить товар', 'add:start'), Markup.button.callback('🛍 Товары', 'products:0')],
    [Markup.button.callback('📦 Заказы', 'orders:0'), Markup.button.callback('⚙️ Настройки', 'settings')],
    [Markup.button.url('🌐 Открыть сайт', publicBaseUrl)]
  ]);
}

function cancelKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('✖️ Отменить', 'cancel')]]);
}

function productKeyboard(product) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Название', `edit:${product.id}:name`), Markup.button.callback('💰 Цена', `edit:${product.id}:price`)],
    [Markup.button.callback('🏷 Старая цена', `edit:${product.id}:oldPrice`), Markup.button.callback('📝 Описание', `edit:${product.id}:description`)],
    [Markup.button.callback('🖼 Фотографии', `edit:${product.id}:images`), Markup.button.callback('📂 Категория', `edit:${product.id}:category`)],
    [Markup.button.callback('📏 Размеры', `edit:${product.id}:sizes`), Markup.button.callback('📦 Остаток', `edit:${product.id}:stockQuantity`)],
    [Markup.button.callback('↕️ Сортировка', `edit:${product.id}:sortOrder`)],
    [Markup.button.callback(product.isActive ? '🙈 Скрыть' : '👁 Показать', `toggle:${product.id}`)],
    [Markup.button.callback(product.featured ? '⭐ Убрать из новинок' : '⭐ Добавить в новинки', `feature:${product.id}`)],
    [Markup.button.callback('🗑 Удалить', `delete:ask:${product.id}`), Markup.button.callback('⬅️ К товарам', 'products:0')]
  ]);
}

function settingsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Бренд', 'setting:brand'), Markup.button.callback('Надзаголовок', 'setting:eyebrow')],
    [Markup.button.callback('Заголовок', 'setting:headline'), Markup.button.callback('Подзаголовок', 'setting:subheadline')],
    [Markup.button.callback('Объявление', 'setting:announcement'), Markup.button.callback('Валюта', 'setting:currency')],
    [Markup.button.callback('Instagram', 'setting:instagram'), Markup.button.callback('WhatsApp', 'setting:whatsapp')],
    [Markup.button.callback('Telegram', 'setting:telegram'), Markup.button.callback('Доставка', 'setting:deliveryText')],
    [Markup.button.callback('Заголовок «О нас»', 'setting:aboutTitle'), Markup.button.callback('Текст «О нас»', 'setting:aboutText')],
    [Markup.button.callback('🏠 Меню', 'home')]
  ]);
}

function paginationRow(prefix, page, totalPages) {
  const row = [];
  if (page > 0) row.push(Markup.button.callback('◀️', `${prefix}:${page - 1}`));
  row.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'));
  if (page < totalPages - 1) row.push(Markup.button.callback('▶️', `${prefix}:${page + 1}`));
  return row;
}


async function removeImages(images) {
  for (const image of [...new Set((images || []).filter(Boolean))]) {
    await removeLocalImage(image).catch(() => {});
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseMoney(value) {
  const number = Number(String(value || '').replace(/\s/g, '').replace(',', '.'));
  return Number.isInteger(number) && number >= 0 && number <= 100_000_000 ? number : null;
}

function statusIcon(status) {
  return ({ new: '🆕', confirmed: '✅', sent: '🚚', completed: '🏁', cancelled: '❌' })[status] || '•';
}

function statusLabel(status) {
  return ({ new: 'новый', confirmed: 'подтверждён', sent: 'отправлен', completed: 'завершён', cancelled: 'отменён' })[status] || status;
}

function formatMoney(value, currency) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ${escapeHtml(currency || 'сом')}`;
}

function truncate(value, length) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

module.exports = { createTelegramManager };
