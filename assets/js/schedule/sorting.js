import { localize } from "../i18n.js";

const TYPE_RANK = {
  lecture: 1,
  practical: 2,
  examination: 3,
  "college-event": 4
};

export function timeToMinutes(time) {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function sortOccurrences(events, locale = "en") {
  return [...events].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;

    const startCmp = timeToMinutes(a.start) - timeToMinutes(b.start);
    if (startCmp !== 0) return startCmp;

    const rankCmp = (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99);
    if (rankCmp !== 0) return rankCmp;

    return localize(a.title, locale).localeCompare(localize(b.title, locale));
  });
}

export function detectConflicts(events) {
  const active = events
    .filter((e) => e.status === "published" && e.start && e.end)
    .sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return timeToMinutes(a.start) - timeToMinutes(b.start);
    });

  const conflicts = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      if (a.date !== b.date) break;

      const aStart = timeToMinutes(a.start);
      const aEnd = timeToMinutes(a.end);
      const bStart = timeToMinutes(b.start);
      const bEnd = timeToMinutes(b.end);

      const overlaps = aStart < bEnd && bStart < aEnd;

      if (overlaps) {
        conflicts.push({
          severity: a.source === "institution" || b.source === "institution" ? "warning" : "error",
          date: a.date,
          events: [a, b],
          message: `Overlap between ${a.eventId} and ${b.eventId} on ${a.date}.`
        });
      }
    }
  }

  return conflicts;
}
