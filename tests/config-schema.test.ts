// Exercises 02-CONFIG-SCHEMA.md §5's validation rules directly against the
// Zod schema — each case is a config that should fail exactly one rule.
import { describe, expect, it } from "vitest";
import { CmieConfig, type CmieConfigInput } from "../src/config/schema.js";

function baseConfig(): CmieConfigInput {
  return {
    schemaVersion: 1 as const,
    environment: {
      id: "test-env",
      displayName: "Test Env",
      entities: [{ id: "primary-co", name: "Primary Co", role: "primary" as const }],
    },
    sections: [{ id: "target", label: "Target", order: 1 }],
    targets: [
      {
        id: "t1",
        label: "Target One",
        entityId: "primary-co",
        sectionId: "target",
        kind: "html" as const,
        url: "https://example.test/page",
        schedule: { cron: "0 6 * * *", ttlHours: 72 },
        extractors: [
          {
            key: "e1",
            label: "Extractor One",
            presenter: "metric" as const,
            kind: "html" as const,
            selector: "#x",
            type: "number" as const,
          },
        ],
      },
    ],
  };
}

describe("CmieConfig validation rules", () => {
  it("accepts a well-formed config", () => {
    expect(CmieConfig.safeParse(baseConfig()).success).toBe(true);
  });

  it("rule 1: rejects zero primary entities", () => {
    const cfg = baseConfig();
    cfg.environment.entities = [{ id: "x", name: "X", role: "competitor" as const }];
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 1"))).toBe(true);
  });

  it("rule 1: rejects two primary entities", () => {
    const cfg = baseConfig();
    cfg.environment.entities.push({ id: "y", name: "Y", role: "primary" as const });
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it("rule 2: rejects unknown entityId", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.entityId = "does-not-exist";
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 2"))).toBe(true);
  });

  it("rule 2: rejects unknown sectionId", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.sectionId = "does-not-exist";
    expect(CmieConfig.safeParse(cfg).success).toBe(false);
  });

  it("rule 3: rejects a non-slug target id", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.id = "Not A Slug!";
    expect(CmieConfig.safeParse(cfg).success).toBe(false);
  });

  it("rule 3: rejects duplicate target ids", () => {
    const cfg = baseConfig();
    cfg.targets.push({ ...cfg.targets[0]!, extractors: [{ ...cfg.targets[0]!.extractors[0]!, key: "e2" }] });
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 3"))).toBe(true);
  });

  it("rule 4: rejects duplicate extractor keys within a target", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.extractors.push({ ...cfg.targets[0]!.extractors[0]! });
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 4"))).toBe(true);
  });

  it("rule 5: rejects ttlHours less than 2x the cron interval without an override reason", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.schedule = { cron: "0 6 * * *", ttlHours: 12 }; // daily cron, 12h ttl
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 5"))).toBe(true);
  });

  it("rule 5: accepts a short ttlHours when ttlOverrideReason is given", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.schedule = { cron: "0 6 * * *", ttlHours: 12, ttlOverrideReason: "intentionally short for a fast-moving source" };
    expect(CmieConfig.safeParse(cfg).success).toBe(true);
  });

  it("rule 6: rejects an extractor kind that doesn't match its target's kind", () => {
    const cfg = baseConfig();
    // An internally well-formed "api" extractor (has jsonPath, not selector)
    // nested under an "html" target — individually valid shapes, mismatched
    // against each other. This is what rule 6 exists to catch; a shape the
    // discriminated union alone (which only checks kind+field agreement
    // *within* one extractor) cannot.
    cfg.targets[0]!.extractors[0] = { key: "e1", label: "Extractor One", presenter: "metric", kind: "api", jsonPath: "$.x", type: "number" };
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 6"))).toBe(true);
  });

  it("rule 7: rejects a presenter/type mismatch", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.extractors[0]!.type = "enum";
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 7"))).toBe(true);
  });

  it("rule 8: rejects type currency without a currency code", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.extractors[0]!.presenter = "metric";
    cfg.targets[0]!.extractors[0]!.type = "currency";
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 8"))).toBe(true);
  });

  it("rule 8: rejects type enum without enumValues", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.extractors[0]!.presenter = "status";
    cfg.targets[0]!.extractors[0]!.type = "enum";
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it("rule 10: rejects a non-https url", () => {
    const cfg = baseConfig();
    cfg.targets[0]!.url = "http://example.test/page";
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 10"))).toBe(true);
  });

  it("rule 11: rejects a config carrying a literal secret-shaped value", () => {
    const cfg = baseConfig();
    (cfg.targets[0] as unknown as { notes: string }).notes = 'apiKey: "sk-abcdef1234567890"';
    const result = CmieConfig.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.message.includes("rule 11"))).toBe(true);
  });
});
