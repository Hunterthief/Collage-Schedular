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
      groups: deriveGroups(assignmentDocs, program.id, year.id)
    }))
  }));

  return {
    programs,
    assignmentDocs,
    programsDoc
  };
}

function deriveGroups(assignmentDocs, programId, academicYearId) {
  const groups = new Set();

  for (const wrapper of assignmentDocs) {
    if (
      wrapper.programId !== programId ||
      wrapper.academicYearId !== academicYearId
    ) {
      continue;
    }

    for (const rule of wrapper.doc.rules ?? []) {
      if (rule.practicalGroup != null) {
        groups.add(rule.practicalGroup);
      }
    }
  }

  return Array.from(groups).sort((a, b) => a - b);
}
