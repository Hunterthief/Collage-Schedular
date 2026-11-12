function getCurrentBase() {
  if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
  if (typeof window !== "undefined" && window.location?.href) return window.location.href;
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

function cohortCount(manifest, assignment) {
  return (manifest?.assignments ?? []).filter(
    (a) => a.programId === assignment.programId && a.academicYearId === assignment.academicYearId
  ).length;
}

export function buildFeedUrl(assignment, manifest) {
  if (!assignment || assignment.practicalGroup == null) return null;

  const feeds = manifest?.calendarFeeds ?? {};
  const baseUrl = String(feeds.baseUrl ?? "calendar/feeds").replace(/\/$/, "");
  const subdivision = assignment.subdivision ? String(assignment.subdivision).toUpperCase() : "";
  const level = assignment.yearLevel ?? null;

  // When a program/calendar-year holds more than one cohort (year level),
  // feeds are level-scoped. With a single cohort, legacy URLs are preserved.
  const useLevel = level != null && cohortCount(manifest, assignment) > 1;

  const template = useLevel
    ? (subdivision
        ? feeds.levelSubdivisionPathTemplate ?? "{programId}/{academicYearId}/year-{level}/group-{group}-{subdivisionLower}.ics"
        : feeds.levelPathTemplate ?? "{programId}/{academicYearId}/year-{level}/group-{group}.ics")
    : (subdivision
        ? feeds.subdivisionPathTemplate ?? "{programId}/{academicYearId}/group-{group}-{subdivisionLower}.ics"
        : feeds.pathTemplate ?? "{programId}/{academicYearId}/group-{group}.ics");

  const path = template
    .replace("{programId}", assignment.programId)
    .replace("{academicYearId}", assignment.academicYearId)
    .replace("{level}", level == null ? "" : String(level))
    .replace("{group}", String(assignment.practicalGroup))
    .replace("{subdivision}", subdivision)
    .replace("{subdivisionLower}", subdivision.toLowerCase());

  return absoluteUrl(`${baseUrl}/${path}`, getCurrentBase());
}

export function googleCalendarAddByUrlUrl() {
  return "https://calendar.google.com/calendar/u/0/r/settings/addbyurl";
}

export function webcalUrl(feedUrl, _ignoredBase) {
  const absoluteFeedUrl = absoluteUrl(feedUrl, getCurrentBase());
  return absoluteFeedUrl.replace(/^https?:\/\//, "webcal://");
}

export function googleCalendarSubscribeUrl(feedUrl, _ignoredBase) {
  return `https://www.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(feedUrl))}`;
}
