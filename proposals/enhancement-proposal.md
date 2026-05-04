# Adding JSON support to the ICC profile and characterization data registries

**Status:** Draft for working-group review (PAWG / COMMS)
**Author:** William Li
**Date:** 2026-05-04

## Summary

Publish each registry entry as a machine-readable JSON document alongside
the existing HTML page, and add a per-registry index JSON plus a top-level
catalogue JSON. This turns the ICC registries into a typed, discoverable
static API without changing the registry data sources or the deployment
topology.

The change is additive: HTML pages remain authoritative for human readers.
JSON endpoints serve programmatic consumers (colour-management software,
validators, mirrors, research tools) that today have no choice but to
scrape.

## Motivation

The registries at `registry.color.org/profile-registry/` and
`registry.color.org/characterization-registry/` are reference data for
the colour-management ecosystem. Several classes of consumer would
benefit from machine-readable access:

- Colour-management applications wanting to bundle or update profiles.
- Validators, conformance test suites, and academic research code.
- Mirrors and aggregators (the current ad-hoc workflow is "scrape the
  HTML, hope the layout doesn't change").
- Browser-based tools and other CDN consumers, whose HTTP-level access
  to the registry today is gated by a Cloudflare bot rule whose
  behaviour is observably volatile — the same diagnostic probe shifted
  from "every Node-fetch attempt blocked with `cf-mitigated: challenge`"
  to "most clients pass; only Python's default urllib UA is flagged"
  within roughly two hours on the same IP, with no coordination on
  either side. See
  [`colourbill-ctrl/icc-cloudflare-probe`](https://github.com/colourbill-ctrl/icc-cloudflare-probe)
  for the cross-client diagnostic and a date-stamped record of observed
  rule behaviour.

A JSON API removes the scraping requirement and gives consumers a
stable contract.

This proposal builds on a direction suggested by Adam Dewitz of the
registry administration: expose a JSON endpoint per registry entry,
containing the primary metadata plus URLs for related assets. The
sections below specify endpoint structure, schema, and the cross-cutting
requirements (CORS, asset integrity, bot-challenge exemption) that
should accompany the format.

## Design overview

Three endpoint layers, all static files emitted by the existing build:

| Layer | Path                          | Purpose                                                  |
| ----- | ----------------------------- | -------------------------------------------------------- |
| 1     | `/<registry>/<entry-id>.json` | Per-entry payload with metadata and asset URLs           |
| 2     | `/<registry>/index.json`      | Registry index — list of entries with summary fields     |
| 3     | `/index.json`                 | Top-level catalogue — list of registries on the host     |

Layer 1 alone reproduces the discovery problem we have today (you have
to crawl HTML to find the entries). Layer 2 fixes that with one fetch.
Layer 3 lets consumers discover what registries exist without prior
knowledge.

## Schema strategy

A common envelope schema with type-specific extensions, rather than one
flat schema per registry that duplicates common fields.

### Schema files (published under `/schemas/`)

| Schema                           | Purpose                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `registry-entry-v1.json`         | Common envelope: id, name, submitter, dates, license, assets, documentation, details |
| `profile-entry-v1.json`          | Extends envelope; constrains `details` for ICC profile entries                 |
| `characterization-entry-v1.json` | Extends envelope; constrains `details` for characterization data entries       |
| `registry-index-v1.json`         | Schema for layer-2 index files                                                 |
| `registry-catalogue-v1.json`     | Schema for layer-3 catalogue                                                   |

JSON Schema draft 2020-12. Each emitted JSON declares its `$schema` so
consumers can validate.

### Why envelope + typed details (not flat-per-registry)

- **Generic tooling.** A registry browser, asset downloader, or mirror
  that doesn't care about colour-science specifics works against the
  envelope alone. Adding a third or fourth registry type costs the
  generic tooling zero changes.
- **Sharable validation.** License, submitter, asset integrity, dates —
  defined and validated once.
- **Future-proof.** New registry types (a gamut volume registry, a
  measurement-condition registry, …) drop in by writing one new
  `*-entry-v1.json` schema for the `details` payload.

## Endpoint shapes

### Per-entry JSON (layer 1)

```json
{
  "$schema":      "https://registry.color.org/schemas/profile-entry-v1.json",
  "id":           "ECI_FOGRA39",
  "type":         "profile",
  "name":         "Coated FOGRA39 (ISO 12647-2:2004)",
  "registryUrl":  "https://registry.color.org/profile-registry/ECI_FOGRA39",
  "submitter": {
    "name": "European Color Initiative",
    "url":  "https://www.eci.org"
  },
  "submittedDate": "2007-04-12",
  "lastModified":  "2018-09-03",
  "license": {
    "spdxId": "CC-BY-4.0",
    "url":    "https://creativecommons.org/licenses/by/4.0/"
  },
  "documentation": [
    {
      "url":       "ECI_FOGRA39.pdf",
      "title":     "Submission notes",
      "mediaType": "application/pdf"
    }
  ],
  "assets": [
    {
      "role":       "icc-profile",
      "url":        "ECI_FOGRA39.icc",
      "mediaType":  "application/vnd.iccprofile",
      "byteLength": 553208,
      "sha256":     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "role":       "characterization-data",
      "url":        "ECI_FOGRA39.txt",
      "mediaType":  "text/cgats",
      "byteLength": 84321,
      "sha256":     "a7cf3c..."
    }
  ],
  "details": {
    "deviceSpace":  "CMYK",
    "pcs":          "Lab",
    "profileClass": "prtr",
    "iccVersion":   "2.4.0"
  }
}
```

URLs in `assets[]` and `documentation[]` are **relative to the per-entry
JSON's location**, so mirrors don't need to rewrite content. Consumers
resolve against the document URL using standard URL resolution.

### Registry index (layer 2)

```json
{
  "$schema":   "https://registry.color.org/schemas/registry-index-v1.json",
  "registry":  "profile",
  "title":     "ICC Profile Registry",
  "generated": "2026-05-04T12:00:00Z",
  "baseUrl":   "https://registry.color.org/profile-registry/",
  "count":     42,
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

42 entries → ~6 KB. Even at 10× growth still trivially small as a
single file. Pagination is not warranted at current scale; if it ever
is, a `next` link in standard JSON:API / RFC 5988 form can be added
without breaking existing consumers.

### Top-level catalogue (layer 3)

```json
{
  "$schema":   "https://registry.color.org/schemas/registry-catalogue-v1.json",
  "title":     "ICC Registries",
  "generated": "2026-05-04T12:00:00Z",
  "registries": [
    {
      "id":          "profile",
      "title":       "ICC Profile Registry",
      "url":         "https://registry.color.org/profile-registry/",
      "indexUrl":    "https://registry.color.org/profile-registry/index.json",
      "entrySchema": "https://registry.color.org/schemas/profile-entry-v1.json"
    },
    {
      "id":          "characterization",
      "title":       "Characterization Data Registry",
      "url":         "https://registry.color.org/characterization-registry/",
      "indexUrl":    "https://registry.color.org/characterization-registry/index.json",
      "entrySchema": "https://registry.color.org/schemas/characterization-entry-v1.json"
    }
  ]
}
```

## Cross-cutting requirements

These are easy to overlook but blocking for real consumers.

### CORS

All `*.json` and asset URLs MUST serve `Access-Control-Allow-Origin: *`.
Without it, browser-based consumers cannot fetch from the registry
directly.

### Bot-mitigation exemption (permanent commitment)

Cloudflare's bot rules in front of `registry.color.org` are observably
volatile — see the cross-client probe for date-stamped runs. Rule
behaviour has shifted from "blanket-403 with `cf-mitigated: challenge`"
to "selective UA-string flagging only" within hours, on the same IP,
without coordination. Today's pass-list is not necessarily tomorrow's.

For a registry that is contractually a programmatic data source, the
ICC SHOULD commit to **permanently exempting** the following paths
from any bot mitigation, regardless of how the rule is otherwise tuned:

- All `*.json` paths.
- All asset paths (`*.icc`, `*.icm`, `*.txt`, `*.pdf`, …).

The argument is reliability, not "we're blocked right now." Even if
the current rule is lenient, a consumer that built against today's
behaviour breaks the next time scoring tightens. Stable contractual
access is what the JSON API needs to be useful at all.

If a bot challenge is needed elsewhere on the host, restricting it to
HTML paths is sufficient.

### Content-Type

| Path             | Content-Type                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| `*.json`         | `application/json`                                                          |
| `*.icc`, `*.icm` | `application/vnd.iccprofile` (RFC 3839)                                     |
| CGATS data       | `text/cgats; charset=us-ascii` (or `text/plain` if CGATS is not registered) |
| `*.pdf`          | `application/pdf`                                                           |

### Asset integrity

Each asset entry includes a `sha256` field, computed at build time.
This lets consumers verify bytes without trusting the transport,
enables cache deduplication, and gives mirrors a way to detect drift.

### Caching

Cloudflare's static-file caching already emits ETag and `Last-Modified`.
Confirm these aren't stripped. The `lastModified` field inside each
JSON is informational and tracks the entry's content date, not the
file's mtime.

## Versioning

- Schema version is carried in the schema filename
  (`profile-entry-v1.json`).
- A major-version bump means a breaking change. Old schema URLs stay
  live indefinitely (they're static files; cost is bytes on disk).
- Additive changes within a major version are allowed and don't require
  a bump.
- Each emitted JSON references the schema version it was built against
  via `$schema`. Consumers can pin.
- A documented migration window precedes any major bump (announcement,
  parallel publication of v1 and v2 for ≥6 months).

## Implementation impact for the existing build

Given the current pipeline (CSV + YAML → Python → static HTML on
Cloudflare):

- Add a JSON emitter alongside the HTML emitter, fed from the same CSV
  row. Estimated ~150 LOC of Python.
- Add SHA-256 computation over each referenced asset at build time.
  Cheap even for hundreds of files; can be cached against asset mtime.
- Generate `index.json` from the same iteration that produces the HTML
  index.
- Generate top-level `index.json` from the YAML registry list.
- Hand-author the schema files (4 schemas + the catalogue schema),
  publish under `/schemas/`.
- One Cloudflare WAF / page-rule update for CORS + challenge-exempt
  paths.

No runtime, no API server, no new dependencies. The build's output
footprint roughly doubles in file count (one extra JSON per HTML), but
file sizes are small (1–4 KB per entry JSON).

## Worked example

Take the existing entry **ECI_FOGRA39**. Today the registry surfaces:

- An HTML page at `/profile-registry/ECI_FOGRA39` (or similar).
- A linked download of `ECI_FOGRA39.icc`.
- Linked PDF documentation.

Under this proposal the build would additionally emit:

- `/profile-registry/ECI_FOGRA39.json` — the per-entry JSON shown above.
- `/profile-registry/index.json` — incremented to include this entry.

A consumer wanting to fetch every CMYK printer profile from the
registry would do:

```text
1.  GET /index.json                                       → list of registries
2.  GET /profile-registry/index.json                      → list of entries
3.  GET /profile-registry/{entry}.json   for each entry   → metadata + asset URLs
4.  GET /profile-registry/{entry}.icc    for those that match deviceSpace=CMYK
```

Steps 1–3 are JSON, cacheable, small. Step 4 is the actual binary
download that consumers care about. No HTML parsing; no scraping; no
bot-challenge collisions.

## Non-goals

The following are deliberately out of scope:

- **Query / search API.** Consumers can fetch the index and filter
  client-side. A query API would require a runtime — incompatible with
  the static-site model.
- **Write API.** Submission remains the existing process (presumably PR
  against the source repo).
- **GraphQL / OpenAPI / OData.** Heavy, server-side machinery for a
  problem that doesn't need it.
- **Bulk-download tarballs.** Per Adam Dewitz's response, the JSON +
  assets approach addresses the same need with less maintenance burden.
- **Sitemap.xml.** Could be added as a complementary discovery aid (it's
  a recognized standard) but is not required by this proposal.

## Open questions for the working group

1. Exact taxonomy of `details` fields per registry — what's the minimum
   set the working groups consider normative versus the additional
   fields currently surfaced in HTML?
2. License metadata format — SPDX identifier preferred, or free-text
   URL sufficient given the registries' historical diversity of license
   terms? Or both, with SPDX where possible?
3. Treatment of withdrawn / deprecated entries — keep their JSONs live
   with a `withdrawn: true` field, or 410 Gone? (Static-site preference:
   keep live with a flag.)
4. Should the per-entry JSON include the historical changelog of the
   entry (versions, edits, re-submissions) or just current state?
5. Top-level catalogue location — `/index.json` collides with a future
   site-root behaviour; alternative is `/registries.json` or
   `/.well-known/icc-registries.json`. Working group preference?

## References

- icc-cloudflare-probe: https://github.com/colourbill-ctrl/icc-cloudflare-probe
- JSON Schema draft 2020-12: https://json-schema.org/draft/2020-12/release-notes.html
- RFC 3839 (`application/vnd.iccprofile`): https://www.rfc-editor.org/rfc/rfc3839
- RFC 5988 (Web Linking): https://www.rfc-editor.org/rfc/rfc5988
