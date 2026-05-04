# Adding JSON support to the ICC registries

### A proposal for the PAWG and COMMS working groups

**Author:** William Li
**Date:** 2026-05-04

---

## Why I'm writing

I maintain a browser-based ICC profile editor that
wants to read the public ICC profile registry to populate its built-in
profile library. While building it I ran into two related issues:

1. The registry has no machine-readable surface, so consumers have to
   parse HTML and guess at download links.
2. Even at HTTP level, access is unreliable. A Cloudflare bot rule on
   `registry.color.org` blocks some clients (Python `urllib`'s default
   User-Agent at minimum) and during the development of the probe its
   behaviour shifted substantially within a single day — from "every
   non-browser client returns HTTP 403 with `cf-mitigated: challenge`"
   to "almost everything passes; only Python's default UA is flagged."
   A cross-client diagnostic and a date-stamped record of observed rule
   behaviour is published at
   [`colourbill-ctrl/icc-cloudflare-probe`](https://github.com/colourbill-ctrl/icc-cloudflare-probe).

In a recent exchange with Adam Dewitz, the suggested
direction was to expose JSON endpoints with the registry metadata plus
asset URLs. This proposal fleshes that direction out into something
concrete enough for the PAWG and COMMS working groups to review.

## What I'm proposing, in one paragraph

Publish each registry entry as a small JSON file next to its existing
HTML page. Add one index JSON per registry, and one top-level catalogue
JSON listing the registries on the host. Define and publish a small set
of JSON Schema files describing the format. Make sure these JSON files
(and the assets they reference) are CORS-enabled and exempt from the
bot challenge. Done. The static-site model the registry already uses
doesn't change.

## What this enables

A few concrete consumer scenarios that are blocked or impractical today:

- **A colour-management application** can fetch the profile registry
  index at startup, filter to the device-spaces it cares about, and
  pre-populate its profile library with verified bytes — without ever
  scraping HTML or shipping a stale snapshot in its installer.

- **A validator or conformance test suite** can iterate over every
  characterization data entry, fetch the CGATS file, run measurement
  consistency checks, and report results — useful both for the ICC's
  own quality assurance and for downstream toolmakers.

- **Browser-based tools and other CDN consumers** can rely on stable
  HTTP-level access. Today the bot-mitigation rule on the host is
  selective and (as observed) volatile, so a consumer that built
  against today's behaviour may break the next time the rule
  re-tightens. A permanent path-based exemption fixes this.

- **Mirrors and academic research** can crawl efficiently against a
  known schema rather than reverse-engineering whatever HTML structure
  the build happens to emit this month.

In every case the cost to the ICC is the same: emit JSON alongside
HTML.

## How it would work

The proposal uses three layers of JSON, all of which are static files
emitted by the existing build process.

### Layer 1 — a JSON file per entry

Each entry in the registry gets a sibling JSON file. For the existing
ECI_FOGRA39 profile entry the JSON would look like (abridged):

```json
{
  "id":            "ECI_FOGRA39",
  "name":          "Coated FOGRA39 (ISO 12647-2:2004)",
  "submitter":     { "name": "European Color Initiative", "url": "https://www.eci.org" },
  "submittedDate": "2007-04-12",
  "lastModified":  "2018-09-03",
  "license":       { "spdxId": "CC-BY-4.0" },
  "assets": [
    {
      "role":       "icc-profile",
      "url":        "ECI_FOGRA39.icc",
      "byteLength": 553208,
      "sha256":     "e3b0c44298..."
    }
  ],
  "details": {
    "deviceSpace":  "CMYK",
    "pcs":          "Lab",
    "profileClass": "prtr"
  }
}
```

A consumer can read everything they need to download and verify the
asset without parsing any HTML. The `sha256` hash is part of the
contract: consumers can cache aggressively and detect drift.

### Layer 2 — an index JSON per registry

`/profile-registry/index.json` lists every entry in that registry with
just enough information to decide whether to fetch the per-entry JSON:

```json
{
  "registry": "profile",
  "count":    42,
  "entries": [
    {
      "id":           "ECI_FOGRA39",
      "url":          "ECI_FOGRA39.json",
      "name":         "Coated FOGRA39 (ISO 12647-2:2004)",
      "type":         "profile",
      "lastModified": "2018-09-03"
    }
  ]
}
```

This is the layer that fixes discovery. Without it, a consumer wanting
to enumerate the registry has to crawl HTML to find what entries exist.
With it, one fetch yields the whole list.

### Layer 3 — a top-level catalogue

`/index.json` lists the registries the site publishes. Useful for
consumers that want to discover registries without prior knowledge, or
for future expansion (additional registry types).

### Schemas

Five JSON Schema files, hand-authored once and published under
`/schemas/`:

- A common envelope schema (`registry-entry-v1.json`) defining the
  shared fields across all registry entries.
- Per-registry extensions (`profile-entry-v1.json`,
  `characterization-entry-v1.json`) that constrain the `details` field
  for that registry's specific data shape.
- Two more covering the index and catalogue file formats.

Each emitted JSON declares which schema it was built against via the
standard `$schema` field. Consumers can validate strictly or loosely
depending on their needs.

The schema-design choice — common envelope plus per-type details — is
deliberate: it means a generic mirror or asset-downloader doesn't need
to know about ICC profiles versus characterization data, while a
specialised tool can validate the `details` field against its
registry's specific schema. Adding a third or fourth registry type
later costs no changes to the generic consumers.

## Cross-cutting requirements

A few things that are easy to forget but blocking for real consumers:

1. **CORS.** Browser-based tools cannot fetch JSON without
   `Access-Control-Allow-Origin: *`. This needs to be set on both the
   JSON files and the asset files. Cheap one-line config change at the
   CDN.

2. **Permanent bot-mitigation exemption for JSON + asset paths.**
   Cloudflare's bot rule on the host is volatile (see the probe's
   history table). Even if today's rule is lenient, a consumer built
   against today's behaviour may break the next time scoring tightens.
   The ICC should commit to a permanent path-based exemption for
   `*.json` and asset paths, so the JSON API has a stable HTTP-level
   contract. (HTML paths could remain bot-gated if the working groups
   prefer — this proposal doesn't require lifting the rule entirely.)

3. **Asset integrity.** Each asset URL is published with a SHA-256 hash.
   This is the contract that makes mirrors safe to trust.

4. **Stable Content-Type.** ICC profile files served with the
   registered `application/vnd.iccprofile` (RFC 3839); CGATS as
   `text/cgats`; JSON as `application/json`.

## What this asks of the ICC

The build pipeline today reads CSV+YAML and emits HTML. The change is
to emit JSON in parallel. Concretely:

- ~150 LOC of Python added to the existing build script.
- One pass to compute SHA-256 over each referenced asset at build time
  (cacheable against mtime).
- Five JSON Schema files authored once.
- One Cloudflare configuration change for CORS and a permanent
  path-based bot-mitigation exemption.

No runtime infrastructure. No new dependencies. No change to where data
lives, who owns it, or how submissions work. The HTML pages remain
authoritative for human readers; the JSON layer is purely additive.

A working prototype could be done by one developer in a few days,
including the schema authoring and a worked example with real data.

## Versioning

JSON Schemas carry their major version in the filename
(`profile-entry-v1.json`). Additive changes within a major version are
fine. Breaking changes bump the major and the old schema URL stays live
indefinitely — they're static files; the disk cost is negligible.

A migration window of at least six months and a parallel publication of
v1 and v2 should precede any breaking change, so consumers have time to
update.

## Open questions

The proposal leaves several deliberate gaps for the working groups to
decide:

- **Which fields are normative.** The current HTML pages surface some
  fields more prominently than others. The working groups should agree
  which fields are part of the contract versus which are extension
  fields.

- **License metadata format.** SPDX identifiers are the modern norm,
  but the registries' historical license terms are diverse — a
  free-text URL might be more honest. Or both: SPDX where possible,
  URL otherwise.

- **Treatment of withdrawn entries.** Keep them live with a
  `"withdrawn": true` field, or remove them and serve `410 Gone`? My
  recommendation is the former (matches the static-site model and
  preserves bookmarks).

- **Historical changelog.** Should the per-entry JSON include the
  history of edits to that entry, or just the current state? My
  recommendation: just current state, with `lastModified`. If history
  matters it can come later.

- **Top-level catalogue path.** `/index.json` is convenient but might
  collide with a future site-root use. Alternatives: `/registries.json`
  or `/.well-known/icc-registries.json` (formal but standards-compliant).

## What I'm asking for

If the working groups are receptive, I'd like to:

1. Iterate on this proposal based on WG feedback (substance, not just
   wording).
2. Author the JSON Schema files and contribute them as a PR against the
   registry source repository.
3. Provide a worked example with the existing ECI_FOGRA39 data so the
   JSON output can be reviewed alongside the current HTML.

The bot-mitigation volatility is a precondition for any of this being
useful — committing to a permanent path-based exemption (for `*.json`
and asset paths) needs to happen first or in parallel, regardless of
whether the JSON proposal otherwise moves forward. The
icc-cloudflare-probe repository contains the cross-client diagnostic
and a date-stamped record of observed rule behaviour.

I'd welcome the chance to present this in either working group's next
meeting.

## References

- **icc-cloudflare-probe** (Cloudflare blocking reproducer):
  https://github.com/colourbill-ctrl/icc-cloudflare-probe
- **JSON Schema draft 2020-12**:
  https://json-schema.org/draft/2020-12/release-notes.html
- **RFC 3839** (`application/vnd.iccprofile`):
  https://www.rfc-editor.org/rfc/rfc3839
