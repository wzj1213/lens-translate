import type { Settings, SiteRule, SiteRuleMode } from "./types";

/** Normalize a user-entered host pattern (strip scheme/path, leading www). */
export function normalizeHost(input: string): string {
  let host = String(input || "").trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  return host;
}

/**
 * Match the most specific per-site rule for a hostname.
 *   - exact host                       (strongest)
 *   - "*.example.com" wildcard
 *   - parent domain "example.com" covering "sub.example.com"
 * Returns the winning rule's mode, or null when nothing matches.
 */
export function matchPerSiteRule(rules: SiteRule[], hostname: string): SiteRuleMode | null {
  const host = normalizeHost(hostname);
  if (!host) return null;

  let best: { mode: SiteRuleMode; score: number; len: number } | null = null;
  for (const rule of rules) {
    const pattern = normalizeHost(rule.host);
    if (!pattern) continue;
    const score = scoreMatch(pattern, host);
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && pattern.length > best.len)) {
      best = { mode: rule.mode, score, len: pattern.length };
    }
  }
  return best?.mode ?? null;
}

function scoreMatch(pattern: string, host: string): number {
  if (pattern === host) return 3;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    if (host === base || host.endsWith(`.${base}`)) return 2;
    return 0;
  }
  if (host === pattern || host.endsWith(`.${pattern}`)) return 1;
  return 0;
}

export function upsertSiteRule(rules: SiteRule[], host: string, mode: SiteRuleMode): SiteRule[] {
  const norm = normalizeHost(host);
  if (!norm) return rules;
  const next = rules.filter((r) => normalizeHost(r.host) !== norm);
  next.push({ host: norm, mode });
  next.sort((a, b) => a.host.localeCompare(b.host));
  return next;
}

export function removeSiteRule(rules: SiteRule[], host: string): SiteRule[] {
  const norm = normalizeHost(host);
  return rules.filter((r) => normalizeHost(r.host) !== norm);
}

/**
 * Is auto-translate on for THIS host? A per-site rule always wins over the
 * global default, in both directions — that is what makes the in-page / popup
 * auto switch able to turn auto OFF on a site the global default (or a parent
 * domain rule) would otherwise force on.
 */
export function isAutoOnFor(settings: Pick<Settings, "siteRules" | "autoTranslateEnabled">, hostname: string): boolean {
  const rule = matchPerSiteRule(settings.siteRules, hostname);
  if (rule === "always") return true;
  if (rule === "never") return false;
  return settings.autoTranslateEnabled;
}

/**
 * Turn auto-translate on/off for one host by writing an EXPLICIT rule. Writing
 * the rule (instead of flipping the global flag) is what scopes the switch to
 * the site the user is actually looking at, and guarantees the switch works
 * even when a broader rule or the global default disagrees.
 */
export function setAutoForHost(
  settings: Pick<Settings, "siteRules" | "autoTranslateEnabled">,
  hostname: string,
  enabled: boolean,
): SiteRule[] {
  const host = normalizeHost(hostname);
  if (!host) return settings.siteRules;
  // When the global default already matches the wish AND no other rule would
  // override it, drop the explicit rule so the site simply follows "default".
  const without = removeSiteRule(settings.siteRules, host);
  const inherited = matchPerSiteRule(without, host);
  const inheritedValue = inherited === "always" ? true : inherited === "never" ? false : settings.autoTranslateEnabled;
  if (inheritedValue === enabled) return without;
  return upsertSiteRule(without, host, enabled ? "always" : "never");
}
