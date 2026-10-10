import { createApp } from './app';
import { config } from './config';
import { prisma, disconnectPrisma } from './prisma';

async function main(): Promise<void> {
  // Fail fast with a clear message instead of crashing on the first request.
  try {
    await prisma.$connect();
    const result = await prisma.$queryRaw`SELECT 1`;
    if (!result) throw new Error('no result');
    console.log('[db] PostgreSQL bağlantısı uğurlu.');
  } catch (err) {
    console.error('[db] PostgreSQL-ə qoşulma mümkün olmadı:', err instanceof Error ? err.message : err);
    console.error('     DATABASE_URL env dəyişənini və DB-nin işlədiyini yoxlayın.');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[api] Farah API ${config.env} rejimdə http://0.0.0.0:${config.port}${config.apiPrefix} ünvanında işləyir.`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[api] ${signal} alındı, bağlanır...`);
    server.close(() => {
      void disconnectPrisma().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
