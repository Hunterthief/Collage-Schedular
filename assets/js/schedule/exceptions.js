import { dateInSameWeek, parseDate, weekdayName } from "./recurrence.js";

function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

export function applyExceptions(occurrences, exceptions, options) {
  const diagnostics = { errors: [], warnings: [] };
  const index = new Map();

  for (const ex of exceptions) {
    const groupKey = ex.group ?? "*";
    const key = `${ex.eventId}|${ex.date}|${groupKey}`;

    if (index.has(key)) {
      diagnostics.errors.push(`Duplicate exception key: ${key}`);
      continue;
    }

    index.set(key, ex);
  }

  const result = [];
  const consumed = new Set();

  for (const occ of occurrences) {
    const exactKey = `${occ.eventId}|${occ.originalDate}|${occ.group ?? ""}`;
    const wildcardKey = `${occ.eventId}|${occ.originalDate}|*`;

    const key = index.has(exactKey) ? exactKey : index.has(wildcardKey) ? wildcardKey : null;

    if (!key) {
      result.push(occ);
      continue;
    }

    consumed.add(key);
    const ex = index.get(key);

    if (ex.action === "cancel") {
      result.push({
        ...occ,
        status: "cancelled"
      });
      continue;
    }

    if (ex.action === "update") {
      result.push({
        ...occ,
        ...pick(ex, ["start", "end"]),
        location: ex.location ?? occ.location,
        status: "published"
      });
      continue;
    }

    if (ex.action === "move" || ex.action === "reschedule") {
      let newDate = ex.newDate ?? null;

      if (!newDate && ex.day) {
        newDate = dateInSameWeek(
          occ.originalDate,
          ex.day,
          options.settings?.weekStartDay ?? "Saturday"
        );

        if (!newDate) {
          diagnostics.errors.push(
            `Exception ${ex.id} has invalid target day "${ex.day}".`
          );
          result.push(occ);
          continue;
        }

        if (parseDate(newDate) < parseDate(occ.originalDate)) {
          diagnostics.errors.push(
            `Exception ${ex.id} moves ${occ.eventId} backwards without explicit newDate. Provide newDate to avoid ambiguity.`
          );
          result.push(occ);
          continue;
        }
      }

      if (!newDate) {
        diagnostics.errors.push(
          `Exception ${ex.id} has action move/reschedule but no newDate or valid day.`
        );
        result.push(occ);
        continue;
      }

      result.push({
        ...occ,
        date: newDate,
        day: weekdayName(parseDate(newDate)),
        ...pick(ex, ["start", "end"]),
        location: ex.location ?? occ.location,
        uid: occ.uid,
        uidBase: occ.uidBase ?? occ.uid,
        status: "published"
      });

      continue;
    }

    if (ex.action === "replace") {
      result.push({
        ...occ,
        status: "cancelled"
      });

      const replacement =
        ex.replacement ??
        options.eventById?.get(ex.replacementEventId) ??
        null;

      if (!replacement) {
        diagnostics.errors.push(
          `Exception ${ex.id} references missing replacement event.`
        );
        continue;
      }

      const date = ex.newDate ?? occ.date;
      const uid = ex.keepIdentity
        ? occ.uid
        : `${options.institutionId}:${replacement.id}:${date}:${occ.group ?? "all"}`;

      result.push({
        uid,
        uidBase: ex.keepIdentity ? occ.uidBase ?? occ.uid : uid,
        eventId: replacement.id,
        courseId: replacement.courseId ?? null,
        type: replacement.type ?? "college-event",
        title: replacement.title,
        date,
        originalDate: occ.originalDate,
        day: weekdayName(parseDate(date)),
        start: replacement.start ?? occ.start,
        end: replacement.end ?? occ.end,
        location: replacement.location ?? occ.location,
        group: occ.group,
        status: "published",
        source: "academic-replacement",
        sourceReview: replacement.sourceReview ?? []
      });

      continue;
    }

    diagnostics.errors.push(`Unknown exception action: ${ex.action}`);
    result.push(occ);
  }

  for (const [key, ex] of index.entries()) {
    if (!consumed.has(key)) {
      diagnostics.warnings.push(
        `Exception ${ex.id} did not match any materialized occurrence.`
      );
    }
  }

  return { occurrences: result, diagnostics };
}
