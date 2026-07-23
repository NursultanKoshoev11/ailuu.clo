const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { config } = require('./config');

async function ensureUploadsDir() {
  await fs.mkdir(config.UPLOADS_DIR, { recursive: true, mode: 0o750 });
}

function detectImageExtension(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return null;
}

async function saveImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Invalid image data');
  if (buffer.length > config.MAX_IMAGE_BYTES) throw new Error('Изображение слишком большое.');
  const extension = detectImageExtension(buffer);
  if (!extension) throw new Error('Поддерживаются только JPG, PNG и WebP.');
  await ensureUploadsDir();
  const filename = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${extension}`;
  const target = path.join(config.UPLOADS_DIR, filename);
  await fs.writeFile(target, buffer, { mode: 0o640, flag: 'wx' });
  return `/uploads/${filename}`;
}

async function downloadTelegramImage(bot, fileId) {
  const link = await bot.telegram.getFileLink(fileId);
  const response = await fetch(link, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Не удалось скачать фотографию из Telegram.');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > config.MAX_IMAGE_BYTES) throw new Error('Изображение слишком большое.');
  const buffer = Buffer.from(await response.arrayBuffer());
  return saveImageBuffer(buffer);
}

async function removeLocalImage(publicPath) {
  if (!String(publicPath || '').startsWith('/uploads/')) return;
  const filename = path.basename(publicPath);
  await fs.unlink(path.join(config.UPLOADS_DIR, filename)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

module.exports = { ensureUploadsDir, downloadTelegramImage, removeLocalImage, saveImageBuffer };
