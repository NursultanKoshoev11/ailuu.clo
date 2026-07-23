const { config } = require('./config');
const db = require('./db');
const { buildApp } = require('./app');
const { createTelegramManager } = require('./telegram');
const { ensureUploadsDir } = require('./storage');
const { pruneOperationalData } = require('./repository');
const { migrate } = require('../scripts/migrate');
const { seed } = require('../scripts/seed');

async function main() {
  if (config.RUN_MIGRATIONS_ON_START) await migrate();
  if (config.RUN_SEED_ON_START) await seed();
  await ensureUploadsDir();
  await db.healthcheck();

  const telegram = createTelegramManager(config);
  const app = await buildApp({ telegram });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Graceful shutdown started');
    const forceTimer = setTimeout(() => process.exit(1), 20_000).unref();
    try {
      await telegram.stop(signal);
      await app.close();
      await db.close();
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (error) {
      app.log.error({ error }, 'Graceful shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (error) => {
    app.log.fatal({ error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (error) => {
    app.log.error({ error }, 'Unhandled rejection');
  });

  await app.listen({ host: config.HOST, port: config.PORT });
  await telegram.start();
  await pruneOperationalData().catch((error) => app.log.warn({ error }, 'Operational cleanup failed'));
  setInterval(() => pruneOperationalData().catch((error) => app.log.warn({ error }, 'Operational cleanup failed')), 60 * 60 * 1000).unref();
}

main().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exit(1);
});
