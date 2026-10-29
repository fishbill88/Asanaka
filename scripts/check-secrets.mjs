#!/usr/bin/env node
// Refuses commits that would publish a secret. The repo is public, so anything sensitive stays local.
//
//   node scripts/check-secrets.mjs          check what is staged (the pre-commit hook runs this)
//   node scripts/check-secrets.mjs --all    check every tracked file (CI runs this)
//
// A line that must keep a flagged pattern for a real reason can carry the comment "secret-scan: allow".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const all = process.argv.includes('--all');
const git = (...args) => execFileSync('git', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });

// Files that hold secrets by design: never committed, whatever they contain.
const FORBIDDEN_PATHS = [
  [/(^|\/)\.env(\.(?!example$)[^/]+)?$/, 'environment file'],
  [/(^|\/)\.secrets\//, 'local secrets folder'],
  [/(^|\/)\.local\//, 'local notes folder'],
  [/(^|\/)[^/]*\.local\.[^/]+$/, 'a *.local.* file'],
  [/\.(pem|key|p12|pfx)$/i, 'key or certificate file'],
  [/(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/, 'SSH key'],
];

const PRIVATE_V4 = (a, b) => a === 10 || a === 127 || a === 0 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
const CONTENT_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b(password|passwd|secret|token|api[_-]?key)\b["']?\s*[:=]\s*["'][^"'\s]{6,}["']/i, 'password or key written into the code'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\b\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\.(sslip|nip)\.io\b/i, 'server address (IP-based hostname)'],
  [/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/, 'public IP address', (m) => {
    const [a, b, c, d] = m.slice(1).map(Number);
    return [a, b, c, d].every((n) => n <= 255) && !PRIVATE_V4(a, b);
  }],
];

// Passwords kept in the local secrets file must never appear anywhere in the repo, in any form of file.
function localPasswords() {
  const f = '.secrets/users.local.json';
  if (!existsSync(f)) return [];
  try {
    const users = JSON.parse(readFileSync(f, 'utf8'));
    return (Array.isArray(users) ? users : Object.values(users)).map((u) => u?.password).filter((p) => typeof p === 'string' && p.length >= 4);
  } catch { return []; }
}

const files = all
  ? git('ls-files', '-z').toString('utf8').split('\0').filter(Boolean)
  : git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').toString('utf8').split('\0').filter(Boolean);

const passwords = localPasswords();
const findings = [];
for (const path of files) {
  const forbidden = FORBIDDEN_PATHS.find(([re]) => re.test(path));
  if (forbidden) { findings.push(`${path}: ${forbidden[1]} must stay local`); continue; }

  let buf;
  try { buf = all ? readFileSync(path) : git('show', `:${path}`); } catch { continue; }
  for (const p of passwords) if (buf.includes(Buffer.from(p))) findings.push(`${path}: contains a password from .secrets/users.local.json`);
  if (buf.length > 4 * 1024 * 1024 || buf.subarray(0, 8000).includes(0)) continue; // binary or very large: path and password checks only

  // Embedded fonts and images (data: URIs) are long base64 runs that only produce noise.
  const lines = buf.toString('utf8').replace(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:…').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes('secret-scan: allow')) return;
    for (const [re, label, accept] of CONTENT_RULES) {
      const m = line.match(re);
      if (m && (!accept || accept(m))) findings.push(`${path}:${i + 1}: ${label}`);
    }
  });
}

if (findings.length) {
  console.error('\n  [x] Secret check refused this ' + (all ? 'tree' : 'commit') + ':\n');
  for (const f of findings) console.error('      ' + f);
  console.error('\n      Keep secrets in .secrets/ or .local/ (both gitignored). If a line is a false alarm,');
  console.error('      add the comment "secret-scan: allow" to it.\n');
  process.exit(1);
}
console.log(`  secret check: ${files.length} file(s) clean`);
