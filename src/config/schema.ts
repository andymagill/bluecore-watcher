// CmieConfig — 02-CONFIG-SCHEMA.md. Zod is the single source of truth:
// TypeScript types are inferred (z.infer) and the JSON Schema is generated
// from these same schemas (scripts/schema-gen.ts) — never hand-maintained
// in parallel (doc 02 §0).
import { z } from "zod";

export const EntityRole = z.enum(["primary", "competitor", "parent", "counterparty", "regulator"]);

export const EntityDef = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: EntityRole,
  aliases: z.array(z.string()).optional(),
});
export type EntityDef = z.infer<typeof EntityDef>;

export const SectionDef = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  order: z.int(),
  description: z.string().optional(),
});
export type SectionDef = z.infer<typeof SectionDef>;

export const EnvironmentDef = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1),
  entities: z.array(EntityDef),
  staleCeilingMultiplier: z.number().positive().default(3),
});
export type EnvironmentDef = z.infer<typeof EnvironmentDef>;

export const AuthDef = z.object({
  type: z.enum(["bearer", "header", "query"]),
  secretEnv: z.string().min(1), // rule 9 (config-time): name only, not the value
  name: z.string().optional(),
});
export type AuthDef = z.infer<typeof AuthDef>;

export const ScheduleDef = z.object({
  cron: z.string().min(1),
  ttlHours: z.number().positive(),
  jitterSeconds: z.number().min(0).max(120).default(0),
  staleCeilingHours: z.number().positive().optional(),
  // Required when ttlHours < 2x the cron interval (rule 5). A real schema
  // field, not a comment — 02-CONFIG-SCHEMA.md rule 5, corrected 2026-09-12.
  ttlOverrideReason: z.string().min(1).optional(),
});
export type ScheduleDef = z.infer<typeof ScheduleDef>;

export const PolitenessDef = z.object({
  minIntervalMs: z.int().nonnegative().optional(),
  userAgent: z.string().optional(),
  respectRobotsTxt: z.boolean().default(true), // Q6 posture: true until resolved
});
export type PolitenessDef = z.infer<typeof PolitenessDef>;

// ---- Location — discriminated union keyed on `kind` (ADR-010). ----
// v1 ships exactly these two members. Adding a kind is a new member here
// plus a handler module (02-CONFIG-SCHEMA.md §7) — no change to this file's
// structure, no change to any existing member.

export const HtmlLocation = z.object({
  kind: z.literal("html"),
  selector: z.string().min(1),
  attr: z.string().optional(),
  multiple: z.boolean().optional(),
});

export const ApiLocation = z.object({
  kind: z.literal("api"),
  jsonPath: z.string().min(1),
});

export const LocationDef = z.discriminatedUnion("kind", [HtmlLocation, ApiLocation]);
export type LocationDef = z.infer<typeof LocationDef>;

export const AssertDef = z.object({
  notEmpty: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  maxLength: z.int().positive().optional(),
  minItems: z.int().nonnegative().optional(), // presenter: "list" only
  maxItems: z.int().nonnegative().optional(), // presenter: "list" only
  maxChangePct: z.number().positive().optional(),
  maxChangeAbs: z.number().positive().optional(),
  expectMonotonic: z.enum(["increasing", "decreasing"]).optional(),
});
export type AssertDef = z.infer<typeof AssertDef>;

export const AlertDef = z.object({
  on: z.enum(["any-change", "threshold", "never"]).default("never"),
  thresholdPct: z.number().positive().optional(),
  quietHours: z.number().nonnegative().optional(),
  severity: z.enum(["info", "warn", "critical"]).optional(),
});
export type AlertDef = z.infer<typeof AlertDef>;

const ExtractorBase = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  presenter: z.enum(["metric", "markdown", "list", "status"]),
  required: z.boolean().default(false),
  regex: z.string().optional(),
  regexGroup: z.int().positive().default(1),
  trim: z.boolean().default(true),
  type: z.enum(["number", "currency", "percent", "date", "string", "markdown", "enum"]),
  unit: z.string().optional(),
  currency: z.string().length(3).optional(),
  locale: z.string().default("en-US"),
  dateFormat: z.string().optional(),
  enumValues: z.array(z.string()).optional(),
  assert: AssertDef.optional(),
  alert: AlertDef.optional(),
});

// ExtractorDef = ExtractorBase & LocationDef (doc 02 §3), built with
// z.intersection so the location union's discriminant survives.
export const ExtractorDef = z.intersection(ExtractorBase, LocationDef).check((ctx) => {
  const ex = ctx.value as z.infer<typeof ExtractorBase> & LocationDef;

  // Rule 7 — type/presenter compatibility.
  const presenterTypes: Record<string, readonly string[]> = {
    metric: ["number", "currency", "percent", "date"],
    markdown: ["markdown", "string"],
    list: ["string"],
    status: ["enum"],
  };
  if (!presenterTypes[ex.presenter]?.includes(ex.type)) {
    ctx.issues.push({
      code: "custom",
      input: ex,
      message: `presenter "${ex.presenter}" does not accept type "${ex.type}" (rule 7)`,
      path: ["type"],
    });
  }

  // Rule 8 — currency/enum coupling, plus minItems/maxItems <-> list.
  if (ex.type === "currency" && !ex.currency) {
    ctx.issues.push({ code: "custom", input: ex, message: "currency required when type is \"currency\" (rule 8)", path: ["currency"] });
  }
  if (ex.currency && ex.type !== "currency") {
    ctx.issues.push({ code: "custom", input: ex, message: "currency set but type is not \"currency\" (rule 8)", path: ["currency"] });
  }
  if (ex.type === "enum" && (!ex.enumValues || ex.enumValues.length === 0)) {
    ctx.issues.push({ code: "custom", input: ex, message: "enumValues required when type is \"enum\" (rule 8)", path: ["enumValues"] });
  }
  if (ex.enumValues && ex.type !== "enum") {
    ctx.issues.push({ code: "custom", input: ex, message: "enumValues set but type is not \"enum\" (rule 8)", path: ["enumValues"] });
  }
  if ((ex.assert?.minItems !== undefined || ex.assert?.maxItems !== undefined) && ex.presenter !== "list") {
    ctx.issues.push({ code: "custom", input: ex, message: "minItems/maxItems only apply to presenter \"list\" (rule 8)", path: ["assert"] });
  }

  // multiple: true only makes sense for html + list.
  if (ex.kind === "html" && ex.multiple && ex.presenter !== "list") {
    ctx.issues.push({ code: "custom", input: ex, message: "multiple: true is only meaningful with presenter \"list\"", path: ["multiple"] });
  }
});
export type ExtractorDef = z.infer<typeof ExtractorBase> & LocationDef;

export const RendererDef = z.enum(["static", "browser"]);
export const ProxyDef = z.enum(["none", "edge"]);

export const TargetDef = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), // rule 3
    label: z.string().min(1),
    entityId: z.string().min(1),
    sectionId: z.string().min(1),
    kind: z.enum(["html", "api"]), // pdf removed from v1 per ADR-010; see doc 02 §7
    url: z.url(), // rule 10
    renderer: RendererDef.default("static"),
    method: z.enum(["GET", "POST"]).default("GET"),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    auth: AuthDef.optional(),
    proxy: ProxyDef.default("none"),
    schedule: ScheduleDef,
    politeness: PolitenessDef.optional(),
    extractors: z.array(ExtractorDef).min(1),
    notes: z.string().optional(),
  })
  .check((ctx) => {
    const t = ctx.value;

    // Rule 10 — https only (no allowInsecure exception in v1; deferred to M1
    // per the M0.5 scope cut, see the plan's "Deferred to M1" section).
    if (!t.url.startsWith("https://")) {
      ctx.issues.push({ code: "custom", input: t, message: `url must be https (rule 10): ${t.url}`, path: ["url"] });
    }

    // Rule 4 — extractor.key unique within target.
    const seen = new Set<string>();
    for (const [i, ex] of t.extractors.entries()) {
      if (seen.has(ex.key)) {
        ctx.issues.push({ code: "custom", input: t, message: `duplicate extractor key "${ex.key}" (rule 4)`, path: ["extractors", i, "key"] });
      }
      seen.add(ex.key);

      // Rule 6 — an extractor's location kind must match its target's kind.
      if (ex.kind !== t.kind) {
        ctx.issues.push({
          code: "custom",
          input: t,
          message: `extractor "${ex.key}" has kind "${ex.kind}" but target kind is "${t.kind}" (rule 6)`,
          path: ["extractors", i, "kind"],
        });
      }
    }

    // Rule 5 — ttlHours >= 2x cron interval, unless overridden with a reason.
    // Interval estimation is best-effort here (exact cron-interval math lives
    // in the ingestion plan step); this check catches the common shapes.
    if (!t.schedule.ttlOverrideReason) {
      const intervalHours = estimateCronIntervalHours(t.schedule.cron);
      if (intervalHours !== null && t.schedule.ttlHours < 2 * intervalHours) {
        ctx.issues.push({
          code: "custom",
          input: t,
          message:
            `ttlHours (${t.schedule.ttlHours}) is less than 2x the estimated cron interval ` +
            `(${intervalHours}h) — set schedule.ttlOverrideReason to override (rule 5)`,
          path: ["schedule", "ttlHours"],
        });
      }
    }
  });
export type TargetDef = z.infer<typeof TargetDef>;

// Best-effort cron-interval estimator for rule 5. Recognizes the common
// daily/hourly/weekly shapes used in the doc examples; anything else is
// left to a human (returns null, which skips the check rather than
// producing a false positive).
export function estimateCronIntervalHours(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, , dow] = parts;
  const dowIsSingleDay = dow !== "*" && /^\d+$/.test(dow ?? ""); // e.g. "1" — once a week
  const dowIsMultiDay = dow !== "*" && !dowIsSingleDay; // e.g. "1-5", "1,3,5" — still daily-ish
  if (dom === "*" && (dow === "*" || dowIsMultiDay)) {
    if (hour === "*") return 1; // hourly
    if (/^\d+$/.test(hour ?? "") && /^\d+$/.test(minute ?? "")) return 24; // daily (weekday-filtered still ~daily)
  }
  if (dowIsSingleDay && dom === "*") return 168; // weekly — fires on exactly one weekday
  return null;
}

export const TargetDefaults = z.object({
  renderer: RendererDef.optional(),
  proxy: ProxyDef.optional(),
  politeness: PolitenessDef.optional(),
  timeoutMs: z.int().positive().optional(),
  retries: z.int().nonnegative().optional(),
});
export type TargetDefaults = z.infer<typeof TargetDefaults>;

export const AlertingConfig = z.object({
  channel: z.enum(["github-issue", "webhook", "email"]),
  webhookUrlEnv: z.string().optional(),
  emailToEnv: z.string().optional(),
  minSeverity: z.enum(["info", "warn", "critical"]).default("warn"),
});
export type AlertingConfig = z.infer<typeof AlertingConfig>;

export const CmieConfig = z
  .object({
    schemaVersion: z.literal(1),
    environment: EnvironmentDef,
    sections: z.array(SectionDef),
    targets: z.array(TargetDef),
    defaults: TargetDefaults.optional(),
    alerting: AlertingConfig.optional(),
  })
  .check((ctx) => {
    const cfg = ctx.value;

    // Rule 1 — exactly one primary entity.
    const primaries = cfg.environment.entities.filter((e) => e.role === "primary");
    if (primaries.length !== 1) {
      ctx.issues.push({
        code: "custom",
        input: cfg,
        message: `exactly one entity must have role "primary" (found ${primaries.length}) (rule 1)`,
        path: ["environment", "entities"],
      });
    }

    const entityIds = new Set(cfg.environment.entities.map((e) => e.id));
    const sectionIds = new Set(cfg.sections.map((s) => s.id));
    const targetIds = new Set<string>();

    for (const [i, t] of cfg.targets.entries()) {
      // Rule 2 — entityId / sectionId resolve.
      if (!entityIds.has(t.entityId)) {
        ctx.issues.push({ code: "custom", input: cfg, message: `target "${t.id}" has unknown entityId "${t.entityId}" (rule 2)`, path: ["targets", i, "entityId"] });
      }
      if (!sectionIds.has(t.sectionId)) {
        ctx.issues.push({ code: "custom", input: cfg, message: `target "${t.id}" has unknown sectionId "${t.sectionId}" (rule 2)`, path: ["targets", i, "sectionId"] });
      }
      // Rule 3 — target.id unique (format already enforced by the field schema).
      if (targetIds.has(t.id)) {
        ctx.issues.push({ code: "custom", input: cfg, message: `duplicate target id "${t.id}" (rule 3)`, path: ["targets", i, "id"] });
      }
      targetIds.add(t.id);

      // Rule 9 (config-time half) — secretEnv name present when auth or
      // *Env fields are used. Existence of the *value* is a runtime check
      // (AUTH_ERROR skip), not enforceable here.
      if (t.auth && !t.auth.secretEnv) {
        ctx.issues.push({ code: "custom", input: cfg, message: `target "${t.id}" auth.secretEnv must be set (rule 9)`, path: ["targets", i, "auth", "secretEnv"] });
      }
    }

    // Rule 11 — no literal secret in config. Best-effort pattern scan over
    // every string value the parsed config actually contains; the real
    // defence is the CI pattern scan over the source file itself (doc 02
    // rule 11), which this cannot replace. Tests each string leaf directly
    // rather than JSON.stringify-ing the whole object first — stringify
    // escapes embedded quotes as `\"`, which would otherwise make this
    // regex (which expects a literal `"`) never match.
    const suspicious = /(?:secret|token|password|api[_-]?key)\s*[:=]\s*["'][^"'$][^"']{7,}["']/i;
    if (collectStrings(cfg).some((s) => suspicious.test(s))) {
      ctx.issues.push({ code: "custom", input: cfg, message: "config appears to contain a literal secret (rule 11) — use secretEnv instead", path: [] });
    }
  });

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}
export type CmieConfig = z.infer<typeof CmieConfig>;
// The type an author writes, before Zod fills in defaults (renderer, proxy,
// jitterSeconds, regexGroup, trim, locale, etc.) — what `config/*.config.ts`
// files should annotate themselves with.
export type CmieConfigInput = z.input<typeof CmieConfig>;
