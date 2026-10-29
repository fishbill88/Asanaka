import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One small interface over node-postgres (production) and PGlite (tests): query, exec, tx, close.
// Queries inside tx() run on one connection between BEGIN and COMMIT.

export function fromPool(pool) {
  return {
    query: (text, params) => pool.query(text, params),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (t, p) => client.query(t, p), exec: (s) => client.query(s) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export function fromPglite(pg) {
  return {
    query: (text, params) => pg.query(text, params),
    exec: (sql) => pg.exec(sql),
    tx: (fn) => pg.transaction((t) => fn({ query: (q, p) => t.query(q, p), exec: (s) => t.exec(s) })),
    close: () => pg.close(),
  };
}

// Applies each migrations/*.sql file once, in name order, each in its own transaction.
export async function migrate(db, dir = fileURLToPath(new URL('../migrations/', import.meta.url))) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const ran = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(dir, name), 'utf8');
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    });
    ran.push(name);
  }
  return ran;
}
