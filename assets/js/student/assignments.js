export async function loadAssignmentDocuments(loader, manifest) {
  return Promise.all(
    manifest.assignments.map(async (entry) => {
      const doc = await loader.loadJson(entry.path);
      return {
        programId: entry.programId ?? doc.programId,
        academicYearId: entry.academicYearId ?? doc.academicYearId,
        path: entry.path,
        doc
      };
    })
  );
}
