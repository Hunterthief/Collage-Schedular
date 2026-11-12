export const WEEKDAYS = Object.freeze({
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
});

const REVERSE_WEEKDAYS = Object.fromEntries(
  Object.entries(WEEKDAYS).map(([name, num]) => [num, name])
);

export function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function weekdayName(dateOrString) {
  const date =
    typeof dateOrString === "string" ? parseDate(dateOrString) : dateOrString;
  return REVERSE_WEEKDAYS[date.getUTCDay()];
}

export function expandWeekly(
  start,
  end,
  weekday,
  validFrom = null,
  validUntil = null
) {
  if (!start || !end || !weekday) return [];

  const dayNum = WEEKDAYS[weekday];
  if (dayNum == null) return [];

  let cursor = parseDate(start);
  let endDate = parseDate(end);

  if (validFrom) {
    const vf = parseDate(validFrom);
    if (vf > cursor) cursor = vf;
  }

  if (validUntil) {
    const vu = parseDate(validUntil);
    if (vu < endDate) endDate = vu;
  }

  const dates = [];

  while (cursor <= endDate) {
    if (cursor.getUTCDay() === dayNum) {
      dates.push(formatDate(cursor));
    }
    cursor = addDays(cursor, 1);
  }

  return dates;
}

export function dateInSameWeek(
  originalDateStr,
  targetWeekday,
  weekStartDay = "Saturday"
) {
  const original = parseDate(originalDateStr);
  const originalDay = original.getUTCDay();
  const weekStartNum = WEEKDAYS[weekStartDay];
  const targetNum = WEEKDAYS[targetWeekday];

  if (weekStartNum == null || targetNum == null) return null;

  const diffFromWeekStart = (originalDay - weekStartNum + 7) % 7;
  const weekStart = addDays(original, -diffFromWeekStart);

  const targetDiff = (targetNum - weekStartNum + 7) % 7;
  const target = addDays(weekStart, targetDiff);

  return formatDate(target);
}

export function startOfWeek(dateStr, weekStartDay = "Saturday") {
  const date = parseDate(dateStr);
  const day = date.getUTCDay();
  const weekStartNum = WEEKDAYS[weekStartDay];
  const diff = (day - weekStartNum + 7) % 7;
  return formatDate(addDays(date, -diff));
}

export function endOfWeek(startStr) {
  return formatDate(addDays(parseDate(startStr), 6));
}

export function todayInTimeZone(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function occursOnDay(event, dayStr) {
  if (event.allDay) {
    const end = event.endDate ?? event.date;
    return event.date <= dayStr && dayStr <= end;
  }

  return event.date === dayStr;
}

export function occursInRange(event, startStr, endStr) {
  if (event.allDay) {
    const evEnd = event.endDate ?? event.date;
    return event.date <= endStr && evEnd >= startStr;
  }

  return event.date >= startStr && event.date <= endStr;
}

function periodRange(period) {
  const from = period.from ?? period.date ?? period.startDate;
  const to = period.to ?? period.endDate ?? from;
  return { from, to };
}

function periodOverlapsWeek(period, weekStartStr, weekEndStr) {
  const { from, to } = periodRange(period);
  if (!from) return false;
  const end = to ?? from;
  return from <= weekEndStr && end >= weekStartStr;
}

export function isAcademicBlackoutDate(dateStr, blackouts = [], eventType = null) {
  if (!Array.isArray(blackouts) || blackouts.length === 0) return false;

  return blackouts.some((period) => {
    if (period.blocksAcademicEvents === false) return false;

    const blockTypes = period.blockTypes ?? ["lecture", "practical"];

    if (eventType && !blockTypes.includes(eventType)) return false;

    const { from, to } = periodRange(period);
    if (!from) return false;

    const end = to ?? from;
    return dateStr >= from && dateStr <= end;
  });
}

export function teachingWeekNumber(
  dateStr,
  anchorDateStr,
  blackouts = [],
  weekStartDay = "Saturday"
) {
  if (!dateStr || !anchorDateStr) return null;

  const targetWeekStartStr = startOfWeek(dateStr, weekStartDay);
  const anchorWeekStartStr = startOfWeek(anchorDateStr, weekStartDay);

  const targetWeekStart = parseDate(targetWeekStartStr);
  const anchorWeekStart = parseDate(anchorWeekStartStr);

  if (targetWeekStart < anchorWeekStart) return null;

  let count = 0;
  let cursor = anchorWeekStart;

  while (cursor <= targetWeekStart) {
    const cursorStr = formatDate(cursor);
    const cursorEndStr = endOfWeek(cursorStr);

    const excluded = Array.isArray(blackouts)
      ? blackouts.some(
          (period) =>
            period.excludedFromRotation !== false &&
            periodOverlapsWeek(period, cursorStr, cursorEndStr)
        )
      : false;

    if (!excluded) {
      count++;
    }

    if (cursorStr === targetWeekStartStr) {
      break;
    }

    cursor = addDays(cursor, 7);
  }

  return count > 0 ? count : null;
}

export function getRotationSubdivision(
  dateStr,
  rotation,
  anchorDateStr,
  blackouts = [],
  weekStartDay = "Saturday"
) {
  if (!rotation || !Array.isArray(rotation.sequence) || rotation.sequence.length === 0) {
    return null;
  }

  const weekNumber = teachingWeekNumber(
    dateStr,
    anchorDateStr,
    blackouts,
    weekStartDay
  );

  if (!weekNumber) return null;

  const startWeek = rotation.startWeek ?? 1;
  const length = rotation.sequence.length;
  const rawIndex = weekNumber - startWeek;
  const index = ((rawIndex % length) + length) % length;

  return rotation.sequence[index] ?? null;
}
