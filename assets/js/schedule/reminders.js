// Reminder rule:
//   first timed event of each day  -> 60 minutes before
//   every later timed event        -> 15 minutes before
//   all-day / cancelled events     -> no alarm
//
// The same rule is used by the ICS writer (VALARM) and by the live
// in-page scheduler (browser notifications + toasts).

const STORAGE_KEY = "college-schedule-reminders-enabled";
const HORIZON_MS = 36 * 60 * 60 * 1000; // schedule alarms up to 36h ahead
const ROLL_MS = 15 * 60 * 1000;        // re-roll the window every 15 min

export function buildReminderPlan(events) {
  const byDay = new Map();

  for (const e of events ?? []) {
    if (!e || e.status !== "published") continue;
    if (e.allDay || !e.date || !e.start || !e.end) continue;
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  }

  const plan = new Map();

  for (const list of byDay.values()) {
    list.sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        String(a.uid).localeCompare(String(b.uid))
    );
    list.forEach((e, i) => plan.set(e.uid, i === 0 ? 60 : 15));
  }

  return plan;
}

function offsetMinutes(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);

  let hour = get("hour");
  if (hour === 24) hour = 0;

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  );

  return (asUtc - utcMs) / 60000;
}

export function localDateTimeToEpoch(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);

  let off = offsetMinutes(guess, timeZone);
  let utc = guess - off * 60000;
  off = offsetMinutes(utc, timeZone);

  return guess - off * 60000;
}

export class ReminderScheduler {
  constructor({ timeZone, onToast, onStateChange }) {
    this.timeZone = timeZone;
    this.onToast = onToast ?? (() => {});
    this.onStateChange = onStateChange ?? (() => {});

    this.events = [];
    this.labelFor = () => "";
    this.timeFor = () => "";
    this.locationFor = () => "";

    this.timers = new Map();
    this.rollTimer = null;
    this.enabled = false;

    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      this.enabled = false;
    }
  }

  get permission() {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  }

  async enable() {
    if (this.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Toast fallback still works.
      }
    }
    this.enabled = true;
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    this.reschedule();
    this.onStateChange();
  }

  disable() {
    this.enabled = false;
    try {
      localStorage.setItem(STORAGE_KEY, "0");
    } catch {}
    this.clearTimers();
    this.onStateChange();
  }

  setEvents(events, helpers = {}) {
    this.events = events ?? [];
    this.labelFor = helpers.labelFor ?? this.labelFor;
    this.timeFor = helpers.timeFor ?? this.timeFor;
    this.locationFor = helpers.locationFor ?? this.locationFor;
    this.reschedule();
  }

  clearTimers() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.rollTimer) {
      clearInterval(this.rollTimer);
      this.rollTimer = null;
    }
  }

  reschedule() {
    this.clearTimers();
    if (!this.enabled) return;

    const plan = buildReminderPlan(this.events);
    const now = Date.now();
    const horizon = now + HORIZON_MS;

    for (const e of this.events) {
      const minutes = plan.get(e.uid);
      if (!minutes) continue;

      const startEpoch = localDateTimeToEpoch(e.date, e.start, this.timeZone);
      const fireAt = startEpoch - minutes * 60000;

      if (fireAt <= now || fireAt > horizon) continue;

      const t = setTimeout(() => {
        this.timers.delete(e.uid);
        this.fire(e, minutes);
      }, fireAt - now);

      this.timers.set(e.uid, t);
    }

    this.rollTimer = setInterval(() => this.reschedule(), ROLL_MS);
  }

  fire(event, minutes) {
    const label = this.labelFor(event);
    const when = this.timeFor(event);
    const where = this.locationFor(event);

    const title =
      minutes === 60 ? "Starts in 1 hour" : `Starts in ${minutes} minutes`;
    const body = [label, when, where].filter(Boolean).join(" · ");

    this.onToast(`${title}: ${body}`);

    if (this.permission === "granted") {
      try {
        const n = new Notification(title, {
          body,
          tag: `${event.uid}:${minutes}`,
          renotify: false
        });
        n.onclick = () => {
          try {
            window.focus();
            n.close();
          } catch {}
        };
      } catch {
        // Toast already shown.
      }
    }
  }

  test() {
    const sample = this.events.find((e) => !e.allDay && e.start) ?? null;
    const label = sample ? this.labelFor(sample) : "Test reminder";
    const when = sample ? this.timeFor(sample) : "";
    const where = sample ? this.locationFor(sample) : "";

    this.onToast(`Starts in 15 minutes: ${[label, when, where].filter(Boolean).join(" · ")}`);

    if (this.permission === "granted") {
      try {
        const n = new Notification("Starts in 15 minutes", {
          body: [label, when, where].filter(Boolean).join(" · "),
          tag: "college-schedule-test"
        });
        n.onclick = () => {
          try {
            window.focus();
            n.close();
          } catch {}
        };
      } catch {}
    }
  }

  destroy() {
    this.clearTimers();
  }
}
