import { CONFIG } from "./config.js";
import { DataLoader } from "./data/loader.js";
import { findProgram, findAcademicYear } from "./data/programs.js";
import { loadAssignmentDocuments } from "./student/assignments.js";
import {
  resolveStudentId,
  StudentNotFoundError,
  DataIntegrityError
} from "./student/resolver.js";
import {
  composeSchedule,
  selectActiveSemester
} from "./schedule/engine.js";
import {
  todayInTimeZone,
  startOfWeek,
  endOfWeek,
  parseDate
} from "./schedule/recurrence.js";
import {
  buildFeedUrl,
  googleCalendarSubscribeUrl
} from "./calendar/calendar-links.js";
import { eventsToIcs, formatLocation } from "./calendar/ics-generator.js";
import { localize } from "./i18n.js";

const loader = new DataLoader();

const els = {
  form: document.getElementById("lookup-form"),
  input: document.getElementById("student-id"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  assignmentSummary: document.getElementById("assignment-summary"),
  timetable: document.getElementById("timetable"),
  calendarLinks: document.getElementById("calendar-links"),
  tabs: document.querySelectorAll(".tabs button")
};

let currentState = null;

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await lookup(els.input.value);
});

els.tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    els.tabs.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (currentState) renderView(currentState, btn.dataset.view);
  });
});

function setStatus(message, kind = "info") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`;
}

async function lookup(rawId) {
  try {
    setStatus("Loading schedule…");

    const manifest = await loader.loadManifest();
    checkForUpdate(manifest.dataVersion);

    const programs = await loader.loadPrograms(manifest);
    const assignmentDocs = await loadAssignmentDocuments(loader, manifest);

    const assignment = resolveStudentId(rawId, assignmentDocs);

    const program = findProgram(programs, assignment.programId);
    if (!program) throw new DataIntegrityError(`Unknown program: ${assignment.programId}`);

    const year = findAcademicYear(program, assignment.academicYearId);
    if (!year) throw new DataIntegrityError(`Unknown academic year: ${assignment.academicYearId}`);

    const institution = await loader.loadInstitutionData(manifest);
    const today = todayInTimeZone(manifest.timezone);

    const semester = selectActiveSemester(year, today, manifest.timezone);
    if (!semester) {
      throw new Error("No active or upcoming published semester found for this academic year.");
    }

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
      exceptions: datasets.exceptions,
      institutionEvents: institution.events,
      context: {
        ...assignment,
        semesterId: semester.id,
        today
      },
      locale: institution.settings.defaultLocale ?? CONFIG.ui.defaultLocale
    });

    currentState = {
      manifest,
      institution,
      assignment,
      semester,
      schedule,
      today,
      view: "weekly"
    };

    renderAll(currentState);
    setStatus("");
  } catch (err) {
    renderError(err);
  }
}

function checkForUpdate(dataVersion) {
  const key = "college-schedule-data-version";
  const previous = localStorage.getItem(key);

  if (previous && previous !== dataVersion) {
    setStatus("The published schedule has been updated.", "info");
  }

  localStorage.setItem(key, dataVersion);
}

function renderAll(state) {
  els.result.hidden = false;
  renderAssignmentSummary(state);
  renderView(state, state.view);
  renderCalendar(state);
}

function renderAssignmentSummary(state) {
  const a = state.assignment;
  const warnings = (a.warnings ?? []).join(", ");

  els.assignmentSummary.innerHTML = `
    <p><strong>Program:</strong> ${a.programId}</p>
    <p><strong>Academic year:</strong> ${a.academicYearId}</p>
    <p><strong>Semester:</strong> ${state.semester.id}</p>
    <p><strong>Practical group:</strong> ${a.practicalGroup ?? "unresolved"}</p>
    <p><strong>Subdivision:</strong> ${a.subdivision ?? a.subdivisionStatus}</p>
    ${warnings ? `<p class="warning">Warnings: ${warnings}</p>` : ""}
  `;
}

function renderView(state, view) {
  state.view = view;
  const events = state.schedule.events;

  if (view === "weekly") {
    const weekStart = startOfWeek(state.today, state.institution.settings.weekStartDay ?? "Saturday");
    const weekEnd = endOfWeek(weekStart);

    const filtered = events.filter((e) => e.date >= weekStart && e.date <= weekEnd);
    renderAgenda(filtered, state, `Week of ${weekStart}`);
    return;
  }

  if (view === "daily") {
    const filtered = events.filter((e) => e.date === state.today);
    renderAgenda(filtered, state, `Today (${state.today})`);
    return;
  }

  const limitDate = new Date(parseDate(state.today).getTime() + CONFIG.ui.upcomingDays * 86400000);
  const limit = limitDate.toISOString().slice(0, 10);

  const filtered = events.filter((e) => e.date >= state.today && e.date <= limit);
  renderAgenda(filtered, state, `Next ${CONFIG.ui.upcomingDays} days`);
}

function renderAgenda(events, state, heading) {
  const locale = state.institution.settings.defaultLocale ?? "en";
  const buildings = state.institution.locations.buildings;

  const grouped = new Map();

  for (const event of events) {
    if (!grouped.has(event.date)) grouped.set(event.date, []);
    grouped.get(event.date).push(event);
  }

  let html = `<h2>${heading}</h2>`;

  if (events.length === 0) {
    html += `<p>No events found.</p>`;
  }

  for (const [date, dayEvents] of grouped.entries()) {
    html += `<section class="day"><h3>${date}</h3>`;

    for (const event of dayEvents) {
      const classes = [
        "event",
        event.type,
        event.status,
        (event.sourceReview ?? []).length ? "unverified" : ""
      ].filter(Boolean).join(" ");

      html += `
        <article class="${classes}">
          <div class="event-title">${localize(event.title, locale)}</div>
          <div class="event-meta">
            ${event.start ?? ""}–${event.end ?? ""}
            · ${event.day}
            · ${formatLocation(event.location, buildings, locale)}
          </div>
          <div class="event-type">${event.type}</div>
        </article>
      `;
    }

    html += `</section>`;
  }

  els.timetable.innerHTML = html;
}

function renderCalendar(state) {
  const feedUrl = buildFeedUrl(state.assignment, state.manifest);

  if (!feedUrl) {
    els.calendarLinks.innerHTML = `
      <p class="warning">
        Calendar subscription is unavailable because your practical group could not be resolved.
      </p>
    `;
    return;
  }

  const googleUrl = googleCalendarSubscribeUrl(feedUrl, window.location.origin);

  els.calendarLinks.innerHTML = `
    <p><strong>Feed URL:</strong> <code>${feedUrl}</code></p>
    <p>
      <a class="button" href="${googleUrl}" target="_blank" rel="noopener">
        Subscribe in Google Calendar
      </a>
    </p>
    <p>
      Google Controls refresh frequency. After repository updates, the same feed URL remains stable.
    </p>
    <button id="download-ics">Download .ics preview</button>
  `;

  document.getElementById("download-ics").addEventListener("click", () => {
    const ics = eventsToIcs(state.schedule.events, {
      calendarName: state.institution.settings.calendarName,
      locale: state.institution.settings.defaultLocale ?? "en",
      timezone: state.manifest.timezone,
      institutionId: state.institution.settings.institutionId,
      locations: state.institution.locations,
      generatedAt: new Date()
    });

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `group-${state.assignment.practicalGroup}.ics`;
    a.click();

    URL.revokeObjectURL(url);
  });
}

function renderError(err) {
  els.result.hidden = true;

  if (err instanceof StudentNotFoundError) {
    setStatus(
      "Student ID not found. Check the ID or contact the college office if you believe this is incorrect.",
      "error"
    );
    return;
  }

  if (err instanceof DataIntegrityError) {
    setStatus(
      `Data integrity problem: ${err.message}. This is a repository data issue, not an authentication issue.`,
      "error"
    );
    return;
  }

  setStatus(`Unexpected error: ${err.message}`, "error");
}
