#!/usr/bin/env node
// Everything run from this PC against the VPS. Settings come from .local/deploy.local.json (gitignored):
//   { "sshHost": "<ssh alias>", "apiHost": "<public API host name>", "apiPort": 7360, "allowedOrigins": "https://..." }
//
//   node vps/local.mjs deploy [--allow-dirty]   stage api/ and vps/, copy over SSH, rebuild and restart the api
//   node vps/local.mjs publish                  install or refresh the public HTTPS address (deploy does this too)
//   node vps/local.mjs rotate-admin             new admin password, shown once
//   node vps/local.mjs show-admin               show the current admin password
//   node vps/local.mjs seed-users               create/update accounts from .secrets/users.local.json
//   node vps/local.mjs status                   containers, health, backups
//   node vps/local.mjs smoke                    end-to-end check on the box (as admin)
//   node vps/local.mjs smoke-public             end-to-end check through the public HTTPS address
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => { console.error(`  [x] ${msg}`); process.exit(1); };
const cfgPath = join(repo, '.local/deploy.local.json');
if (!existsSync(cfgPath)) fail('.local/deploy.local.json is missing (see the top of vps/local.mjs).');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const host = cfg.sshHost || fail('sshHost is missing in .local/deploy.local.json');
const port = Number(cfg.apiPort || 7360);

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: opts.input !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit', input: opts.input, cwd: opts.cwd || repo, encoding: 'utf8' });
  if (r.error) fail(`${cmd}: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) process.exit(r.status ?? 1);
  return r.status;
};
const capture = (cmd, args) => spawnSync(cmd, args, { cwd: repo, encoding: 'utf8' }).stdout.trim();
const remote = (command, opts) => run('ssh', [...(opts?.tty ? ['-t'] : ['-o', 'BatchMode=yes']), host, command], opts);

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'deploy': {
    const dirty = capture('git', ['status', '--porcelain', '--', 'api', 'vps', 'package.json', 'package-lock.json']);
    if (dirty && !rest.includes('--allow-dirty')) fail('uncommitted changes in api/ or vps/. Commit them, or pass --allow-dirty.');
    const label = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${capture('git', ['rev-parse', '--short', 'HEAD'])}${dirty ? '-dirty' : ''}`;
    const stage = mkdtempSync(join(tmpdir(), 'asanaka-deploy-'));
    try {
      // The release: what the api image builds from. Scripts get LF endings: they run on Linux.
      const app = join(stage, 'app');
      mkdirSync(join(app, 'web'), { recursive: true });
      mkdirSync(join(stage, 'vps'), { recursive: true });
      for (const f of ['package.json', 'package-lock.json']) writeFileSync(join(app, f), readFileSync(join(repo, f)));
      writeFileSync(join(app, 'web/package.json'), readFileSync(join(repo, 'web/package.json')));
      cpSync(join(repo, 'api'), join(app, 'api'), { recursive: true, filter: (src) => !/[\\/](node_modules|test)([\\/]|$)/.test(relative(repo, src)) });
      const lf = (f) => readFileSync(join(repo, 'vps', f), 'utf8').replace(/\r\n/g, '\n');
      mkdirSync(join(app, 'vps'), { recursive: true });
      writeFileSync(join(app, 'vps/Dockerfile.api'), lf('Dockerfile.api'));
      // tar and scp run inside the stage with relative paths: Git Bash's versions read "C:\..." as a remote host.
      run('tar', ['-czf', 'app.tgz', '-C', 'app', '.'], { cwd: stage });
      for (const f of ['docker-compose.yml', 'asanaka', 'backup.sh', 'remote-deploy.sh', 'site-sync.sh']) writeFileSync(join(stage, 'vps', f), lf(f));
      writeFileSync(join(stage, 'vps/asanaka.caddy'), lf('asanaka.caddy.template').replaceAll('{{API_HOST}}', cfg.apiHost).replaceAll('{{API_PORT}}', String(port)));

      console.log(`  deploying ${label} to ${host}`);
      remote('rm -rf ~/asanaka-incoming && mkdir -p ~/asanaka-incoming');
      run('scp', ['-q', '-r', 'app.tgz', 'vps', `${host}:asanaka-incoming/`], { cwd: stage });
      remote(`bash ~/asanaka-incoming/vps/remote-deploy.sh '${label}' ${port} '${cfg.allowedOrigins || 'https://fishbill88.github.io'}'`);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
    break;
  }
  case 'publish':
    remote('~/asanaka/site-sync.sh');
    break;
  case 'rotate-admin':
    remote('~/asanaka/asanaka admin-password --rotate');
    break;
  case 'show-admin':
    remote('~/asanaka/asanaka admin-password --show');
    break;
  case 'seed-users': {
    const f = join(repo, '.secrets/users.local.json');
    if (!existsSync(f)) fail('.secrets/users.local.json is missing.');
    const users = JSON.parse(readFileSync(f, 'utf8'));
    for (const u of users) {
      // The password travels on stdin inside the JSON, never on a command line.
      run('ssh', ['-o', 'BatchMode=yes', host, '~/asanaka/asanaka set-user'], { input: JSON.stringify(u) });
    }
    break;
  }
  case 'status':
    remote('~/asanaka/asanaka status');
    break;
  case 'smoke':
    remote('~/asanaka/asanaka smoke');
    break;
  case 'smoke-public': {
    const pass = spawnSync('ssh', ['-o', 'BatchMode=yes', host, 'cat ~/asanaka/.admin-password'], { encoding: 'utf8' }).stdout.trim();
    if (!pass) fail('could not read the admin password from the box.');
    run(process.execPath, [join(repo, 'api/tools/smoke.mjs'), `https://${cfg.apiHost}`], { input: JSON.stringify({ username: 'admin', password: pass }) });
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n'));
    process.exitCode = cmd ? 1 : 0;
}
