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
import { buildFeedUrl, googleCalendarSubscribeUrl } from "./calendar/calendar-links.js";
import { eventsToIcs, formatLocation } from "./calendar/ics-generator.js";
import { localize } from "./i18n.js";

const loader = new DataLoader();

const els = {
  modeButtons: document.querySelectorAll(".segment"),
  consoleTabs: document.querySelector(".console-tabs"),
  idForm: document.getElementById("id-form"),
  manualForm: document.getElementById("manual-form"),
  studentId: document.getElementById("student-id"),
  programSelect: document.getElementById("program-select"),
  yearSelect: document.getElementById("year-select"),
  groupSelect: document.getElementById("group-select"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  assignmentSummary: document.getElementById("assignment-summary"),
  timetable: document.getElementById("timetable"),
  calendarLinks: document.getElementById("calendar-links"),
  tabs: document.querySelectorAll(".tab"),
  siteTitle: document.getElementById("site-title"),
  privacyNotice: document.getElementById("privacy-notice")
};

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
  els.tabs.forEach((btn) => btn.addEventListener("click", () => {
    if (currentState) renderView(currentState, btn.dataset.view);
  }));
}

function setMode(mode) {
  els.modeButtons.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  if (els.consoleTabs) els.consoleTabs.dataset.mode = mode;
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
    assignment, schedule, today, locale, issues, view: "weekly"
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
  els.result.classList.remove("results-show");
  void els.result.offsetWidth;
  els.result.classList.add("results-show");
  renderAssignmentSummary(state);
  renderView(state, state.view);
  renderCalendar(state);
}

function renderAssignmentSummary(state) {
  const a = state.assignment;
  const locale = state.locale;
  const items = [];
  if (a.displayId) items.push(["Student ID", a.displayId]);
  items.push(["Lookup", a.lookupMethod ?? "Student ID"]);
  items.push(["Program", localize(state.program.name, locale) || state.program.id]);
  items.push(["Academic year", localize(state.year.name, locale) || state.year.id]);
  items.push(["Semester", localize(state.semester.name, locale) || state.semester.id]);
  items.push(["Practical group", a.groupLabel ?? formatGroupLabel(a)]);
  items.push(["Subdivision", a.subdivision ?? (a.subdivisionStatus === "unresolved" ? "Unresolved" : "Not applicable")]);

  let html = `<div class="summary-grid">`;
  for (const [label, value] of items) {
    html += `<div class="summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }
  html += `</div>`;

  const notes = [...(a.warnings ?? []), ...(state.issues ?? []).map((i) => i.message)].filter(Boolean);
  if (notes.length) {
    const visible = notes.slice(0, 5).join(" · ");
    const extra = notes.length > 5 ? " …" : "";
    html += `<div class="warning-box"><strong>Data notes:</strong> ${escapeHtml(visible + extra)}</div>`;
  }
  els.assignmentSummary.innerHTML = html;
}

function renderView(state, view) {
  state.view = view;
  els.tabs.forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "true");
    else btn.removeAttribute("aria-current");
  });

  const events = state.schedule.events;

  if (view === "weekly") {
    const ws = startOfWeek(state.today, state.institution.settings.weekStartDay ?? "Saturday");
    const we = endOfWeek(ws);
    renderAgenda(expandEventsForRange(events.filter((e) => occursInRange(e, ws, we)), ws, we, "repeat"), state, `Week of ${ws}`);
    return;
  }
  if (view === "daily") {
    renderAgenda(expandEventsForRange(events.filter((e) => occursOnDay(e, state.today)), state.today, state.today, "repeat"), state, `Today (${state.today})`);
    return;
  }
  const limit = formatDate(addDays(parseDate(state.today), CONFIG.ui.upcomingDays));
  renderAgenda(expandEventsForRange(events.filter((e) => occursInRange(e, state.today, limit)), state.today, limit, "once"), state, `Next ${CONFIG.ui.upcomingDays} days`);
}

function expandEventsForRange(events, rangeStart, rangeEnd, mode) {
  const out = [];
  for (const event of events) {
    if (event.allDay && event.endDate && event.endDate !== event.date) {
      const start = event.date > rangeStart ? event.date : rangeStart;
      const end = event.endDate < rangeEnd ? event.endDate : rangeEnd;
      if (mode === "repeat") {
        let cursor = start;
        while (cursor <= end) {
          out.push({ ...event, displayDate: cursor, displayWhen: "All day" });
          cursor = formatDate(addDays(parseDate(cursor), 1));
        }
      } else {
        out.push({ ...event, displayDate: start, displayWhen: `${event.date} → ${event.endDate} (all day)` });
      }
      continue;
    }
    let displayDate = event.date;
    if (event.allDay && displayDate < rangeStart) displayDate = rangeStart;
    const displayWhen = event.allDay
      ? (event.endDate && event.endDate !== event.date ? `${event.date} → ${event.endDate} (all day)` : "All day")
      : `${event.start ?? ""}–${event.end ?? ""} · ${event.day}`;
    out.push({ ...event, displayDate, displayWhen });
  }
  return out;
}

function renderAgenda(displayEvents, state, heading) {
  const locale = state.locale;
  const buildings = state.institution.locations.buildings;
  const grouped = new Map();
  for (const event of displayEvents) {
    const day = event.displayDate ?? event.date;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(event);
  }

  let html = `<h2 class="sr-only">${escapeHtml(heading)}</h2>`;
  if (!displayEvents.length) {
    html += `<div class="empty-state">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
      Nothing scheduled for this view.
    </div>`;
    els.timetable.innerHTML = html;
    return;
  }

  const sortedDays = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [date, dayEvents] of sortedDays) {
    dayEvents.sort((a, b) => {
      if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
      const d = timeToMinutes(a.start) - timeToMinutes(b.start);
      if (d !== 0) return d;
      return localize(a.title, locale).localeCompare(localize(b.title, locale));
    });

    html += `<section class="day"><div class="day-header"><h3>${escapeHtml(formatDayHeading(date))}</h3><span class="day-count">${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}</span></div>`;
    for (const event of dayEvents) {
      const classes = ["event", event.type, event.status, event.allDay ? "all-day" : "", (event.sourceReview ?? []).length ? "unverified" : ""].filter(Boolean).join(" ");
      const when = event.displayWhen ?? (event.allDay ? "All day" : `${event.start ?? ""}–${event.end ?? ""} · ${event.day}`);
      const location = formatLocation(event.location, buildings, locale);
      const title = localize(event.title, locale);
      const typeLabel = event.type.replace(/-/g, " ");
      html += `<article class="${classes}">
        <div class="event-main">
          <div class="event-title">${escapeHtml(title)}</div>
          <div class="event-meta">
            <span class="time">${escapeHtml(when)}</span>
            ${location ? `<span>${escapeHtml(location)}</span>` : ""}
            ${event.courseId ? `<span>${escapeHtml(event.courseId)}</span>` : ""}
          </div>
        </div>
        <div class="event-side">
          <span class="badge ${escapeHtml(event.type)}">${escapeHtml(typeLabel)}</span>
          ${event.status === "cancelled" ? `<span class="badge cancelled">Cancelled</span>` : ""}
          ${(event.sourceReview ?? []).length ? `<span class="badge unverified">Needs review</span>` : ""}
        </div>
      </article>`;
    }
    html += `</section>`;
  }
  els.timetable.innerHTML = html;
}

function formatDayHeading(date) {
  try { return `${weekdayName(parseDate(date))} · ${date}`; } catch { return date; }
}

function renderCalendar(state) {
  const feedUrl = buildFeedUrl(state.assignment, state.manifest);
  if (!feedUrl) {
    els.calendarLinks.innerHTML = `<div class="warning-box">Calendar subscription is unavailable because your practical group could not be resolved.</div>`;
    return;
  }
  const googleUrl = googleCalendarSubscribeUrl(feedUrl, window.location.origin);
  els.calendarLinks.innerHTML = `
    <ol class="steps">
      <li>Open the Google Calendar link below.</li>
      <li>If prompted, choose <strong>Add other calendar → From URL</strong>.</li>
      <li>Paste the stable feed URL and subscribe.</li>
    </ol>
    <div class="feed-box">
      <div><span class="label">Stable feed URL</span><code>${escapeHtml(feedUrl)}</code></div>
      <div class="feed-actions">
        <a class="btn primary" href="${escapeHtml(googleUrl)}" target="_blank" rel="noopener noreferrer">Subscribe in Google Calendar</a>
        <button class="btn secondary" type="button" id="download-ics">Download .ics preview</button>
      </div>
    </div>
    <p class="hint">Google controls refresh frequency. The feed URL stays stable when repository data is updated.</p>
  `;
  document.getElementById("download-ics").addEventListener("click", () => {
    const ics = eventsToIcs(state.schedule.events, {
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
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
