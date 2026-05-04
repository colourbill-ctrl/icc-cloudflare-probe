# icc-cloudflare-probe

Minimal reproducer demonstrating that the public ICC profile registry at
**`registry.color.org/profile-registry/`** is currently gated by a
Cloudflare bot-challenge that blocks all non-browser HTTP clients
(Node, curl, wget, Python `requests`, etc.).

The challenge serves an HTML page that requires browser-side JavaScript
to compute a clearance cookie. No HTTP-only client can pass it.

## Run

Requires Node ≥ 18 (uses global `fetch`). Zero npm dependencies — no
`npm install` needed.

```
node probe.mjs
```

or

```
npm start
```

To probe a specific URL (e.g. an `.icc` profile file) instead of the
default index page:

```
node probe.mjs --url https://registry.color.org/profile-registry/<NAME>.icc
```

## What it does

Issues GET requests to one URL using a range of header sets:

1. Bare (no `User-Agent` override — Node's default)
2. curl-like (`curl/8.4.0`)
3. Firefox `User-Agent` only
4. Full Firefox header set (`User-Agent` + `Accept` + `Sec-Fetch-*` + …)

For each request it prints:

- HTTP status line
- Relevant Cloudflare response headers (`cf-ray`, `cf-mitigated`,
  `cf-cache-status`, `server`)
- The first 300 characters of the response body, whitespace-collapsed

Exit code `0` if any probe received an HTTP 2xx response; exit code `1`
otherwise. Useful for running this in CI to detect when the gate is
lifted.

## Expected output today

All four probes return identically:

```
HTTP 403 Forbidden
server          : cloudflare
cf-ray          : <ray id>
cf-mitigated    : challenge
content-type    : text/html; charset=UTF-8
body (first 300 chars, whitespace-collapsed):
  <!DOCTYPE html><html lang="en-US"><head> ... Just a moment ...
```

The `cf-mitigated: challenge` header is Cloudflare's marker for the
JS-challenge interstitial. The fact that probe (4) — which sends the
same headers a real Firefox would — also receives this response
confirms the block is not header-sniffing-based: the challenge
genuinely requires browser JS execution.

## Why this matters

ICC profile files published at `registry.color.org/profile-registry/`
are reference data for the colour-management ecosystem. Software that
wants to use those profiles programmatically — colour-management
applications, validators, mirrors, research and teaching tooling —
currently cannot fetch them over HTTP without a headless browser
(Puppeteer / Playwright) or an out-of-band copy.

If the registry is intended to be machine-consumable (which the
directory-listing format strongly implies), the bot-challenge gate
should be relaxed for that subdirectory, or for the host as a whole.

## License

MIT
