const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { createOrder, getPublicCatalog } = require('./store');
const { createTelegramManager } = require('./telegram');

loadEnv(path.join(__dirname, '..', '.env'));

const port = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
const requests = new Map();

const telegram = createTelegramManager({
  token: process.env.TELEGRAM_BOT_TOKEN,
  adminIds: process.env.TELEGRAM_ADMIN_IDS,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  notificationChatId: process.env.ORDER_NOTIFICATION_CHAT_ID
});

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, 200, getPublicCatalog());
    }

    if (req.method === 'POST' && url.pathname === '/api/orders') {
      if (!allowRequest(clientIp(req), url.pathname, 15 * 60 * 1000, 8)) {
        return sendJson(res, 429, { error: 'Слишком много запросов. Попробуйте позже.' });
      }
      try {
        const body = await readJsonBody(req, 250 * 1024);
        if (body.website) return sendJson(res, 200, { ok: true });
        const order = createOrder(body);
        telegram.notifyOrder(order).catch((error) => console.error('Order notification error:', error.message));
        return sendJson(res, 201, { ok: true, orderId: order.id });
      } catch (error) {
        return sendJson(res, 400, { error: error.message || 'Не удалось оформить заказ.' });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Метод не поддерживается.' });
    }

    if (url.pathname.startsWith('/uploads/')) {
      const relative = url.pathname.slice('/uploads/'.length);
      return serveFile(res, uploadsDir, relative, 'public, max-age=604800');
    }

    const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const served = await serveFile(res, publicDir, requested, 'public, max-age=3600', true);
    if (served) return;
    return serveFile(res, publicDir, 'index.html', 'no-cache');
  } catch (error) {
    console.error('HTTP error:', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера.' });
    else res.end();
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`AILUU.CLO store is running on port ${port}`);
  telegram.startPolling().catch((error) => console.error('Telegram startup error:', error));
});

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
}

function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length
  });
  res.end(body);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Запрос слишком большой.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Некорректный JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function serveFile(res, rootDir, relativePath, cacheControl, returnBoolean = false) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    if (returnBoolean) return false;
    return sendJson(res, 400, { error: 'Некорректный путь.' });
  }
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const absolute = path.resolve(rootDir, normalized);
  const root = path.resolve(rootDir) + path.sep;
  if (!absolute.startsWith(root) && absolute !== path.resolve(rootDir)) {
    if (returnBoolean) return false;
    return sendJson(res, 403, { error: 'Доступ запрещён.' });
  }

  try {
    const stat = await fs.promises.stat(absolute);
    if (!stat.isFile()) {
      if (returnBoolean) return false;
      return sendJson(res, 404, { error: 'Файл не найден.' });
    }
    const content = await fs.promises.readFile(absolute);
    res.writeHead(200, {
      'Content-Type': mimeType(absolute),
      'Content-Length': content.length,
      'Cache-Control': cacheControl
    });
    res.end(content);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' && returnBoolean) return false;
    if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'Файл не найден.' });
    throw error;
  }
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
  })[extension] || 'application/octet-stream';
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function allowRequest(ip, route, windowMs, max) {
  const now = Date.now();
  const key = `${ip}:${route}`;
  let entry = requests.get(key);
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + windowMs };
  entry.count += 1;
  requests.set(key, entry);
  return entry.count <= max;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of requests.entries()) {
    if (now > entry.resetAt) requests.delete(key);
  }
}, 60_000).unref();
