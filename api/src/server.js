import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { fromPool, migrate } from './db.js';

const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set. On the VPS it comes from the .env file next to docker-compose.yml.');
  process.exit(1);
}

const db = fromPool(new pg.Pool({ connectionString: config.databaseUrl, max: 10 }));
const ran = await migrate(db);
const app = buildApp({ db, config, logger: true });
if (ran.length) app.log.info({ migrations: ran }, 'migrations applied');

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
