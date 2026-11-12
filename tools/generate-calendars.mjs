import fs from "node:fs/promises";
import path from "node:path";
import {
  composeSchedule,
  buildInstitutionOccurrences,
  mergeOccurrences
} from "../assets/js/schedule/engine.js";
import { sortOccurrences } from "../assets/js/schedule/sorting.js";
import { eventsToIcs } from "../assets/js/calendar/ics-generator.js";
import { createShorthandParser } from "../assets/js/schedule/shorthand.js";
import { buildEventIndex, eventShorthand } from "../assets/js/schedule/labels.js";

const ROOT = process.cwd();

async function readJson(rel) {
  const full = path.resolve(ROOT, rel);
  const text = await fs.readFile(full, "utf8");
  return JSON.parse(text);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.events)) return value.events;
  if (value && Array.isArray(value.exceptions)) return value.exceptions;
  if (value && Array.isArray(value.courses)) return value.courses;
  return [];
}

function collectGroups(assignmentDocs, lectures, practicals, exams) {
  const groups = new Set();

  for (const wrapper of assignmentDocs) {
    for (const rule of wrapper.doc.rules ?? []) {
      if (rule.practicalGroup != null) groups.add(rule.practicalGroup);
    }
  }

  for (const event of toArray(lectures)) {
    for (const g of event.groups ?? []) {
      if (typeof g === "number") groups.add(g);
    }
  }

  for (const event of toArray(practicals)) {
    for (const session of event.sessions ?? []) {
      if (session.group != null) groups.add(session.group);
    }
  }

  for (const event of toArray(exams)) {
    for (const g of event.groups ?? []) {
      if (typeof g === "number") groups.add(g);
    }
    for (const session of event.sessions ?? []) {
      if (session.group != null) groups.add(session.group);
    }
  }

  return Array.from(groups).sort((a, b) => a - b);
}

function collectSubdivisions(assignmentDocs, group) {
  const subs = new Set();

  for (const wrapper of assignmentDocs) {
    for (const rule of wrapper.doc.rules ?? []) {
      if (rule.practicalGroup !== group) continue;
      for (const sub of rule.subdivisions ?? []) {
        const name = String(sub.name ?? "").trim().toUpperCase();
        if (name) subs.add(name);
      }
    }
  }

  return Array.from(subs).sort();
}

function feedPath(manifest, programId, yearId, group, subdivision) {
  const feeds = manifest.calendarFeeds ?? {};
  const baseUrl = String(feeds.baseUrl ?? "calendar/feeds").replace(/\/$/, "");

  const template = subdivision
    ? feeds.subdivisionPathTemplate ??
      "{programId}/{academicYearId}/group-{group}-{subdivisionLower}.ics"
    : feeds.pathTemplate ?? "{programId}/{academicYearId}/group-{group}.ics";

  const rel = template
    .replace("{programId}", programId)
    .replace("{academicYearId}", yearId)
    .replace("{group}", String(group))
    .replace("{subdivision}", subdivision ?? "")
    .replace("{subdivisionLower}", (subdivision ?? "").toLowerCase());

  return `${baseUrl}/${rel}`;
}

function withShorthandTitles(events, index) {
  return events.map((e) => {
    const code = eventShorthand(e, index);
    return code ? { ...e, calendarTitle: code } : e;
  });
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeIcs(relPath, ics) {
  const outPath = path.resolve(ROOT, relPath);
  await ensureDir(outPath);
  await fs.writeFile(outPath, ics, "utf8");
  console.log(`Generated ${path.relative(ROOT, outPath)}`);
}

async function main() {
  const manifest = await readJson("data/manifest.json");
  const programs = await readJson(manifest.paths.programs);
  const settings = await readJson(manifest.paths.settings);
  const locations = await readJson(manifest.paths.locations);
  const institutionEvents = await readJson(manifest.paths.institutionEvents);

  const assignmentDocs = await Promise.all(
    manifest.assignments.map(async (entry) => {
      const doc = await readJson(entry.path);
      return {
        programId: entry.programId ?? doc.programId,
        academicYearId: entry.academicYearId ?? doc.academicYearId,
        doc
      };
    })
  );

  const generatedAt = new Date();
  const parser = createShorthandParser(locations.buildings);
  const diagnostics = { errors: [], warnings: [] };
  const locale = settings.defaultLocale ?? "en";

  const institutionContext = {
    programId: null,
    academicYearId: null,
    semesterId: null,
    practicalGroup: null,
    subdivision: null
  };

  const institutionOccurrences = buildInstitutionOccurrences(
    institutionEvents,
    institutionContext,
    settings,
    settings.institutionId,
    parser,
    diagnostics
  );

  const institutionFeedEvents = sortOccurrences(
    mergeOccurrences(institutionOccurrences, diagnostics),
    locale
  );

  await writeIcs(
    feedPath(manifest, "institution", "", null, null).replace(
      /institution\/\/?/,
      "institution/"
    ),
    eventsToIcs(institutionFeedEvents, {
      calendarName: { en: "College-wide Events", ar: "فعاليات الكلية" },
      locale,
      timezone: manifest.timezone,
      institutionId: settings.institutionId,
      locations,
      generatedAt
    })
  );

  for (const program of programs.programs) {
    for (const year of program.academicYears) {
      const yearAssignmentDocs = assignmentDocs.filter(
        (a) => a.programId === program.id && a.academicYearId === year.id
      );

      // key: `${group}` for whole-group feeds, `${group}:${sub}` for subgroup feeds
      const eventsByTarget = new Map();

      for (const semester of year.semesters) {
        if (semester.status === "draft") continue;

        const courses = await readJson(semester.datasets.courses);
        const lectures = await readJson(semester.datasets.lectures);
        const practicals = await readJson(semester.datasets.practicals);
        const exams = await readJson(semester.datasets.exams);
        const exceptions = await readJson(semester.datasets.exceptions);

        const index = buildEventIndex({ courses, lectures, practicals, exams });
        const groups = collectGroups(yearAssignmentDocs, lectures, practicals, exams);

        for (const group of groups) {
          const targets = [
            { group, subdivision: null },
            ...collectSubdivisions(yearAssignmentDocs, group).map((s) => ({
              group,
              subdivision: s
            }))
          ];

          for (const target of targets) {
            const key = target.subdivision
              ? `${group}:${target.subdivision}`
              : `${group}`;

            if (!eventsByTarget.has(key)) {
              eventsByTarget.set(key, { ...target, events: [] });
            }

            const result = composeSchedule({
              institutionId: settings.institutionId,
              timezone: manifest.timezone,
              settings,
              locations,
              semester,
              courses,
              lectures,
              practicals,
              exams,
              exceptions,
              institutionEvents,
              context: {
                programId: program.id,
                academicYearId: year.id,
                semesterId: semester.id,
                practicalGroup: target.group,
                subdivision: target.subdivision
              },
              locale
            });

            diagnostics.errors.push(...result.diagnostics.errors);
            diagnostics.warnings.push(...result.diagnostics.warnings);

            for (const conflict of result.conflicts) {
              diagnostics.warnings.push(conflict.message);
            }

            eventsByTarget
              .get(key)
              .events.push(...withShorthandTitles(result.events, index));
          }
        }
      }

      for (const { group, subdivision, events } of eventsByTarget.values()) {
        const merged = mergeOccurrences(events, diagnostics);
        const sorted = sortOccurrences(merged, locale);

        const label = subdivision
          ? `Group ${group}${subdivision}`
          : `Group ${group}`;

        const ics = eventsToIcs(sorted, {
          calendarName: {
            en: `${program.id} ${year.id} ${label}`,
            ar: `${program.id} ${year.id} مجموعة ${group}${subdivision ?? ""}`
          },
          locale,
          timezone: manifest.timezone,
          institutionId: settings.institutionId,
          locations,
          generatedAt
        });

        await writeIcs(feedPath(manifest, program.id, year.id, group, subdivision), ics);
      }
    }
  }

  if (diagnostics.errors.length) {
    console.error("Generation errors:");
    for (const err of diagnostics.errors) console.error(" -", err);
    process.exit(1);
  }

  if (diagnostics.warnings.length) {
    console.warn("Generation warnings:");
    for (const warn of diagnostics.warnings) console.warn(" -", warn);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
