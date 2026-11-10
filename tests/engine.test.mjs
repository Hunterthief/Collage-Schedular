import test from "node:test";
import assert from "node:assert/strict";
import { composeSchedule } from "../assets/js/schedule/engine.js";

const settings = {
  institutionId: "college",
  weekStartDay: "Saturday"
};

const locations = {
  buildings: [
    { id: "new", code: "N", name: { en: "New Building" } },
    { id: "old", code: "O", name: { en: "Old Building" } }
  ]
};

const semester = {
  id: "test-semester",
  validFrom: "2026-12-06",
  validUntil: "2026-12-12"
};

const courses = [
  {
    id: "C1",
    title: { en: "Microbiology" }
  }
];

const lectures = [
  {
    id: "L1",
    courseId: "C1",
    type: "lecture",
    day: "Wednesday",
    start: "15:00",
    end: "16:50",
    groups: [1, 2, 3],
    location: { building: "new", floor: 5 }
  }
];

const practicals = [
  {
    id: "P1",
    courseId: "C1",
    type: "practical",
    day: "Wednesday",
    sessions: [
      { group: 1, start: "11:00", end: "12:50" },
      { group: 2, start: "09:00", end: "10:50" }
    ],
    location: { building: "new", floor: 8 }
  }
];

const institutionEvents = [
  {
    id: "I1",
    title: { en: "Scientific Day" },
    type: "college-event",
    date: "2026-12-10",
    start: "10:00",
    end: "15:00",
    location: { building: "new", floor: 1 },
    audience: { scope: "all" },
    status: "published"
  }
];

test("shared lecture appears for every group", () => {
  for (const group of [1, 2, 3]) {
    const result = composeSchedule({
      institutionId: settings.institutionId,
      timezone: "Africa/Cairo",
      settings,
      locations,
      semester,
      courses,
      lectures,
      practicals,
      exceptions: [],
      institutionEvents: [],
      context: {
        programId: "pharmd",
        academicYearId: "2026-2027",
        semesterId: semester.id,
        practicalGroup: group
      }
    });

    const lecture = result.events.find((e) => e.eventId === "L1");
    assert.ok(lecture, `lecture missing for group ${group}`);
  }
});

test("practical session is selected by group", () => {
  const g1 = composeSchedule({
    institutionId: settings.institutionId,
    timezone: "Africa/Cairo",
    settings,
    locations,
    semester,
    courses,
    lectures: [],
    practicals,
    exceptions: [],
    institutionEvents: [],
    context: {
      programId: "pharmd",
      academicYearId: "2026-2027",
      semesterId: semester.id,
      practicalGroup: 1
    }
  });

  const g2 = composeSchedule({
    institutionId: settings.institutionId,
    timezone: "Africa/Cairo",
    settings,
    locations,
    semester,
    courses,
    lectures: [],
    practicals,
    exceptions: [],
    institutionEvents: [],
    context: {
      programId: "pharmd",
      academicYearId: "2026-2027",
      semesterId: semester.id,
      practicalGroup: 2
    }
  });

  assert.equal(g1.events[0].start, "11:00");
  assert.equal(g2.events[0].start, "09:00");
});

test("college-wide event appears even without academic classes", () => {
  const result = composeSchedule({
    institutionId: settings.institutionId,
    timezone: "Africa/Cairo",
    settings,
    locations,
    semester,
    courses,
    lectures: [],
    practicals: [],
    exceptions: [],
    institutionEvents,
    context: {
      programId: "pharmd",
      academicYearId: "2026-2027",
      semesterId: semester.id,
      practicalGroup: 1
    }
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].eventId, "I1");
});

test("cancel exception marks occurrence cancelled", () => {
  const exceptions = [
    {
      id: "EX1",
      eventId: "L1",
      date: "2026-12-09",
      action: "cancel"
    }
  ];

  const result = composeSchedule({
    institutionId: settings.institutionId,
    timezone: "Africa/Cairo",
    settings,
    locations,
    semester,
    courses,
    lectures,
    practicals: [],
    exceptions,
    institutionEvents: [],
    context: {
      programId: "pharmd",
      academicYearId: "2026-2027",
      semesterId: semester.id,
      practicalGroup: 1
    }
  });

  const cancelled = result.events.find((e) => e.eventId === "L1");
  assert.equal(cancelled.status, "cancelled");
});

test("detects overlap between lecture and practical", () => {
  const overlappingPractical = [
    {
      id: "P_OVERLAP",
      courseId: "C1",
      type: "practical",
      day: "Wednesday",
      sessions: [
        { group: 1, start: "15:30", end: "16:30" }
      ],
      location: { building: "new", floor: 8 }
    }
  ];

  const result = composeSchedule({
    institutionId: settings.institutionId,
    timezone: "Africa/Cairo",
    settings,
    locations,
    semester,
    courses,
    lectures,
    practicals: overlappingPractical,
    exceptions: [],
    institutionEvents: [],
    context: {
      programId: "pharmd",
      academicYearId: "2026-2027",
      semesterId: semester.id,
      practicalGroup: 1
    }
  });

  assert.ok(result.conflicts.length > 0);
});
