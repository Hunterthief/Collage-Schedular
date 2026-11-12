import { localize } from "../i18n.js";

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.events)) return value.events;
  if (value && Array.isArray(value.courses)) return value.courses;
  return [];
}

// Index course colors and event display codes by id, so the presentation and
// the ICS writer can label events without re-reading the raw datasets.
export function buildEventIndex({ courses = [], lectures = [], practicals = [], exams = [] } = {}) {
  const courseById = new Map();
  for (const c of toArray(courses)) {
    if (c?.id) courseById.set(c.id, c);
  }

  const defById = new Map();
  for (const list of [lectures, practicals, exams]) {
    for (const e of toArray(list)) {
      if (e?.id) defById.set(e.id, e);
    }
  }

  return { courseById, defById };
}

// Shorthand label (e.g. "PN 7 Basic Pharmacology") when the definition has a
// displayCode/shorthand; otherwise null so callers fall back to the full title.
export function eventShorthand(event, index) {
  const def = index?.defById?.get(event.eventId);
  return def?.displayCode ?? def?.shorthand ?? null;
}

export function eventLabel(event, index, locale = "en") {
  return eventShorthand(event, index) ?? localize(event.title, locale);
}

export function eventFullTitle(event, locale = "en") {
  return localize(event.title, locale);
}

export function eventColor(event, index) {
  const def = index?.defById?.get(event.eventId);
  const courseId = event.courseId ?? def?.courseId ?? null;
  const course = courseId ? index?.courseById?.get(courseId) : null;
  const color = course?.color ?? null;
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}
