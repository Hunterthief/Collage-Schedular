import test from "node:test";
import assert from "node:assert/strict";
import { composeSchedule } from "../assets/js/schedule/engine.js";

const settings = { institutionId: "college", weekStartDay: "Saturday" };
const locations = { buildings: [{ id: "new", code: "N", name: { en: "New" } }] };
const semester = { id: "s5", validFrom: "2026-09-19", validUntil: "2026-12-17" };
const courses = [{ id: "C1", title: { en: "X" } }];
const exams = [{
  id: "mid-x", courseId: "C1", type: "examination",
  date: "2026-11-02", start: "12:00", end: "12:30",
  groups: [1, 2, 3], location: { building: "new", floor: null, room: null }
}];

test("examination materializes on its exact date for every group and is not weekly", () => {
  for (const g of [1, 2, 3]) {
    const r = composeSchedule({
      institutionId: "college", timezone: "Africa/Cairo", settings, locations, semester,
      courses, lectures: [], practicals: [], exams, exceptions: [], institutionEvents: [],
      context: { programId: "pharmd", academicYearId: "2026-2027", semesterId: "s5", practicalGroup: g }
    });
    const xs = r.events.filter((e) => e.eventId === "mid-x");
    assert.equal(xs.length, 1, `group ${g}`);
    assert.equal(xs[0].date, "2026-11-02");
    assert.equal(xs[0].type, "examination");
  }
});
