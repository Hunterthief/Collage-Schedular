// Shorthand is a convenience parser only. Structured JSON fields remain the
// source of truth. Supported leading letters:
//   L = lecture, P = practical, E = examination
// Supported building codes (matched case-insensitively against the locations
// data you pass in): the code letter, e.g. N -> new, O -> old.
// Optional floor number may follow the building letter, with or without a space.
// A non-empty title is required. Malformed input throws so data mistakes are
// loud rather than silent.

const TYPE_BY_LETTER = {
  L: "lecture",
  P: "practical",
  E: "examination"
};

const SHORTHAND_RE = /^([lpe])([a-z])\s*(\d+)?\s*(\S.*)$/i;

export function createShorthandParser(buildings = []) {
  // Map every building code (lowercased) to its canonical id.
  const codeToId = new Map();
  for (const b of buildings) {
    if (b?.code) codeToId.set(String(b.code).toLowerCase(), b.id);
    if (b?.id) codeToId.set(String(b.id).toLowerCase(), b.id);
  }

  function parse(raw) {
    if (typeof raw !== "string") {
      throw new TypeError("Shorthand must be a string.");
    }

    const input = raw.trim();
    if (!input) {
      throw new Error("Shorthand cannot be empty.");
    }

    const m = SHORTHAND_RE.exec(input);
    if (!m) {
      throw new Error(`Unrecognized shorthand: "${input}".`);
    }

    const typeLetter = m[1].toUpperCase();
    const buildingLetter = m[2].toLowerCase();
    const floorRaw = m[3];
    const title = m[4].trim();

    const type = TYPE_BY_LETTER[typeLetter];
    if (!type) {
      throw new Error(`Unknown shorthand type "${typeLetter}" in "${input}".`);
    }

    const buildingId = codeToId.get(buildingLetter);
    if (!buildingId) {
      throw new Error(
        `Unknown shorthand building "${m[2]}" in "${input}". Not present in locations data.`
      );
    }

    if (!title) {
      throw new Error(`Shorthand "${input}" is missing a title.`);
    }

    const floor = floorRaw != null ? Number(floorRaw) : null;

    return {
      type,
      location: {
        building: buildingId,
        floor,
        room: null
      },
      title,
      displayCode: input
    };
  }

  return { parse };
}
