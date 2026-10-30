#!/usr/bin/env node
// Account administration on the VPS: `asanaka admin <command>` runs this inside the api container.
// Passwords are read from stdin, never from the command line, so they never show in `ps` or shell history.
//
//   set-user               stdin: {"username","password","displayName"?,"role"?} as JSON. Creates or updates.
//   set-password <name>    stdin: the password. Creates the account if missing (role admin when name is "admin").
//   rename <name> <display name...>   change the name people see (not a secret, so it may be an argument)
//   list                   every account: username, name, role, disabled, open sessions
//   disable <name>         block sign-in and end its sessions
//   enable <name>          allow sign-in again
//   sign-out <name>        end every session of that account
import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { fromPool, migrate } from '../src/db.js';
import { setUser } from '../src/users.js';

const [cmd, arg, ...rest] = process.argv.slice(2);
const readStdin = async () => { let s = ''; for await (const c of process.stdin) s += c; return s.replace(/\r?\n$/, ''); };
const fail = (msg) => { console.error(`  [x] ${msg}`); process.exit(1); };

const config = loadConfig();
if (!config.databaseUrl) fail('DATABASE_URL is not set.');
const db = fromPool(new pg.Pool({ connectionString: config.databaseUrl, max: 2 }));
try {
  await migrate(db);
  switch (cmd) {
    case 'set-user': {
      let input;
      try { input = JSON.parse(await readStdin()); } catch { fail('stdin must be one JSON object.'); }
      const { user, created } = await setUser(db, input);
      console.log(`  ${created ? 'created' : 'updated'} ${user.username} (${user.display_name}, ${user.role})`);
      break;
    }
    case 'set-password': {
      if (!arg) fail('usage: set-password <username>   (password on stdin)');
      const password = await readStdin();
      // A new admin account is named Admin; an existing one keeps whatever name it was given.
      const isAdmin = arg.toLowerCase() === 'admin';
      const exists = (await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [arg])).rows[0];
      const { user, created } = await setUser(db, { username: arg, password, ...(isAdmin ? { role: 'admin', ...(exists ? {} : { displayName: 'Admin' }) } : {}) });
      console.log(`  ${created ? 'created' : 'new password for'} ${user.username}; every session of this account has ended`);
      break;
    }
    case 'rename': {
      const name = rest.join(' ').trim().replace(/\s+/g, ' ');
      if (!arg || !name || name.length > 60) fail('usage: rename <username> <display name, up to 60 characters>');
      const r = (await db.query('UPDATE users SET display_name = $2, updated_at = now() WHERE lower(username) = lower($1) RETURNING username, display_name', [arg, name])).rows[0];
      if (!r) fail(`no account named ${arg}`);
      console.log(`  ${r.username} is now shown as ${r.display_name}`);
      break;
    }
    case 'list': {
      const rows = (await db.query(
        `SELECT u.username, u.display_name, u.role, u.disabled, count(s.id) FILTER (WHERE s.expires_at > now())::int AS sessions
         FROM users u LEFT JOIN sessions s ON s.user_id = u.id GROUP BY u.id ORDER BY u.username`)).rows;
      for (const r of rows) console.log(`  ${r.username.padEnd(20)} ${r.display_name.padEnd(24)} ${r.role.padEnd(7)} ${r.disabled ? 'disabled' : 'active  '} ${r.sessions} session(s)`);
      if (!rows.length) console.log('  no accounts yet');
      break;
    }
    case 'disable':
    case 'enable': {
      if (!arg) fail(`usage: ${cmd} <username>`);
      const r = (await db.query('UPDATE users SET disabled = $2, updated_at = now() WHERE lower(username) = lower($1) RETURNING id, username', [arg, cmd === 'disable'])).rows[0];
      if (!r) fail(`no account named ${arg}`);
      if (cmd === 'disable') await db.query('DELETE FROM sessions WHERE user_id = $1', [r.id]);
      console.log(`  ${r.username} ${cmd}d`);
      break;
    }
    case 'sign-out': {
      if (!arg) fail('usage: sign-out <username>');
      const n = (await db.query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(username) = lower($1))', [arg])).rowCount;
      console.log(`  ended ${n} session(s) of ${arg}`);
      break;
    }
    default:
      console.log('  commands: set-user | set-password <name> | rename <name> <display name> | list | disable <name> | enable <name> | sign-out <name>');
      process.exitCode = cmd ? 1 : 0;
  }
} catch (err) {
  fail(err.message);
} finally {
  await db.close();
}
