import test from "node:test";
import assert from "node:assert/strict";
import { createShorthandParser } from "../assets/js/schedule/shorthand.js";

const buildings = [
  { id: "new", code: "N" },
  { id: "old", code: "O" }
];

const parser = createShorthandParser(buildings);

test("parses lecture with floor", () => {
  const result = parser.parse("LN 5 Microbiology");
  assert.equal(result.type, "lecture");
  assert.equal(result.location.building, "new");
  assert.equal(result.location.floor, 5);
  assert.equal(result.title, "Microbiology");
  assert.equal(result.displayCode, "LN 5 Microbiology");
});

test("parses lowercase and compact floor", () => {
  const result = parser.parse("lo2 pharmacology");
  assert.equal(result.type, "lecture");
  assert.equal(result.location.building, "old");
  assert.equal(result.location.floor, 2);
  assert.equal(result.title, "pharmacology");
});

test("parses practical without floor", () => {
  const result = parser.parse("PN Drug Design");
  assert.equal(result.type, "practical");
  assert.equal(result.location.building, "new");
  assert.equal(result.location.floor, null);
  assert.equal(result.title, "Drug Design");
});

test("parses examination with floor (EN/EO codes)", () => {
  const en = parser.parse("EN Pharmaceutics III");
  assert.equal(en.type, "examination");
  assert.equal(en.location.building, "new");
  assert.equal(en.location.floor, null);
  assert.equal(en.title, "Pharmaceutics III");

  const eo = parser.parse("EO 2 Drug Design (Quiz 1)");
  assert.equal(eo.type, "examination");
  assert.equal(eo.location.building, "old");
  assert.equal(eo.location.floor, 2);
  assert.equal(eo.title, "Drug Design (Quiz 1)");
});

test("parses floor 0", () => {
  const result = parser.parse("LO 0 Drug Information");
  assert.equal(result.type, "lecture");
  assert.equal(result.location.building, "old");
  assert.equal(result.location.floor, 0);
  assert.equal(result.title, "Drug Information");
});

test("rejects unknown type", () => {
  assert.throws(() => parser.parse("XN 5 Biology"));
});

test("rejects unknown building", () => {
  assert.throws(() => parser.parse("LZ 5 Biology"));
});

test("rejects missing title", () => {
  assert.throws(() => parser.parse("LN 5"));
});
