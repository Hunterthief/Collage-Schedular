import { CONFIG } from "./config.js";
import { DataLoader } from "./data/loader.js";
import { findProgram, findAcademicYear } from "./data/programs.js";
import { loadAssignmentDocuments } from "./student/assignments.js";
import { buildLookupOptions } from "./data/options.js";
import {
  resolveStudentId,
  StudentNotFoundError,
  DataIntegrityError
} from "./student/resolver.js";
import { composeSchedule, selectActiveSemester } from "./schedule/engine.js";
import {
  todayInTimeZone,
  startOfWeek,
  endOfWeek,
  parseDate,
  formatDate,
  addDays,
  occursOnDay,
  occursInRange,
  weekdayName
} from "./schedule/recurrence.js";
import { timeToMinutes } from "./schedule/sorting.js";
import {
  buildFeedUrl,
  googleCalendarSubscribeUrl,
  googleCalendarAddByUrlUrl
} from "./calendar/calendar-links.js";
import { eventsToIcs, formatLocation } from "./calendar/ics-generator.js";
import {
  buildEventIndex,
  eventLabel,
  eventFullTitle,
  eventColor,
  eventShorthand
} from "./schedule/labels.js";
import { localize } from "./i18n.js";

const loader = new DataLoader();

const els = {
  modeButtons: document.querySelectorAll(".segment"),
  idForm: document.getElementById("id-form"),
  manualForm: document.getElementById("manual-form"),
  studentId: document.getElementById("student-id"),
  programSelect: document.getElementById("program-select"),
  yearSelect: document.getElementById("year-select"),
  groupSelect: document.getElementById("group-select"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  periodHeading: document.getElementById("period-heading"),
  prevPeriod: document.getElementById("prev-period"),
  nextPeriod: document.getElementById("next-period"),
  todayBtn: document.getElementById("today-btn"),
  viewButtons: document.querySelectorAll(".view-btn"),
  assignmentSummary: document.getElementById("assignment-summary"),
  timetable: document.getElementById("timetable"),
  calendarLinks: document.getElementById("calendar-links"),
  siteTitle: document.getElementById("site-title"),
  privacyNotice: document.getElementById("privacy-notice")
};

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const WEEKDAYS_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

let currentState = null;
let lookupOptions = null;

init();

async function init() {
  bindEvents();
  setMode("id");
  try { els.studentId?.focus({ preventScroll: true }); } catch {}
  try { await ensureOptions(); }
  catch (err) { setStatus(`Could not load lookup options: ${err.message}`, "error"); }
}

function bindEvents() {
  els.modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));
  els.idForm.addEventListener("submit", onIdSubmit);
  els.manualForm.addEventListener("submit", onManualSubmit);
  els.programSelect.addEventListener("change", () => { populateYears(); populateGroups(); });
  els.yearSelect.addEventListener("change", populateGroups);
  els.viewButtons.forEach((btn) => btn.addEventListener("click", () => {
    if (currentState) renderView(currentState, btn.dataset.view);
  }));
  els.prevPeriod.addEventListener("click", () => navigate(-1));
  els.nextPeriod.addEventListener("click", () => navigate(1));
  els.todayBtn.addEventListener("click", goToday);
}

function setMode(mode) {
  els.modeButtons.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  els.idForm.hidden = mode !== "id";
  els.manualForm.hidden = mode !== "manual";
  if (mode === "manual") {
    ensureOptions().catch((err) => setStatus(`Could not load year/group options: ${err.message}`, "error"));
  } else {
    els.studentId?.focus({ preventScroll: true });
  }
}

async function ensureOptions() {
  if (lookupOptions) return lookupOptions;
  const manifest = await loader.loadManifest();
  const [options, settings] = await Promise.all([
    buildLookupOptions(loader, manifest),
    loader.loadJson(manifest.paths.settings)
  ]);
  lookupOptions = { ...options, settings, manifest };
  applyBranding(settings);
  populatePrograms(options.programs);
  return lookupOptions;
}

function applyBranding(settings) {
  const locale = settings.defaultLocale ?? CONFIG.ui.defaultLocale ?? "en";
  const title = localize(settings.calendarName, locale) || "College Schedule";
  const privacy = localize(settings.privacy?.notice, locale);
  if (els.siteTitle) els.siteTitle.textContent = title;
  document.title = title;
  if (privacy && els.privacyNotice) els.privacyNotice.textContent = privacy;
}

function populatePrograms(programs) {
  els.programSelect.innerHTML = "";
  if (!programs.length) {
    clearSelect(els.programSelect, "No programs available");
    clearSelect(els.yearSelect, "No academic years");
    clearSelect(els.groupSelect, "No groups available");
    return;
  }
  for (const program of programs) addOption(els.programSelect, program.id, program.name);
  els.programSelect.value = programs[0].id;
  populateYears();
}

function populateYears() {
  const program = lookupOptions?.programs.find((p) => p.id === els.programSelect.value);
  clearSelect(els.yearSelect, program?.years?.length ? "Select academic year" : "No academic years");
  if (!program) return;
  for (const year of program.years) addOption(els.yearSelect, year.id, year.name);
  if (program.years.length === 1) els.yearSelect.value = program.years[0].id;
  populateGroups();
}

function populateGroups() {
  const program = lookupOptions?.programs.find((p) => p.id === els.programSelect.value);
  const year = program?.years.find((y) => y.id === els.yearSelect.value);
  clearSelect(els.groupSelect, year?.groups?.length ? "Select practical group" : "No groups available");
  if (!year) return;
  for (const group of year.groups) addOption(els.groupSelect, group.value, group.label);
  if (year.groups.length === 1) els.groupSelect.value = year.groups[0].value;
}

function clearSelect(select, placeholder) {
  select.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = placeholder;
  option.disabled = true;
  option.selected = true;
  select.appendChild(option);
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

async function onIdSubmit(event) {
  event.preventDefault();
  setStatus("Searching…");
  try {
    const manifest = await loader.loadManifest();
    checkForUpdate(manifest.dataVersion);
    const assignmentDocs = await loadAssignmentDocuments(loader, manifest);
    const assignment = resolveStudentId(els.studentId.value, assignmentDocs);
    assignment.lookupMethod = "Student ID";
    assignment.displayId = maskStudentId(assignment.studentId);
    assignment.groupLabel = formatGroupLabel(assignment);
    await loadAndRenderSchedule(assignment, manifest);
  } catch (err) { renderError(err); }
}

async function onManualSubmit(event) {
  event.preventDefault();
  setStatus("Searching…");
  try {
    await ensureOptions();
    const programId = els.programSelect.value;
    const academicYearId = els.yearSelect.value;
    const groupValue = els.groupSelect.value;
    if (!programId || !academicYearId || !groupValue) {
      setStatus("Select a program, academic year, and practical group.", "error");
      return;
    }
    const program = lookupOptions?.programs.find((p) => p.id === programId);
    const year = program?.years.find((y) => y.id === academicYearId);
    const groupOption = year?.groups.find((g) => g.value === groupValue);
    if (!groupOption) throw new Error("Selected group is no longer available. Reload the page.");

    const assignment = {
      studentId: null,
      displayId: null,
      programId,
      academicYearId,
      practicalGroup: groupOption.practicalGroup,
      subdivision: groupOption.subdivision ?? null,
      subdivisionStatus: groupOption.subdivision ? "resolved" : "not-applicable",
      groupLabel: groupOption.label,
      source: "manual",
      lookupMethod: "Year & group",
      warnings: []
    };

    const manifest = await loader.loadManifest();
    checkForUpdate(manifest.dataVersion);
    await loadAndRenderSchedule(assignment, manifest);
  } catch (err) { renderError(err); }
}

function maskStudentId(id) {
  if (!id) return "";
  if (id.length <= 4) return id;
  return "•".repeat(id.length - 4) + id.slice(-4);
}

function formatGroupLabel(assignment) {
  if (assignment.practicalGroup == null) return "Unresolved";
  if (assignment.subdivision) return `${assignment.practicalGroup}${assignment.subdivision}`;
  return String(assignment.practicalGroup);
}

async function loadAndRenderSchedule(assignment, manifest) {
  const programs = await loader.loadPrograms(manifest);
  const program = findProgram(programs, assignment.programId);
  if (!program) throw new DataIntegrityError(`Unknown program: ${assignment.programId}`);
  const year = findAcademicYear(program, assignment.academicYearId);
  if (!year) throw new DataIntegrityError(`Unknown academic year: ${assignment.academicYearId}`);

  const institution = await loader.loadInstitutionData(manifest);
  const locale = institution.settings.defaultLocale ?? CONFIG.ui.defaultLocale ?? "en";
  const today = todayInTimeZone(manifest.timezone);

  const semester = selectActiveSemester(year, today, manifest.timezone);
  if (!semester) throw new Error("No active or upcoming published semester is available for this academic year.");

  const datasets = await loader.loadSemesterDatasets(semester, manifest);
  const labelIndex = buildEventIndex(datasets);

  const schedule = composeSchedule({
    institutionId: institution.settings.institutionId,
    timezone: manifest.timezone,
    settings: institution.settings,
    locations: institution.locations,
    semester,
    courses: datasets.courses,
    lectures: datasets.lectures,
    practicals: datasets.practicals,
    exams: datasets.exams,
    exceptions: datasets.exceptions,
    institutionEvents: institution.events,
    context: { ...assignment, semesterId: semester.id, today },
    locale
  });

  const issues = [
    ...schedule.diagnostics.errors.map((message) => ({ level: "error", message })),
    ...schedule.diagnostics.warnings.map((message) => ({ level: "warning", message }))
  ];

  currentState = {
    manifest, institution, program, year, semester,
    assignment, schedule, today, locale, issues,
    courses: Array.isArray(datasets.courses) ? datasets.courses : datasets.courses?.courses ?? [],
    labelIndex,
    anchorDate: today,
    view: "weekly"
  };

  renderAll(currentState);
  const hasErrors = issues.some((i) => i.level === "error");
  setStatus(hasErrors ? "Schedule loaded, but data issues were detected." : "Schedule loaded.",
    hasErrors ? "error" : "success");
}

function checkForUpdate(dataVersion) {
  const key = "college-schedule-data-version";
  let previous = null;
  try { previous = localStorage.getItem(key); } catch { previous = null; }
  if (previous && previous !== dataVersion) {
    loader.cache?.clear();
    lookupOptions = null;
    setStatus("Published data changed. Cached files were cleared. Reload if anything looks stale.", "info");
  }
  try { localStorage.setItem(key, dataVersion); } catch {}
}

function setStatus(message, kind = "info") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`;
}

function renderAll(state) {
  els.result.hidden = false;
  renderAssignmentSummary(state);
  renderView(state, state.view);
  renderCalendar(state);
}

function navigate(delta) {
  if (!currentState) return;
  const days = currentState.view === "weekly" ? 7 : currentState.view === "daily" ? 1 : CONFIG.ui.upcomingDays;
  currentState.anchorDate = formatDate(addDays(parseDate(currentState.anchorDate), delta * days));
  renderView(currentState, currentState.view);
}

function goToday() {
  if (!currentState) return;
  currentState.anchorDate = currentState.today;
  renderView(currentState, currentState.view);
}

function renderView(state, view) {
  state.view = view;
  els.viewButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  const range = getVisibleRange(state, view);
  els.periodHeading.textContent = formatPeriodHeading(view, range.start, range.end);
  if (view === "upcoming") renderUpcomingList(state, range.start, range.end);
  else renderGoogleStyleCalendar(state, range.days);
}

function getVisibleRange(state, view) {
  const weekStartDay = state.institution.settings.weekStartDay ?? "Saturday";
  if (view === "weekly") {
    const start = startOfWeek(state.anchorDate, weekStartDay);
    const end = endOfWeek(start);
    const days = [];
    let cursor = start;
    while (cursor <= end) { days.push(cursor); cursor = formatDate(addDays(parseDate(cursor), 1)); }
    return { start, end, days };
  }
  if (view === "daily") return { start: state.anchorDate, end: state.anchorDate, days: [state.anchorDate] };
  const start = state.anchorDate;
  const end = formatDate(addDays(parseDate(start), Math.max(0, CONFIG.ui.upcomingDays - 1)));
  return { start, end, days: [] };
}

function formatPeriodHeading(view, start, end) {
  if (view === "daily") return formatLongDate(start);
  if (view === "upcoming") return `Upcoming · ${formatShortDate(start)} – ${formatShortDate(end)}`;
  return formatRangeHeading(start, end);
}

function formatRangeHeading(start, end) {
  const s = parseDate(start);
  const e = parseDate(end);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth();
  if (sameMonth) return `${MONTHS_LONG[s.getUTCMonth()]} ${s.getUTCDate()}–${e.getUTCDate()}, ${s.getUTCFullYear()}`;
  if (sameYear) return `${MONTHS_SHORT[s.getUTCMonth()]} ${s.getUTCDate()} – ${MONTHS_SHORT[e.getUTCMonth()]} ${e.getUTCDate()}, ${s.getUTCFullYear()}`;
  return `${MONTHS_SHORT[s.getUTCMonth()]} ${s.getUTCDate()}, ${s.getUTCFullYear()} – ${MONTHS_SHORT[e.getUTCMonth()]} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

function formatLongDate(dateStr) {
  const d = parseDate(dateStr);
  return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function formatShortDate(dateStr) {
  const d = parseDate(dateStr);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function formatTime12(time) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function formatTimeRange(start, end) {
  if (!start && !end) return "All day";
  if (!end) return formatTime12(start);
  return `${formatTime12(start)} – ${formatTime12(end)}`;
}

function formatHourLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  if (m === 0) return `${hour} ${period}`;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function formatEventTime(event) {
  if (event.allDay) {
    if (event.endDate && event.endDate !== event.date) return `${formatShortDate(event.date)} – ${formatShortDate(event.endDate)}`;
    return "All day";
  }
  return formatTimeRange(event.start, event.end);
}

function nowMinutesInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return hour * 60 + get("minute");
}

// ---- subject colors + shorthand labels ----

function evLabel(state, event) {
  return eventLabel(event, state.labelIndex, state.locale);
}

function evColor(state, event) {
  return eventColor(event, state.labelIndex);
}

function colorStyle(color, kind) {
  if (!color) return "";
  if (kind === "block") {
    return `background:${color}1a;border-color:${color}59;border-left-color:${color};color:${color};`;
  }
  return `background:${color}1a;border-color:${color}59;color:${color};`;
}

function renderAssignmentSummary(state) {
  const a = state.assignment;
  const locale = state.locale;
  const pills = [];

  if (a.displayId) pills.push({ label: "ID", value: a.displayId });
  pills.push({ label: "Lookup", value: a.lookupMethod ?? "Student ID" });
  pills.push({ label: "Program", value: localize(state.program.name, locale) || state.program.id });
  pills.push({ label: "Year", value: localize(state.year.name, locale) || state.year.id });
  pills.push({ label: "Semester", value: localize(state.semester.name, locale) || state.semester.id });
  pills.push({ label: "Group", value: a.groupLabel ?? formatGroupLabel(a), className: "group" });
  if (a.subdivision) pills.push({ label: "Subdivision", value: a.subdivision });

  let html = `<div class="summary-pills">`;
  for (const pill of pills) {
    html += `<span class="pill ${escapeHtml(pill.className ?? "")}"><span>${escapeHtml(pill.label)}</span> ${escapeHtml(String(pill.value))}</span>`;
  }
  html += `</div>`;

  const legend = (state.courses ?? []).filter((c) => c?.color);
  if (legend.length) {
    html += `<div class="summary-pills" style="margin-top:8px;">`;
    for (const course of legend) {
      html += `<span class="pill"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escapeHtml(course.color)};margin-right:6px;"></span>${escapeHtml(localize(course.title, locale))}</span>`;
    }
    html += `</div>`;
  }

  const notes = [...(a.warnings ?? []), ...(state.issues ?? []).map((i) => i.message)].filter(Boolean);
  if (notes.length) {
    const visible = notes.slice(0, 4).join(" · ");
    const extra = notes.length > 4 ? " …" : "";
    html += `<div class="summary-notes"><strong>Data notes:</strong> ${escapeHtml(visible + extra)}</div>`;
  }

  els.assignmentSummary.innerHTML = html;
}

function renderGoogleStyleCalendar(state, days) {
  const today = state.today;
  const timezone = state.manifest.timezone;
  const hourHeight = 56;

  const visibleEvents = state.schedule.events.filter((event) => occursInRange(event, days[0], days[days.length - 1]));

  const allDayByDay = days.map((day) =>
    visibleEvents
      .filter((event) => event.allDay && occursOnDay(event, day))
      .sort((a, b) => evLabel(state, a).localeCompare(evLabel(state, b)))
  );

  const timedByDay = days.map((day) =>
    visibleEvents
      .filter((event) => !event.allDay && occursOnDay(event, day) && event.start && event.end)
      .map((event) => ({
        ...event,
        _start: timeToMinutes(event.start),
        _end: Math.max(timeToMinutes(event.end), timeToMinutes(event.start) + 15)
      }))
  );

  const allTimed = timedByDay.flat();
  let rangeStart = 7 * 60;
  let rangeEnd = 20 * 60;

  if (allTimed.length) {
    const minStart = Math.min(...allTimed.map((e) => e._start));
    const maxEnd = Math.max(...allTimed.map((e) => e._end));
    rangeStart = Math.max(0, Math.floor((minStart - 60) / 60) * 60);
    rangeEnd = Math.min(24 * 60, Math.ceil((maxEnd + 60) / 60) * 60);
    if (rangeEnd <= rangeStart) { rangeStart = 7 * 60; rangeEnd = 20 * 60; }
  }

  const laidOutDays = timedByDay.map(layoutTimedEvents);
  const nowMinutes = nowMinutesInTimeZone(timezone);
  const showNowLine = days.includes(today) && nowMinutes >= rangeStart && nowMinutes <= rangeEnd;
  const nowTop = ((nowMinutes - rangeStart) / 60) * hourHeight;

  let html = `<div class="gc-calendar" style="--day-count:${days.length}; --hour-height:${hourHeight}px; --range-start:${rangeStart}; --range-end:${rangeEnd};">`;

  html += `<div class="gc-row gc-header-row"><div class="gc-corner"></div><div class="gc-day-heads">`;
  for (const day of days) {
    const d = parseDate(day);
    const isToday = day === today;
    html += `<div class="gc-day-head ${isToday ? "today" : ""}"><span class="gc-weekday">${escapeHtml(WEEKDAYS_SHORT[d.getUTCDay()])}</span><span class="gc-daynum">${d.getUTCDate()}</span></div>`;
  }
  html += `</div></div>`;

  html += `<div class="gc-row gc-allday-row"><div class="gc-allday-label">All day</div><div class="gc-allday-cells">`;
  for (const dayEvents of allDayByDay) {
    html += `<div class="gc-allday-cell">`;
    for (const event of dayEvents) {
      const label = evLabel(state, event);
      const color = evColor(state, event);
      const type = event.type ?? "college-event";
      html += `<div class="gc-allday-chip type-${escapeHtml(type)}" style="${colorStyle(color, "chip")}" title="${escapeHtml(`${label} · All day`)}">${escapeHtml(label)}</div>`;
    }
    html += `</div>`;
  }
  html += `</div></div>`;

  html += `<div class="gc-row gc-body-row"><div class="gc-time-gutter">`;
  for (let m = rangeStart; m < rangeEnd; m += 60) {
    const top = ((m - rangeStart) / 60) * hourHeight;
    html += `<div class="gc-hour-label" style="top:${top}px;">${escapeHtml(formatHourLabel(m))}</div>`;
  }
  html += `</div><div class="gc-columns">`;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const isToday = day === today;
    html += `<div class="gc-day-column ${isToday ? "today" : ""}">`;

    for (const event of laidOutDays[i]) {
      const top = ((event._start - rangeStart) / 60) * hourHeight;
      const height = Math.max(22, ((event._end - event._start) / 60) * hourHeight - 2);
      const widthPercent = 100 / (event._total || 1);
      const leftPercent = (event._col || 0) * widthPercent;

      const label = evLabel(state, event);
      const full = eventFullTitle(event, state.locale);
      const time = formatTimeRange(event.start, event.end);
      const location = formatLocation(event.location, state.institution.locations.buildings, state.locale);
      const color = evColor(state, event);
      const tooltip = [label, full !== label ? full : null, time, location].filter(Boolean).join(" · ");

      html += `<div class="gc-event type-${escapeHtml(event.type)} status-${escapeHtml(event.status)}" style="top:${top}px; height:${height}px; left:calc(${leftPercent}% + 2px); width:calc(${widthPercent}% - 4px); ${colorStyle(color, "block")}" title="${escapeHtml(tooltip)}"><div class="gc-event-title">${escapeHtml(label)}</div><div class="gc-event-time">${escapeHtml(time)}</div></div>`;
    }

    html += `</div>`;
  }

  if (showNowLine) html += `<div class="gc-now-line" style="top:${nowTop}px;"></div>`;

  html += `</div></div></div>`;
  els.timetable.innerHTML = html;
}

function layoutTimedEvents(events) {
  const items = [...events].sort((a, b) => {
    const startDiff = a._start - b._start;
    if (startDiff !== 0) return startDiff;
    const durationDiff = (b._end - b._start) - (a._end - a._start);
    if (durationDiff !== 0) return durationDiff;
    return String(a.eventId).localeCompare(String(b.eventId));
  });

  const clusters = [];
  let currentCluster = [];
  let clusterEnd = -1;

  for (const item of items) {
    if (currentCluster.length && item._start >= clusterEnd) {
      clusters.push(currentCluster);
      currentCluster = [];
      clusterEnd = -1;
    }
    currentCluster.push(item);
    clusterEnd = Math.max(clusterEnd, item._end);
  }
  if (currentCluster.length) clusters.push(currentCluster);

  for (const cluster of clusters) {
    const columnEnds = [];
    for (const item of cluster) {
      let placed = false;
      for (let i = 0; i < columnEnds.length; i++) {
        if (columnEnds[i] <= item._start) {
          item._col = i;
          columnEnds[i] = item._end;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item._col = columnEnds.length;
        columnEnds.push(item._end);
      }
    }
    const total = columnEnds.length || 1;
    for (const item of cluster) item._total = total;
  }

  return items;
}

function renderUpcomingList(state, start, end) {
  const events = state.schedule.events
    .filter((event) => occursInRange(event, start, end))
    .sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
      const startCmp = timeToMinutes(a.start) - timeToMinutes(b.start);
      if (startCmp !== 0) return startCmp;
      return evLabel(state, a).localeCompare(evLabel(state, b));
    });

  if (!events.length) {
    els.timetable.innerHTML = `<div class="empty-state">Nothing scheduled in this range.</div>`;
    return;
  }

  const grouped = new Map();
  for (const event of events) {
    if (event.allDay && event.endDate && event.endDate !== event.date) {
      let cursor = event.date > start ? event.date : start;
      const stop = event.endDate < end ? event.endDate : end;
      while (cursor <= stop) {
        if (!grouped.has(cursor)) grouped.set(cursor, []);
        grouped.get(cursor).push({ ...event, displayDate: cursor, displayWhen: "All day" });
        cursor = formatDate(addDays(parseDate(cursor), 1));
      }
      continue;
    }
    const day = event.date;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push({ ...event, displayDate: day, displayWhen: formatEventTime(event) });
  }

  const buildings = state.institution.locations.buildings;
  const sortedDays = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  let html = `<div class="agenda">`;
  for (const [date, dayEvents] of sortedDays) {
    html += `<section class="agenda-day"><div class="agenda-day-header"><h3>${escapeHtml(formatLongDate(date))}</h3><span class="agenda-count">${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}</span></div>`;

    for (const event of dayEvents) {
      const label = evLabel(state, event);
      const full = eventFullTitle(event, state.locale);
      const location = formatLocation(event.location, buildings, state.locale);
      const color = evColor(state, event);
      const type = event.type ?? "event";

      const tags = [];
      tags.push(`<span class="tag ${escapeHtml(type)}" style="${colorStyle(color, "tag")}">${escapeHtml(type.replace(/-/g, " "))}</span>`);
      if (event.status === "cancelled") tags.push(`<span class="tag cancelled">Cancelled</span>`);
      if ((event.sourceReview ?? []).length) tags.push(`<span class="tag unverified">Needs review</span>`);

      html += `<article class="agenda-event"><div class="agenda-time">${escapeHtml(event.displayWhen ?? formatEventTime(event))}</div><div class="agenda-main"><div class="agenda-title">${escapeHtml(label)}</div><div class="agenda-meta">${full !== label ? `<span>${escapeHtml(full)}</span>` : ""}${location ? `<span>${escapeHtml(location)}</span>` : ""}${event.courseId ? `<span>${escapeHtml(event.courseId)}</span>` : ""}</div></div><div class="agenda-tags">${tags.join(" ")}</div></article>`;
    }

    html += `</section>`;
  }
  html += `</div>`;
  els.timetable.innerHTML = html;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function renderCalendar(state) {
  const feedUrl = buildFeedUrl(state.assignment, state.manifest);

  if (!feedUrl) {
    els.calendarLinks.innerHTML = `<div class="summary-notes">Calendar subscription is unavailable because your practical group could not be resolved.</div>`;
    return;
  }

  const addByUrlPage = googleCalendarAddByUrlUrl();
  const oneClickUrl = googleCalendarSubscribeUrl(feedUrl);
  const subNote = state.assignment.subdivision
    ? `This feed contains only subgroup ${state.assignment.groupLabel} sessions (alternating weeks and batch times included).`
    : `This feed contains the whole group ${state.assignment.practicalGroup} schedule.`;

  els.calendarLinks.innerHTML = `
    <ol class="steps">
      <li>Click <strong>Open Google Calendar</strong>. The feed URL is copied to your clipboard automatically.</li>
      <li>In the page that opens, paste it into the <strong>URL of calendar</strong> box.</li>
      <li>Click <strong>Add calendar</strong>. The subscription stays live and updates itself.</li>
    </ol>
    <div class="feed-box">
      <div><span class="feed-label">Stable feed URL</span><code>${escapeHtml(feedUrl)}</code></div>
      <div class="feed-actions">
        <a class="btn primary" id="open-gcal" href="${escapeHtml(addByUrlPage)}" target="_blank" rel="noopener noreferrer">Open Google Calendar</a>
        <button class="btn quiet" type="button" id="copy-feed">Copy feed URL</button>
        <button class="btn quiet" type="button" id="download-ics">Download .ics preview</button>
      </div>
      <p class="hint" id="copy-hint">${escapeHtml(subNote)} Google's one-click endpoint is unreliable, so this button opens Google's official "Add by URL" page.</p>
      <p class="hint">Prefer to try anyway? <a href="${escapeHtml(oneClickUrl)}" target="_blank" rel="noopener noreferrer">One-click subscribe (may fail)</a>. If Google says the calendar already exists, remove the old entry first.</p>
    </div>
    <p class="hint">Subject colors appear on this website. Google assigns one color per subscribed calendar, so in Google the subject is identified by its shorthand name (e.g. PN 7 Basic Pharmacology).</p>
  `;

  const hint = document.getElementById("copy-hint");

  document.getElementById("open-gcal").addEventListener("click", () => {
    copyToClipboard(feedUrl).then((ok) => {
      if (hint) {
        hint.textContent = ok
          ? "Feed URL copied. Paste it into the URL of calendar box, then click Add calendar."
          : "Could not copy automatically. Select the feed URL above and copy it manually.";
      }
    });
  });

  document.getElementById("copy-feed").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    copyToClipboard(feedUrl).then((ok) => {
      btn.textContent = ok ? "Copied ✓" : "Copy failed";
      setTimeout(() => { btn.textContent = "Copy feed URL"; }, 1600);
    });
  });

  document.getElementById("download-ics").addEventListener("click", () => {
    const enriched = state.schedule.events.map((e) => {
      const code = eventShorthand(e, state.labelIndex);
      return code ? { ...e, calendarTitle: code } : e;
    });

    const ics = eventsToIcs(enriched, {
      calendarName: state.institution.settings.calendarName,
      locale: state.locale,
      timezone: state.manifest.timezone,
      institutionId: state.institution.settings.institutionId,
      locations: state.institution.locations,
      generatedAt: new Date()
    });

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = calendarFileName(state.assignment);
    a.click();
    URL.revokeObjectURL(url);
  });
}

function calendarFileName(assignment) {
  const group = assignment.practicalGroup ?? "unresolved";
  const sub = assignment.subdivision ? `-${String(assignment.subdivision).toLowerCase()}` : "";
  return `group-${group}${sub}.ics`;
}

function renderError(err) {
  els.result.hidden = true;
  if (err instanceof StudentNotFoundError) {
    setStatus("Student ID not found. Check the ID, or contact the college office if you believe this is wrong.", "error");
    return;
  }
  if (err instanceof DataIntegrityError) {
    setStatus(`Data integrity problem: ${err.message}. This is a repository data issue, not an authentication issue.`, "error");
    return;
  }
  setStatus(`Unexpected error: ${err.message}`, "error");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}
