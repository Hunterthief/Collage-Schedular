#!/usr/bin/env python3
"""
Dependency-free structural validator for the college schedule repository.

Semantic schedule conflicts are validated by the JS engine and Node tests.
This script validates data contracts and high-risk integrity issues.
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
INF = 10**30

VALID_TYPES = {"lecture", "practical", "examination"}
VALID_STATUSES = {"draft", "published", "cancelled", "completed"}
VALID_ACTIONS = {"cancel", "move", "reschedule", "update", "replace"}
VALID_AUDIENCE_SCOPES = {
    "all",
    "program",
    "academic-year",
    "semester",
    "group",
    "custom",
}
WEEKDAYS = {
    "Sunday": 0,
    "Monday": 1,
    "Tuesday": 2,
    "Wednesday": 3,
    "Thursday": 4,
    "Friday": 5,
    "Saturday": 6,
}


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    def print(self):
        if self.warnings:
            print("Warnings:")
            for w in self.warnings:
                print(f"  - {w}")

        if self.errors:
            print("Errors:")
            for e in self.errors:
                print(f"  - {e}")
        else:
            print("Structural validation passed.")


def load_json(root: Path, rel: str, report: Report):
    p = root / rel
    if not p.exists():
        report.error(f"Missing file: {rel}")
        return None

    try:
        with p.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        report.error(f"Invalid JSON in {rel}: {e}")
        return None


def is_time(value):
    return isinstance(value, str) and TIME_RE.match(value)


def is_date(value):
    if not isinstance(value, str) or not DATE_RE.match(value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def normalize_sub(value):
    """Normalize a subdivision label for comparison (A/a/ A -> 'A')."""
    if value is None:
        return None
    text = str(value).strip().upper()
    return text or None


def to_array(value, key=None):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        if key and isinstance(value.get(key), list):
            return value[key]
        for k in ("events", "exceptions", "courses", "rules"):
            if isinstance(value.get(k), list):
                return value[k]
    return []


def validate_manifest(root, report):
    manifest = load_json(root, "data/manifest.json", report)
    if not manifest:
        return None

    for key in [
        "schemaVersion",
        "dataVersion",
        "timezone",
        "paths",
        "assignments",
        "calendarFeeds",
    ]:
        if key not in manifest:
            report.error(f"manifest missing required key: {key}")

    if manifest.get("timezone") != "Africa/Cairo":
        report.error("manifest timezone must be Africa/Cairo")

    for key in ["programs", "settings", "locations", "institutionEvents"]:
        if key not in manifest.get("paths", {}):
            report.error(f"manifest paths missing {key}")
        else:
            load_json(root, manifest["paths"][key], report)

    return manifest


def validate_locations(root, manifest, report):
    locations = load_json(root, manifest["paths"]["locations"], report)
    if not locations:
        return {}

    building_ids = set()
    building_codes = set()

    for b in locations.get("buildings", []):
        if not b.get("id"):
            report.error("location building missing id")
            continue
        if not b.get("code"):
            report.error(f"location building {b.get('id')} missing code")
            continue

        if b["id"] in building_ids:
            report.error(f"duplicate building id: {b['id']}")
        if b["code"] in building_codes:
            report.error(f"duplicate building code: {b['code']}")

        building_ids.add(b["id"])
        building_codes.add(b["code"])

    return {"ids": building_ids, "codes": building_codes}


def validate_programs(root, manifest, report):
    programs = load_json(root, manifest["paths"]["programs"], report)
    if not programs:
        return {}

    program_ids = set()
    year_ids = set()
    semester_ids = set()
    semester_map = {}

    for program in programs.get("programs", []):
        pid = program.get("id")
        if not pid:
            report.error("program missing id")
            continue
        if pid in program_ids:
            report.error(f"duplicate program id: {pid}")
        program_ids.add(pid)

        for year in program.get("academicYears", []):
            yid = year.get("id")
            if not yid:
                report.error(f"program {pid} has academic year missing id")
                continue

            qualified_year = f"{pid}/{yid}"
            if qualified_year in year_ids:
                report.error(f"duplicate academic year: {qualified_year}")
            year_ids.add(qualified_year)

            for semester in year.get("semesters", []):
                sid = semester.get("id")
                if not sid:
                    report.error(
                        f"academic year {qualified_year} has semester missing id"
                    )
                    continue

                if sid in semester_ids:
                    report.error(f"duplicate semester id: {sid}")
                semester_ids.add(sid)

                if semester.get("status") not in VALID_STATUSES:
                    report.error(
                        f"semester {sid} has invalid status: {semester.get('status')}"
                    )

                vf = semester.get("validFrom")
                vu = semester.get("validUntil")

                if vf and not is_date(vf):
                    report.error(f"semester {sid} invalid validFrom: {vf}")
                if vu and not is_date(vu):
                    report.error(f"semester {sid} invalid validUntil: {vu}")
                if vf and vu and vf > vu:
                    report.error(f"semester {sid} validFrom is after validUntil")

                datasets = semester.get("datasets", {})
                for key in [
                    "courses",
                    "lectures",
                    "practicals",
                    "exams",
                    "exceptions",
                ]:
                    if key not in datasets:
                        report.error(f"semester {sid} missing dataset path: {key}")
                    else:
                        load_json(root, datasets[key], report)

                # Validate blackout windows if present.
                for bo in semester.get("blackouts", []) or []:
                    bid = bo.get("id") or f"{sid}/blackout"
                    bf = bo.get("from") or bo.get("date") or bo.get("startDate")
                    bt = bo.get("to") or bo.get("endDate") or bf
                    if not bf:
                        report.error(f"{bid}: blackout missing from/date/startDate")
                    if bf and not is_date(bf):
                        report.error(f"{bid}: invalid blackout from date: {bf}")
                    if bt and not is_date(bt):
                        report.error(f"{bid}: invalid blackout to date: {bt}")
                    if bf and bt and bf > bt:
                        report.error(f"{bid}: blackout from is after to")
                    block_types = bo.get("blockTypes")
                    if block_types is not None and not isinstance(block_types, list):
                        report.error(f"{bid}: blockTypes must be an array")
                    elif isinstance(block_types, list):
                        for t in block_types:
                            if t not in VALID_TYPES:
                                report.error(f"{bid}: invalid blockType {t}")

                semester_map[sid] = semester

    return {
        "programs": programs,
        "program_ids": program_ids,
        "year_ids": year_ids,
        "semester_ids": semester_ids,
        "semester_map": semester_map,
    }


def validate_assignment_ranges(rules, context, report, require_group=True):
    intervals = []
    explicit = {}

    for idx, rule in enumerate(rules):
        rid = rule.get("id") or f"{context}-rule-{idx}"

        if require_group and rule.get("practicalGroup") is None:
            report.error(f"{rid}: missing practicalGroup")

        students = rule.get("students", [])
        if not isinstance(students, list):
            report.error(f"{rid}: students must be an array")
            students = []

        for sid in students:
            if not isinstance(sid, str):
                report.error(f"{rid}: student id must be string")
                continue
            if sid in explicit:
                report.error(
                    f"duplicate explicit student assignment: {sid} in {rid} and {explicit[sid]}"
                )
            explicit[sid] = rid

        has_from = "from" in rule
        has_to = "to" in rule

        if has_from or has_to:
            from_s = rule.get("from")
            to_s = rule.get("to")

            if from_s is not None and not str(from_s).isdigit():
                report.error(f"{rid}: from must be numeric string or null")
            if to_s is not None and not str(to_s).isdigit():
                report.error(f"{rid}: to must be numeric string or null")

            if (
                from_s is not None
                and to_s is not None
                and str(from_s).isdigit()
                and str(to_s).isdigit()
                and int(from_s) > int(to_s)
            ):
                report.error(f"{rid}: from is greater than to")

            from_i = int(from_s) if from_s is not None and str(from_s).isdigit() else 0
            to_i = int(to_s) if to_s is not None and str(to_s).isdigit() else INF

            intervals.append((from_i, to_i, rid))

        subdivisions = rule.get("subdivisions", [])
        if subdivisions:
            validate_assignment_ranges(
                subdivisions,
                f"{rid}/subdivisions",
                report,
                require_group=False,
            )

    intervals.sort(key=lambda x: x[0])

    for i in range(1, len(intervals)):
        prev_start, prev_end, prev_id = intervals[i - 1]
        curr_start, curr_end, curr_id = intervals[i]

        if curr_start <= prev_end:
            report.error(f"overlapping ID ranges: {prev_id} and {curr_id}")

    for sid, rid in explicit.items():
        if not sid.isdigit():
            continue
        sid_i = int(sid)
        for start, end, range_rid in intervals:
            if start <= sid_i <= end and range_rid != rid:
                report.error(
                    f"explicit student {sid} in {rid} overlaps range {range_rid}"
                )


def validate_assignments(root, manifest, program_data, report):
    for entry in manifest.get("assignments", []):
        pid = entry.get("programId")
        yid = entry.get("academicYearId")
        rel = entry.get("path")

        if pid not in program_data["program_ids"]:
            report.error(f"assignment references unknown program: {pid}")
        if f"{pid}/{yid}" not in program_data["year_ids"]:
            report.error(
                f"assignment references unknown academic year: {pid}/{yid}"
            )

        doc = load_json(root, rel, report)
        if not doc:
            continue

        if doc.get("programId") != pid:
            report.error(f"{rel}: programId mismatch")
        if doc.get("academicYearId") != yid:
            report.error(f"{rel}: academicYearId mismatch")

        rules = doc.get("rules", [])
        if not isinstance(rules, list):
            report.error(f"{rel}: rules must be array")
            continue

        validate_assignment_ranges(rules, rel, report)

        overrides = doc.get("overrides", [])
        override_ids = set()
        for o in overrides:
            sid = o.get("studentId")
            if not sid:
                report.error(f"{rel}: override missing studentId")
                continue
            if sid in override_ids:
                report.error(f"{rel}: duplicate override for {sid}")
            override_ids.add(sid)


def validate_location_object(loc, ctx, location_data, report):
    if loc is None:
        return

    building = loc.get("building")
    if (
        building
        and building not in location_data["ids"]
        and building not in location_data["codes"]
    ):
        report.error(f"{ctx}: unknown building {building}")

    floor = loc.get("floor")
    if floor is not None and not isinstance(floor, int):
        report.error(f"{ctx}: floor must be integer or null")


def validate_sessions(event, eid, report):
    """
    Validate the sessions array of any event (practical or examination).

    A session is a true duplicate only when group + subdivision + batch repeat,
    or when group + subdivision + time-slot repeat. Multiple batches inside the
    same group (e.g. 1A-1 and 1A-2) are legitimate and must NOT be flagged.
    """
    sessions = event.get("sessions")

    if event.get("type") == "practical" and not sessions:
        report.error(f"{eid}: practical must have sessions")

    if not isinstance(sessions, list) or not sessions:
        return

    seen_keys = set()
    seen_slots = set()

    for s in sessions:
        if not isinstance(s, dict):
            report.error(f"{eid}: session must be an object")
            continue

        g = s.get("group")
        if g is None:
            report.error(f"{eid}: session missing group")

        sub = normalize_sub(s.get("subdivision"))
        batch = s.get("batch")
        ss = s.get("start")
        se = s.get("end")

        if ss and not is_time(ss):
            report.error(f"{eid}: session invalid start {ss}")
        if se and not is_time(se):
            report.error(f"{eid}: session invalid end {se}")
        if ss and se and ss >= se:
            report.error(f"{eid}: session start must be before end")

        fr = s.get("from")
        to = s.get("to")
        if fr is not None and not str(fr).isdigit():
            report.error(f"{eid}: session from must be numeric string or null")
        if to is not None and not str(to).isdigit():
            report.error(f"{eid}: session to must be numeric string or null")
        if (
            fr is not None
            and to is not None
            and str(fr).isdigit()
            and str(to).isdigit()
            and int(fr) > int(to)
        ):
            report.error(f"{eid}: session from is greater than to")

        students = s.get("students")
        if students is not None and not isinstance(students, list):
            report.error(f"{eid}: session students must be an array")

        key = (g, sub, batch)
        if key in seen_keys:
            report.error(
                f"{eid}: duplicate session (group={g}, subdivision={sub}, batch={batch})"
            )
        seen_keys.add(key)

        # Only enforce time-slot uniqueness when both times are present.
        if ss and se:
            slot = (g, sub, ss, se)
            if slot in seen_slots:
                report.error(
                    f"{eid}: two sessions share group={g}, subdivision={sub}, "
                    f"time={ss}-{se}"
                )
            seen_slots.add(slot)


def validate_event_record(
    event, ctx, course_ids, location_data, report, event_ids
):
    eid = event.get("id")
    if not eid:
        report.error(f"{ctx}: event missing id")
        return

    if eid in event_ids:
        report.error(f"{ctx}: duplicate event id {eid}")
    event_ids.add(eid)

    etype = event.get("type")
    if etype not in VALID_TYPES:
        report.error(f"{eid}: invalid type {etype}")

    cid = event.get("courseId")
    if cid and cid not in course_ids:
        report.error(f"{eid}: references unknown course {cid}")

    day = event.get("day")
    if day and day not in WEEKDAYS:
        report.error(f"{eid}: invalid day {day}")

    date_val = event.get("date")
    if date_val and not is_date(date_val):
        report.error(f"{eid}: invalid date {date_val}")

    start = event.get("start")
    end = event.get("end")

    if start and not is_time(start):
        report.error(f"{eid}: invalid start {start}")
    if end and not is_time(end):
        report.error(f"{eid}: invalid end {end}")
    if start and end and start >= end:
        report.error(f"{eid}: start must be before end")

    all_day = event.get("allDay")
    if all_day is not None and not isinstance(all_day, bool):
        report.error(f"{eid}: allDay must be boolean")

    # Sessions are validated for any event that defines them, not only practicals.
    validate_sessions(event, eid, report)

    if etype != "practical":
        # Non-session-driven recurring events still need a day or a date,
        # and a time window unless they are explicitly all-day.
        if not date_val and not day:
            report.error(f"{eid}: non-practical event needs day or date")
        if not date_val and not all_day and (not start or not end):
            report.error(f"{eid}: recurring event needs start/end (or allDay)")

    validate_location_object(event.get("location"), eid, location_data, report)

    # Rotation block (alternating A/B patterns).
    rotation = event.get("rotation")
    if rotation is not None:
        if not isinstance(rotation, dict):
            report.error(f"{eid}: rotation must be an object")
        else:
            seq = rotation.get("sequence")
            if not isinstance(seq, list) or not seq:
                report.error(f"{eid}: rotation.sequence must be a non-empty array")
            else:
                norm = [normalize_sub(x) for x in seq]
                if any(x is None for x in norm):
                    report.error(f"{eid}: rotation.sequence entries must be strings")
                if len(set(norm)) != len(norm):
                    report.error(f"{eid}: rotation.sequence has duplicate subdivisions")
            sw = rotation.get("startWeek", 1)
            if not isinstance(sw, int) or sw < 1:
                report.error(f"{eid}: rotation.startWeek must be an integer >= 1")
            efb = rotation.get("excludeBlackouts")
            if efb is not None and not isinstance(efb, bool):
                report.error(f"{eid}: rotation.excludeBlackouts must be boolean")

    vf = event.get("validFrom")
    vu = event.get("validUntil")
    if vf and not is_date(vf):
        report.error(f"{eid}: invalid validFrom")
    if vu and not is_date(vu):
        report.error(f"{eid}: invalid validUntil")
    if vf and vu and vf > vu:
        report.error(f"{eid}: validFrom after validUntil")


def validate_semester_datasets(root, program_data, location_data, report):
    for sid, semester in program_data["semester_map"].items():
        datasets = semester.get("datasets", {})

        courses_doc = load_json(root, datasets["courses"], report)
        lectures_doc = load_json(root, datasets["lectures"], report)
        practicals_doc = load_json(root, datasets["practicals"], report)
        exams_doc = load_json(root, datasets["exams"], report)
        exceptions_doc = load_json(root, datasets["exceptions"], report)

        course_ids = set()
        for c in to_array(courses_doc, "courses"):
            cid = c.get("id")
            if not cid:
                report.error(f"{sid}: course missing id")
                continue
            if cid in course_ids:
                report.error(f"{sid}: duplicate course id {cid}")
            course_ids.add(cid)

        event_ids = set()

        for e in to_array(lectures_doc, "events"):
            validate_event_record(
                e, f"{sid}/lectures", course_ids, location_data, report, event_ids
            )

        for e in to_array(practicals_doc, "events"):
            validate_event_record(
                e, f"{sid}/practicals", course_ids, location_data, report, event_ids
            )

        for e in to_array(exams_doc, "events"):
            validate_event_record(
                e, f"{sid}/exams", course_ids, location_data, report, event_ids
            )

        # Events whose sessions are split by group/subdivision/batch need an
        # explicit target when an exception cancels or moves them.
        multi_target_events = set()
        for source in (practicals_doc, exams_doc):
            for e in to_array(source, "events"):
                sessions = e.get("sessions") or []
                keys = set()
                for s in sessions:
                    keys.add(
                        (
                            s.get("group"),
                            normalize_sub(s.get("subdivision")),
                            s.get("batch"),
                        )
                    )
                if len(keys) > 1:
                    multi_target_events.add(e.get("id"))

        for ex in to_array(exceptions_doc, "exceptions"):
            ex_id = ex.get("id")
            if not ex_id:
                report.error(f"{sid}: exception missing id")
                continue

            ref = ex.get("eventId")
            if ref not in event_ids:
                report.error(
                    f"{sid}: exception {ex_id} references unknown event {ref}"
                )

            if ex.get("action") not in VALID_ACTIONS:
                report.error(
                    f"{sid}: exception {ex_id} invalid action {ex.get('action')}"
                )

            if not is_date(ex.get("date", "")):
                report.error(f"{sid}: exception {ex_id} invalid date")

            if ex.get("newDate") and not is_date(ex.get("newDate")):
                report.error(f"{sid}: exception {ex_id} invalid newDate")

            if ex.get("day") and ex.get("day") not in WEEKDAYS:
                report.error(f"{sid}: exception {ex_id} invalid day")

            if ex.get("start") and not is_time(ex.get("start")):
                report.error(f"{sid}: exception {ex_id} invalid start")
            if ex.get("end") and not is_time(ex.get("end")):
                report.error(f"{sid}: exception {ex_id} invalid end")
            if ex.get("start") and ex.get("end") and ex.get("start") >= ex.get("end"):
                report.error(f"{sid}: exception {ex_id} start >= end")

            if ref in multi_target_events and ex.get("group") is None:
                report.error(
                    f"{sid}: exception {ex_id} targets a multi-session event {ref} "
                    "without specifying group"
                )

            validate_location_object(
                ex.get("location"),
                f"{sid}/exception/{ex_id}",
                location_data,
                report,
            )


def validate_institution_events(
    root, manifest, program_data, location_data, report
):
    doc = load_json(root, manifest["paths"]["institutionEvents"], report)
    if not doc:
        return

    ids = set()

    for event in to_array(doc, "events"):
        eid = event.get("id")
        if not eid:
            report.error("institution event missing id")
            continue
        if eid in ids:
            report.error(f"duplicate institution event id {eid}")
        ids.add(eid)

        if event.get("status") not in VALID_STATUSES:
            report.error(f"{eid}: invalid status {event.get('status')}")

        if event.get("date") and not is_date(event.get("date")):
            report.error(f"{eid}: invalid date")

        sd = event.get("startDate")
        ed = event.get("endDate")

        if sd and not is_date(sd):
            report.error(f"{eid}: invalid startDate")
        if ed and not is_date(ed):
            report.error(f"{eid}: invalid endDate")
        if sd and ed and sd > ed:
            report.error(f"{eid}: startDate after endDate")

        if event.get("allDay") is not None and not isinstance(
            event.get("allDay"), bool
        ):
            report.error(f"{eid}: allDay must be boolean")

        if event.get("day") and event.get("day") not in WEEKDAYS:
            report.error(f"{eid}: invalid day")

        if event.get("start") and not is_time(event.get("start")):
            report.error(f"{eid}: invalid start")
        if event.get("end") and not is_time(event.get("end")):
            report.error(f"{eid}: invalid end")
        if event.get("start") and event.get("end") and event.get("start") >= event.get(
            "end"
        ):
            report.error(f"{eid}: start >= end")

        validate_location_object(event.get("location"), eid, location_data, report)

        has_single = bool(event.get("date"))
        has_range = bool(sd)
        has_weekly = bool(
            event.get("day") and event.get("validFrom") and event.get("validUntil")
        )

        if not (has_single or has_range or has_weekly):
            report.error(
                f"{eid}: institution event has no materializable window "
                "(need date, startDate, or day+validFrom+validUntil)"
            )

        audience = event.get("audience", {})
        scope = audience.get("scope", "all")

        if scope not in VALID_AUDIENCE_SCOPES:
            report.error(f"{eid}: invalid audience scope {scope}")

        if scope == "program":
            for pid in audience.get("programIds", []):
                if pid not in program_data["program_ids"]:
                    report.error(f"{eid}: unknown program {pid}")

        if scope == "academic-year":
            if isinstance(audience.get("academicYears"), list):
                for y in audience.get("academicYears", []):
                    qualified = f"{y.get('programId')}/{y.get('academicYearId')}"
                    if qualified not in program_data["year_ids"]:
                        report.error(f"{eid}: unknown academic year {qualified}")
            elif audience.get("programId") and isinstance(
                audience.get("academicYearIds"), list
            ):
                if audience.get("programId") not in program_data["program_ids"]:
                    report.error(f"{eid}: unknown program {audience.get('programId')}")
                for yid in audience.get("academicYearIds", []):
                    qualified = f"{audience.get('programId')}/{yid}"
                    if qualified not in program_data["year_ids"]:
                        report.error(f"{eid}: unknown academic year {qualified}")

        if scope == "semester":
            for sid in audience.get("semesterIds", []):
                if sid not in program_data["semester_ids"]:
                    report.error(f"{eid}: unknown semester {sid}")

        if scope == "group":
            for g in audience.get("groups", []):
                qualified = f"{g.get('programId')}/{g.get('academicYearId')}"
                if qualified not in program_data["year_ids"]:
                    report.error(f"{eid}: unknown academic year {qualified}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".", help="Repository root")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    report = Report()

    manifest = validate_manifest(root, report)
    if not manifest:
        report.print()
        sys.exit(1)

    location_data = validate_locations(root, manifest, report)
    program_data = validate_programs(root, manifest, report)

    validate_assignments(root, manifest, program_data, report)
    validate_semester_datasets(root, program_data, location_data, report)
    validate_institution_events(
        root, manifest, program_data, location_data, report
    )

    report.print()
    sys.exit(1 if report.errors else 0)


if __name__ == "__main__":
    main()
