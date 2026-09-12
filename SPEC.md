# **Product Canvas & System Architecture Specification**

**Project:** Configurable Market Intelligence Engine (CMIE)

**Target Audience:** Private Equity & Venture Capital Analysts, Deal Teams, Strategy Advisors (Post-Deal Diligence & Portfolio Monitoring)

**Paradigm:** Domain-Agnostic, Zero-Database, Zero-LLM-Runtime, GitOps-Driven Command Center

> **Status of record.** This document holds strategy and positioning. Architectural decisions live in `docs/00-DECISIONS.md`, and where the two disagree, the decision log wins. Sections amended on 2026-09-11 are marked **[Amended]**; the amendment log is at the end.

## **Part 1: Product Canvas & Strategic Positioning**

### **1. Vision & Purpose**

The Configurable Market Intelligence Engine (CMIE) is a lightweight, high-density intelligence command center delivering a real-time, evidence-based operational snapshot of a target company, its industry segment, regulatory dockets, and macroeconomic climate.

The CMIE is intentionally positioned as a **"Deal Command Center"** rather than a top-of-funnel company discovery tool (competing with PitchBook). It is deployed post-thesis when deal teams need absolute, noise-free operational truth without the risk of AI hallucination, database infrastructure overhead, or enterprise per-seat subscriptions.

```
 [ Public & Target Sources ]
 (Port Dockets, Regulatory REST APIs, Company Sites)
            │
            ▼  (Scheduled Cron via GitHub Actions)
 ┌─────────────────────────────────────────────────┐
 │       Orchestrated Ingestion Pipeline           │
 │ 1. Build Queue (Filter by ttlHours & cron)      │
 │ 2. Route Requests via Edge Proxy (PSK Auth)     │
 │ 3. Deterministic Extraction (Cheerio/Playwright)│
 │ 4. Validate, Diff, Write Files & health.json    │
 └────────────────────────┬────────────────────────┘
                          │
                          ▼ (Commit to short-lived ingest branch)
 ┌─────────────────────────────────────────────────┐
 │        Preview Deploy + Validation Gate         │
 │ Schema validation, contract tests, smoke render │
 │ Fails ⇒ main untouched, last good data serves   │
 └────────────────────────┬────────────────────────┘
                          │
                          ▼ (Squash-merge to main)
 ┌─────────────────────────────────────────────────┐
 │         Client-Side Static SPA (React)          │
 │ 1. Fetches /data/*.json from Production Origin  │
 │ 2. Calculates Freshness at Runtime (T_now)      │
 │ 3. Renders 4-Grid Dashboard & Health Modal      │
 └─────────────────────────────────────────────────┘
```

### **2. Core Principles & Requirements**

* **Deterministic Provenance:** Absolute auditability. Every metric block and natural language block MUST explicitly store and render its raw source URL, DOM anchor, extraction timestamp, and the raw pre-parse text, to eliminate trust deficits.
* **Current-State Snapshot with Change Awareness:** **[Amended — ADR-002]** Displays active, verified state, annotated with what changed and when. Excludes commit timelines and time-series charts from the UI, while leveraging Git under the hood for data versioning. A monitoring tool that cannot answer "what moved since I last looked?" is a report, not a monitor.
* **Extraction Integrity:** **[Added — ADR-002]** A selector that throws is caught by the health log; a selector that silently resolves to the wrong node publishes a confident, sourced, wrong number. Shape assertions, ambiguity detection, and change-magnitude guards are mandatory parts of the extraction contract, not optional hardening.
* **GitOps for Data / Git Scraping:** **[Amended — ADR-005]** The Git repository functions as both the time-series data warehouse and the deployment trigger. Each ingestion run commits to a short-lived branch, is gated on a validated preview deploy, and squash-merges to `main` only after proving that the exact data renders in the exact application.
* **Single-Environment Scope:** A single deployment environment hosts one active configuration defining one primary target entity and optional related entities (e.g., key competitors or parent holding structures).
* **Pipeline Health & Degradation Tracking:** Proactive capture of failing DOM selectors or stale sources logged to a health log artifact and surfaced in a dedicated UI Health Modal.
* **Flat-File Architecture:** Zero database. Uses modular, isolated flat JSON storage as the runtime state snapshot to ensure clean, readable Git diffs. Scale ceiling stated explicitly in ADR-007.
* **Zero-LLM Runtime:** **[Amended — ADR-003]** No LLM call occurs during ingestion, transformation, or rendering. LLMs may be used offline to draft extractor configs and propose replacement selectors, delivered as reviewed pull requests subject to the same validation gate. The determinism guarantee is about the data path; selector maintenance is not the data path.

### **3. Core Intelligence Dimensions**

The UI dynamically renders four top-level operational sections configured in the target matrix:

1. **Target Company State:** Operational status, asset capacity, financial milestones, executive developments.
2. **Industry Segment:** Competitor activity, sector capacity metrics, technology updates, supply chain bottlenecks.
3. **Regulatory Landscape:** Active dockets, municipal/port approvals, federal frameworks, environmental reviews.
4. **Market Climate:** Macroeconomic indicators, sector sentiment, policy incentives, commodity/capacity indices.

Section identifiers are configuration, not framework constants. Another environment may define a different set.

### **4. Strategic Positioning & Market Differentiation**

| Feature / Capability | Configurable Market Intelligence Engine | Enterprise Terminals (PitchBook) | AI Platforms (AlphaSense) | Custom RPA (Apify/AWS) |
| :---- | :---- | :---- | :---- | :---- |
| **Data Determinism** | **High** (Rigid DOM/Regex exact matching) | Medium (Human/algorithmic error potential) | Low (LLM hallucination risk) | High |
| **Hyper-Niche Tracking** | **Excellent** (Configurable to any DOM node) | Poor (Only tracks standard market data) | Medium (Dependent on search index) | Excellent |
| **Infrastructure Cost** | **Near-Zero** (Serverless, Git repo, static CDN) | High ($10k–$25k+ per seat/year) | High ($5k+ per seat/year) | Medium (Database, compute, API costs) |
| **Auditability & Provenance** | **Absolute** (Git commit history + Source URLs) | Medium (Cites general sources) | Low (Opaque AI synthesis) | Medium (Requires custom logging) |
| **Maintenance Overhead** | **Low–Moderate** (Self-contained orchestrator, UI health modal) | Zero (Managed by vendor) | Zero (Managed by vendor) | High (Database maintenance, DevOps) |

**[Amended]** The maintenance row previously read "Low." Rigid DOM selectors across ~20 sources break on a predictable cadence, and because the dashboards are operated as a service, that cost falls on the operator rather than the client. The honest claim is that maintenance is low *relative to running database and pipeline infrastructure*, not that it is negligible. Current working estimate and its basis are in `docs/06-OPS-RUNBOOK.md` §7.

## **Part 2: Technology Stack & Configuration Schema**

### **1. Technology Stack Constraints**

* **Frontend UI:** React + Vite + Tailwind CSS + shadcn/ui components (compiled as a static Single Page Application).
* **Ingestion Engine:** Node.js with TypeScript.
* **Scraping Frameworks:**
  * **Cheerio:** Primary lightweight HTML parser for static pages and fast execution.
  * **Playwright:** Strictly reserved as an optional fallback for complex, client-side rendered (SPA) targets requiring JavaScript execution.

> **Unvalidated.** This constraint assumes the source set is predominantly HTML. If PDFs or session-state web applications are a meaningful share, it is wrong as written. Resolution depends on the source triage in `docs/05-SOURCES.md` (open question Q2).

### **2. Configuration Schema Contract**

Full schema in `docs/02-CONFIG-SCHEMA.md`.

The configuration defines environment metadata, entity definitions, section definitions, and an array of target extraction sources. Each target specifies its entity, section mapping, extraction kind (`html`, `api`, `pdf`), source URL, renderer, execution schedule, TTL threshold, optional authentication environment variable keys, politeness controls, and a collection of extractors defining keys, labels, presenters, value types, selectors, regex patterns, validation assertions, and alert rules.

Per ADR-001, configuration is the entire surface on which a new environment is stood up. If adding a client requires an application code change, that is a defect in the schema.

### **3. Isolated Data Directory Structure**

State and health data are written to isolated flat-file paths separated by section and target identifier to ensure clean, granular Git diffs and modular runtime fetching. Layout and file envelopes in `docs/01-DATA-CONTRACT.md`.

## **Part 3: Resilient GitOps Ingestion Pipeline**

Full design in `docs/03-INGESTION.md`.

### **1. Orchestrated Execution Cycle**

1. **Trigger:** CI/CD workflow runs on a scheduled cron and invokes the Orchestrator script under a single concurrency group, so runs are serialized.
2. **Filtering & Queueing:** The Orchestrator reads target configurations, evaluates execution frequency and TTL relative to current time, and dynamically constructs a runtime target queue.
3. **Secure & Proxied Execution:**
   * **Secrets Injection:** Secret keys are injected from CI/CD environment variables based on configuration mappings. Secret values are scrubbed from all committed output.
   * **Edge Proxy Routing:** Target HTTP requests may be routed through production edge proxies to mitigate runner IP blocking. Applied per target, default off. **Unvalidated — see ADR-006.**
   * **Proxy Authentication:** Edge proxies must require a Pre-Shared Key (PSK) passed via custom request headers to prevent unauthorized public compute usage.
4. **Isolated Extraction, Validation & Error Handling:** Handlers parse target data, then validate it against shape assertions and change-magnitude guards. If extraction or validation fails:
   * Retains the existing cached data file.
   * Marks status as failed using cached fallback.
   * Logs error class, failing DOM selectors, and stack traces to a centralized health log artifact.
5. **Validated Preview Merge:** **[Amended — ADR-005]** Updated data files are committed to a short-lived `ingest/<runId>` branch, which produces a preview deployment. The run then gates on JSON Schema validation, contract assertions, and a smoke render of the preview URL. On pass, the branch squash-merges to `main` and production rebuilds. On fail, the branch is left open, an issue is raised, and `main` is untouched — production continues serving the last verified snapshot.

   *This supersedes the original long-lived `data/latest` branch design. The build-thrashing rationale is retired: data commits do reach `main` and do trigger a production build. For a static Vite SPA that build is cheap, and it buys a real integration test on every run.*

## **Part 4: Presentation & Frontend Specifications**

Full design in `docs/04-FRONTEND.md`.

### **1. UI Layout & Component Requirements**

* **Header Bar:** Displays entity names alongside a global Pipeline Health Indicator.
* **Grid Layout:** Renders active operational sections mapped to configuration definitions.
* **Value Presenters:**
  * **Metric Presenter:** Prominent display of quantitative values, value units, human-readable labels, and direct hyperlink source attribution.
  * **Markdown Presenter:** Formatted natural language narrative blocks rendered via a Markdown parser with source link attribution.
  * **List and Status Presenters:** **[Added]** Multi-item extractions and enumerated state values.
* **Delta Indicators:** **[Added — ADR-002]** Each block renders what changed, by how much, and when — including the unchanged case ("unchanged for 34 days"), which is frequently the finding.
* **Provenance Disclosure:** **[Added]** Every value is one interaction from its source URL, resolved anchor, extraction timestamp, and raw pre-parse text.
* **Zero-State Handler:** Modules or sections lacking ingested data render an explicit placeholder.
* **Pipeline Health Modal:** Clickable drawer or modal surfacing system health logs, allowing analysts to inspect failing DOM selectors, stale sources, and stack traces.

### **2. Client-Side Runtime Freshness Logic**

Data freshness badges must not be hardcoded or generated at build time. They must be calculated dynamically by the frontend application in browser memory using current timestamp, last updated timestamp, TTL threshold, and execution status flags.

**[Amended]** The state machine is explicit: `never`, `fresh`, `stale`, `expired`, `failing`, `flagged` — defined in `docs/01-DATA-CONTRACT.md` §5. The `expired` state is a requirement, not a refinement: past a configured ceiling the interface stops presenting a value as current and presents it as a dated historical observation. An analyst must not be able to misread a six-week-old figure as today's.

## **Part 5: Deployment & Same-Origin Fetch Strategy**

**[Amended — ADR-005]**

Data files are part of the production build output and are served from the production domain alongside the application. Same-origin fetching is therefore structural rather than configured: the SPA requests `/data/*.json` via standard relative requests, with no CORS surface and no dependency on raw GitHub endpoints or their rate limits.

Cache correctness is handled by the manifest: `manifest.json` is served short-cache, and its `runId` query-busts every section file, so long-lived CDN caching of data files cannot serve a stale snapshot.

*The original design mapped a long-lived `data` branch to the production domain root. Vercel maps one branch per project to production, so that approach assumed a capability that does not exist natively.*

## **Part 6: Known Gaps**

**[Added]**

* **Access control.** The specification defined no authentication. v1 ships without it, which means the deployment is public and nothing damaging-if-crawled may be ingested until whole-site auth lands (ADR-004).
* **Legal posture.** robots.txt stance, target-site terms of service, and rate-limiting policy are unwritten. Required before any client deliverable (open question Q6).
* **Source inventory.** The engine is specified; its fuel is not. `docs/05-SOURCES.md` is empty and blocks all extraction work (open question Q1).
* **PDF extraction.** Sketched, not designed. Deliberately deferred until the source triage says whether it matters (open question Q2).

---

## Amendment Log

**2026-09-11** — Amended following an architecture review. Changes: Current-State Snapshot principle now includes deltas (ADR-002); Extraction Integrity added as a principle; GitOps principle and Part 3 §5 rewritten for the validated-preview-merge model (ADR-005); Part 5 rewritten, long-lived `data/latest` branch retired; Zero-LLM Runtime scoped to the data path (ADR-003); maintenance claim in the positioning table softened to "Low–Moderate" with rationale; list/status presenters, delta indicators and provenance disclosure added to Part 4; freshness state machine made explicit; Part 6 added for known gaps. Architecture diagram re-rendered as a code block (the original had been mangled by Markdown escaping) and updated to match the new pipeline. Decision record: `docs/00-DECISIONS.md`.
