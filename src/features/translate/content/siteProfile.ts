import profiles from "./siteProfiles.json";

export function profileFor(url: URL) {
  return profiles.find(rule => rule.host === url.hostname && new RegExp(rule.path).test(url.pathname));
}

let lastUrl = "";
let active: ReturnType<typeof profileFor>;
export function inReadingArea(element: Element): boolean {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    active = profileFor(new URL(lastUrl));
  }
  return !active || (!element.closest(active.exclude) && Boolean(element.closest(active.include)));
}
