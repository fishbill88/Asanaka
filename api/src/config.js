// Every setting comes from the environment (on the VPS: the .env file Docker reads). Nothing secret has a default.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.ASANAKA_API_PORT || 7360),
    host: env.ASANAKA_API_HOST || '0.0.0.0',
    databaseUrl: env.DATABASE_URL || '',
    trustProxy: env.ASANAKA_TRUST_PROXY === '1',
    allowedOrigins: (env.ASANAKA_ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    sessionHours: Number(env.ASANAKA_SESSION_HOURS || 12),
    maxFailures: Number(env.ASANAKA_MAX_FAILURES || 5),
    lockMinutes: Number(env.ASANAKA_LOCK_MINUTES || 15),
  };
}
