// @vitest-environment jsdom
// ADR-025 — ListBlock renders each row's displayValue as sanitized inline
// markdown (a composite row's own `[title](url) — ...` template), exactly
// one `data-block-key` node per block regardless of row count (src/gate/
// smoke-render.ts's rendered-vs-published block-count check depends on
// this), and suppresses stale rows behind an expired-state disclosure the
// same way MarkdownBlock does.
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { ListBlock } from "../../src/app/components/ListBlock.js";
import type { ListBlock as ListBlockType } from "../../src/contract/block.js";

afterEach(cleanup);

const NOW = new Date("2026-09-12T00:00:00Z");

function makeBlock(overrides: Partial<ListBlockType> = {}): ListBlockType {
  return {
    key: "recent_items",
    label: "Recent Items",
    type: "markdown",
    presenter: "list",
    status: "ok",
    value: ['{"title":"First"}', '{"title":"Second"}'],
    displayValue: [
      "[First Item](https://example.test/post/a) — Alpha, 08 Sep 2026",
      "[Second Item](https://example.test/post/b) — Beta, 01 Sep 2026",
    ],
    provenance: {
      sourceUrl: "https://example.test/news",
      anchor: [
        "https://example.test/news#.row:nth-of-type(1)",
        "https://example.test/news#.row:nth-of-type(2)",
      ],
      extractedAt: "2026-09-12T00:00:00Z",
      rawText: ['{"title":"First"}', '{"title":"Second"}'],
      contentHash: "sha256:aabbcc",
    },
    delta: {
      kind: "set",
      added: [],
      removed: [],
      count: 2,
      previousCount: 2,
      changedAt: "2026-09-12T00:00:00Z",
    },
    validation: { passed: true, warnings: [] },
    ...overrides,
  };
}

describe("ListBlock (ADR-025)", () => {
  it("renders each row as sanitized inline markdown with a working per-item link", () => {
    const { container } = render(
      <ListBlock targetId="example-newsroom" block={makeBlock()} ttlHours={168} now={NOW} />,
    );
    const links = container.querySelectorAll("li a[href]");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://example.test/post/a");
    expect(links[0]!.textContent).toBe("First Item");
    expect(links[1]).toHaveAttribute("href", "https://example.test/post/b");
  });

  it("sanitizes a row that carries raw HTML instead of executing it", () => {
    const block = makeBlock({
      displayValue: ["[Click](https://example.test/x)<script>window.__pwned = true</script>"],
      value: ['{"title":"x"}'],
      provenance: {
        ...makeBlock().provenance!,
        anchor: ["https://example.test/news#.row"],
        rawText: ['{"title":"x"}'],
      },
      delta: {
        kind: "set",
        added: [],
        removed: [],
        count: 1,
        previousCount: 1,
        changedAt: "2026-09-12T00:00:00Z",
      },
    });
    const { container } = render(
      <ListBlock targetId="example-newsroom" block={block} ttlHours={168} now={NOW} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("exactly one data-block-key node per block, regardless of row count", () => {
    const { container } = render(
      <ListBlock targetId="example-newsroom" block={makeBlock()} ttlHours={168} now={NOW} />,
    );
    expect(
      container.querySelectorAll('[data-block-key="example-newsroom.recent_items"]'),
    ).toHaveLength(1);
  });

  it("suppresses expired rows behind a disclosure while still counting the data-block-key node", () => {
    const block = makeBlock({
      status: "cached",
      provenance: {
        ...makeBlock().provenance!,
        extractedAt: "2020-01-01T00:00:00Z", // far past the default 3x ttlHours ceiling
      },
    });
    const { container } = render(
      <ListBlock targetId="example-newsroom" block={block} ttlHours={168} now={NOW} />,
    );
    const node = container.querySelector('[data-block-key="example-newsroom.recent_items"]');
    expect(node).not.toBeNull();
    expect(node!.querySelector("details")).not.toBeNull();
    expect(node!.querySelectorAll("li a[href]")).toHaveLength(2);
  });

  it("spans the full grid row via col-span-full", () => {
    const { container } = render(
      <ListBlock targetId="example-newsroom" block={makeBlock()} ttlHours={168} now={NOW} />,
    );
    expect(container.querySelector('[data-block-key="example-newsroom.recent_items"]')).toHaveClass(
      "col-span-full",
    );
  });

  it("renders a ZeroState (still one data-block-key node) when the block is missing", () => {
    const block = makeBlock({
      status: "missing",
      value: null,
      displayValue: null,
      provenance: null,
      delta: null,
    });
    const { container } = render(
      <ListBlock targetId="example-newsroom" block={block} ttlHours={168} now={NOW} />,
    );
    expect(
      container.querySelectorAll('[data-block-key="example-newsroom.recent_items"]'),
    ).toHaveLength(1);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
