import { buildApp } from './app.js';

// Settings come from the environment (the VPS .env, read by Docker); nothing secret lives in the code.
const port = Number(process.env.ASANAKA_API_PORT || 7360);
const host = process.env.ASANAKA_API_HOST || '0.0.0.0';

const app = buildApp({ logger: true, trustProxy: process.env.ASANAKA_TRUST_PROXY === '1' });

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
