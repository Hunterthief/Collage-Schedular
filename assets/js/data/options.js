import { loadAssignmentDocuments } from "../student/assignments.js";
import { localize } from "../i18n.js";

export async function buildLookupOptions(loader, manifest) {
  const programsDoc = await loader.loadPrograms(manifest);
  const assignmentDocs = await loadAssignmentDocuments(loader, manifest);

  const programs = (programsDoc.programs ?? []).map((program) => ({
    id: program.id,
    name: localize(program.name, "en") || program.id,
    years: (program.academicYears ?? []).map((year) => ({
      id: year.id,
      name: localize(year.name, "en") || year.id,
      groups: deriveGroupOptions(assignmentDocs, program.id, year.id)
    }))
  }));

  return { programs, assignmentDocs, programsDoc };
}

function deriveGroupOptions(assignmentDocs, programId, academicYearId) {
  const clusters = new Map();

  for (const wrapper of assignmentDocs) {
    if (wrapper.programId !== programId || wrapper.academicYearId !== academicYearId) {
      continue;
    }

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
    // Plain numeric group fallback (whole group view).
    // Delete this push() if you only want 1A/1B and never plain 1.
    options.push({
      value: String(cluster.practicalGroup),
      label: String(cluster.practicalGroup),
      practicalGroup: cluster.practicalGroup,
      subdivision: null
    });

    const subs = Array.from(cluster.subdivisions.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    options.push(...subs);
  }

  return options.sort((a, b) => {
    const groupCmp = a.practicalGroup - b.practicalGroup;
    if (groupCmp !== 0) return groupCmp;
    const aSub = a.subdivision ?? "";
    const bSub = b.subdivision ?? "";
    return aSub.localeCompare(bSub);
  });
}

function normalizeSubdivisionName(value) {
  if (value == null) return "";
  const text = String(value).trim().toUpperCase();
  return text || "";
}
