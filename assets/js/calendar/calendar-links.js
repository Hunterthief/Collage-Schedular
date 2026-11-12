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

function cohortsFor(assignment, manifest) {
  return (manifest?.assignments ?? []).filter(
    (a) =>
      a.programId === assignment.programId &&
      a.academicYearId === assignment.academicYearId
  );
}

// The year level is part of the feed identity. Prefer the resolved assignment,
// then fall back to the manifest cohort when it is unambiguous.
export function resolveYearLevel(assignment, manifest) {
  if (!assignment) return null;

  if (assignment.yearLevel != null && assignment.yearLevel !== "") {
    const n = Number(assignment.yearLevel);
    return Number.isFinite(n) ? n : null;
  }

  const matches = cohortsFor(assignment, manifest).filter((a) => a.yearLevel != null);
  if (matches.length === 1) {
    const n = Number(matches[0].yearLevel);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function renderTemplate(template, values) {
  return template
    .replace("{programId}", values.programId)
    .replace("{academicYearId}", values.academicYearId)
    .replace("{level}", values.level == null ? "" : String(values.level))
    .replace("{group}", String(values.group))
    .replace("{subdivision}", values.subdivision)
    .replace("{subdivisionLower}", values.subdivision.toLowerCase());
}

export function buildFeedUrl(assignment, manifest) {
  if (!assignment || assignment.practicalGroup == null) return null;

  const feeds = manifest?.calendarFeeds ?? {};
  const baseUrl = String(feeds.baseUrl ?? "calendar/feeds").replace(/\/$/, "");
  const subdivision = assignment.subdivision
    ? String(assignment.subdivision).toUpperCase()
    : "";
  const level = resolveYearLevel(assignment, manifest);

  // Year-scoped paths are always used when the level is known, so 1st / 2nd /
  // 3rd / 4th year feeds never collide and never change when a year is added.
  const template =
    level != null
      ? subdivision
        ? feeds.levelSubdivisionPathTemplate ??
          "{programId}/{academicYearId}/year-{level}/group-{group}-{subdivisionLower}.ics"
        : feeds.levelPathTemplate ??
          "{programId}/{academicYearId}/year-{level}/group-{group}.ics"
      : subdivision
        ? feeds.subdivisionPathTemplate ??
          "{programId}/{academicYearId}/group-{group}-{subdivisionLower}.ics"
        : feeds.pathTemplate ?? "{programId}/{academicYearId}/group-{group}.ics";

  const rel = renderTemplate(template, {
    programId: assignment.programId,
    academicYearId: assignment.academicYearId,
    level,
    group: assignment.practicalGroup,
    subdivision
  });

  return absoluteUrl(`${baseUrl}/${rel}`, getCurrentBase());
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
