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
  const date = typeof dateOrString === "string" ? parseDate(dateOrString) : dateOrString;
  return REVERSE_WEEKDAYS[date.getUTCDay()];
}

export function expandWeekly(start, end, weekday, validFrom = null, validUntil = null) {
  if (!start || !end || !weekday) return [];

  const dayNum = WEEKDAYS[weekday];
  if (dayNum == null) return [];

  let cursor = parseDate(start);
  const endDate = parseDate(end);

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

export function dateInSameWeek(originalDateStr, targetWeekday, weekStartDay = "Saturday") {
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
