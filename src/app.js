const path = require('node:path');
const Fastify = require('fastify');
const helmet = require('@fastify/helmet');
const rateLimit = require('@fastify/rate-limit');
const fastifyStatic = require('@fastify/static');
const { ZodError } = require('zod');
const { config } = require('./config');
const { healthcheck } = require('./db');
const { createOrder, getPublicCatalog } = require('./repository');

async function buildApp({ telegram }) {
  const isHttpsPublicUrl = config.PUBLIC_BASE_URL.startsWith('https://');
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => cryptoRandomId()
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const pathname = request.url.split('?', 1)[0];
    if (pathname === '/' || pathname === '/index.html') {
      reply.header('Cache-Control', 'no-cache');
    }
    return payload;
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: isHttpsPublicUrl ? [] : null
      }
    },
    ...(isHttpsPublicUrl ? {} : { strictTransportSecurity: false }),
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => request.ip
  });

  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/',
    decorateReply: true,
    cacheControl: true,
    maxAge: config.isProduction ? '1h' : 0,
    immutable: false,
    setHeaders(response, filePath) {
      if (!isHttpsPublicUrl || filePath.endsWith('index.html')) {
        response.setHeader('Cache-Control', 'no-cache');
      }
    }
  });

  await app.register(fastifyStatic, {
    root: config.UPLOADS_DIR,
    prefix: '/uploads/',
    decorateReply: false,
    cacheControl: true,
    maxAge: '365d',
    immutable: true
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (request, reply) => {
    const database = await healthcheck().catch(() => false);
    if (!database) return reply.code(503).send({ status: 'not_ready', database: false });
    return { status: 'ready', database: true };
  });

  app.get('/api/catalog', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return getPublicCatalog();
  });

  app.post('/api/orders', {
    config: {
      rateLimit: {
        max: config.ORDER_RATE_LIMIT_MAX,
        timeWindow: config.ORDER_RATE_LIMIT_WINDOW
      }
    },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['customer', 'items'],
        properties: {
          website: { type: 'string', maxLength: 200 },
          customer: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'phone'],
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 160 },
              phone: { type: 'string', minLength: 5, maxLength: 60 },
              address: { type: 'string', maxLength: 500 },
              comment: { type: 'string', maxLength: 1000 }
            }
          },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['productId', 'quantity'],
              properties: {
                productId: { type: 'string', format: 'uuid' },
                quantity: { type: 'integer', minimum: 1, maximum: 20 },
                size: { type: 'string', maxLength: 80 }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const order = await createOrder(request.body);
    if (order.honeypot) return reply.code(202).send({ ok: true });
    if (!order.duplicate) {
      telegram.notifyOrder(order).catch((error) => request.log.error({ error, orderId: order.id }, 'Order notification failed'));
    }
    return reply.code(order.duplicate ? 200 : 201).send({ ok: true, orderId: order.id, duplicate: Boolean(order.duplicate) });
  });

  await telegram.registerWebhookRoute(app);

  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send({ error: 'Маршрут не найден.' });
    }
    if (request.url.startsWith('/api/') || request.url.startsWith('/internal/') || request.url.startsWith('/uploads/')) {
      return reply.code(404).send({ error: 'Ресурс не найден.' });
    }
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html');
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, 'Request failed');
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: error.issues[0]?.message || 'Некорректные данные.' });
    }
    if (error.validation) {
      return reply.code(400).send({ error: 'Проверьте заполнение формы.' });
    }
    if (error.statusCode === 429) {
      return reply.code(429).send({ error: 'Слишком много запросов. Попробуйте позже.' });
    }
    if (error.message && /товар|корзин|имя|телефон|размер|склад|заказ|обрабатывается|недостаточно/i.test(error.message)) {
      return reply.code(400).send({ error: error.message });
    }
    return reply.code(500).send({ error: 'Внутренняя ошибка сервера.' });
  });

  return app;
}

function cryptoRandomId() {
  return require('node:crypto').randomUUID();
}

module.exports = { buildApp };
