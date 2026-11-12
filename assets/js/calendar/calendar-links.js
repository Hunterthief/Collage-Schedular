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

  const relativeUrl = `${baseUrl}/${path}`;

  return absoluteUrl(relativeUrl, getCurrentBase());
}

export function googleCalendarSubscribeUrl(feedUrl, _ignoredBase) {
  const absoluteFeedUrl = absoluteUrl(feedUrl, getCurrentBase());

  return `https://calendar.google.com/calendar?cid=${encodeURIComponent(
    absoluteFeedUrl
  )}`;
}

export function webcalUrl(feedUrl, _ignoredBase) {
  const absoluteFeedUrl = absoluteUrl(feedUrl, getCurrentBase());

  return absoluteFeedUrl.replace(/^https?:\/\//, "webcal://");
}
