# College Scheduler

[![CI](https://github.com/Hunterthief/Collage-Scheduler/actions/workflows/ci.yml/badge.svg)](https://github.com/Hunterthief/Collage-Scheduler/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/hosting-GitHub%20Pages-1a73e8.svg)](https://hunterthief.github.io/Collage-Scheduler/)

A **fully static, data-driven college scheduling platform** for the Faculty of Pharmacy, Alexandria University. Students look up their personal timetable by university ID (or by program → academic year → year → practical group), see lectures, practicals, exams and college-wide events in a Google-Calendar-style interface, and subscribe to a permanent `.ics` feed for their exact year, group and subgroup.

**Live site:** <https://hunterthief.github.io/Collage-Scheduler/>
**Repository:** <https://github.com/Hunterthief/Collage-Scheduler>

> **Deployment status — year-scoped feeds.** Canonical feed paths now include the year level
> (`…/year-3/group-1-a.ics`). This takes effect once the updated `data/manifest.json`,
> `assets/js/calendar/calendar-links.js` and `tools/generate-calendars.mjs` are committed and CI
> regenerates the feeds. Until then only the flat alias paths listed in §9.2 resolve. The alias
> paths work both before and after the update, so no existing subscription breaks.

---

## Table of contents

- [1. What this is](#1-what-this-is)
- [2. Features](#2-features)
- [3. Architecture](#3-architecture)
- [4. Repository layout](#4-repository-layout)
- [5. Data model reference](#5-data-model-reference)
- [6. Shorthand notation](#6-shorthand-notation)
- [7. Student ID resolution](#7-student-id-resolution)
- [8. Scheduling semantics](#8-scheduling-semantics)
- [9. Calendar feeds](#9-calendar-feeds)
- [10. The web app](#10-the-web-app)
- [11. Local development](#11-local-development)
- [12. Data editing cookbook](#12-data-editing-cookbook)
- [13. Validation and tests](#13-validation-and-tests)
- [14. CI/CD and deployment](#14-cicd-and-deployment)
- [15. Current dataset](#15-current-dataset)
- [16. Data caveats (`sourceReview`)](#16-data-caveats-sourcereview)
- [17. Privacy and security](#17-privacy-and-security)
- [18. Troubleshooting](#18-troubleshooting)
- [19. Known limitations and roadmap](#19-known-limitations-and-roadmap)
- [20. Contributing conventions](#20-contributing-conventions)
- [21. License](#21-license)
- [22. Acknowledgements](#22-acknowledgements)

---

## 1. What this is

The repository is the **single source of truth**. All academic information lives in JSON under `data/`. The browser fetches those files over relative paths, resolves the student, composes the schedule locally, and renders it. Static `.ics` feeds are generated from the *same* engine by a Node script and committed back into the repo, so GitHub Pages serves them.

**Hard constraints (by design):**

| No | Why |
|---|---|
| Backend / server / cloud functions | GitHub Pages only |
| Database (SQL or NoSQL) | JSON in git is the database |
| Authentication | Student ID is a *lookup key*, not a credential |
| External APIs / paid services | Zero cost, zero third-party runtime dependency |
| Frontend framework / build step | Vanilla ES modules, no bundler, no `node_modules` |
| Hardcoded academic content in JS | Programs, years, groups, courses, rooms, colours all live in JSON |

Adding a program, a year level, a semester, a course, a rotation or a college-wide event is a **data edit**, never a code change.

---

## 2. Features

**Lookup**
- Student-ID lookup with leading-zero preservation, ID ranges, explicit lists and per-student overrides.
- Manual lookup: **Program → Academic year → Year (1st/2nd/3rd/4th…) → Practical group**, including subgroups `1A 1B 2A 2B 3A 3B`.
- Ambiguity is never guessed: multiple matches raise a data-integrity error; an uncovered subdivision keeps the group and flags `SUBDIVISION_UNRESOLVED`.

**Scheduling**
- Weekly recurrence with `validFrom` / `validUntil` windows.
- Date-specific one-off events (exam days, tutorial cycles, ChemSketch cycles).
- Per-group practical sessions, plus **batch** sessions restricted by seat-number range.
- **Alternating A/B week rotations** that skip blacked-out weeks without consuming a slot.
- **Blackouts** (e.g. mid-term week) that suppress lectures/practicals but keep examinations.
- Date-specific **exceptions**: cancel, move, reschedule, update, replace.
- College-wide events with audience targeting (`all`, `program`, `academic-year`, `semester`, `group`, `custom`), all-day and multi-day ranges.
- Merge + dedupe + chronological sort + overlap/conflict detection.

**Presentation**
- Google-Calendar-style **Week** and **Day** grids (sticky headers, sticky time gutter, "now" line, overlap columns), plus a **List** agenda.
- **Per-subject colour coding** driven by `courses.json`, with a legend.
- Event titles in **shorthand form** (`PN 7 Basic Pharmacology`, `LO 0 Drug Information`, `EO 2 Drug Design (Quiz 1)`).
- 12-hour AM/PM times, `Needs review` badges for unverified source data, cancelled styling.
- Responsive down to small phones; no horizontal page overflow.

**Calendars**
- Static feeds per **year level**, per group and per subgroup, plus a college-wide feed.
- Stable URLs across updates; stable UIDs; content-hashed `SEQUENCE`; `STATUS:CANCELLED`.
- **Reminders**: first timed event of each day → 1 hour before; every later timed event → 15 minutes before (`VALARM`).
- In-page reminder engine (browser notifications + toasts) using the same rule, for clients that ignore feed alarms.

---

## 3. Architecture

Five independent layers, each testable in isolation:

```text
┌──────────────────────────────────────────────────────────────┐
│ 1. DATA           data/**.json  (manifest-driven discovery)   │
├──────────────────────────────────────────────────────────────┤
│ 2. RESOLUTION     student/resolver.js  + data/options.js      │
│                   ID → program / year / level / group / A-B   │
├──────────────────────────────────────────────────────────────┤
│ 3. SCHEDULING     schedule/engine.js                          │
│                   recurrence · rotation · blackouts ·         │
│                   sessions · exceptions · targeting ·         │
│                   merge · sort · conflicts                    │
├──────────────────────────────────────────────────────────────┤
│ 4. PRESENTATION   app.js + assets/css/**                      │
├──────────────────────────────────────────────────────────────┤
│ 5. CALENDAR       calendar/ics-generator.js (browser preview) │
│                   tools/generate-calendars.mjs (static feeds) │
└──────────────────────────────────────────────────────────────┘
```

The browser and the feed generator call **the same `composeSchedule()`**, so what a student sees on screen and what lands in Google Calendar cannot drift apart.

Request flow:

```text
manifest.json
  → programs.json + assignments/*.json + institution/*.json
  → resolveStudentId()  (or manual selection)
  → selectActiveSemester(scoped by yearLevel, today in Africa/Cairo)
  → loadSemesterDatasets(courses, lectures, practicals, exams, exceptions)
  → composeSchedule()
  → render grid / agenda  ·  buildFeedUrl()  ·  eventsToIcs()
```

---

## 4. Repository layout

```text
.
├── index.html                     # single page, no build step
├── package.json                   # convenience scripts only, zero dependencies
├── LICENSE                        # Apache-2.0
├── README.md
├── .nojekyll                      # serve files as-is on GitHub Pages
│
├── .github/workflows/ci.yml       # validate → test → generate → publish feeds
│
├── assets/
│   ├── css/
│   │   ├── main.css               # tokens, page chrome, scrollbars, safe areas
│   │   ├── components.css         # lookup, pills, cards, buttons, feed box
│   │   └── schedule.css           # calendar grid, agenda, tags
│   └── js/
│       ├── app.js                 # UI wiring, views, reminders panel, subscription
│       ├── config.js              # manifest path, fetch cache policy, UI defaults
│       ├── i18n.js                # localize({en, ar})
│       ├── data/
│       │   ├── loader.js          # cache-aware fetch, missing-file diagnostics
│       │   ├── options.js         # dropdown model: programs → years → levels → groups
│       │   └── programs.js        # findProgram / findAcademicYear
│       ├── student/
│       │   ├── assignments.js     # load assignment documents from manifest
│       │   └── resolver.js        # pure ID resolution + error classes
│       ├── schedule/
│       │   ├── engine.js          # normalization + materialization + composition
│       │   ├── recurrence.js      # dates, teaching weeks, rotations, blackouts
│       │   ├── exceptions.js      # cancel / move / reschedule / update / replace
│       │   ├── shorthand.js       # "LN 5 Microbiology" parser
│       │   ├── labels.js          # shorthand titles + subject colours index
│       │   ├── reminders.js       # reminder plan + browser scheduler
│       │   ├── sorting.js         # chronological sort + conflict detection
│       │   └── targeting.js       # institution audience matching
│       └── calendar/
│           ├── ics-generator.js   # RFC 5545 writer (folding, UTC, VALARM)
│           └── calendar-links.js  # feed URL templates + Google links
│
├── data/
│   ├── manifest.json              # version, timezone, paths, feeds, cohorts
│   ├── changelog.json             # human-readable publication history
│   ├── institution/
│   │   ├── settings.json          # name, timezone, week start, locales, privacy
│   │   ├── locations.json         # buildings, codes, floors
│   │   └── events.json            # college-wide calendar & activities
│   ├── programs/programs.json     # programs → academic years → semesters
│   ├── students/assignments/
│   │   ├── pharmd/2026-2027.json
│   │   └── clinical-pharmacy/2026-2027.json
│   └── schedules/
│       ├── pharmd/2026-2027/semester-5/
│       │   ├── courses.json  lectures.json  practicals.json
│       │   └── exams.json    exceptions.json
│       └── clinical-pharmacy/2026-2027/semester-3/
│           ├── courses.json  lectures.json  practicals.json
│           └── exams.json    exceptions.json
│
├── calendar/feeds/                # generated, committed, served by Pages
│   ├── institution.ics
│   ├── pharmd/2026-2027/
│   │   ├── year-3/group-{1,2,3}[-a|-b].ics    # canonical, year-scoped
│   │   └── group-{1,2,3}[-a|-b].ics           # preserved aliases
│   └── clinical-pharmacy/2026-2027/
│       ├── year-2/group-{1,2}[-a|-b].ics      # canonical, year-scoped
│       └── group-{1,2}[-a|-b].ics             # preserved aliases
│
├── schemas/                       # JSON Schema contracts
│   ├── manifest.schema.json
│   ├── programs.schema.json
│   ├── assignments.schema.json
│   ├── events.schema.json
│   ├── exceptions.schema.json
│   └── institution-events.schema.json
│
├── tools/
│   ├── validate-data.py           # dependency-free structural validator
│   └── generate-calendars.mjs     # static feed generator (uses the same engine)
│
└── tests/
    ├── engine.test.mjs
    ├── exams.test.mjs
    ├── institution-allday.test.mjs
    ├── resolver.test.mjs
    └── shorthand.test.mjs
```

> The generator removes the legacy stray `calendar/feeds/institution/group-null.ics` on every run.
> The canonical college-wide feed is `calendar/feeds/institution.ics`.

---

## 5. Data model reference

### 5.1 `data/manifest.json`

Discovery root. The client never hardcodes dataset paths.

| Field | Purpose |
|---|---|
| `schemaVersion` | Contract version |
| `dataVersion` | Publication timestamp; drives client cache invalidation |
| `timezone` | Always `Africa/Cairo` |
| `paths.*` | `programs`, `settings`, `locations`, `institutionEvents`, `changelog` |
| `assignments[]` | One entry per **cohort** |
| `assignments[].programId` / `academicYearId` | Cohort identity |
| `assignments[].yearLevel` | Grade (1-based). Makes the manifest self-describing so feed URLs can be built without loading the assignment doc |
| `assignments[].legacyAlias` | `true` = this cohort also publishes the pre-year flat paths, keeping old subscriptions alive |
| `assignments[].path` | Assignment document |
| `calendarFeeds.baseUrl` | `calendar/feeds` |
| `calendarFeeds.pathTemplate` | `{programId}/{academicYearId}/group-{group}.ics` |
| `calendarFeeds.subdivisionPathTemplate` | `…/group-{group}-{subdivisionLower}.ics` |
| `calendarFeeds.levelPathTemplate` | `…/year-{level}/group-{group}.ics` |
| `calendarFeeds.levelSubdivisionPathTemplate` | `…/year-{level}/group-{group}-{subdivisionLower}.ics` |

**Rule:** the level templates are used whenever the year level is known — unconditionally, not only when several cohorts share a program year. The flat templates are used only for cohorts with no year level, and for explicit legacy aliases.

### 5.2 `data/programs/programs.json`

`programs[] → academicYears[] → semesters[]`.

Semester fields: `id`, `name{en,ar}`, **`yearLevel`** (1-based grade), `validFrom`, `validUntil`, `status` (`draft|published|cancelled|completed`), `datasets{courses,lectures,practicals,exams,exceptions}`, `blackouts[]`, `sourceReview[]`.

Blackout:

```json
{
  "id": "fall-2026-midterm-week",
  "from": "2026-10-31",
  "to": "2026-11-05",
  "blocksAcademicEvents": true,
  "blockTypes": ["lecture", "practical"],
  "excludedFromRotation": true
}
```

### 5.3 `data/institution/locations.json` and `settings.json`

Buildings carry `id`, `code` (shorthand letter), `name{en,ar}`, `floors[]`. Settings carry `institutionId`, `calendarName`, `timezone`, `weekStartDay` (`Saturday`), `defaultLocale`, `locales`, `privacy.notice`.

### 5.4 `data/students/assignments/<program>/<year>.json`

```json
{
  "programId": "pharmd",
  "academicYearId": "2026-2027",
  "yearLevel": 3,
  "rules": [
    {
      "id": "pharmd-2026-2027-group-1",
      "practicalGroup": 1,
      "from": "2415001",
      "to": "2415076",
      "subdivisions": [
        { "name": "A", "from": "2415001", "to": "2415038" },
        { "name": "B", "from": "2415039", "to": "2415076" }
      ]
    }
  ],
  "overrides": []
}
```

- `to: null` means *open-ended* ("to the end").
- `students: ["…"]` supports explicit lists instead of ranges.
- `overrides[]` win over rules: `{ studentId, practicalGroup, subdivision, yearLevel?, reason }`.

### 5.5 `courses.json`

```json
{ "id": "02-06-02305", "code": "02-06-02305",
  "title": { "en": "Basic Pharmacology" }, "color": "#1a73e8" }
```

`color` is the single source of subject colouring across grid, chips, agenda tags and legend.

### 5.6 Academic events (`lectures.json`, `practicals.json`, `exams.json`)

All three share one shape: `{ "events": [ … ] }`.

| Field | Notes |
|---|---|
| `id` | Stable, never reused |
| `courseId` | Must exist in `courses.json` |
| `type` | `lecture` \| `practical` \| `examination` |
| `day` | Weekday name for recurring events |
| `date` | `YYYY-MM-DD` for one-off events (overrides `day`) |
| `start` / `end` | 24-hour `HH:MM` local time |
| `groups` | `[1,2,3]`, `["all"]`, or omitted = everyone |
| `subdivisions` | Optional `["A"]` restriction at event level |
| `sessions[]` | Group-specific times (see below) |
| `rotation` | Alternating-week rule (see §8.3) |
| `location` | `{ building, floor, room }` |
| `shorthand` / `displayCode` | Human notation / calendar title |
| `validFrom` / `validUntil` | Optional validity window |
| `allDay` | All-day examination (no times) |
| `title`, `description` | Override course title; carry tutorial topics |
| `sourceReview[]` | Verification flags (see §16) |

Session:

```json
{ "group": 1, "subdivision": "A", "batch": "1A-1",
  "from": "2415001", "to": "2415010",
  "students": ["2435001"],
  "start": "09:00", "end": "10:00" }
```

`from`/`to`/`students` restrict a session to specific seat numbers — this is how ChemSketch batches and the Quiz slots are modelled.

### 5.7 `exceptions.json`

```json
{ "id": "…", "eventId": "…", "date": "2026-11-10",
  "action": "cancel", "group": 1, "newDate": "…",
  "day": "…", "start": "…", "end": "…",
  "location": { … }, "replacementEventId": "…", "keepIdentity": false }
```

Actions: `cancel`, `move`, `reschedule`, `update`, `replace`. Omitting `group` makes it a wildcard for all groups. Exceptions never mutate the recurring definition. Moving *backwards* in a week requires an explicit `newDate` (otherwise a data error is reported rather than guessing).

### 5.8 `data/institution/events.json`

College-wide calendar and activities, independent of any timetable.

- Timing: `date`, or `startDate`(+`endDate`), or `day`+`validFrom`+`validUntil`; `allDay: true` for date ranges.
- `audience.scope`: `all` \| `program` \| `academic-year` \| `semester` \| `group` \| `custom` (`custom` supports `all`/`any`/`none` rule lists).
- `status`: `draft` \| `published` \| `cancelled` \| `completed`. Only `published` (and `cancelled`, rendered struck-through) reach the public timetable.

A `scope: "all"` event appears for **every** student and in **every** feed without duplicating it into any program file.

### 5.9 `data/changelog.json`

`entries[]` with `id`, `publishedAt`, `summary{en}`, `affected{programId,academicYearId,semesterId}`, `calendarFeedAffected`, `notes[]`.

---

## 6. Shorthand notation

Compact, case-insensitive notation for humans. **Structured fields remain authoritative** — shorthand is never the only representation.

| Part | Values |
|---|---|
| Event type | `L` lecture · `P` practical/section · `E` examination |
| Building | `N` New Building · `O` Old Building (from `locations.json`) |
| Floor | Optional integer, `0` = ground |
| Title | Remaining text |

| Shorthand | Meaning |
|---|---|
| `LN 5 Microbiology` | Lecture, New Building, floor 5 |
| `LO 0 Drug Information` | Lecture, Old Building, ground floor |
| `PN 7 Basic Pharmacology` | Practical, New Building, floor 7 |
| `PN 4 Drug Design (ChemSketch)` | Practical, New Building, floor 4, ChemSketch cycle |
| `EO 2 Drug Design (Quiz 1)` | Examination, Old Building, floor 2 |
| `PN Drug Design` | Practical, floor intentionally unspecified |

`displayCode` becomes the event title in the UI **and** the ICS `SUMMARY`; the full course title/topic goes into the tooltip and `DESCRIPTION`. The parser rejects unknown types/buildings and missing titles instead of guessing.

---

## 7. Student ID resolution

`assets/js/student/resolver.js` is pure and fully unit-tested.

1. Normalize: trim, strip internal whitespace, **keep leading zeroes**.
2. Individual `overrides` win; more than one override → `AmbiguousAssignmentError`.
3. Match `rules` by explicit `students` list or numeric range (`BigInt` comparison, so long IDs are safe).
4. More than one matching rule, or matches across cohorts → `AmbiguousAssignmentError`.
5. Resolve subdivision; if the group matches but no subdivision covers the ID, keep the group and return `subdivisionStatus: "unresolved"` + `SUBDIVISION_UNRESOLVED`.
6. No match → `StudentNotFoundError`.
7. Return `{ studentId, programId, academicYearId, yearLevel, practicalGroup, subdivision, subdivisionStatus, source, warnings }`.

The presentation layer never sees ID ranges — it receives a normalized assignment object, identical in shape to the one produced by manual selection.

---

## 8. Scheduling semantics

### 8.1 Materialization

For each definition: one-off `date` → that date; otherwise expand the weekday across the semester window, clipped by `validFrom`/`validUntil`. Practicals iterate `sessions`; other types use event-level times. All-day examinations materialize without times.

### 8.2 Blackouts

`isAcademicBlackoutDate()` drops occurrences whose type is listed in `blockTypes` inside any blackout range. Examinations are unaffected, so mid-term week shows exams only.

### 8.3 Teaching weeks and A/B rotation

`teachingWeekNumber()` counts Saturday-start weeks from `semester.validFrom`, **skipping** weeks that overlap a blackout with `excludedFromRotation !== false`. `getRotationSubdivision()` maps that count through `rotation.sequence` starting at `rotation.startWeek`.

```json
"rotation": { "type": "alternating-subdivisions",
              "sequence": ["A","B"], "startWeek": 1,
              "excludeBlackouts": true }
```

With the Fall 2026 anchor (`2026-09-19`) and the mid-term blackout:

| Teaching week | Calendar week | Subdivision |
|---|---|---|
| 1 | 19–25 Sep | A |
| 2 | 26 Sep–2 Oct | B |
| 3 | 3–9 Oct | A |
| 4 | 10–16 Oct | B |
| 5 | 17–23 Oct | A |
| 6 | 24–30 Oct | B |
| — | 31 Oct–5 Nov | *mid-term blackout, not counted* |
| 7 | 7–13 Nov | A |
| 8 | 14–20 Nov | B |
| 9 | 21–27 Nov | A |
| 10 | 28 Nov–4 Dec | B |
| 11 | 5–11 Dec | A |
| 12 | 12–18 Dec | B |

This drives **PharmD Phytochemistry I** (Wed) and **Clinical Biochemistry-I** (Tue). Drug Information tutorials instead use **explicit dates**, because the department's own sequence resumes with Group B on 8 Nov rather than following a pure alternation.

### 8.4 Session selection

A session is kept when: group matches, its `subdivision` (if any) matches the effective subdivision (rotation result, else the student's), and the student's ID falls in `from`/`to` or `students` (when a student ID is known). Subgroup feeds therefore contain only that subgroup's weeks and batches.

### 8.5 Exceptions, targeting, merge, conflicts

Exceptions apply to materialized occurrences by `eventId` + `date` (+ optional `group`). Institution events are filtered by audience. Everything is merged by UID (a `published` occurrence supersedes a `cancelled` one), sorted by date/time/type/title, then scanned for overlaps. Overlaps are **reported**, never silently "fixed"; institution overlaps are warnings, academic overlaps are errors.

---

## 9. Calendar feeds

Base: `https://hunterthief.github.io/Collage-Scheduler/calendar/feeds/`

### 9.1 Canonical, year-scoped paths

The year level is part of the feed identity, so 1st / 2nd / 3rd / 4th year can never collide and a feed URL never changes meaning when a new year is added.

| Cohort | Path pattern |
|---|---|
| PharmD, Year 3 | `pharmd/2026-2027/year-3/group-{1,2,3}.ics` |
| PharmD, Year 3 subgroups | `pharmd/2026-2027/year-3/group-{1,2,3}-{a,b}.ics` |
| Clinical, Year 2 | `clinical-pharmacy/2026-2027/year-2/group-{1,2}.ics` |
| Clinical, Year 2 subgroups | `clinical-pharmacy/2026-2027/year-2/group-{1,2}-{a,b}.ics` |
| College-wide only | `institution.ics` |

Example: `…/pharmd/2026-2027/year-3/group-1-a.ics`

### 9.2 Preserved aliases (pre-year paths)

Cohorts marked `legacyAlias: true` in the manifest also publish the original flat paths, byte-identical to their canonical feed. These are the URLs already in students' calendars.

```text
pharmd/2026-2027/group-1.ics … group-3-b.ics
clinical-pharmacy/2026-2027/group-1.ics … group-2-b.ics
```

Only one cohort per program + academic year may own an alias; the generator raises an error if two claim the same path.

**Totals:** 16 canonical feeds (1 college-wide + 9 PharmD + 6 Clinical) and 15 preserved aliases.

### 9.3 Adding a new year level

Add the semester with its `yearLevel`, add the assignment document, add the manifest cohort entry with that `yearLevel`. The new cohort publishes to `year-N/…`; existing cohorts keep their own canonical paths **and** their aliases. Nothing that is already subscribed changes.

### 9.4 ICS conformance

- `VERSION:2.0`, `METHOD:PUBLISH`, `CALSCALE:GREGORIAN`, `X-WR-CALNAME`, `X-WR-TIMEZONE`.
- Timed events converted from `Africa/Cairo` to UTC `…Z` (two-pass offset resolution).
- All-day events use `DTSTART;VALUE=DATE` with an **exclusive** `DTEND`.
- Every content line folded at 75 octets with CRLF + space.
- Text escaped (`\`, `;`, `,`, newlines).
- Stable `UID`: `institutionId:eventId:date:group:subdivision:start` (institution events: `institutionId:eventId:date`).
- `SEQUENCE` = FNV-1a hash of the event's content, so edits bump it and identity survives time/room changes.
- `SUMMARY` = shorthand title; `DESCRIPTION` = full title, type, course, group, subdivision, batch, topic, review notes; `LOCATION` = building/floor/room; `CATEGORIES` = course code; `STATUS:CANCELLED` for cancellations.

### 9.5 Reminders

`VALARM` / `ACTION:DISPLAY` with `TRIGGER:-PT1H` for the **first timed event of each day** and `TRIGGER:-PT15M` for every later timed event. All-day and cancelled events get no alarm.

### 9.6 Google Calendar realities

- **Subscribe via Settings → Add calendar → From URL.** The site's button copies the feed URL and opens that page.
- The one-click `…/render?cid=` endpoint is unreliable for external feeds ("Unable to add calendar. Check the URL."); it is offered only as a labelled fallback.
- Never paste a feed URL into an *email address* field.
- Google **ignores `VALARM` and per-event colours on subscribed calendars** — hence the in-page reminder engine and the shorthand titles. Apple Calendar, Outlook and Thunderbird honour feed alarms.
- Google refreshes subscribed feeds on its own schedule (hours to days). The website and the `.ics` files update immediately after publication.

---

## 10. The web app

- **Lookup card** with two modes; the manual mode exposes Program / Academic year / **Year** / Practical group, all derived from data.
- **Summary strip**: masked ID, lookup method, program, academic year, year level, semester, group, subdivision, subject-colour legend, and any data notes.
- **Week / Day** grids: sticky day headers and time gutter, all-day row, overlap columns, current-time line, AM/PM gutter labels, 🔔 reminder badges, subject colours, tooltips with full title + room + reminder.
- **List** agenda grouped by day with type/reminder/cancelled/review tags.
- **Reminders panel**: opt-in toggle (persisted), permission status, test button, toast fallback; schedules a rolling 36-hour window and re-rolls on tab focus.
- **Subscription panel**: stable feed URL, copy button, Add-by-URL button, `.ics` preview download named after group/subgroup/year.
- Privacy notice from `settings.json`; mobile-first layout with no sideways scrolling.

---

## 11. Local development

Requirements: **Python 3.12+** and **Node 22+**. No npm dependencies, no install step.

```bash
# serve the site (must be over HTTP, not file://)
python -m http.server 8080        # or: npm run preview
# → http://localhost:8080

# validate all data contracts and references
python tools/validate-data.py     # or: npm run validate

# run the engine test suite
node --test tests/                # or: npm test

# regenerate every static feed into calendar/feeds/
node tools/generate-calendars.mjs # or: npm run generate-calendars
```

After editing JS or CSS, hard-reload with DevTools → Network → **Disable cache** (`Ctrl/Cmd + Shift + R`); ES modules are cached aggressively.

---

## 12. Data editing cookbook

Every recipe below is **data-only**. Finish with: validate → test → generate → bump `dataVersion` → changelog → commit → push.

**Add a program**
1. Append to `data/programs/programs.json` (`id`, `name`, `academicYears[]`, `semesters[]` with `yearLevel`, `datasets`, `blackouts`).
2. Create `data/schedules/<program>/<year>/<semester>/{courses,lectures,practicals,exams,exceptions}.json`.
3. Create `data/students/assignments/<program>/<year>.json` with `yearLevel`, ranges and subdivisions.
4. Add the cohort to `manifest.assignments` with `programId`, `academicYearId`, `yearLevel`, `path`. Dropdowns and feeds appear automatically.

**Add a year level to an existing program** — add the semester with its `yearLevel`, add its assignment document, add a manifest cohort entry with that `yearLevel`. Leave `legacyAlias` off the new cohort; the original cohort keeps owning the flat paths.

**Add an academic year / semester** — append under the program; set `yearLevel`, window, datasets. No engine change.

**Add a course** — append to `courses.json` with a unique `id`, `code`, `title`, `color`.

**Add a lecture** — append to `lectures.json` with `day`, `start`, `end`, `groups`, `location`, `shorthand`, `displayCode`.

**Add a practical** — append to `practicals.json` with `sessions[]` per group (add `subdivision`/`batch`/`from`/`to` when sections are split).

**Make a section alternate A/B** — add the `rotation` block from §8.3. Choose `startWeek` so the observed week lands on the right letter; the pattern backdates automatically.

**Add an exam / quiz** — append to `exams.json` with `date` (+`sessions` for per-subgroup slots), or `allDay: true` when the time is not yet announced.

**Cancel one occurrence** — add a `cancel` exception referencing `eventId` + `date`. It renders struck-through and exports `STATUS:CANCELLED`.

**Remove a slot entirely** — delete the definition (and any exceptions referencing it). Use this when a recurring window produced *only* cancelled dates.

**Move a lecture to another weekday from a date** — split into two definitions with adjacent `validFrom`/`validUntil` windows (this is how Drug Information moved from Tuesday to Wednesday on 18 Nov).

**Add a college-wide event** — append to `data/institution/events.json` only. No timetable file is touched.

**Recolour a subject** — change that course's `color`.

**Change student ranges** — edit the assignment file; keep `sourceReview` notes for anything unverified.

---

## 13. Validation and tests

`tools/validate-data.py` (standard library only) checks:

- JSON syntax and required fields for every referenced file.
- Manifest keys, `Africa/Cairo` timezone, dataset path existence.
- Unique program / year / semester / course / event / institution-event IDs.
- Course, program, year and semester references.
- Time (`HH:MM`) and date (`YYYY-MM-DD`) formats; `start < end`; validity and blackout ordering.
- Building codes and integer floors.
- Assignment ranges: numeric, ordered, non-overlapping; explicit-list duplicates; subdivision ranges.
- Sessions: group present, `from ≤ to`, and **batch-aware duplicate detection** — `group + subdivision + batch` or `group + subdivision + time` must be unique (multiple batches per group are legitimate).
- `rotation` shape, `allDay` boolean, exception references/actions/dates, and the requirement to name a `group` when an exception targets a multi-session event.
- Institution audience scopes and their references; every event must have a materializable window.

Semantic behaviour is covered by `node --test`:

| Suite | Covers |
|---|---|
| `engine.test.mjs` | shared lectures for all groups, group-specific practicals, college-wide events without classes, cancel exceptions, overlap detection, mid-term blackout keeping exams |
| `exams.test.mjs` | examinations materialize once on their exact date for every group |
| `institution-allday.test.mjs` | all-day single date and multi-day range overlap logic |
| `resolver.test.mjs` | range + subdivision resolution, uncovered-subdivision gap, open-ended ranges, unknown IDs, ambiguous matches |
| `shorthand.test.mjs` | `L/P/E`, `N/O`, floor `0`, compact/lowercase forms, rejection of bad input |

Schedule conflicts are intentionally detected in the JS engine only, so there is exactly one scheduling implementation.

---

## 14. CI/CD and deployment

`.github/workflows/ci.yml` runs on every push and pull request:

1. `actions/checkout`, Python 3.12, Node 22.
2. **Validate data** → `python tools/validate-data.py`.
3. **Run tests** → discovers `*.test.{js,mjs,cjs}` and runs `node --test` (fails with a clear message if none are found).
4. **Generate feeds** → `node tools/generate-calendars.mjs`, writing canonical year-scoped feeds plus any declared legacy aliases, and removing the legacy stray institution file.
5. **Publish feeds** *(push to default branch only)* → `touch .nojekyll`, `git add .nojekyll calendar/feeds`, and if anything changed, commit `chore: regenerate calendar feeds [skip ci]` and push. Requires `permissions: contents: write`. The `[skip ci]` tag plus the no-change guard prevent loops.
6. **Upload artifact** `calendar-feeds` for inspection.

Deployment: **Settings → Pages → Deploy from a branch → `main` / root**. `.nojekyll` disables Jekyll processing.

> An Actions **artifact is not a published site**. Feeds are only reachable on Pages because step 5 commits them into the repository.

---

## 15. Current dataset

### PharmD — Semester 5 (Year 3), 2026/2027

- **7 courses**, **8 lecture definitions**, **19 practical definitions**, **10 examinations**.
- Practicals: 5 weekly (Scientific Writing, Basic Pharmacology, Pharmaceutics III, Pharmaceutical Microbiology, Phytochemistry I) + 9 dated Drug Information tutorials + 4 ChemSketch cycles + 1 Wet Lab cycle.
- **ChemSketch** (Simulation Lab, New Building floor 4): Wednesdays 30 Sep (A), 7 Oct (B), 14 Oct (A), 21 Oct (B). Six hourly slots 09–10, 10–11, 11–12, 12–13, 13–14, 14–15, ordered `1A, 1A, 3A, 3A, 2A, 2A`, each restricted to a seat-number batch.
- **Wet Lab**: Wednesdays, 09–11 (section 1), 11–13 (section 3), 13–15 (section 2); Week 1 = Group A, Week 2 = Group B. Held in the Pharmaceutical Chemistry Lab (Old Building, floor 2) and Organic Chemistry Lab (New Building, floor 4). Structure stored but **not materialized** until dates are confirmed.
- **Drug Information tutorials** (Computer Hall, New Building ground floor): 27 Sep A, 4 Oct B, 11 Oct A, 18 Oct B, 25 Oct A, 8 Nov B, 15 Nov A, 22 Nov B, 29 Nov A+B — topics carried in each event's description.
- **Examinations**: 7 mid-terms (31 Oct–5 Nov, New Building); **Drug Design Quiz 1** on 18 Nov in the Pharmaceutical Chemistry Lab (Old Building, floor 2), six 30-minute slots `1A 09:00, 1B 10:00, 3A 11:00, 3B 12:00, 2A 13:00, 2B 14:00` — all students attend the same week, and students from higher levels attend at their fixed time starting from the first section; **Drug Information final practical** A on 6 Dec, B on 13 Dec (times/rooms not yet announced, stored all-day).
- Groups **1, 2, 3**, each with **A/B** subdivisions (`2415001`–`2415076`, `2415077`–`2415148`, `2415149`–end).
- Drug Information lecture: Monday until 29 Oct, then **Wednesday from 18 Nov**; the Tuesday 10/17 Nov occurrences were cancelled and removed entirely.

### PharmD (Clinical Pharmacy Program) — Semester 3 (Year 2), 2026/2027

- **8 courses**, **8 lecture definitions**, **6 practical definitions**, examinations pending publication.
- Groups **1, 2**, each with **A/B** (`2510001`–`2510047`, `2510048`–end).
- **Biochemistry-I** practical alternates A/B (10 Nov = A, 17 Nov = B, backdated to 22 Sep = A); all other Clinical practicals run weekly for every group.
- The college-wide mid-term blackout applies; no Clinical exam timetable has been supplied yet.

### Institution

Fall 2026/2027 academic calendar transcribed as college-wide all-day events: registration windows, fee penalties, add/drop, 6 October holiday, mid-term week, end of classes, revision, final-exam period, results, mid-year vacation.

---

## 16. Data caveats (`sourceReview`)

Unverified information is **never silently presented as confirmed**. Records carry `sourceReview[]` codes, the UI shows a `Needs review` badge, and the ICS `DESCRIPTION` repeats the note.

| Code | Meaning |
|---|---|
| `SEMESTER_WINDOW_FROM_PROVISIONAL_CALENDAR` | Semester bounds come from a calendar that states its dates are approximate |
| `CALENDAR_DATES_APPROXIMATE` | Same disclaimer on individual college-wide events |
| `HOLIDAY_DATE_SUBJECT_TO_CHANGE` | 6 October holiday marked with an asterisk in the source |
| `REVISION_PLACEMENT_AMBIGUOUS` | Revision bullet shares a row with "End of classes" |
| `MERGED_CELL_SPAN` | Final-exam span inferred from a merged table cell |
| `RESULTS_VACATION_TENSION` | Results week and vacation start share 23 Jan |
| `SCOPE_ALL_TEMPORAL` | Fall calendar uses `scope: all`; re-target when spring datasets exist |
| `LOCATION_MULTI_UNCONFIRMED` | Source lists two halls for one practical |
| `SUBDIVISION_GAP` | PharmD group 2: ID `2415113` covered by neither A nor B |
| `SUBDIVISION_TRANSCRIPTION_AMBIGUOUS` | PharmD group 3 B boundary needs confirmation |
| `OPEN_ENDED_RANGE` | Clinical group 2 / 2B and PharmD 3B printed as "to the end" |
| `DATE_UNCONFIRMED` | Drug Design Wet Lab has structure but no calendar dates |
| `EXAM_TIMETABLE_NOT_YET_PUBLISHED` | Clinical examinations awaiting publication |
| `TIME_UNCONFIRMED`, `LOCATION_UNCONFIRMED` | Drug Information final practical exams: date/group only |
| `SOURCE_TYPO_CORRECTED` | `2215095 → 2415095`, `2215148 → 2415148` |
| `EXTERNAL_IDS_PRESENT` | ChemSketch batch 3B-4 includes `2435001`, `2435002` |
| `DAY_CHANGED_BY_DEPARTMENT_INSTRUCTION` | Drug Information lecture moved to Wednesday |
| `ALTERNATING_A_B_PATTERN`, `EVERY_WEEK_ALL_GROUPS` | Department confirmations of section cadence |
| `QUIZ_MODELED_AS_EXAMINATION` | Quiz 1 modelled as an assessment, not a section |

---

## 17. Privacy and security

- **No authentication.** The student ID is a lookup key; the UI states plainly that schedules are public and the ID is not a password.
- **No name directory**, no personal data beyond ID ranges that the faculty already publishes.
- IDs are masked in the summary (`•••5001`) and never persisted; only the reminder preference and the last-seen `dataVersion` are stored in `localStorage`.
- No analytics, no trackers, no third-party runtime requests — everything is served from the same origin.
- Because the data is public by design, **do not commit anything confidential** to `data/`.

---

## 18. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Feed URL has no year segment | Older build gated the year behind "more than one cohort" | Year-scoped templates are now used whenever the level is known; manifest cohorts carry `yearLevel` |
| Existing feed URL stopped working after adding a year | Flat path ownership was implicit | Mark the original cohort `legacyAlias: true`; it keeps publishing the flat copies |
| `'fetch' called on an object that does not implement interface Window` | Native `fetch` invoked with the wrong receiver | `loader.js` calls `Reflect.apply(fn, globalThis, [url, init])`; never store a bare `fetch` reference |
| `Failed to load …/lectures.json: 404` | Dataset file absent or path/case mismatch | Create the exact path from `programs.json`; the loader lists all missing datasets at once |
| `Loading module … was blocked because of a disallowed MIME type ("text/html")` | A JS module is missing, so Pages returns its 404 HTML page; the whole `app.js` graph fails and **every** button stops working | Create the missing file (this happened with `schedule/reminders.js`) |
| `Cannot find module '…/tests'` | `tests/` not committed | Commit `tests/*.test.mjs`; CI discovers test files and fails with a readable message |
| Validator: `duplicate session group N` | Older validator assumed one session per group | Batch-aware validator: duplicates are `group+subdivision+batch` or `group+subdivision+time` |
| Google: *"…is not a valid email address"* | Feed URL pasted into an email field | Use **Add calendar → From URL** |
| Google: *"Unable to add calendar. Check the URL."* | Known `render?cid=` endpoint bug, or the URL is already subscribed | Use Add by URL; remove any existing entry first |
| Feed URL returns 404 | Feeds only existed as an Actions artifact | Ensure the CI publish step committed `calendar/feeds/` |
| Search bar overflows on mobile | Auto-sized grid track + sub-16px input focus zoom | `grid-template-columns: minmax(0,1fr)`, `min-width: 0`, 16px inputs, stacked button under 480px |
| Changes don't appear | Cached ES modules / JSON | Hard reload with cache disabled; bump `manifest.dataVersion` |
| Stray `institution/group-null.ics` | Legacy generator revision | Removed automatically by the current generator; canonical feed is `calendar/feeds/institution.ics` |

---

## 19. Known limitations and roadmap

**Limitations**
- Google ignores feed alarms and per-event colours on subscribed calendars; the in-page engine covers reminders while the tab is open.
- Whole-group feeds are a fallback: rotating sections appear every week there, labelled with the active subdivision. Subgroup feeds are the accurate ones.
- Drug Design Wet Lab is stored but not materialized (no confirmed dates).
- Clinical examinations are empty pending publication.
- No `schemas/courses.schema.json` yet; courses are validated structurally by the Python validator.
- Reminders require the page to be open — a static site cannot deliver background push.

**Roadmap (not implemented, deliberately)**
Name-based lookup · course materials · results · announcements · attendance · room directory / campus maps · event registration · student organizations · academic progress · background notifications · admin data-entry tools · timetable document import · multi-college support.

The architecture already separates students, programs, events, courses, locations and schedules so these can be added without rewriting the scheduling core.

---

## 20. Contributing conventions

1. **Data first.** If a change can be expressed in JSON, it must be. Never hardcode course names, IDs, groups, years, ranges, buildings or semesters in JS.
2. **Stable identifiers.** Never reuse an event/course/rule `id`; retired IDs stay retired.
3. **Stable URLs.** A published feed path is a promise. Change the scheme only by adding new canonical paths and preserving the old ones as declared aliases.
4. **Structured fields are authoritative.** Shorthand is a display/input convenience.
5. **Flag uncertainty.** Add `sourceReview` rather than guessing dates, rooms or boundaries.
6. **Cancel vs delete.** Use a `cancel` exception for a single occurrence; delete a definition only when its whole window is dead (and remove its exceptions).
7. **Full-file edits.** Replace whole files rather than partial patches, so the repository never drifts from the reviewed version.
8. **Before pushing:** `python tools/validate-data.py` → `node --test tests/` → `node tools/generate-calendars.mjs`, bump `manifest.dataVersion`, add a `changelog.json` entry.
9. **Never commit secrets or personal data.** Everything under `data/` is public.

---

## 21. License

Licensed under the **Apache License, Version 2.0** — see [LICENSE](LICENSE).

```text
Copyright 2026 HunterThief

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

Timetable content originates from faculty documents; the license covers the software and data architecture, not the underlying academic records.

---

## 22. Acknowledgements

Schedule data transcribed from official documents of the **Faculty of Pharmacy, Alexandria University** — Education and Student Affairs Administration, Pharmaceutical Chemistry Department, and Department of Clinical Pharmacy and Pharmacy Practice:

- PharmD 5th Semester lecture and practical timetables, 2026/2027
- PharmD (Clinical Pharmacy Program) 3rd Semester lecture and practical timetables, 2026/2027
- Fall Semester 2026/2027 academic calendar
- PharmD mid-term examination timetable
- Drug Design ChemSketch cycle, Wet Lab cycle and Quiz-1 timetables
- Provisional Drug Information tutorials content and distribution

Any discrepancy between this platform and an official faculty document should be reported so the JSON can be corrected and republished.
