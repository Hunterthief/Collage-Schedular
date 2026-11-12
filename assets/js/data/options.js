import { loadAssignmentDocuments } from "../student/assignments.js";
import { localize } from "../i18n.js";

export function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const rem100 = v % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

export function yearLevelLabel(level) {
  return level == null ? "All years" : `${ordinal(level)} year`;
}

export async function buildLookupOptions(loader, manifest) {
  const programsDoc = await loader.loadPrograms(manifest);
  const assignmentDocs = await loadAssignmentDocuments(loader, manifest);

  const programs = (programsDoc.programs ?? []).map((program) => ({
    id: program.id,
    name: localize(program.name, "en") || program.id,
    years: (program.academicYears ?? []).map((year) => ({
      id: year.id,
      name: localize(year.name, "en") || year.id,
      levels: deriveLevels(year, assignmentDocs, program.id)
    }))
  }));

  return { programs, assignmentDocs, programsDoc };
}

function deriveLevels(year, assignmentDocs, programId) {
  const byLevel = new Map();

  for (const semester of year.semesters ?? []) {
    const level = semester.yearLevel ?? null;
    if (!byLevel.has(level)) {
      byLevel.set(level, { level, label: yearLevelLabel(level), groups: [] });
    }
  }

  if (byLevel.size === 0) {
    byLevel.set(null, { level: null, label: yearLevelLabel(null), groups: [] });
  }

  for (const entry of byLevel.values()) {
    entry.groups = deriveGroupOptions(assignmentDocs, programId, year.id, entry.level);
  }

  return Array.from(byLevel.values()).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
}

function deriveGroupOptions(assignmentDocs, programId, academicYearId, level) {
  const clusters = new Map();

  for (const wrapper of assignmentDocs) {
    if (wrapper.programId !== programId || wrapper.academicYearId !== academicYearId) continue;

    const docLevel = wrapper.doc.yearLevel ?? null;
    if (level != null && docLevel != null && docLevel !== level) continue;

    for (const rule of wrapper.doc.rules ?? []) {
      const group = rule.practicalGroup;
      if (group == null) continue;

      if (!clusters.has(group)) {
        clusters.set(group, { practicalGroup: group, subdivisions: new Map() });
      }
      const cluster = clusters.get(group);

      for (const sub of rule.subdivisions ?? []) {
        const name = normalizeSubdivisionName(sub.name ?? sub.id);
        if (!name) continue;
        cluster.subdivisions.set(name, {
          value: `${group}:${name}`,
          label: `${group}${name}`,
          practicalGroup: group,
          subdivision: name
        });
      }
    }
  }

  const options = [];
  for (const cluster of clusters.values()) {
    options.push({
      value: String(cluster.practicalGroup),
      label: String(cluster.practicalGroup),
      practicalGroup: cluster.practicalGroup,
      subdivision: null
    });
    options.push(
      ...Array.from(cluster.subdivisions.values()).sort((a, b) => a.label.localeCompare(b.label))
    );
  }

  return options.sort((a, b) => {
    const g = a.practicalGroup - b.practicalGroup;
    if (g !== 0) return g;
    return (a.subdivision ?? "").localeCompare(b.subdivision ?? "");
  });
}

function normalizeSubdivisionName(value) {
  if (value == null) return "";
  return String(value).trim().toUpperCase();
}
