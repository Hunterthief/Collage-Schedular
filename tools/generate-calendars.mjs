import fs from "node:fs/promises";
import path from "node:path";
import { composeSchedule, buildInstitutionOccurrences, mergeOccurrences } from "../assets/js/schedule/engine.js";
import { sortOccurrences } from "../assets/js/schedule/sorting.js";
import { eventsToIcs } from "../assets/js/calendar/ics-generator.js";
import { createShorthandParser } from "../assets/js/schedule/shorthand.js";
import { localize } from "../assets/js/i18n.js";

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

function collectGroups(assignmentDocs, lectures, practicals) {
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

  return Array.from(groups).sort((a, b) => a - b);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
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

  const baseUrl = manifest.calendarFeeds.baseUrl.replace(/\/$/, "");

  // Institution-only feed: scope=all college-wide events.
  const institutionContext = {
    programId: null,
    academicYearId: null,
    semesterId: null,
    practicalGroup: null
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
    settings.defaultLocale ?? "en"
  );

  const institutionIcs = eventsToIcs(institutionFeedEvents, {
    calendarName: { en: "College-wide Events", ar: "فعاليات الكلية" },
    locale: settings.defaultLocale ?? "en",
    timezone: manifest.timezone,
    institutionId: settings.institutionId,
    locations,
    generatedAt
  });

  await ensureDir(path.resolve(ROOT, `${baseUrl}/institution.ics`));
  await fs.writeFile(path.resolve(ROOT, `${baseUrl}/institution.ics`), institutionIcs, "utf8");

  for (const program of programs.programs) {
    for (const year of program.academicYears) {
      const yearAssignmentDocs = assignmentDocs.filter(
        (a) => a.programId === program.id && a.academicYearId === year.id
      );

      const eventsByGroup = new Map();
      let allLectures = [];
      let allPracticals = [];

      for (const semester of year.semesters) {
        if (semester.status === "draft") continue;

        const courses = await readJson(semester.datasets.courses);
        const lectures = await readJson(semester.datasets.lectures);
        const practicals = await readJson(semester.datasets.practicals);
        const exceptions = await readJson(semester.datasets.exceptions);

        allLectures = [...allLectures, ...toArray(lectures)];
        allPracticals = [...allPracticals, ...toArray(practicals)];

        const groups = collectGroups(yearAssignmentDocs, lectures, practicals);

        for (const group of groups) {
          if (!eventsByGroup.has(group)) eventsByGroup.set(group, []);

          const result = composeSchedule({
            institutionId: settings.institutionId,
            timezone: manifest.timezone,
            settings,
            locations,
            semester,
            courses,
            lectures,
            practicals,
            exceptions,
            institutionEvents,
            context: {
              programId: program.id,
              academicYearId: year.id,
              semesterId: semester.id,
              practicalGroup: group
            },
            locale: settings.defaultLocale ?? "en"
          });

          diagnostics.errors.push(...result.diagnostics.errors);
          diagnostics.warnings.push(...result.diagnostics.warnings);

          for (const conflict of result.conflicts) {
            diagnostics.warnings.push(conflict.message);
          }

          eventsByGroup.get(group).push(...result.events);
        }
      }

      for (const [group, events] of eventsByGroup.entries()) {
        const merged = mergeOccurrences(events, diagnostics);
        const sorted = sortOccurrences(merged, settings.defaultLocale ?? "en");

        const ics = eventsToIcs(sorted, {
          calendarName: {
            en: `${program.id} ${year.id} Group ${group}`,
            ar: `${program.id} ${year.id} مجموعة ${group}`
          },
          locale: settings.defaultLocale ?? "en",
          timezone: manifest.timezone,
          institutionId: settings.institutionId,
          locations,
          generatedAt
        });

        const outPath = path.resolve(
          ROOT,
          `${baseUrl}/${program.id}/${year.id}/group-${group}.ics`
        );

        await ensureDir(outPath);
        await fs.writeFile(outPath, ics, "utf8");

        console.log(`Generated ${path.relative(ROOT, outPath)}`);
      }
    }
  }

  console.log(`Generated ${baseUrl}/institution.ics`);

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
