#!/usr/bin/env node
//
// icc-cloudflare-probe
//
// Cross-client diagnostic for the Cloudflare bot rule sitting in front of
// registry.color.org. Probes one URL with each of curl, wget, python urllib,
// and Node fetch (whichever are installed), in two modes: default headers
// and with a Firefox User-Agent override. Reports a per-client status table.
//
// The bot rule on this hostname is volatile — the same probe's results have
// shifted between "every client gets 403" and "almost every client gets 200"
// within a single day. The point of this tool is to give a date-stamped
// snapshot of which clients fail right now, plus a record (in the README)
// of what the rule has done historically.
//
// Usage:
//   node probe.mjs                 # default URL, all available clients
//   node probe.mjs --url <URL>     # probe a specific URL instead
//   node probe.mjs --help

import { spawnSync } from 'node:child_process';

const DEFAULT_URL = 'https://registry.color.org/profile-registry/';
const FIREFOX_UA  = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0';
const TIMEOUT_S   = 20;

const CLIENTS = [
  { name: 'curl',          probe: curlProbe         },
  { name: 'wget',          probe: wgetProbe         },
  { name: 'python urllib', probe: pythonUrllibProbe },
  { name: 'node fetch',    probe: nodeFetchProbe    }
];

const args = parseArgs(process.argv.slice(2));
if (args.help) { printHelp(); process.exit(0); }
const url = args.url ?? DEFAULT_URL;

console.log(`Target URL : ${url}`);
console.log(`Probed at  : ${new Date().toISOString()}`);
console.log('');

const rows = [];
for (const client of CLIENTS) {
  const available = client.probe(url, null, /* detectOnly */ true);
  if (!available) {
    rows.push({ name: client.name, available: false });
    continue;
  }
  const def = client.probe(url, null);
  const fox = client.probe(url, FIREFOX_UA);
  rows.push({ name: client.name, available: true, def, fox });
}

const NAME_W = Math.max(...CLIENTS.map((c) => c.name.length), 'Client'.length);
const COL    = 14;
console.log(`${'Client'.padEnd(NAME_W)}    ${'Default'.padEnd(COL)}${'Firefox UA'.padEnd(COL)}`);
console.log(`${'-'.repeat(NAME_W)}    ${'-'.repeat(COL - 2).padEnd(COL)}${'-'.repeat(COL - 2).padEnd(COL)}`);
for (const r of rows) {
  if (!r.available) {
    console.log(`${r.name.padEnd(NAME_W)}    (not installed)`);
    continue;
  }
  console.log(`${r.name.padEnd(NAME_W)}    ${fmt(r.def).padEnd(COL)}${fmt(r.fox).padEnd(COL)}`);
}
console.log('');

const availableRows = rows.filter((r) => r.available);
const anyBlocked    = availableRows.some((r) => !is2xx(r.def));
const allBlocked    = availableRows.every((r) => !is2xx(r.def) && !is2xx(r.fox));

if (allBlocked) {
  console.log('Verdict: every available client was blocked, including with a Firefox User-Agent.');
  process.exit(1);
}
if (anyBlocked) {
  console.log('Verdict: at least one client is blocked with default settings.');
  console.log('         The bot rule on this hostname is currently selective rather than blanket.');
  process.exit(1);
}
console.log('Verdict: all available clients fetched the URL with default settings.');
console.log('         The bot rule on this hostname is currently inactive (or scoring lenient).');
process.exit(0);

// ─── Probes ────────────────────────────────────────────────────────────────

function curlProbe(url, ua, detectOnly) {
  if (detectOnly) return cmdAvailable('curl', ['--version']);
  const cmdArgs = ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', String(TIMEOUT_S)];
  if (ua) cmdArgs.push('-A', ua);
  cmdArgs.push(url);
  const r = spawnSync('curl', cmdArgs, { encoding: 'utf8' });
  return (r.stdout || '').trim() || 'ERR';
}

function wgetProbe(url, ua, detectOnly) {
  if (detectOnly) return cmdAvailable('wget', ['--version']);
  const cmdArgs = ['-q', '-O', '/dev/null', '--server-response', `--timeout=${TIMEOUT_S}`];
  if (ua) cmdArgs.push(`--user-agent=${ua}`);
  cmdArgs.push(url);
  const r = spawnSync('wget', cmdArgs, { encoding: 'utf8' });
  // wget --server-response prints HTTP status lines to stderr; grab the
  // first one (the URL itself isn't redirected to a different status path).
  const m = (r.stderr || '').match(/HTTP\/[\d.]+\s+(\d+)/);
  return m ? m[1] : 'ERR';
}

function pythonUrllibProbe(url, ua, detectOnly) {
  if (detectOnly) return cmdAvailable('python3', ['--version']);
  const headersExpr = ua ? `, headers={'User-Agent': ${JSON.stringify(ua)}}` : '';
  const code = `import urllib.request as u, urllib.error as e
try:
    req = u.Request(${JSON.stringify(url)}${headersExpr})
    print(u.urlopen(req, timeout=${TIMEOUT_S}).status)
except e.HTTPError as ex:
    print(ex.code)
except Exception:
    print('ERR')`;
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
  return (r.stdout || '').trim() || 'ERR';
}

function nodeFetchProbe(url, ua, detectOnly) {
  if (detectOnly) return cmdAvailable('node', ['--version']);
  const opts = ua
    ? `{ headers: { 'User-Agent': ${JSON.stringify(ua)} }, signal: AbortSignal.timeout(${TIMEOUT_S * 1000}) }`
    : `{ signal: AbortSignal.timeout(${TIMEOUT_S * 1000}) }`;
  const code = `fetch(${JSON.stringify(url)}, ${opts}).then((r) => console.log(r.status)).catch(() => console.log('ERR'))`;
  const r = spawnSync('node', ['-e', code], { encoding: 'utf8' });
  return (r.stdout || '').trim() || 'ERR';
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function cmdAvailable(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0;
}

function is2xx(code) {
  const n = Number(code);
  return Number.isFinite(n) && n >= 200 && n < 300;
}

function fmt(code) {
  if (is2xx(code)) return `${code} OK`;
  if (code === 'ERR') return 'network err';
  return String(code);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function printHelp() {
  console.log(`icc-cloudflare-probe — cross-client diagnostic for registry.color.org

Probes ${DEFAULT_URL} (or --url) with each available client (curl, wget,
python urllib, node fetch), with default headers and again with a Firefox
User-Agent. Prints a per-client status table.

Usage:
  node probe.mjs                  Probe the default URL with all available clients
  node probe.mjs --url <URL>      Probe a specific URL instead
  node probe.mjs --help           This help

Default URL: ${DEFAULT_URL}

Exit code:
  0  all available clients fetched with default settings
  1  at least one client was blocked
`);
}
