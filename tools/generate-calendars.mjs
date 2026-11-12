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
  const text = await fs.readFile(path.resolve(ROOT, rel), "utf8");
  return JSON.parse(text);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.events)) return value.events;
  if (value && Array.isArray(value.exceptions)) return value.exceptions;
  if (value && Array.isArray(value.courses)) return value.courses;
  return [];
}

function collectGroups(doc, lectures, practicals, exams) {
  const groups = new Set();
  for (const rule of doc.rules ?? []) {
    if (rule.practicalGroup != null) groups.add(rule.practicalGroup);
  }
  for (const event of toArray(lectures)) {
    for (const g of event.groups ?? []) if (typeof g === "number") groups.add(g);
  }
  for (const event of toArray(practicals)) {
    for (const s of event.sessions ?? []) if (s.group != null) groups.add(s.group);
  }
  for (const event of toArray(exams)) {
    for (const g of event.groups ?? []) if (typeof g === "number") groups.add(g);
    for (const s of event.sessions ?? []) if (s.group != null) groups.add(s.group);
  }
  return Array.from(groups).sort((a, b) => a - b);
}

function collectSubdivisions(doc, group) {
  const subs = new Set();
  for (const rule of doc.rules ?? []) {
    if (rule.practicalGroup !== group) continue;
    for (const sub of rule.subdivisions ?? []) {
      const name = String(sub.name ?? "").trim().toUpperCase();
      if (name) subs.add(name);
    }
  }
  return Array.from(subs).sort();
}

function renderTemplate(template, values) {
  return template
    .replace("{programId}", values.programId)
    .replace("{academicYearId}", values.academicYearId)
    .replace("{level}", values.level == null ? "" : String(values.level))
    .replace("{group}", String(values.group))
    .replace("{subdivision}", values.subdivision ?? "")
    .replace("{subdivisionLower}", (values.subdivision ?? "").toLowerCase());
}

function baseUrlOf(manifest) {
  return String(manifest.calendarFeeds?.baseUrl ?? "calendar/feeds").replace(/\/$/, "");
}

// Canonical path: year-scoped whenever the level is known.
function canonicalPath(manifest, programId, yearId, group, subdivision, level) {
  const feeds = manifest.calendarFeeds ?? {};
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

  return `${baseUrlOf(manifest)}/${renderTemplate(template, {
    programId, academicYearId: yearId, level, group, subdivision
  })}`;
}

// Pre-year flat path, kept alive only for cohorts that explicitly own it.
function legacyPath(manifest, programId, yearId, group, subdivision) {
  const feeds = manifest.calendarFeeds ?? {};
  const template = subdivision
    ? feeds.subdivisionPathTemplate ??
      "{programId}/{academicYearId}/group-{group}-{subdivisionLower}.ics"
    : feeds.pathTemplate ?? "{programId}/{academicYearId}/group-{group}.ics";

  return `${baseUrlOf(manifest)}/${renderTemplate(template, {
    programId, academicYearId: yearId, level: null, group, subdivision
  })}`;
}

function withShorthandTitles(events, index) {
  return events.map((e) => {
    const code = eventShorthand(e, index);
    return code ? { ...e, calendarTitle: code } : e;
  });
}

async function writeIcs(relPath, ics) {
  const outPath = path.resolve(ROOT, relPath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
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
      const rawLevel = entry.yearLevel ?? doc.yearLevel ?? null;
      const level = rawLevel == null || rawLevel === "" ? null : Number(rawLevel);
      return {
        programId: entry.programId ?? doc.programId,
        academicYearId: entry.academicYearId ?? doc.academicYearId,
        level: Number.isFinite(level) ? level : null,
        legacyAlias: entry.legacyAlias === true,
        doc
      };
    })
  );

  const generatedAt = new Date();
  const parser = createShorthandParser(locations.buildings);
  const diagnostics = { errors: [], warnings: [] };
  const locale = settings.defaultLocale ?? "en";
  const baseUrl = baseUrlOf(manifest);

  // Remove the stray feed produced by an older generator revision.
  const strayDir = path.resolve(ROOT, baseUrl, "institution");
  await fs.rm(path.join(strayDir, "group-null.ics"), { force: true });
  try {
    await fs.rmdir(strayDir);
  } catch {
    // Directory absent or not empty; nothing to clean.
  }

  const institutionOccurrences = buildInstitutionOccurrences(
    institutionEvents,
    { programId: null, academicYearId: null, semesterId: null, practicalGroup: null, subdivision: null },
    settings,
    settings.institutionId,
    parser,
    diagnostics
  );

  await writeIcs(
    `${baseUrl}/institution.ics`,
    eventsToIcs(sortOccurrences(mergeOccurrences(institutionOccurrences, diagnostics), locale), {
      calendarName: { en: "College-wide Events", ar: "فعاليات الكلية" },
      locale,
      timezone: manifest.timezone,
      institutionId: settings.institutionId,
      locations,
      generatedAt
    })
  );

  // Guard against two cohorts claiming the same pre-year flat path.
  const legacyOwners = new Map();

  for (const program of programs.programs) {
    for (const year of program.academicYears) {
      const cohorts = assignmentDocs.filter(
        (a) => a.programId === program.id && a.academicYearId === year.id
      );
      if (!cohorts.length) continue;

      for (const cohort of cohorts) {
        const level = cohort.level;
        const semesters = year.semesters.filter(
          (s) => s.status !== "draft" && (level == null || s.yearLevel == null || s.yearLevel === level)
        );

        if (!semesters.length) {
          diagnostics.warnings.push(
            `No published semester matches ${program.id}/${year.id} year level ${level ?? "unspecified"}.`
          );
        }

        const eventsByTarget = new Map();

        for (const semester of semesters) {
          const courses = await readJson(semester.datasets.courses);
          const lectures = await readJson(semester.datasets.lectures);
          const practicals = await readJson(semester.datasets.practicals);
          const exams = await readJson(semester.datasets.exams);
          const exceptions = await readJson(semester.datasets.exceptions);

          const index = buildEventIndex({ courses, lectures, practicals, exams });
          const groups = collectGroups(cohort.doc, lectures, practicals, exams);

          for (const group of groups) {
            const targets = [
              { group, subdivision: null },
              ...collectSubdivisions(cohort.doc, group).map((s) => ({ group, subdivision: s }))
            ];

            for (const target of targets) {
              const key = `${group}:${target.subdivision ?? ""}`;
              if (!eventsByTarget.has(key)) eventsByTarget.set(key, { ...target, events: [] });

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
                  subdivision: target.subdivision,
                  yearLevel: level
                },
                locale
              });

              diagnostics.errors.push(...result.diagnostics.errors);
              diagnostics.warnings.push(...result.diagnostics.warnings);
              for (const conflict of result.conflicts) diagnostics.warnings.push(conflict.message);

              eventsByTarget.get(key).events.push(...withShorthandTitles(result.events, index));
            }
          }
        }

        for (const { group, subdivision, events } of eventsByTarget.values()) {
          const sorted = sortOccurrences(mergeOccurrences(events, diagnostics), locale);
          const label = subdivision ? `Group ${group}${subdivision}` : `Group ${group}`;
          const levelLabel = level == null ? "" : ` Year ${level}`;

          const ics = eventsToIcs(sorted, {
            calendarName: {
              en: `${program.id} ${year.id}${levelLabel} ${label}`,
              ar: `${program.id} ${year.id}${levelLabel} مجموعة ${group}${subdivision ?? ""}`
            },
            locale,
            timezone: manifest.timezone,
            institutionId: settings.institutionId,
            locations,
            generatedAt
          });

          const canonical = canonicalPath(manifest, program.id, year.id, group, subdivision, level);
          await writeIcs(canonical, ics);

          if (!cohort.legacyAlias || level == null) continue;

          const alias = legacyPath(manifest, program.id, year.id, group, subdivision);
          if (alias === canonical) continue;

          const owner = `${program.id}/${year.id} year ${level}`;
          if (legacyOwners.has(alias) && legacyOwners.get(alias) !== owner) {
            diagnostics.errors.push(
              `Legacy alias conflict: ${alias} is claimed by both ${legacyOwners.get(alias)} and ${owner}. Set legacyAlias on only one cohort.`
            );
            continue;
          }
          legacyOwners.set(alias, owner);
          await writeIcs(alias, ics);
        }
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
