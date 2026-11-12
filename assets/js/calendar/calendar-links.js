function getCurrentBase() {
  if (typeof document !== "undefined" && document.baseURI) {
    return document.baseURI;
  }
  if (typeof window !== "undefined" && window.location?.href) {
    return window.location.href;
  }
  return "/";
}

export function absoluteUrl(path, base = getCurrentBase()) {
  if (!path) return "";
  try {
    return new URL(path, base).href;
  } catch {
    return path;
  }
}

export function buildFeedUrl(assignment, manifest) {
  if (!assignment || assignment.practicalGroup == null) {
    return null;
  }

  const feeds = manifest?.calendarFeeds ?? {};
  const baseUrl = String(feeds.baseUrl ?? "calendar/feeds").replace(/\/$/, "");

  const template =
    feeds.pathTemplate ??
    "{programId}/{academicYearId}/group-{group}.ics";

  const subdivision = assignment.subdivision
    ? String(assignment.subdivision).toUpperCase()
    : "";

  const path = template
    .replace("{programId}", assignment.programId)
    .replace("{academicYearId}", assignment.academicYearId)
    .replace("{group}", String(assignment.practicalGroup))
    .replace("{subdivision}", subdivision)
    .replace("{subdivisionLower}", subdivision.toLowerCase());

  return absoluteUrl(`${baseUrl}/${path}`, getCurrentBase());
}

// Google's official "Add by URL" page. This is the reliable subscription
// route: the user pastes the feed URL here and clicks "Add calendar".
// It does NOT support pre-filling via ?url= or ?cid= parameters.
export function googleCalendarAddByUrlUrl() {
  return "https://calendar.google.com/calendar/u/0/r/settings/addbyurl";
}

export function webcalUrl(feedUrl, _ignoredBase) {
  const absoluteFeedUrl = absoluteUrl(feedUrl, getCurrentBase());
  return absoluteFeedUrl.replace(/^https?:\/\//, "webcal://");
}

// Legacy one-click attempt. Google's render?cid= endpoint is unreliable for
// external ICS feeds; kept only as a labelled fallback in the UI.
export function googleCalendarSubscribeUrl(feedUrl, _ignoredBase) {
  const webcal = webcalUrl(feedUrl);
  return `https://www.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
}
