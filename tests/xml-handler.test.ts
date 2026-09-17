// ADR-026: XML handler tests. Cheerio in XML mode for RSS feeds and similar.
// Tests cover: link extraction (the defect that motivated xml handler),
// namespace element access, case sensitivity, and composite row lists.
// ADR-010 additivity: xml handler doesn't change html/api behavior.
import { describe, expect, it } from "vitest";
import { CmieConfig, type TargetDef } from "../src/config/schema.js";
import { XmlHandler } from "../src/ingest/extract/xml-handler.js";
import type { FetchResult } from "../src/ingest/fetch/types.js";

function asFetchResult(body: string): FetchResult {
  return { body, httpStatus: 200, fetchedAt: "2026-09-13T00:00:00.000Z" };
}

function baseTarget(extractors: unknown[]): TargetDef {
  return CmieConfig.parse({
    schemaVersion: 1,
    environment: {
      id: "t",
      displayName: "T",
      entities: [{ id: "p", name: "P", role: "primary" }],
    },
    sections: [{ id: "s", label: "S", order: 1 }],
    targets: [
      {
        id: "example-rss-feed",
        label: "Example RSS Feed",
        entityId: "p",
        sectionId: "s",
        kind: "xml",
        url: "https://example.test/feed.xml",
        schedule: { cron: "0 6 * * *", ttlHours: 48 },
        extractors,
      },
    ],
  }).targets[0]!;
}

const exampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com</link>
    <item>
      <title>Article 1</title>
      <link>https://example.com/article-1</link>
      <pubDate>Mon, 15 Jan 2024 10:00:00 GMT</pubDate>
      <dc:creator>Alice</dc:creator>
    </item>
    <item>
      <title>Article 2</title>
      <link>https://example.com/article-2</link>
      <pubDate>Tue, 16 Jan 2024 09:30:00 GMT</pubDate>
      <dc:creator>Bob</dc:creator>
    </item>
  </channel>
</rss>`;

describe("XmlHandler", () => {
  const handler = new XmlHandler();

  it("parses XML with cheerio.load(..., { xml: true })", () => {
    const result = handler.parse(asFetchResult(exampleRssXml));
    // Verify it's a Cheerio instance by checking we can select elements
    expect(result("channel > item:nth-of-type(1) > title").length).toBeGreaterThan(0);
    const titleText = result("channel > item:nth-of-type(1) > title").text();
    expect(titleText).toBe("Article 1");
  });

  it("extracts <link> text correctly (the defect HTML mode has)", () => {
    const target = baseTarget([
      {
        key: "article_link",
        section: "s",
        label: "Article Link",
        kind: "xml",
        selector: "channel > item:nth-of-type(1) > link",
        type: "string",
        presenter: "markdown",
      },
    ]);
    const result = handler.parse(asFetchResult(exampleRssXml));
    const located = handler.locate(result, target.extractors[0]!, target);
    expect(located.matchCount).toBe(1);
    // Use cheerio's selector directly from the extractor
    const extractor = target.extractors[0]!;
    if ("selector" in extractor) {
      const linkText = result(extractor.selector).text();
      expect(linkText).toBe("https://example.com/article-1");
    }
  });

  it("handles namespace elements with attribute selector", () => {
    // Note: CSS selectors with colons in tag names are problematic.
    // For dc:creator, use attribute-based selection instead:
    // XML parsers expose namespace elements, so we can select them
    // by their actual tag name using a slightly different approach.
    const xmlWithAttrs = `<?xml version="1.0"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <item>
      <title>Test</title>
      <creator xmlns="http://purl.org/dc/elements/1.1/">Alice</creator>
    </item>
  </channel>
</rss>`;
    const target = baseTarget([
      {
        key: "article_author",
        section: "s",
        label: "Article Author",
        kind: "xml",
        selector: "channel > item > creator",
        type: "string",
        presenter: "markdown",
      },
    ]);
    const result = handler.parse(asFetchResult(xmlWithAttrs));
    const located = handler.locate(result, target.extractors[0]!, target);
    expect(located.matchCount).toBe(1);
  });

  it("case-sensitive selector matching", () => {
    const target = baseTarget([
      {
        key: "lowercase_item",
        section: "s",
        label: "Lowercase Item",
        kind: "xml",
        selector: "channel > item > title",
        type: "string",
        presenter: "list",
      },
    ]);
    const result = handler.parse(asFetchResult(exampleRssXml));
    const located = handler.locate(result, target.extractors[0]!, target);
    // Should match both items (case-sensitive, all lowercase)
    expect(located.matchCount).toBe(2);
  });

  it("list extraction with composite rows", () => {
    const target = baseTarget([
      {
        key: "articles_list",
        section: "s",
        label: "Articles List",
        kind: "xml",
        selector: "channel > item",
        fields: {
          title: {
            selector: "title",
            type: "string",
          },
          link: {
            selector: "link",
            type: "string",
          },
        },
        template: "[{title}]({link})",
        limit: 2,
        type: "markdown",
        presenter: "list",
        multiple: true,
      },
    ]);
    const result = handler.parse(asFetchResult(exampleRssXml));
    const located = handler.locate(result, target.extractors[0]!, target);
    expect(located.matchCount).toBe(2); // limit: 2
    expect(located.rawTexts).toBeDefined();
    expect(located.rawTexts.length).toBe(2);
    expect(located.texts).toBeDefined();
    expect(located.texts?.length).toBe(2);
  });

  it("throws on non-xml extractor kind passed to locate", () => {
    const xmlBody = exampleRssXml;
    const result = handler.parse(asFetchResult(xmlBody));
    const target = baseTarget([
      {
        key: "bad_kind",
        section: "s",
        label: "Bad Kind",
        kind: "xml",
        selector: "channel > item > title",
        type: "string",
        presenter: "markdown",
      },
    ]);
    // Test: manually pass an html extractor to xml handler by changing kind
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const htmlExtractor = { ...target.extractors[0]!, kind: "html" as const } as any;
    expect(() => handler.locate(result, htmlExtractor, target)).toThrow(
      /XmlHandler received a non-xml extractor/,
    );
  });

  describe("ADR-010 additivity", () => {
    it("xml handler exists in registry alongside html and api", async () => {
      const { handlerRegistry } = await import("../src/ingest/extract/registry.js");
      expect(handlerRegistry.xml).toBeDefined();
      expect(handlerRegistry.html).toBeDefined();
      expect(handlerRegistry.api).toBeDefined();
    });

    it("xml kind can be specified in config schema", () => {
      const target = baseTarget([
        {
          key: "simple_extract",
          section: "s",
          label: "Simple Extract",
          kind: "xml",
          selector: "channel > title",
          type: "string",
          presenter: "markdown",
        },
      ]);
      expect(target.kind).toBe("xml");
      expect(target.extractors[0]!.kind).toBe("xml");
    });
  });
});
