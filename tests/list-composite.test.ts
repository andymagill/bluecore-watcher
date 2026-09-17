// ADR-025 — composite html row lists: `selector`+`multiple: true` picks the
// row nodes (same as a plain list), `fields` (row-relative) + `template`
// compose each row into one markdown string, `limit` bounds how many of the
// matched rows are resolved. Synthetic fixture mirroring the real shape that
// motivated this (an anchor-wrapped news-card grid, per ADR-001/ADR-021 —
// no entity name here): rows mixing a relative href, an absolute href, a
// `javascript:` href (must reject), and one row missing a field (must raise
// SELECTOR_NO_MATCH naming the row).
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import { HtmlHandler } from "../src/ingest/extract/html-handler.js";
import { extractOne } from "../src/ingest/extract/pipeline.js";
import { IngestError } from "../src/ingest/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadFixtureDom(): Promise<cheerio.CheerioAPI> {
  const html = await readFile(
    join(__dirname, "..", "fixtures", "example-news-cards", "response.html"),
    "utf-8",
  );
  return cheerio.load(html);
}

function buildTarget(limit: number): TargetDef {
  const cfg = CmieConfig.parse({
    schemaVersion: 1,
    environment: { id: "t", displayName: "T", entities: [{ id: "p", name: "P", role: "primary" }] },
    sections: [{ id: "s", label: "S", order: 1 }],
    targets: [
      {
        id: "target-cards",
        label: "Target Cards",
        entityId: "p",
        sectionId: "s",
        kind: "html",
        url: "https://example.test/news",
        schedule: { cron: "0 6 * * *", ttlHours: 72 },
        extractors: [
          {
            key: "recent_items",
            label: "Recent Items",
            presenter: "list",
            kind: "html",
            type: "markdown",
            selector: ".ex-card",
            multiple: true,
            limit,
            fields: {
              title: { selector: ".ex-title" },
              url: { attr: "href", escape: "href" }, // no selector -> the row (<a>) itself
              cat: { selector: ".ex-cat" },
              date: { selector: ".ex-date", format: "date" },
            },
            template: "[{title}]({url}) — {cat}, {date}",
          },
        ],
      },
    ],
  });
  return cfg.targets[0]!;
}

describe("HtmlHandler — composite row list (ADR-025)", () => {
  it("resolves the first `limit` rows, mixing a relative and an absolute href", async () => {
    const $ = await loadFixtureDom();
    const target = buildTarget(2);
    const handler = new HtmlHandler();
    const candidate = await extractOne(handler, $, target.extractors[0]!, target);
    expect(candidate.value).toEqual([
      "[First Item](https://example.test/post/first-item) — Alpha, 08 Sep 2026",
      "[Second Item](https://outlet.example/second-item) — Beta, 01 Sep 2026",
    ]);
  });

  it("limits row count before field resolution — a malformed row past the window doesn't fail extraction", async () => {
    // Row 3 (bad href) and row 4 (missing field) are both past limit: 2, so
    // neither should be resolved at all.
    const $ = await loadFixtureDom();
    const target = buildTarget(2);
    const handler = new HtmlHandler();
    await expect(extractOne(handler, $, target.extractors[0]!, target)).resolves.toBeDefined();
  });

  it("throws SELECTOR_NO_MATCH naming the field and the row when a row is missing a field", async () => {
    // Isolated from the shared fixture's own bad-href row (which would
    // throw its own PARSE_ERROR first at a lower row index if both were in
    // the same window) — this proves the missing-field shape specifically.
    const $ = cheerio.load(
      '<a class="ex-card" href="/post/a"><span class="ex-title">A</span>' +
        '<span class="ex-cat">C</span><span class="ex-date">2026-09-01</span></a>' +
        '<a class="ex-card" href="/post/b"><span class="ex-title">B</span>' +
        '<span class="ex-date">2026-08-01</span></a>', // no .ex-cat on the second row
    );
    const target = buildTarget(2);
    const handler = new HtmlHandler();
    await expect(extractOne(handler, $, target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "SELECTOR_NO_MATCH",
      message: expect.stringContaining('field "cat" (row 1)'),
    } satisfies Partial<IngestError>);
  });

  it("rejects a javascript: href as PARSE_ERROR (escape: href scheme validation)", async () => {
    const $ = await loadFixtureDom();
    const target = buildTarget(3); // include row 3, whose href is javascript:
    const handler = new HtmlHandler();
    await expect(extractOne(handler, $, target.extractors[0]!, target)).rejects.toMatchObject({
      errorClass: "PARSE_ERROR",
      message: expect.stringContaining('field "url"'),
    } satisfies Partial<IngestError>);
  });

  it("escape: href resolves a relative href against target.url and percent-encodes unsafe characters", async () => {
    const $ = cheerio.load(
      '<a class="ex-card" href="/post/a (draft)"><span class="ex-title">T</span>' +
        '<span class="ex-cat">C</span><span class="ex-date">2026-09-01</span></a>',
    );
    const target = buildTarget(1);
    const handler = new HtmlHandler();
    const candidate = await extractOne(handler, $, target.extractors[0]!, target);
    expect((candidate.value as string[])[0]).toContain(
      "(https://example.test/post/a%20%28draft%29)",
    );
  });

  it("truncate shortens the composed field text without affecting the stored rawText", async () => {
    const $ = cheerio.load(
      '<a class="ex-card" href="/post/a"><span class="ex-title">A very long headline that ' +
        "should be truncated for display purposes only</span>" +
        '<span class="ex-cat">C</span><span class="ex-date">2026-09-01</span></a>',
    );
    const cfg = CmieConfig.parse({
      schemaVersion: 1,
      environment: {
        id: "t",
        displayName: "T",
        entities: [{ id: "p", name: "P", role: "primary" }],
      },
      sections: [{ id: "s", label: "S", order: 1 }],
      targets: [
        {
          id: "target-cards",
          label: "Target Cards",
          entityId: "p",
          sectionId: "s",
          kind: "html",
          url: "https://example.test/news",
          schedule: { cron: "0 6 * * *", ttlHours: 72 },
          extractors: [
            {
              key: "recent_items",
              label: "Recent Items",
              presenter: "list",
              kind: "html",
              type: "markdown",
              selector: ".ex-card",
              multiple: true,
              limit: 1,
              fields: {
                title: { selector: ".ex-title", truncate: 10 },
                url: { attr: "href", escape: "href" },
                cat: { selector: ".ex-cat" },
                date: { selector: ".ex-date" },
              },
              template: "[{title}]({url}) — {cat}, {date}",
            },
          ],
        },
      ],
    });
    const target = cfg.targets[0]!;
    const handler = new HtmlHandler();
    const candidate = await extractOne(handler, $, target.extractors[0]!, target);
    expect((candidate.value as string[])[0]).toContain("A very lon…");
    expect((candidate.rawText as string[])[0]).toContain(
      "A very long headline that should be truncated for display purposes only",
    );
  });
});
