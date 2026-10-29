import Fastify from 'fastify';
import cors from '@fastify/cors';
import { HttpError } from './errors.js';
import authRoutes from './routes/auth.js';
import boardRoutes from './routes/board.js';

// Builds the app without listening, so tests can drive it with inject(). `db` is the adapter from db.js.
export function buildApp({ db, config, logger = false }) {
  const app = Fastify({ logger, trustProxy: config.trustProxy, bodyLimit: 1024 * 1024 });

  // Only the site itself may call the API from a browser.
  app.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err.validation) {
      return reply.code(400).send({ error: 'invalid', message: `The request was missing something or had the wrong shape: ${err.message}.` });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'bad-request', message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'server', message: 'Something went wrong on the server. Try again in a moment.' });
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'not-found', message: 'There’s nothing at that address.' }));

  // Docker's health check and the deploy script both poll this; it also proves the database answers.
  app.get('/healthz', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  const ctx = { db, config };
  authRoutes(app, ctx);
  boardRoutes(app, ctx);
  return app;
}
