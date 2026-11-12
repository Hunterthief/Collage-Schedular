// Shorthand is a convenience parser only. Structured JSON fields remain the
// source of truth. Supported leading letters:
//   L = lecture, P = practical, E = examination
// The building code is matched case-insensitively against the locations data
// (code or id, longest first). An optional floor number may follow, with or
// without a space. A non-empty title is required.
//
// Parsing is done step by step (type -> building -> floor -> title), NOT with
// one regex, so "LN 5" is correctly rejected as missing a title instead of
// treating "5" as the course name.

const TYPE_BY_LETTER = {
  L: "lecture",
  P: "practical",
  E: "examination"
};

export function createShorthandParser(buildings = []) {
  const codes = [];
  for (const b of buildings) {
    if (b?.code) codes.push({ code: String(b.code).toLowerCase(), id: b.id });
    if (b?.id) codes.push({ code: String(b.id).toLowerCase(), id: b.id });
  }
  codes.sort((a, b) => b.code.length - a.code.length);

  function matchBuilding(rest) {
    const lower = rest.toLowerCase();
    for (const { code, id } of codes) {
      if (!lower.startsWith(code)) continue;
      const next = rest[code.length];
      if (next === undefined || /\s/.test(next) || /\d/.test(next)) {
        return { id, consumed: code.length };
      }
    }
    return null;
  }

  function parse(raw) {
    if (typeof raw !== "string") {
      throw new TypeError("Shorthand must be a string.");
    }

    const input = raw.trim();
    if (!input) {
      throw new Error("Shorthand cannot be empty.");
    }

    const typeLetter = input[0].toUpperCase();
    const type = TYPE_BY_LETTER[typeLetter];
    if (!type) {
      throw new Error(`Unknown shorthand type "${input[0]}" in "${input}".`);
    }

    let rest = input.slice(1).trimStart();
    if (!rest) {
      throw new Error(`Shorthand "${input}" is missing a building code.`);
    }

    const match = matchBuilding(rest);
    if (!match) {
      throw new Error(
        `Unknown shorthand building "${rest[0]}" in "${input}". Not present in locations data.`
      );
    }
    rest = rest.slice(match.consumed).trimStart();

    let floor = null;
    if (/^\d/.test(rest)) {
      const m = /^(\d+)(?=\s|$)/.exec(rest);
      if (!m) {
        throw new Error(`Invalid floor token in shorthand "${input}".`);
      }
      floor = Number(m[1]);
      rest = rest.slice(m[0].length).trimStart();
    }

    const title = rest.trim();
    if (!title) {
      throw new Error(`Shorthand "${input}" is missing a title.`);
    }

    return {
      type,
      location: {
        building: match.id,
        floor,
        room: null
      },
      title,
      displayCode: input
    };
  }

  return { parse };
}
