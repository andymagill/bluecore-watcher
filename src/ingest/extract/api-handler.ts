// kind: "api" — 03-INGESTION.md §1 "extract" step 1-2. JSONPath over a
// parsed response body.
import { JSONPath } from "jsonpath-plus";
import type { ExtractorDef, TargetDef } from "../../config/schema.js";
import { IngestError } from "../errors.js";
import type { FetchResult } from "../fetch/types.js";
import type { ExtractHandler, LocateResult } from "./types.js";

export class ApiHandler implements ExtractHandler<unknown> {
  parse(fetchResult: FetchResult): unknown {
    try {
      return JSON.parse(fetchResult.body);
    } catch (err) {
      throw new IngestError("PARSE_ERROR", `Response body is not valid JSON: ${(err as Error).message}`);
    }
  }

  locate(doc: unknown, extractor: ExtractorDef, target: TargetDef): LocateResult {
    if (extractor.kind !== "api") {
      throw new Error(`ApiHandler received a non-api extractor "${extractor.key}"`);
    }
    const matches: unknown[] = JSONPath({ path: extractor.jsonPath, json: doc as object });
    const rawTexts = matches.map((m) => (typeof m === "string" ? m : JSON.stringify(m)));
    const resolvedAnchors = matches.map(() => `${target.url}#${extractor.jsonPath}`);
    return { rawTexts, resolvedAnchors, matchCount: matches.length };
  }
}
