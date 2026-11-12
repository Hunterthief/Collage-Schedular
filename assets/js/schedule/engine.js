import { createShorthandParser } from "./shorthand.js";
import { expandWeekly, parseDate, weekdayName } from "./recurrence.js";
import { applyExceptions } from "./exceptions.js";
import { institutionEventMatches } from "./targeting.js";
import { sortOccurrences, detectConflicts } from "./sorting.js";

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.events)) return value.events;
  if (value && Array.isArray(value.exceptions)) return value.exceptions;
  if (value && Array.isArray(value.courses)) return value.courses;
  return [];
}

function normalizeSubdivision(value) {
  if (value == null) return null;
  const text = String(value).trim().toUpperCase();
  return text || null;
}

export function buildCourseMap(courses, diagnostics) {
  const map = new Map();
  for (const course of toArray(courses)) {
    if (!course.id) {
      diagnostics.errors.push("Course missing id.");
      continue;
    }
    if (map.has(course.id)) {
      diagnostics.errors.push(`Duplicate course id: ${course.id}`);
      continue;
    }
    map.set(course.id, course);
  }
  return map;
}

export function normalizeEvents(rawList, fallbackType, parser, courseMap, diagnostics) {
  const out = [];
  const seen = new Set();

  for (const raw of toArray(rawList)) {
    if (!raw.id) {
      diagnostics.errors.push("Event missing id.");
      continue;
    }
    if (seen.has(raw.id)) {
      diagnostics.errors.push(`Duplicate event id: ${raw.id}`);
      continue;
    }
    seen.add(raw.id);

    const parsed = raw.shorthand ? parser.parse(raw.shorthand) : null;
    const type = raw.type ?? parsed?.type ?? fallbackType;

    if (!["lecture", "practical", "examination"].includes(type)) {
      diagnostics.errors.push(`Event ${raw.id} has invalid type: ${type}`);
      continue;
    }

    const location = raw.location ?? parsed?.location ?? null;

    if (parsed && raw.location) {
      if (parsed.location.building !== raw.location.building) {
        diagnostics.errors.push(`Event ${raw.id} shorthand building conflicts with structured location.`);
      }
      if (parsed.location.floor !== raw.location.floor) {
        diagnostics.errors.push(`Event ${raw.id} shorthand floor conflicts with structured location.`);
      }
    }

    const course = raw.courseId ? courseMap.get(raw.courseId) : null;
    if (raw.courseId && !course) {
      diagnostics.errors.push(`Event ${raw.id} references unknown course ${raw.courseId}.`);
      continue;
    }

    const title = raw.title ?? course?.title ?? parsed?.title;
    if (!title) {
      diagnostics.errors.push(`Event ${raw.id} has no resolvable title.`);
      continue;
    }

    out.push({
      ...raw,
      id: raw.id,
      type,
      location,
      title,
      courseId: raw.courseId ?? course?.id ?? null,
      displayCode: raw.displayCode ?? raw.shorthand ?? null,
      subdivisions: Array.isArray(raw.subdivisions)
        ? raw.subdivisions.map(normalizeSubdivision).filter(Boolean)
        : raw.subdivisions ?? null
    });
  }

  return out;
}

function appliesToGroup(def, targetGroup) {
  if (!def.groups || def.groups.length === 0) return true;
  if (def.groups.includes("all")) return true;
  if (targetGroup == null) return false;
  return def.groups.includes(targetGroup);
}

function appliesToSubdivision(def, targetSubdivision) {
  const allowed = def.subdivisions;
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  if (targetSubdivision == null) return false;
  return allowed.map(normalizeSubdivision).filter(Boolean).includes(targetSubdivision);
}

function makeOccurrence({ def, date, start, end, group, subdivision, institutionId }) {
  const sub = normalizeSubdivision(subdivision);
  const uid = `${institutionId}:${def.id}:${date}:${group ?? "all"}${sub ? `:${sub}` : ""}`;

  return {
    uid,
    uidBase: uid,
    eventId: def.id,
    courseId: def.courseId ?? null,
    type: def.type,
    title: def.title,
    date,
    originalDate: date,
    day: weekdayName(parseDate(date)),
    start,
    end,
    location: def.location ?? null,
    group: group ?? null,
    subdivision: sub,
    status: "published",
    source: "academic",
    sourceReview: def.sourceReview ?? [],
    validFrom: def.validFrom ?? null,
    validUntil: def.validUntil ?? null
  };
}

export function materializeAcademicOccurrences(
  defs, semester, targetGroup, settings, institutionId, diagnostics, targetSubdivision = null
) {
  const out = [];
  const targetSub = normalizeSubdivision(targetSubdivision);

  if (!semester.validFrom || !semester.validUntil) {
    diagnostics.warnings.push(`Semester ${semester.id} has missing date window.`);
    return out;
  }

  for (const def of defs) {
    if (def.type === "practical") {
      if (!Array.isArray(def.sessions) || def.sessions.length === 0) {
        diagnostics.errors.push(`Practical ${def.id} has no sessions.`);
        continue;
      }
      if (targetGroup == null) continue;
      if (!appliesToSubdivision(def, targetSub)) continue;

      for (const session of def.sessions) {
        if (session.group !== targetGroup) continue;
        const sessionSub = normalizeSubdivision(session.subdivision ?? null);
        if (sessionSub && sessionSub !== targetSub) continue;

        const dates = def.date
          ? [def.date]
          : expandWeekly(semester.validFrom, semester.validUntil, def.day, def.validFrom, def.validUntil);

        for (const date of dates) {
          out.push(makeOccurrence({
            def, date, start: session.start, end: session.end,
            group: session.group, subdivision: sessionSub, institutionId
          }));
        }
      }
      continue;
    }

    if (!appliesToGroup(def, targetGroup)) continue;
    if (!appliesToSubdivision(def, targetSub)) continue;

    if (!def.start || !def.end) {
      diagnostics.errors.push(`Event ${def.id} is missing start/end.`);
      continue;
    }

    const dates = def.date
      ? [def.date]
      : expandWeekly(semester.validFrom, semester.validUntil, def.day, def.validFrom, def.validUntil);

    for (const date of dates) {
      out.push(makeOccurrence({
        def, date, start: def.start, end: def.end,
        group: targetGroup, subdivision: null, institutionId
      }));
    }
  }

  return out;
}

export function buildInstitutionOccurrences(institutionEvents, context, settings, institutionId, parser, diagnostics) {
  const out = [];

  for (const event of toArray(institutionEvents)) {
    if (!["published", "cancelled"].includes(event.status)) continue;
    if (!institutionEventMatches(event, context)) continue;

    const parsed = event.shorthand ? parser.parse(event.shorthand) : null;
    const location = event.location ?? parsed?.location ?? null;

    const metas = [];
    if (event.date) {
      metas.push({ date: event.date, endDate: event.endDate ?? null, allDay: !!event.allDay });
    } else if (event.startDate) {
      metas.push({ date: event.startDate, endDate: event.endDate ?? event.startDate, allDay: event.allDay !== false });
    } else if (event.day && event.validFrom && event.validUntil) {
      for (const d of expandWeekly(event.validFrom, event.validUntil, event.day)) {
        metas.push({ date: d, endDate: null, allDay: false });
      }
    } else {
      diagnostics.warnings.push(`Institution event ${event.id} has no materializable date window.`);
      continue;
    }

    for (const meta of metas) {
      const uid = `${institutionId}:${event.id}:${meta.date}`;
      out.push({
        uid,
        uidBase: uid,
        eventId: event.id,
        courseId: null,
        type: event.type ?? "college-event",
        title: event.title,
        description: event.description ?? null,
        date: meta.date,
        endDate: meta.endDate,
        allDay: meta.allDay,
        originalDate: meta.date,
        day: weekdayName(parseDate(meta.date)),
        start: meta.allDay ? null : event.start ?? null,
        end: meta.allDay ? null : event.end ?? null,
        location,
        group: null,
        subdivision: null,
        status: event.status,
        source: "institution",
        audience: event.audience ?? { scope: "all" },
        sourceReview: event.sourceReview ?? []
      });
    }
  }

  return out;
}

export function mergeOccurrences(events, diagnostics) {
  const map = new Map();
  for (const event of events) {
    const existing = map.get(event.uid);
    if (!existing) {
      map.set(event.uid, event);
      continue;
    }
    if (existing.eventId !== event.eventId) {
      diagnostics.errors.push(`UID collision between ${existing.eventId} and ${event.eventId}: ${event.uid}`);
      continue;
    }
    if (existing.status === "cancelled" && event.status === "published") {
      map.set(event.uid, event);
    }
  }
  return Array.from(map.values());
}

export function composeSchedule({
  institutionId, timezone, settings, locations, semester,
  courses = [], lectures = [], practicals = [], exams = [],
  exceptions = [], institutionEvents = [], context, locale = "en"
}) {
  const diagnostics = { errors: [], warnings: [] };
  const parser = createShorthandParser(locations.buildings);
  const courseMap = buildCourseMap(courses, diagnostics);

  const defs = [
    ...normalizeEvents(lectures, "lecture", parser, courseMap, diagnostics),
    ...normalizeEvents(practicals, "practical", parser, courseMap, diagnostics),
    ...normalizeEvents(exams, "examination", parser, courseMap, diagnostics)
  ];

  const academic = materializeAcademicOccurrences(
    defs, semester, context.practicalGroup ?? null, settings, institutionId, diagnostics,
    context.subdivision ?? null
  );

  const exceptionResult = applyExceptions(academic, toArray(exceptions), {
    settings, institutionId, eventById: new Map(defs.map((d) => [d.id, d]))
  });
  diagnostics.errors.push(...exceptionResult.diagnostics.errors);
  diagnostics.warnings.push(...exceptionResult.diagnostics.warnings);

  const institution = buildInstitutionOccurrences(institutionEvents, context, settings, institutionId, parser, diagnostics);
  const merged = mergeOccurrences([...exceptionResult.occurrences, ...institution], diagnostics);
  const events = sortOccurrences(merged, locale);
  const conflicts = detectConflicts(events);

  return { events, conflicts, diagnostics, locale };
}

export function selectActiveSemester(academicYear, today, timezone) {
  const semesters = academicYear.semesters.filter((s) => s.status !== "draft");
  const active = semesters.find((s) => s.validFrom && s.validUntil && today >= s.validFrom && today <= s.validUntil);
  if (active) return active;
  const upcoming = semesters
    .filter((s) => s.validFrom && today < s.validFrom)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
  return upcoming ?? null;
}
