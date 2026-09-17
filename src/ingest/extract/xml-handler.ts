// kind: "xml" — ADR-026. Cheerio in XML mode, for RSS feeds and similar.
// The only difference from HtmlHandler is cheerio.load(body, { xml: true })
// — HTML mode treats <link> as a void element (empty string match), while XML
// mode parses it with text content. All selector matching and location logic
// reuses the shared cheerio-locate module.
import * as cheerio from "cheerio";
import type { ExtractorDef, TargetDef } from "../../config/schema.js";
import type { FetchResult } from "../fetch/types.js";
import type { ExtractHandler, LocateResult } from "./types.js";
import { locateCompositeRows, locateScalar } from "./cheerio-locate.js";

export class XmlHandler implements ExtractHandler<cheerio.CheerioAPI> {
  parse(fetchResult: FetchResult): cheerio.CheerioAPI {
    return cheerio.load(fetchResult.body, { xml: true });
  }

  locate($: cheerio.CheerioAPI, extractor: ExtractorDef, target: TargetDef): LocateResult {
    if (extractor.kind !== "xml") {
      throw new Error(`XmlHandler received a non-xml extractor "${extractor.key}"`);
    }
    if (extractor.fields !== undefined) {
      return locateCompositeRows($, extractor, target);
    }
    return locateScalar($, extractor, target);
  }
}
