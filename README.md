# icc-cloudflare-probe

Cross-client diagnostic for the Cloudflare bot rule sitting in front of
the public ICC profile registry at **`registry.color.org/profile-registry/`**.

The rule on this hostname is **volatile** — its behaviour has shifted
substantially within the span of a single day during the development of
this very tool (see [history](#observed-history) below). Today's
pass-list is not necessarily tomorrow's. The point of this probe is to
give a date-stamped snapshot of which standard HTTP clients fail
*right now*, plus a record of what the rule has done historically.

## Run

Requires Node ≥ 18. Zero npm dependencies. Optionally also detects and
shells out to `curl`, `wget`, and `python3` if they're on `PATH` —
each is independently optional, the probe just skips the rows for any
that aren't installed.

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

Issues two GET requests per available client to the target URL:

1. **Default** headers (whatever the client sends out of the box).
2. **Firefox User-Agent** override (a current Firefox UA string).

Clients tested: `curl`, `wget`, Python `urllib`, Node `fetch`.

For each client × header-set combination, the probe records the HTTP
status code and prints a per-client table.

Exit code `1` if at least one available client is blocked from default
access; exit code `0` if every available client fetched the URL with
default settings.

## Example output

A run on **2026-05-04T20:24Z** produced:

```
Target URL : https://registry.color.org/profile-registry/
Probed at  : 2026-05-04T20:24:54.320Z

Client           Default       Firefox UA
-------------    ------------  ------------
curl             200 OK        200 OK
wget             200 OK        200 OK
python urllib    403           200 OK
node fetch       200 OK        200 OK

Verdict: at least one client is blocked with default settings.
         The bot rule on this hostname is currently selective rather than blanket.
```

## Observed history

The rule's behaviour over the period this probe has been in use:

| Date (UTC)            | Behaviour observed                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------- |
| 2026-05-04 ~18:16Z    | Blanket block — every Node-fetch probe (no UA, curl-UA, Firefox UA, full Firefox headers) returned `HTTP 403` + `cf-mitigated: challenge`. |
| 2026-05-04 ~20:20Z    | Mostly relaxed — `curl`, `wget`, Node `fetch`, and Python `urllib` *with* a non-default UA all returned `200`. Only Python `urllib`'s default UA (`Python-urllib/3.X`) was still blocked. |

The two observations are roughly **two hours apart**, on the same IP,
with no coordination on either side. The earlier behaviour was a
`cf-mitigated: challenge` JS-interstitial that no HTTP-only client
could pass; the later behaviour is selective UA-string flagging only.

## Why this matters

ICC profile files published at `registry.color.org/profile-registry/`
are reference data for the colour-management ecosystem. Software that
wants to use those profiles programmatically — colour-management
applications, validators, mirrors, research and teaching tooling —
needs predictable HTTP-level access.

The volatility shown above is the operational risk: even if today's
rule lets most clients through, a consumer that built against today's
behaviour may break the next time the rule tightens. A registry that's
contractually a programmatic data source needs **stable, contractual
exemption** from bot mitigation for at least the JSON-API and asset
paths — not "currently lenient scoring."

A draft enhancement proposal for adding a JSON API to the registries,
together with a permanent bot-rule exemption for those paths, lives in
the `proposals/` directory of this repo.

## License

MIT
