import { localize } from "../i18n.js";
import { parseDate, addDays, formatDate } from "../schedule/recurrence.js";

function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545: content lines MUST NOT exceed 75 octets; longer lines are folded
// with CRLF followed by a single space. Applied to EVERY line at the end.
function foldLine(line) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);

  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks = [];

  let i = 0;
  let first = true;

  while (i < bytes.length) {
    const limit = first ? 75 : 74;
    let end = Math.min(i + limit, bytes.length);

    while (end > i && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }

    chunks.push(decoder.decode(bytes.subarray(i, end)));
    i = end;
    first = false;
  }

  return chunks.join("\r\n ");
}

function toIcsUtc(date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function getOffsetMinutes(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  let hour = get("hour");
  if (hour === 24) hour = 0;

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  );

  return (asUtc - utcMs) / 60000;
}

function localToUtcIso(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);

  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);

  let offset = getOffsetMinutes(guess, timeZone);
  let utc = new Date(guess - offset * 60000);

  offset = getOffsetMinutes(utc.getTime(), timeZone);
  utc = new Date(guess - offset * 60000);

  return toIcsUtc(utc);
}

export function formatLocation(location, buildings, locale = "en") {
  if (!location) return "";

  const building = buildings.find(
    (b) => b.id === location.building || b.code === location.building
  );

  const parts = [];

  if (building) {
    parts.push(localize(building.name, locale));
  } else if (location.building) {
    parts.push(location.building);
  }

  if (location.floor != null) {
    parts.push(`Floor ${location.floor}`);
  }

  if (location.room) {
    parts.push(`Room ${location.room}`);
  }

  return parts.join(", ");
}

function fnv1a(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);

  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash % 100000000;
}

function sequenceFor(event) {
  const payload = JSON.stringify({
    start: event.start,
    end: event.end,
    endDate: event.endDate ?? null,
    allDay: !!event.allDay,
    location: event.location,
    title: event.title,
    status: event.status
  });

  return fnv1a(payload);
}

export function eventsToIcs(events, options) {
  const {
    calendarName,
    locale = "en",
    timezone,
    institutionId,
    locations,
    generatedAt = new Date()
  } = options;

  const buildings = locations?.buildings ?? [];
  const stamp = toIcsUtc(new Date(generatedAt));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//" + institutionId + "//College Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + escapeText(localize(calendarName, locale)),
    "X-WR-TIMEZONE:" + timezone,
    "X-WR-CALDESC:" + escapeText("Static college schedule feed.")
  ];

  for (const event of events) {
    if (event.status === "draft" || event.status === "completed") continue;
    if (!event.date) continue;

    let dtstartLine;
    let dtendLine;

    if (event.allDay) {
      dtstartLine = "DTSTART;VALUE=DATE:" + event.date.replace(/-/g, "");
      const endStr = event.endDate ?? event.date;
      const exclusive = formatDate(addDays(parseDate(endStr), 1));
      dtendLine = "DTEND;VALUE=DATE:" + exclusive.replace(/-/g, "");
    } else {
      if (!event.start || !event.end) continue;
      dtstartLine = "DTSTART:" + localToUtcIso(event.date, event.start, timezone);
      dtendLine = "DTEND:" + localToUtcIso(event.date, event.end, timezone);
    }

    const summary = escapeText(localize(event.title, locale));
    const location = escapeText(formatLocation(event.location, buildings, locale));

    const descriptionParts = [
      `Type: ${event.type}`,
      event.courseId ? `Course: ${event.courseId}` : null,
      event.group != null ? `Group: ${event.group}` : null,
      event.subdivision ? `Subdivision: ${event.subdivision}` : null,
      event.batch ? `Batch: ${event.batch}` : null,
      event.allDay ? "All-day" : null,
      ...(event.sourceReview ?? []).map(
        (r) => `Review: ${r.code}${r.detail ? " - " + r.detail : ""}`
      )
    ].filter(Boolean);

    const description = escapeText(descriptionParts.join("\n"));
    const status = event.status === "cancelled" ? "CANCELLED" : "CONFIRMED";

    lines.push(
      "BEGIN:VEVENT",
      "UID:" + event.uid,
      "DTSTAMP:" + stamp,
      "LAST-MODIFIED:" + stamp,
      "SEQUENCE:" + sequenceFor(event),
      "STATUS:" + status,
      dtstartLine,
      dtendLine,
      "SUMMARY:" + summary,
      location ? "LOCATION:" + location : null,
      description ? "DESCRIPTION:" + description : null,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");

  // Fold every line once, at the end, so UID and all other properties comply.
  return lines.filter(Boolean).map(foldLine).join("\r\n") + "\r\n";
}
