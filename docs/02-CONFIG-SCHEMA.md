# 02 — Configuration Schema

Per ADR-001, config is the entire surface on which a new environment is stood up. If adding a client requires a code change, that is a defect in this schema.

Authored as TypeScript (`config/<environmentId>.config.ts`), type-checked at author time, and validated against a generated JSON Schema in CI. The TypeScript is the source of truth; the JSON Schema is derived from it.

---

## 1. Root

```ts
export interface CmieConfig {
  schemaVersion: 1;
  environment: EnvironmentDef;
  sections: SectionDef[];
  targets: TargetDef[];
  defaults?: TargetDefaults;
  alerting?: AlertingConfig;
}

export interface EnvironmentDef {
  id: string;                 // slug, e.g. "bluecore"
  displayName: string;        // "Bluecore Watcher"
  entities: EntityDef[];
  staleCeilingMultiplier?: number;   // default 3 — see freshness state machine
}

export interface EntityDef {
  id: string;                 // "bluecore-energy"
  name: string;               // "Bluecore Energy"
  role: "primary" | "competitor" | "parent" | "counterparty" | "regulator";
  aliases?: string[];         // for human reference and future entity resolution
}

export interface SectionDef {
  id: string;                 // "regulatory"
  label: string;              // "Regulatory Landscape"
  order: number;
  description?: string;       // rendered as section subhead
}
```

Exactly one entity must have `role: "primary"`. Section IDs are free-form; the four in SPEC Part 1 §3 are Bluecore's choices, not framework constants.

---

## 2. Target

One target = one fetchable resource. If two facts come from one page, they are two extractors on one target, not two targets — otherwise the page is fetched twice.

```ts
export interface TargetDef {
  id: string;                 // slug, unique; becomes the data filename
  label: string;
  entityId: string;           // → EntityDef.id
  sectionId: string;          // → SectionDef.id

  kind: "html" | "api" | "pdf";
  url: string;
  renderer?: "static" | "browser";   // cheerio | playwright. Default "static"
  method?: "GET" | "POST";
  headers?: Record<string, string>;  // values support ${ENV_VAR}
  body?: string;
  auth?: AuthDef;
  proxy?: "none" | "edge";           // default "none" — see ADR-006

  schedule: ScheduleDef;
  politeness?: PolitenessDef;
  extractors: ExtractorDef[];

  notes?: string;             // why this source, what's fragile about it
}

export interface AuthDef {
  type: "bearer" | "header" | "query";
  secretEnv: string;          // env var NAME, never a value
  name?: string;              // header or query param name
}

export interface ScheduleDef {
  cron: string;               // when the orchestrator may consider it
  ttlHours: number;           // age past which the UI calls it stale
  jitterSeconds?: number;     // default 0–120, avoids thundering herd
  staleCeilingHours?: number; // overrides environment multiplier
}

export interface PolitenessDef {
  minIntervalMs?: number;     // enforced floor between requests to this host
  userAgent?: string;         // default: identifying UA with a contact URL
  respectRobotsTxt?: boolean; // default true — see Q6
}
```

### `cron` vs `ttlHours`

Two knobs that get confused, so state it plainly:

- **`cron`** is *when we may fetch*. It is about politeness and cost.
- **`ttlHours`** is *how long a value stays believable*. It is about the reader.

They are independent. A quarterly filing may be polled daily (`cron: "0 6 * * *"`) while remaining fresh for 90 days (`ttlHours: 2160`) — polling often, staleness rarely. Setting `ttlHours` from the cron interval is the common mistake and produces a dashboard permanently painted amber.

**Rule:** `ttlHours` should be at least 2× the cron interval, so one missed run never turns the board yellow.

### `notes`

Prose, mandatory in practice. "Table is server-rendered but the header row count changes when a berth is added" is the difference between a five-minute repair and an hour of archaeology. This is the field future-you will thank you for.

---

## 3. Extractor

```ts
export interface ExtractorDef {
  key: string;                // stable, unique within target; becomes block.key
  label: string;              // human-facing
  presenter: "metric" | "markdown" | "list" | "status";
  required?: boolean;         // default false; true → failure fails the target

  // ---- Location (one family per `kind`) ----
  selector?: string;          // CSS, kind: "html"
  attr?: string;              // default: text content
  multiple?: boolean;         // declares intent; absent + >1 match = AMBIGUOUS
  jsonPath?: string;          // kind: "api"
  pageRange?: string;         // kind: "pdf", e.g. "1-3"
  textAnchor?: string;        // kind: "pdf", literal text preceding the value

  // ---- Narrowing ----
  regex?: string;
  regexGroup?: number;        // default 1
  trim?: boolean;             // default true

  // ---- Typing ----
  type: "number" | "currency" | "percent" | "date" | "string" | "markdown" | "enum";
  unit?: string;              // "TEU", "MW", "bbl/d"
  currency?: string;          // ISO 4217
  locale?: string;            // default "en-US"
  dateFormat?: string;        // when the source is unparseable by Date
  enumValues?: string[];      // type: "enum"; anything else → ASSERTION_FAILED

  // ---- Validation ----
  assert?: AssertDef;
  alert?: AlertDef;
}

export interface AssertDef {
  notEmpty?: boolean;
  min?: number;
  max?: number;
  pattern?: string;           // regex the final value must satisfy
  maxLength?: number;
  maxChangePct?: number;      // vs previous committed value
  maxChangeAbs?: number;
  expectMonotonic?: "increasing" | "decreasing";
}

export interface AlertDef {
  on: "any-change" | "threshold" | "never";   // default "never"
  thresholdPct?: number;
  quietHours?: number;        // suppress repeat alerts for this key
  severity?: "info" | "warn" | "critical";
}
```

### Assertions are cheap insurance

Per `01-DATA-CONTRACT.md` §6, these are the only defence against a selector that matches the wrong node. Two minutes writing `min`/`max` at authoring time is the cheapest work in this system. Default to writing them.

`maxChangePct` deserves care: it withholds a value when it moves too far, which means a *genuine* large move gets withheld too. That is the intended trade — a real jump surfaces as a health entry a human clears in a minute, while a silent wrong number may never surface at all. Set the tolerance from the source's observed volatility, not from a guess, and expect to retune in the first month.

### Presenters

| `presenter` | Accepts `type` | Renders |
|---|---|---|
| `metric` | number, currency, percent, date | Large value, unit, label, source link |
| `markdown` | markdown, string | Prose block via markdown parser, source link |
| `list` | string (with `multiple: true`) | Bulleted items, each with its own anchor |
| `status` | enum | Coloured pill, states mapped in the section theme |

---

## 4. Defaults and alerting

```ts
export interface TargetDefaults {
  renderer?: "static" | "browser";
  proxy?: "none" | "edge";
  politeness?: PolitenessDef;
  timeoutMs?: number;         // default 20000 static, 45000 browser
  retries?: number;           // default 2, exponential backoff
}

export interface AlertingConfig {
  channel: "github-issue" | "webhook" | "email";
  webhookUrlEnv?: string;
  emailToEnv?: string;
  minSeverity?: "info" | "warn" | "critical";   // default "warn"
}
```

`github-issue` is the v1 default: zero cost, zero new infrastructure, and GitHub's own notification system handles delivery. Per ADR-004 and open question Q5, alerts route to the operator only in v1.

---

## 5. Validation rules

Enforced by `npm run validate:config`, which runs in CI and as a pre-commit hook. Failures are errors, not warnings.

1. `environment.entities` contains exactly one `role: "primary"`.
2. Every `target.entityId` and `target.sectionId` resolves.
3. `target.id` is unique and filename-safe (`^[a-z0-9][a-z0-9-]*$`).
4. `extractor.key` is unique within its target.
5. `cron` parses; `ttlHours > 0`; `ttlHours ≥ 2 ×` the cron interval, or the target carries an explicit `// eslint-disable`-style override with a reason.
6. Location fields match `kind`: `selector`/`attr` require `html`; `jsonPath` requires `api`; `pageRange`/`textAnchor` require `pdf`.
7. `type` and `presenter` are compatible per the table in §3.
8. `currency` set ⟺ `type: "currency"`. `enumValues` set ⟺ `type: "enum"`.
9. Every `secretEnv` and `*Env` name is present in the environment at run time, or the target is skipped with `AUTH_ERROR` rather than failing the whole run.
10. `url` is absolute and `https`.
11. No literal secret appears anywhere in config. Enforced by a pattern scan, because this file is committed.

---

## 6. Annotated example

Illustrative shapes only — real URLs and selectors are blocked on open question Q1.

```ts
import type { CmieConfig } from "../src/types/config";

export const config: CmieConfig = {
  schemaVersion: 1,

  environment: {
    id: "bluecore",
    displayName: "Bluecore Watcher",
    entities: [
      { id: "bluecore-energy", name: "Bluecore Energy", role: "primary" },
    ],
  },

  sections: [
    { id: "target",     label: "Target Company State",  order: 1 },
    { id: "segment",    label: "Industry Segment",      order: 2 },
    { id: "regulatory", label: "Regulatory Landscape",  order: 3 },
    { id: "climate",    label: "Market Climate",        order: 4 },
  ],

  defaults: {
    renderer: "static",
    proxy: "none",
    politeness: { minIntervalMs: 2000, respectRobotsTxt: true },
  },

  targets: [
    // --- A static HTML table. The common case. ---
    {
      id: "port-albany-capacity",
      label: "Port of Albany — Berth Capacity",
      entityId: "bluecore-energy",
      sectionId: "target",
      kind: "html",
      url: "https://example.gov/port/capacity",
      schedule: { cron: "0 6 * * *", ttlHours: 72 },
      notes:
        "Server-rendered table. Row order changes when a berth is added — " +
        "match on the label cell rather than nth-child if this breaks twice.",
      extractors: [
        {
          key: "berth_capacity_teu",
          label: "Berth Capacity",
          presenter: "metric",
          type: "number",
          unit: "TEU",
          required: true,
          selector: "#capacity-table tbody tr:nth-child(3) td:nth-child(2)",
          regex: "([\\d,]+)",
          assert: { min: 1000, max: 500000, maxChangePct: 25 },
          alert: { on: "threshold", thresholdPct: 10, severity: "warn" },
        },
      ],
    },

    // --- A clean JSON API. The easy case; prefer these wherever they exist. ---
    {
      id: "eia-regional-price",
      label: "Regional Spot Price",
      entityId: "bluecore-energy",
      sectionId: "climate",
      kind: "api",
      url: "https://api.example.gov/v2/series?series_id=XYZ",
      auth: { type: "query", secretEnv: "EIA_API_KEY", name: "api_key" },
      schedule: { cron: "0 7 * * 1-5", ttlHours: 48 },
      extractors: [
        {
          key: "spot_price",
          label: "Spot Price",
          presenter: "metric",
          type: "currency",
          currency: "USD",
          jsonPath: "$.series[0].data[0][1]",
          assert: { min: 0, maxChangePct: 40 },
          alert: { on: "threshold", thresholdPct: 15, quietHours: 24 },
        },
      ],
    },

    // --- A docket page yielding narrative. Note the markdown presenter. ---
    {
      id: "state-puc-docket",
      label: "State PUC — Active Docket",
      entityId: "bluecore-energy",
      sectionId: "regulatory",
      kind: "html",
      url: "https://example.gov/puc/docket/12345",
      renderer: "browser",
      schedule: { cron: "0 8 * * *", ttlHours: 168 },
      notes: "Docket list is client-rendered — static fetch returns an empty shell.",
      extractors: [
        {
          key: "docket_status",
          label: "Docket Status",
          presenter: "status",
          type: "enum",
          enumValues: ["Filed", "Under Review", "Approved", "Denied", "Withdrawn"],
          selector: ".docket-header .status-badge",
          alert: { on: "any-change", severity: "critical" },
        },
        {
          key: "latest_filing_summary",
          label: "Latest Filing",
          presenter: "markdown",
          type: "markdown",
          selector: ".filing-list li:first-child .summary",
          assert: { notEmpty: true, maxLength: 2000 },
        },
      ],
    },
  ],

  alerting: { channel: "github-issue", minSeverity: "warn" },
};
```

---

## 7. Known gap: PDF sources

The `pdf` kind is sketched (`pageRange`, `textAnchor`) but **not designed**. It is a genuinely different extraction model — text position rather than DOM structure, no stable anchors, and scanned documents need OCR, which pulls in a dependency and an accuracy question that sits uncomfortably beside a determinism guarantee.

Per open question Q2, this is deliberately deferred until the real source list exists. If PDFs turn out to be a large share of the Bluecore sources, the `pdf` kind needs its own design pass and the Cheerio-first stack constraint in SPEC Part 2 §1 is wrong as written.

Do not build PDF extraction speculatively.
