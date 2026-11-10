export class StudentNotFoundError extends Error {}
export class DataIntegrityError extends Error {}
export class AmbiguousAssignmentError extends DataIntegrityError {}

export function normalizeStudentId(raw) {
  if (typeof raw !== "string") {
    throw new TypeError("Student ID must be a string.");
  }

  const normalized = raw.trim().replace(/\s+/g, "");

  if (!normalized) {
    throw new TypeError("Student ID cannot be empty.");
  }

  return normalized;
}

function isNumericId(id) {
  return /^\d+$/.test(id);
}

function compareIds(a, b) {
  if (isNumericId(a) && isNumericId(b)) {
    const ba = BigInt(a);
    const bb = BigInt(b);
    if (ba < bb) return -1;
    if (ba > bb) return 1;
    return 0;
  }

  return a.localeCompare(b);
}

function inRange(id, from, to) {
  if (from != null && compareIds(id, from) < 0) return false;
  if (to != null && compareIds(id, to) > 0) return false;
  return true;
}

function ruleMatches(rule, id) {
  if (Array.isArray(rule.students) && rule.students.map(normalizeStudentId).includes(id)) {
    return true;
  }

  if (rule.from != null || rule.to != null) {
    return inRange(id, rule.from, rule.to);
  }

  return false;
}

function subdivisionMatches(sub, id) {
  if (Array.isArray(sub.students) && sub.students.map(normalizeStudentId).includes(id)) {
    return true;
  }

  if (sub.from != null || sub.to != null) {
    return inRange(id, sub.from, sub.to);
  }

  return false;
}

function findSubdivision(rule, id) {
  if (!Array.isArray(rule.subdivisions) || rule.subdivisions.length === 0) {
    return { subdivision: null, status: "not-applicable", warning: null };
  }

  const matches = rule.subdivisions.filter((sub) => subdivisionMatches(sub, id));

  if (matches.length === 0) {
    return {
      subdivision: null,
      status: "unresolved",
      warning: "SUBDIVISION_UNRESOLVED"
    };
  }

  if (matches.length > 1) {
    throw new AmbiguousAssignmentError(
      `Student ${id} matches multiple subdivisions in rule ${rule.id ?? "unknown"}.`
    );
  }

  return {
    subdivision: matches[0].name,
    status: "resolved",
    warning: null
  };
}

export function resolveStudentId(rawId, assignmentDocs) {
  const studentId = normalizeStudentId(rawId);
  const warnings = [];

  const overrideCandidates = [];

  for (const wrapper of assignmentDocs) {
    const overrides = wrapper.doc.overrides ?? [];
    for (const override of overrides) {
      if (normalizeStudentId(override.studentId) === studentId) {
        overrideCandidates.push({ wrapper, override });
      }
    }
  }

  if (overrideCandidates.length > 1) {
    throw new AmbiguousAssignmentError(
      `Student ${studentId} has multiple individual overrides.`
    );
  }

  if (overrideCandidates.length === 1) {
    const { wrapper, override } = overrideCandidates[0];

    return {
      studentId,
      programId: wrapper.programId,
      academicYearId: wrapper.academicYearId,
      practicalGroup: override.practicalGroup ?? null,
      subdivision: override.subdivision ?? null,
      subdivisionStatus: override.subdivision ? "resolved" : "not-applicable",
      source: "override",
      warnings: override.practicalGroup == null
        ? ["PRACTICAL_GROUP_UNRESOLVED"]
        : []
    };
  }

  const ruleCandidates = [];

  for (const wrapper of assignmentDocs) {
    const rules = wrapper.doc.rules ?? [];
    const matched = rules.filter((rule) => ruleMatches(rule, studentId));

    if (matched.length > 1) {
      throw new AmbiguousAssignmentError(
        `Student ${studentId} matches multiple assignment rules in ${wrapper.programId}/${wrapper.academicYearId}.`
      );
    }

    if (matched.length === 1) {
      ruleCandidates.push({ wrapper, rule: matched[0] });
    }
  }

  if (ruleCandidates.length === 0) {
    throw new StudentNotFoundError(
      `No assignment found for student ID ${studentId}.`
    );
  }

  if (ruleCandidates.length > 1) {
    throw new AmbiguousAssignmentError(
      `Student ${studentId} matches multiple program/year assignments.`
    );
  }

  const { wrapper, rule } = ruleCandidates[0];
  const sub = findSubdivision(rule, studentId);

  if (sub.warning) warnings.push(sub.warning);

  return {
    studentId,
    programId: wrapper.programId,
    academicYearId: wrapper.academicYearId,
    practicalGroup: rule.practicalGroup,
    subdivision: sub.subdivision,
    subdivisionStatus: sub.status,
    source: "rule",
    warnings
  };
}
