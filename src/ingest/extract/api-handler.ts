// kind: "api" — 03-INGESTION.md §1 "extract" step 1-2. JSONPath over a
// parsed response body. ADR-022 adds a second location shape: a composite
// location (`fields` + `template`, optionally `index`) resolves several
// jsonPaths against one "row" and composes them into one markdown string —
// see src/ingest/extract/compose.ts for the per-field transforms.
import { JSONPath } from "jsonpath-plus";
import type { ExtractorDef, TargetDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";
import type { FetchResult } from "../fetch/types.js";
import type { ExtractHandler, LocateResult } from "./types.js";
import { applyFieldTransform, composeTemplate, stableRawJson } from "./compose.js";

function stringifyMatch(m: unknown): string {
  return typeof m === "string" ? m : JSON.stringify(m);
}

function substituteIndex(jsonPath: string, index: number | null): string {
  return index === null ? jsonPath : jsonPath.replaceAll("{index}", String(index));
}

// Resolves `index.jsonPath` against `doc` per the config's declared `pick`
// (v1 ships only "first"). `null` return means "no row" (zero matches) or
// "not an integer" — callers that need to distinguish those throw their own
// error class from the raw matches; drift's use (resolveApiPaths, below)
// only needs "could this resolve at all".
function resolveIndexValue(doc: unknown, indexPath: string): number | null {
  const matches: unknown[] = JSONPath({ path: indexPath, json: doc as object });
  const picked = matches[0];
  if (matches.length === 0 || picked === undefined) return null;
  const n = typeof picked === "number" ? picked : Number(picked);
  return Number.isInteger(n) ? n : null;
}

/**
 * ADR-022 drift support: the resolved jsonPath(s) a `TYPE_CHANGED` check
 * should compare, keyed by name. Simple locations resolve to one entry
 * (`"value"`); composite locations resolve one entry per field, with
 * `{index}` substituted fresh against whichever `doc` is passed in — the
 * same as a real run would do independently against the fixture and the
 * live response.
 */
export function resolveApiPaths(doc: unknown, extractor: ExtractorDef): Record<string, string> {
  if (extractor.kind !== "api") return {};
  if (extractor.jsonPath !== undefined) return { value: extractor.jsonPath };
  if (!extractor.fields) return {};
  const indexValue = extractor.index ? resolveIndexValue(doc, extractor.index.jsonPath) : null;
  const out: Record<string, string> = {};
  for (const [name, field] of Object.entries(extractor.fields)) {
    out[name] = substituteIndex(field.jsonPath, indexValue);
  }
  return out;
}

export class ApiHandler implements ExtractHandler<unknown> {
  parse(fetchResult: FetchResult): unknown {
    try {
      return JSON.parse(fetchResult.body);
    } catch (err) {
      throw new IngestError(
        "PARSE_ERROR",
        `Response body is not valid JSON: ${(err as Error).message}`,
      );
    }
  }

  locate(doc: unknown, extractor: ExtractorDef, target: TargetDef): LocateResult {
    if (extractor.kind !== "api") {
      throw new Error(`ApiHandler received a non-api extractor "${extractor.key}"`);
    }
    if (extractor.jsonPath !== undefined) {
      const matches: unknown[] = JSONPath({ path: extractor.jsonPath, json: doc as object });
      const rawTexts = matches.map(stringifyMatch);
      const resolvedAnchors = matches.map(() => `${target.url}#${extractor.jsonPath}`);
      return { rawTexts, resolvedAnchors, matchCount: matches.length };
    }
    return this.locateComposite(doc, extractor, target);
  }

  private locateComposite(doc: unknown, extractor: ExtractorDef, target: TargetDef): LocateResult {
    if (extractor.kind !== "api" || !extractor.fields || !extractor.template) {
      throw new Error(
        `ApiHandler.locateComposite called on a non-composite extractor "${extractor.key}"`,
      );
    }

    let indexValue: number | null = null;
    if (extractor.index) {
      const rawMatches: unknown[] = JSONPath({
        path: extractor.index.jsonPath,
        json: doc as object,
      });
      if (rawMatches.length === 0) {
        // No row to bind fields to — SELECTOR_NO_MATCH, same as a scalar
        // location with zero matches (pipeline.ts's extractOne throws this
        // uniformly from matchCount === 0).
        return { rawTexts: [], resolvedAnchors: [], matchCount: 0 };
      }
      indexValue = resolveIndexValue(doc, extractor.index.jsonPath);
      if (indexValue === null) {
        throw new IngestError(
          "PARSE_ERROR",
          `extractor "${extractor.key}": index.jsonPath "${extractor.index.jsonPath}" ` +
            `resolved to a non-integer (${JSON.stringify(rawMatches[0])})`,
        );
      }
    }

    const rawValues: Record<string, string> = {};
    const resolvedPaths: Record<string, string> = {};
    for (const [name, field] of Object.entries(extractor.fields)) {
      const resolvedPath = substituteIndex(field.jsonPath, indexValue);
      resolvedPaths[name] = resolvedPath;
      const matches: unknown[] = JSONPath({ path: resolvedPath, json: doc as object });
      if (matches.length === 0) {
        throw new IngestError(
          "SELECTOR_NO_MATCH",
          `extractor "${extractor.key}": field "${name}" (${resolvedPath}) matched 0 nodes`,
          { failingSelector: resolvedPath },
        );
      }
      if (matches.length > 1) {
        throw new IngestError(
          "SELECTOR_AMBIGUOUS",
          `extractor "${extractor.key}": field "${name}" (${resolvedPath}) matched ${matches.length} nodes`,
          { failingSelector: resolvedPath },
        );
      }
      rawValues[name] = stringifyMatch(matches[0]);
    }

    const transformed: Record<string, string> = {};
    for (const [name, field] of Object.entries(extractor.fields)) {
      transformed[name] = applyFieldTransform(
        rawValues[name]!,
        field,
        extractor.key,
        name,
        target.url,
      );
    }
    if (extractor.index) transformed.index = String(indexValue);
    const composedText = composeTemplate(extractor.template, transformed);
    const rawJson = stableRawJson(rawValues);

    const anchorParts: string[] = [];
    if (extractor.index) anchorParts.push(`index@${indexValue}:${extractor.index.jsonPath}`);
    for (const [name, path] of Object.entries(resolvedPaths)) anchorParts.push(`${name}:${path}`);
    const anchor = `${target.url}#${anchorParts.join(" ")}`;

    return {
      rawTexts: [rawJson],
      resolvedAnchors: [anchor],
      matchCount: 1,
      texts: [composedText],
    };
  }
}
