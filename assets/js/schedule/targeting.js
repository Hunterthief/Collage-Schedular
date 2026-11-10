function matchesRule(rule, context) {
  if (!rule || !rule.scope) return false;

  switch (rule.scope) {
    case "all":
      return true;

    case "program":
      return (rule.programIds ?? []).includes(context.programId);

    case "academic-year":
      if (Array.isArray(rule.academicYears)) {
        return rule.academicYears.some(
          (y) =>
            y.programId === context.programId &&
            y.academicYearId === context.academicYearId
        );
      }

      return (
        rule.programId === context.programId &&
        (rule.academicYearIds ?? []).includes(context.academicYearId)
      );

    case "semester":
      return (rule.semesterIds ?? []).includes(context.semesterId);

    case "group":
      if (Array.isArray(rule.groups)) {
        return rule.groups.some(
          (g) =>
            g.programId === context.programId &&
            g.academicYearId === context.academicYearId &&
            g.practicalGroup === context.practicalGroup
        );
      }

      return (
        context.programId != null &&
        context.academicYearId != null &&
        (rule.practicalGroups ?? []).includes(context.practicalGroup)
      );

    case "custom":
      return matchCustom(rule, context);

    default:
      return false;
  }
}

function matchCustom(rule, context) {
  const all = rule.all ?? [];
  const any = rule.any ?? [];
  const none = rule.none ?? [];

  const allMatch = all.every((r) => matchesRule(r, context));
  const anyMatch = any.length === 0 ? true : any.some((r) => matchesRule(r, context));
  const noneMatch = none.every((r) => !matchesRule(r, context));

  return allMatch && anyMatch && noneMatch;
}

export function institutionEventMatches(event, context) {
  const audience = event.audience ?? { scope: "all" };
  return matchesRule(audience, context);
}
