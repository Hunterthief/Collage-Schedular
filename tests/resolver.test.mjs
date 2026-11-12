import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveStudentId,
  StudentNotFoundError,
  AmbiguousAssignmentError
} from "../assets/js/student/resolver.js";

// Fixture mirrors the real assignment file, including the group 2
// subdivision gap at 2415113 (A ends 2415112, B starts 2415114).
const docs = [
  {
    programId: "pharmd",
    academicYearId: "2026-2027",
    doc: {
      rules: [
        {
          id: "g1",
          practicalGroup: 1,
          from: "2415001",
          to: "2415076",
          subdivisions: [
            { id: "g1a", name: "A", from: "2415001", to: "2415038" },
            { id: "g1b", name: "B", from: "2415039", to: "2415076" }
          ]
        },
        {
          id: "g2",
          practicalGroup: 2,
          from: "2415077",
          to: "2415148",
          subdivisions: [
            { id: "g2a", name: "A", from: "2415077", to: "2415112" },
            { id: "g2b", name: "B", from: "2415114", to: "2415148" }
          ]
        },
        {
          id: "g3",
          practicalGroup: 3,
          from: "2415149",
          to: null
        }
      ],
      overrides: []
    }
  }
];

test("resolves range and subdivision", () => {
  const result = resolveStudentId("2415010", docs);
  assert.equal(result.programId, "pharmd");
  assert.equal(result.academicYearId, "2026-2027");
  assert.equal(result.practicalGroup, 1);
  assert.equal(result.subdivision, "A");
  assert.equal(result.subdivisionStatus, "resolved");
});

test("resolves subdivision B inside group 1", () => {
  const result = resolveStudentId("2415040", docs);
  assert.equal(result.practicalGroup, 1);
  assert.equal(result.subdivision, "B");
  assert.equal(result.subdivisionStatus, "resolved");
});

test("preserves group when subdivision unresolved (gap at 2415113)", () => {
  const result = resolveStudentId("2415113", docs);
  assert.equal(result.practicalGroup, 2);
  assert.equal(result.subdivision, null);
  assert.equal(result.subdivisionStatus, "unresolved");
  assert.ok(result.warnings.includes("SUBDIVISION_UNRESOLVED"));
});

test("open-ended range resolves", () => {
  const result = resolveStudentId("2419999", docs);
  assert.equal(result.practicalGroup, 3);
});

test("unknown ID below all ranges throws", () => {
  // 9999999 would NOT throw here: group 3 is open-ended (to: null),
  // so any ID >= 2415149 matches it. Use an ID below every range.
  assert.throws(() => resolveStudentId("1000000", docs), StudentNotFoundError);
});

test("ID above all closed ranges throws", () => {
  const closedDocs = [
    {
      programId: "pharmd",
      academicYearId: "2026-2027",
      doc: {
        rules: [
          { id: "g1", practicalGroup: 1, from: "2415001", to: "2415076" },
          { id: "g2", practicalGroup: 2, from: "2415077", to: "2415148" },
          { id: "g3", practicalGroup: 3, from: "2415149", to: "2415229" }
        ],
        overrides: []
      }
    }
  ];
  assert.throws(() => resolveStudentId("9999999", closedDocs), StudentNotFoundError);
});

test("multiple matches throw integrity error", () => {
  const badDocs = [
    {
      programId: "pharmd",
      academicYearId: "2026-2027",
      doc: {
        rules: [
          { id: "a", practicalGroup: 1, from: "2415001", to: "2415100" },
          { id: "b", practicalGroup: 2, from: "2415050", to: "2415150" }
        ],
        overrides: []
      }
    }
  ];
  assert.throws(() => resolveStudentId("2415060", badDocs), AmbiguousAssignmentError);
});
