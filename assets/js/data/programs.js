export function findProgram(programs, programId) {
  return programs.programs.find((p) => p.id === programId) ?? null;
}

export function findAcademicYear(program, academicYearId) {
  return program.academicYears.find((y) => y.id === academicYearId) ?? null;
}

export function findSemester(academicYear, semesterId) {
  return academicYear.semesters.find((s) => s.id === semesterId) ?? null;
}
