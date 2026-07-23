const path = require('node:path');
require('dotenv').config({ quiet: true });
const { z } = require('zod');

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: booleanString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: booleanString,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_ADMIN_IDS: z.string().optional().default(''),
  TELEGRAM_MODE: z.enum(['disabled', 'polling', 'webhook']).default('disabled'),
  TELEGRAM_WEBHOOK_PATH: z.string().regex(/^\/[a-zA-Z0-9_/-]+$/).default('/internal/telegram/webhook'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional().default(''),
  ORDER_NOTIFICATION_CHAT_ID: z.string().optional().default(''),

  UPLOADS_DIR: z.string().default(path.join(process.cwd(), 'data', 'uploads')),
  MAX_IMAGE_BYTES: z.coerce.number().int().min(100000).max(20_000_000).default(8_000_000),
  ORDER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(8),
  ORDER_RATE_LIMIT_WINDOW: z.string().default('15 minutes'),
  RUN_MIGRATIONS_ON_START: booleanString,
  RUN_SEED_ON_START: booleanString
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

const config = parsed.data;
config.isProduction = config.NODE_ENV === 'production';
config.telegramAdminIds = new Set(
  config.TELEGRAM_ADMIN_IDS.split(',').map((value) => value.trim()).filter(Boolean)
);

if (config.TELEGRAM_MODE !== 'disabled') {
  if (!config.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required when Telegram is enabled');
  if (!config.telegramAdminIds.size) throw new Error('TELEGRAM_ADMIN_IDS is required when Telegram is enabled');
}
if (config.TELEGRAM_MODE === 'webhook' && !config.TELEGRAM_WEBHOOK_SECRET) {
  throw new Error('TELEGRAM_WEBHOOK_SECRET is required in webhook mode');
}

module.exports = { config };
