export function buildFeedUrl(assignment, manifest) {
  if (assignment.practicalGroup == null) return null;

  const baseUrl = manifest.calendarFeeds.baseUrl.replace(/\/$/, "");
  const template =
    manifest.calendarFeeds.pathTemplate ??
    "{programId}/{academicYearId}/group-{group}.ics";

  const subdivision = assignment.subdivision ? String(assignment.subdivision).toUpperCase() : "";

  const path = template
    .replace("{programId}", assignment.programId)
    .replace("{academicYearId}", assignment.academicYearId)
    .replace("{group}", String(assignment.practicalGroup))
    .replace("{subdivision}", subdivision)
    .replace("{subdivisionLower}", subdivision.toLowerCase());

  return `${baseUrl}/${path}`;
}

export function absoluteUrl(path, origin) {
  return new URL(path, origin).href;
}

export function googleCalendarSubscribeUrl(feedUrl, origin) {
  const abs = absoluteUrl(feedUrl, origin);
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(abs)}`;
}

export function webcalUrl(feedUrl, origin) {
  const abs = absoluteUrl(feedUrl, origin);
  return abs.replace(/^https?:\/\//, "webcal://");
}
