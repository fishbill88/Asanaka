import Fastify from 'fastify';

// Builds the app without listening, so tests can drive it with inject().
export function buildApp(opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? false });

  // Docker's health check and the deploy script both poll this.
  app.get('/healthz', async () => ({ ok: true }));

  return app;
}
