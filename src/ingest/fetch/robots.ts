// Minimal robots.txt parser for 03-INGESTION.md §1 "fetch": "Honour
// respectRobotsTxt, cached per host per run." Practical subset: matches the
// exact User-agent first, falls back to "*", collects Disallow prefixes, and
// treats an empty Disallow value as "allow everything" per the de-facto
// standard. Deliberately does not implement Allow-overrides-Disallow
// precedence or wildcard/$ path matching — no triaged source (05-SOURCES.md
// §4) needs it, and a stricter parser is cheap to add if one ever does.
export interface RobotsRules {
  disallowedPrefixes: string[];
}

export const ALLOW_ALL: RobotsRules = { disallowedPrefixes: [] };

export function parseRobotsTxt(body: string, userAgent: string): RobotsRules {
  const lines = body.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[] } | null = null;

  for (const line of lines) {
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      // Consecutive User-agent lines (before any Disallow) share one rule
      // set; a User-agent line seen *after* a Disallow starts a new group.
      if (current && current.disallow.length === 0) {
        current.agents.push(value);
      } else {
        current = { agents: [value], disallow: [] };
        groups.push(current);
      }
    } else if (key === "disallow" && current) {
      if (value !== "") current.disallow.push(value);
    }
  }

  const ua = userAgent.toLowerCase();
  const exact = groups.find((g) => g.agents.some((a) => a.toLowerCase() === ua));
  const wildcard = groups.find((g) => g.agents.some((a) => a === "*"));
  const match = exact ?? wildcard;
  return match ? { disallowedPrefixes: match.disallow } : ALLOW_ALL;
}

export function isDisallowed(pathname: string, rules: RobotsRules): boolean {
  return rules.disallowedPrefixes.some((prefix) => pathname.startsWith(prefix));
}
