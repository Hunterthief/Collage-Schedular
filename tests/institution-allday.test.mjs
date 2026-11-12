import test from "node:test";
import assert from "node:assert/strict";
import { composeSchedule } from "../assets/js/schedule/engine.js";
import {
  occursOnDay,
  occursInRange
} from "../assets/js/schedule/recurrence.js";

const settings = {
  institutionId: "college",
  weekStartDay: "Saturday"
};

const locations = {
  buildings: [
    {
      id: "new",
      code: "N",
      name: { en: "New" }
    }
  ]
};

const semester = {
  id: "s5",
  validFrom: "2026-09-19",
  validUntil: "2026-12-17"
};

test("all-day single-date institution event materializes once", () => {
  const inst = [
    {
      id: "holiday",
      title: { en: "Holiday" },
      type: "college-event",
      startDate: "2026-10-06",
      allDay: true,
      audience: { scope: "all" },
      status: "published"
    }
  ];

  const r = composeSchedule({
    institutionId: "college",
    timezone: "Africa/Cairo",
    settings,
    locations,
    semester,
    courses: [],
    lectures: [],
    practicals: [],
    exams: [],
    exceptions: [],
    institutionEvents: inst,
    context: {
      programId: "pharmd",
      academicYearId: "2026-2027",
      semesterId: "s5",
      practicalGroup: 1
    }
  });

  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].allDay, true);
  assert.equal(r.events[0].start, null);
  assert.ok(occursOnDay(r.events[0], "2026-10-06"));
});

test("all-day date-range institution event overlaps partial week", () => {
  const ev = {
    allDay: true,
    date: "2026-10-31",
    endDate: "2026-11-05"
  };

  assert.ok(occursInRange(ev, "2026-11-02", "2026-11-08"));
  assert.ok(!occursInRange(ev, "2026-11-06", "2026-11-12"));
});
