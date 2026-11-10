export class ShorthandParseError extends Error {}

export const EVENT_TYPE_BY_CODE = Object.freeze({
  L: "lecture",
  P: "practical",
  E: "examination"
});

export function createShorthandParser(buildings) {
  const normalizedBuildings = buildings
    .map((b) => ({
      ...b,
      code: String(b.code).toUpperCase()
    }))
    .sort((a, b) => b.code.length - a.code.length);

  function matchBuilding(rest) {
    const upper = rest.toUpperCase();

    for (const building of normalizedBuildings) {
      if (!upper.startsWith(building.code)) continue;

      const nextChar = rest[building.code.length];

      if (
        nextChar === undefined ||
        nextChar === " " ||
        /\d/.test(nextChar)
      ) {
        return { building, consumed: building.code.length };
      }
    }

    return null;
  }

  function parse(input) {
    if (typeof input !== "string") {
      throw new ShorthandParseError("Shorthand must be a string.");
    }

    const original = input.trim();

    if (!original) {
      throw new ShorthandParseError("Shorthand cannot be empty.");
    }

    const typeCode = original[0].toUpperCase();
    const type = EVENT_TYPE_BY_CODE[typeCode];

    if (!type) {
      throw new ShorthandParseError(
        `Unknown event type code "${typeCode}" in shorthand "${original}".`
      );
    }

    let rest = original.slice(1).trimStart();

    const buildingMatch = matchBuilding(rest);

    if (!buildingMatch) {
      throw new ShorthandParseError(
        `Unknown or ambiguous building code in shorthand "${original}".`
      );
    }

    rest = rest.slice(buildingMatch.consumed).trimStart();

    let floor = null;

    if (/^\d/.test(rest)) {
      const floorMatch = /^(\d+)(?=\s|$)/.exec(rest);

      if (!floorMatch) {
        throw new ShorthandParseError(
          `Invalid floor token in shorthand "${original}".`
        );
      }

      floor = Number(floorMatch[1]);
      rest = rest.slice(floorMatch[0].length).trimStart();
    }

    const title = rest.trim();

    if (!title) {
      throw new ShorthandParseError(
        `Missing course/event name in shorthand "${original}".`
      );
    }

    return {
      type,
      location: {
        building: buildingMatch.building.id,
        floor,
        room: null
      },
      title,
      displayCode: original
    };
  }

  return {
    parse,
    buildings: normalizedBuildings
  };
}
