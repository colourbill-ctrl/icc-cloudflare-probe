#!/usr/bin/env node
//
// icc-cloudflare-probe
//
// Minimal reproducer demonstrating that the public ICC profile registry at
// registry.color.org is currently gated by a Cloudflare bot-challenge that
// blocks all non-browser HTTP clients.
//
// Issues GET requests to a single URL with several different header sets and
// prints the HTTP status + relevant Cloudflare response headers + a body
// snippet. Exits non-zero if no probe was able to fetch the URL with HTTP 2xx.
//
// Usage:
//   node probe.mjs                  # default URL
//   node probe.mjs --url <URL>      # probe a specific URL instead
//   node probe.mjs --help

const DEFAULT_URL = 'https://registry.color.org/profile-registry/';

const PROBES = [
  {
    label:   'bare (no User-Agent override)',
    headers: {}
  },
  {
    label:   'curl-like',
    headers: { 'User-Agent': 'curl/8.4.0' }
  },
  {
    label:   'Firefox UA only',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0'
    }
  },
  {
    label:   'full Firefox header set',
    headers: {
      'User-Agent':                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
      'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language':           'en-US,en;q=0.5',
      'Accept-Encoding':           'gzip, deflate, br',
      'DNT':                       '1',
      'Connection':                'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest':            'document',
      'Sec-Fetch-Mode':            'navigate',
      'Sec-Fetch-Site':            'none',
      'Sec-Fetch-User':            '?1'
    }
  }
];

const RELEVANT_HEADERS = [
  'server',
  'cf-ray',
  'cf-mitigated',
  'cf-cache-status',
  'content-type',
  'content-length'
];

const REQUEST_DELAY_MS = 500;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}
const url = args.url ?? DEFAULT_URL;

console.log(`Target URL : ${url}`);
console.log(`Probed at  : ${new Date().toISOString()}`);
console.log(`Probe count: ${PROBES.length}`);
console.log('');

let okCount = 0;
for (let i = 0; i < PROBES.length; i++) {
  if (i > 0) await sleep(REQUEST_DELAY_MS);
  const ok = await runProbe(url, PROBES[i]);
  if (ok) okCount++;
}

console.log(`Summary: ${okCount}/${PROBES.length} probe(s) received HTTP 2xx`);
process.exit(okCount === 0 ? 1 : 0);

// ─── Probe ──────────────────────────────────────────────────────────────────

async function runProbe(url, probe) {
  console.log(`==> ${probe.label}`);
  let response;
  try {
    response = await fetch(url, { headers: probe.headers });
  } catch (err) {
    console.log(`    network error: ${err.message}`);
    console.log('');
    return false;
  }
  console.log(`    HTTP ${response.status} ${response.statusText}`);
  for (const h of RELEVANT_HEADERS) {
    const v = response.headers.get(h);
    if (v) console.log(`    ${h.padEnd(16)}: ${v}`);
  }
  const text = await response.text().catch(() => '');
  const snippet = text.slice(0, 300).replace(/\s+/g, ' ').trim();
  if (snippet) {
    console.log(`    body (first 300 chars, whitespace-collapsed):`);
    console.log(`      ${snippet}${text.length > 300 ? ' …' : ''}`);
  }
  console.log('');
  return response.status >= 200 && response.status < 300;
}

// ─── Misc ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  console.log(`icc-cloudflare-probe — demonstrate Cloudflare blocking on registry.color.org

Usage:
  node probe.mjs                  Probe the default URL with several header sets
  node probe.mjs --url <URL>      Probe a specific URL instead
  node probe.mjs --help           This help

Default URL: ${DEFAULT_URL}

Requires Node >= 18 (uses global fetch).

Exit code:
  0  at least one probe successfully fetched the URL (HTTP 2xx)
  1  no probe got through (typically because of the Cloudflare challenge)
`);
}
