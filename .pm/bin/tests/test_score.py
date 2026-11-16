"""_pmscore: snapshot reading, matching (R5.2), order items, extras (R5.6), score and pass line (R5.5).

Interface used (design 2.5): `_pmscore.load_snapshot(path)`, `_pmscore.score(spec, snapshot, state)` and
`_pmscore.render_text(result)`, the standard output of R3 for a scored run (the `result:` line may be left to the
command). The cases read that text, whose form R3 fixes, rather than the result's attributes. Each snapshot is a
file under fixtures/structure/snapshots/ named by its condition; spec variants written by a case go to
<checkout>/output/tests/score-<pid>/ and are removed when the case ends.

Issue 8 (design 2.2 to 2.4): a steps snapshot (`pm-structure-steps/1`) loads as an object whose `steps` are one
snapshot per shown step, each with `url` and `nodes`; `score()` raises `SnapshotError` when the snapshot does not
fit the spec; `_pmscore.result_json(result, {})` carries `step_urls`, a `step` in each matched item's `node` and in
each extra. The wizard cases read the report text and, where the criteria name them, those result fields. The
steps snapshots are `snapshots/wizard-*.json`, each step entry a complete `pm-structure-snapshot/1` object.
"""
import json
import os
import pathlib
import re
import shutil
import unittest

try:
    import _pmscore
    import _pmspec
except ImportError as e:  # every case fails on its own when a module does not exist
    _pmscore, IMPORT_ERROR = None, e

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
FIXTURES = HERE / "fixtures" / "structure"
SPECS = FIXTURES / "specs"
SNAPS = FIXTURES / "snapshots"
WORK = CHECKOUT / "output" / "tests" / f"score-{os.getpid()}"
BUCKET_LIST = (SPECS / "bucket-list.yaml").read_text()

# issue 46 (R4.1): ` omitted=<o>/<n>` before ` verdict=`; exposed as Report.omitted and Report.spec_items. The group
# is optional only so the confirmed cases read through Report run on main; R4.1 itself is held by the cases that
# compare the whole first line (OmittedShown, OmittedCount, WizardOmittedShown, test_records' texts).
FIRST = re.compile(r"^structure (\S+) state=(\S+) score=(\d+\.\d) \((\d+)/(\d+)\)(?: omitted=(\d+)/(\d+))? "
                   r"verdict=(pass|fail)$")
GROUP = re.compile(r"^(unmatched|matched|omitted|not applicable|not scored|extra|blocked requests) \((\d+)\)$")


class Report:
    """The parts of an R3 report: first line fields, reason lines and the groups with their item lines."""

    def __init__(self, text):
        self.text = text
        lines = text.splitlines()
        m = FIRST.match(lines[0])
        if not m:
            raise AssertionError(f"first line {lines[0]!r} is not the R3 form")
        self.screen, self.state, self.score, matched, total, omitted, spec_items, self.verdict = m.groups()
        self.matched, self.total = int(matched), int(total)
        self.omitted = None if omitted is None else int(omitted)
        self.spec_items = None if spec_items is None else int(spec_items)
        self.reasons = [ln[len("reason: "):] for ln in lines if ln.startswith("reason: ")]
        self.groups, self.counts, current = {}, {}, None
        for ln in lines[1:]:
            g = GROUP.match(ln)
            if g:
                current = g.group(1)
                self.groups[current] = []
                self.counts[current] = int(g.group(2))
            elif current and ln.startswith("  "):
                self.groups[current].append(ln[2:])
            else:
                current = None
        for name, rows in self.groups.items():
            if len(rows) != self.counts[name]:
                raise AssertionError(f"group {name} says {self.counts[name]} but lists {len(rows)}:\n{text}")

    def ids(self, group):
        return [row.split("    ")[0] for row in self.groups.get(group, [])]

    def status(self, item_id):
        found = [g for g in ("unmatched", "matched", "omitted", "not applicable") if item_id in self.ids(g)]
        if len(found) != 1:
            raise AssertionError(f"{item_id} is in groups {found}:\n{self.text}")
        return found[0]


class ScoreCase(unittest.TestCase):
    def setUp(self):
        if _pmscore is None:
            self.fail(f"_pmscore or _pmspec cannot be imported: {IMPORT_ERROR}")
        WORK.mkdir(parents=True, exist_ok=True)
        self.addCleanup(shutil.rmtree, WORK, True)
        self.n = 0

    def spec(self, text=None, path=None):
        if text is None:
            return _pmspec.load(str(path or SPECS / "bucket-list.yaml"))
        self.n += 1
        p = WORK / f"{self._testMethodName}-{self.n}.yaml"
        p.write_text(text)
        return _pmspec.load(str(p))

    def run_score(self, snapshot, spec=None, state="seeded"):
        spec = spec if spec is not None else self.spec()
        snap = _pmscore.load_snapshot(str(SNAPS / f"{snapshot}.json"))
        return Report(_pmscore.render_text(_pmscore.score(spec, snap, state)))

    def assertStatus(self, report, expected):
        for item_id, status in expected.items():
            self.assertEqual(report.status(item_id), status, f"{item_id}\n{report.text}")


def variant(old, new):
    if old not in BUCKET_LIST:
        raise AssertionError(f"{old!r} is not in bucket-list.yaml")
    return BUCKET_LIST.replace(old, new)


# Spec D of issue 46 (test criteria): 9 items, all matched on detail-fields.json.
SPEC_D = """\
screen: s3.bucket-detail
service: s3
kind: detail
route: /s3/buckets/bucket-a
header:
  title: bucket-a
tabs: [Objects, Properties]
sections:
  - title: General configuration
    fields: [Bucket name, AWS Region]
"""
R = "fixture reason"


def omit_entry(*paths, reason=R):
    """An `omitted` block with one entry per path."""
    return "omitted:\n" + "".join(f"  - item: {p}\n    reason: {reason}\n" for p in paths)


def omit_more(*paths, reason=R):
    """bucket-list.yaml with one more entry per path appended to its `omitted` block."""
    if not BUCKET_LIST.endswith("    reason: the emulator has no directory buckets\n"):
        raise AssertionError("bucket-list.yaml does not end with its omitted block")
    return BUCKET_LIST + "".join(f"  - item: {p}\n    reason: {reason}\n" for p in paths)


class BucketList(ScoreCase):
    def test_full_match(self):
        r = self.run_score("full-seeded")
        self.assertEqual((r.matched, r.total, r.score, r.verdict), (17, 17, "100.0", "pass"))
        self.assertEqual(r.counts["unmatched"], 0)
        self.assertEqual(r.reasons, [])

    def test_missing_aws_region_column(self):
        r = self.run_score("missing-aws-region")
        self.assertEqual((r.verdict, r.score), ("fail", "94.1"))
        self.assertEqual(r.reasons, ["critical item unmatched: table.columns[AWS Region]"])
        self.assertEqual(r.ids("unmatched"), ["table.columns[AWS Region]"])

    def test_primary_action_renamed(self):
        r = self.run_score("primary-renamed")
        self.assertEqual(r.verdict, "fail")
        self.assertEqual(r.ids("unmatched"), ["header.actions[Create bucket]", "header.primary_action"])
        self.assertTrue(r.reasons[0].startswith("critical item unmatched: "), r.text)
        self.assertIn("header.primary_action", r.reasons[0])
        self.assertIn('button "Make bucket"', r.groups["extra"])

    def test_title_missing(self):
        r = self.run_score("title-missing")
        self.assertEqual(r.verdict, "fail")
        self.assertIn("header.title", r.reasons[0])
        self.assertStatus(r, {"header.title": "unmatched", "header.counter": "unmatched"})

    def test_two_non_critical_items_missing(self):
        r = self.run_score("filter-pagination-missing")
        self.assertEqual((r.verdict, r.score), ("fail", "88.2"))
        self.assertEqual(r.reasons, ["score below 90"])
        self.assertEqual(r.ids("unmatched"), ["table.filter", "table.pagination"])

    def test_title_missing_and_score_below_90_two_reasons(self):
        r = self.run_score("title-missing")
        self.assertEqual(r.score, "88.2")
        self.assertEqual(r.reasons, ["critical item unmatched: header.title", "score below 90"])
        lines = r.text.splitlines()
        self.assertEqual(lines.index("reason: score below 90"),
                         lines.index("reason: critical item unmatched: header.title") + 1)

    def test_columns_out_of_order_is_critical(self):
        r = self.run_score("columns-reordered")
        self.assertEqual(r.verdict, "fail")
        self.assertEqual(r.ids("unmatched"), ["table.columns.order"])
        self.assertEqual(r.reasons, ["critical item unmatched: table.columns.order"])

    def test_not_applicable_empty_items_are_not_extras(self):
        r = self.run_score("seeded-with-empty-block")
        self.assertStatus(r, {"table.empty.title": "not applicable", "table.empty.action": "not applicable"})
        self.assertEqual(r.groups["extra"], [])


class Matching(ScoreCase):
    def test_case_and_surrounding_whitespace(self):
        r = self.run_score("case-whitespace")
        self.assertEqual(r.ids("unmatched"), [])
        self.assertEqual(r.score, "100.0")

    def test_right_name_wrong_role(self):
        r = self.run_score("wrong-roles")
        self.assertStatus(r, {"header.title": "unmatched", "table.columns[Name]": "unmatched"})

    def test_breadcrumbs_need_a_breadcrumb_navigation(self):
        for snap in ("breadcrumbs-other-nav", "breadcrumbs-no-nav"):
            with self.subTest(snapshot=snap):
                self.assertStatus(self.run_score(snap),
                                  {"breadcrumbs[Amazon S3]": "unmatched", "breadcrumbs[Buckets]": "unmatched"})
        self.assertStatus(self.run_score("full-seeded"),
                          {"breadcrumbs[Amazon S3]": "matched", "breadcrumbs[Buckets]": "matched"})
        r = self.run_score("breadcrumbs-last-statictext")
        self.assertStatus(r, {"breadcrumbs[Amazon S3]": "matched", "breadcrumbs[Buckets]": "matched"})
        self.assertIn('breadcrumbs[Buckets]    StaticText "Buckets"', r.groups["matched"])

    def test_counter_in_the_heading(self):
        for snap in ("full-seeded", "heading-counter-100plus", "heading-counter-fraction"):
            with self.subTest(snapshot=snap):
                self.assertStatus(self.run_score(snap), {"header.title": "matched", "header.counter": "matched"})
        self.assertStatus(self.run_score("heading-no-counter"),
                          {"header.title": "matched", "header.counter": "unmatched"})
        self.assertStatus(self.run_score("heading-bare-number"),
                          {"header.title": "unmatched", "header.counter": "unmatched"})

    def test_heading_with_counter_when_spec_has_none(self):
        spec = self.spec(variant("  counter: true\n", ""))
        self.assertStatus(self.run_score("full-seeded", spec), {"header.title": "unmatched"})

    def test_action_as_link(self):
        self.assertStatus(self.run_score("action-link"), {
            "header.actions[Empty]": "matched", "header.actions[Create bucket]": "matched",
            "header.primary_action": "matched"})

    def test_selection(self):
        self.assertStatus(self.run_score("full-seeded"), {"table.selection": "matched"})
        self.assertStatus(self.run_score("radio-outside-table"), {"table.selection": "unmatched"})
        multi = self.spec(variant("selection: single", "selection: multi"))
        self.assertStatus(self.run_score("checkbox-in-grid", multi), {"table.selection": "matched"})
        self.assertStatus(self.run_score("checkbox-outside-table", multi), {"table.selection": "unmatched"})
        none = self.spec(variant("selection: single", "selection: none"))
        self.assertStatus(self.run_score("full-seeded", none), {"table.selection": "unmatched"})

    def test_filter(self):
        self.assertStatus(self.run_score("full-seeded"), {"table.filter": "matched"})
        self.assertStatus(self.run_score("filter-textbox"), {"table.filter": "matched"})
        self.assertStatus(self.run_score("filter-combobox"), {"table.filter": "unmatched"})
        prop = self.spec(variant("filter: text", "filter: property"))
        self.assertStatus(self.run_score("filter-combobox", prop), {"table.filter": "matched"})

    def test_pagination(self):
        self.assertStatus(self.run_score("pagination-next-only"), {"table.pagination": "unmatched"})
        self.assertStatus(self.run_score("full-seeded"), {"table.pagination": "matched"})

    def test_empty_title_and_action(self):
        self.assertStatus(self.run_score("empty-full", state="empty"),
                          {"table.empty.title": "matched", "table.empty.action": "matched"})
        self.assertStatus(self.run_score("empty-action-before-title", state="empty"),
                          {"table.empty.title": "matched", "table.empty.action": "unmatched"})

    def test_empty_action_needs_the_title(self):
        self.assertStatus(self.run_score("empty-title-missing", state="empty"),
                          {"table.empty.title": "unmatched", "table.empty.action": "unmatched"})

    def test_tab_section_heading_and_fields(self):
        spec = self.spec("""\
screen: s3.bucket-detail
service: s3
kind: detail
route: /s3/buckets/bucket-a
header:
  title: bucket-a
tabs: [Objects, Properties]
sections:
  - title: General configuration
    fields: [Bucket name, AWS Region, Created]
""")
        self.assertStatus(self.run_score("detail-fields", spec), {
            "tabs[Objects]": "matched", "tabs[Properties]": "matched",
            "sections[General configuration].title": "matched",
            "sections[General configuration].fields[Bucket name]": "matched",
            "sections[General configuration].fields[AWS Region]": "matched",
            "sections[General configuration].fields[Created]": "unmatched"})

    def test_empty_name_label_text_matches_by_its_static_text(self):
        # Requirement correction R5.2 (decisions.md, PM decisions): real Chromium gives a form label an empty-name
        # LabelText whose text sits in its StaticText child; that text is matched when the name is empty.
        spec = self.spec("""\
screen: s3.bucket-create
service: s3
kind: form
route: /s3/buckets/create
header:
  title: Create bucket
sections:
  - title: General configuration
    fields: [Bucket name, Bucket type]
""")
        self.assertStatus(self.run_score("labeltext-empty-name", spec), {
            "sections[General configuration].fields[Bucket name]": "matched",
            "sections[General configuration].fields[Bucket type]": "unmatched"})


class OrderItems(ScoreCase):
    def test_in_order_with_an_earlier_duplicate(self):
        r = self.run_score("order-earlier-duplicate")
        self.assertStatus(r, {"table.columns.order": "matched"})
        self.assertIn("table.columns.order    in order", r.groups["matched"])

    def test_two_entries_swapped(self):
        r = self.run_score("order-swapped")
        self.assertStatus(r, {"header.actions.order": "unmatched", "header.actions[Empty]": "matched",
                              "header.actions[Delete]": "matched"})
        self.assertIn("header.actions.order    out of order", r.groups["unmatched"])

    def test_one_or_no_entry_matched(self):
        self.assertStatus(self.run_score("order-one-entry"), {
            "table.columns.order": "matched", "table.columns[Name]": "matched",
            "table.columns[AWS Region]": "unmatched", "table.columns[Creation date]": "unmatched"})
        self.assertStatus(self.run_score("order-no-entry"), {
            "table.columns.order": "matched", "table.columns[Name]": "unmatched",
            "table.columns[AWS Region]": "unmatched", "table.columns[Creation date]": "unmatched"})

    def test_omitted_entry_out_of_order(self):
        """Issue 46: the omitted tab Objects after Permissions does not break tabs.order; the screen shows it, so the
        run fails for that (OmittedShown.test_tab_out_of_order_omitted_and_shown)."""
        spec = self.spec(SPEC_D.replace("tabs: [Objects, Properties]", "tabs: [Objects, Properties, Permissions]")
                         + omit_entry("tabs[Objects]"))
        r = self.run_score("tabs-omitted-out-of-order", spec)
        self.assertStatus(r, {"tabs.order": "matched"})
        self.assertIn("tabs.order    in order", r.groups["matched"])
        self.assertEqual(r.verdict, "fail")


THREE_ITEMS = """\
screen: s3.three
service: s3
kind: detail
route: /s3/three
breadcrumbs: [Home]
header:
  title: Overview
  counter: true
omitted:
  - item: header.counter
    reason: the emulator returns no count for this list
"""

class PassLine(ScoreCase):
    def ten(self, snapshot):
        return self.run_score(snapshot, self.spec(path=SPECS / "ten-items.yaml"))

    def test_nine_of_ten_non_critical_passes(self):
        r = self.ten("ten-nine")
        self.assertEqual((r.matched, r.total, r.score, r.verdict), (9, 10, "90.0", "pass"))
        self.assertEqual(r.ids("unmatched"), ["table.filter"])

    def test_eight_of_ten_fails(self):
        r = self.ten("ten-eight")
        self.assertEqual((r.matched, r.total, r.score, r.verdict), (8, 10, "80.0", "fail"))
        self.assertEqual(r.reasons, ["score below 90"])

    def test_two_of_three_truncated(self):
        r = self.run_score("three-two", self.spec(THREE_ITEMS))
        self.assertEqual((r.matched, r.total, r.score, r.verdict), (2, 3, "66.6", "fail"))


class Extras(ScoreCase):
    def test_each_kind_listed_once_in_document_order(self):
        r = self.run_score("extras-main")
        self.assertEqual(r.groups["extra"], ['tab "Metrics"', 'button "Versioning"', 'columnheader "Bucket owner"',
                                             'LabelText "Owner"', 'term "Size"'])

    def test_duplicate_listed_once(self):
        self.assertEqual(self.run_score("extras-duplicate").groups["extra"], ['button "Refresh"'])

    def test_navigation_outside_main_empty_and_digits_not_listed(self):
        self.assertEqual(self.run_score("extras-excluded").groups["extra"], [])

    def test_no_main_takes_the_whole_page(self):
        self.assertEqual(self.run_score("extras-no-main").groups["extra"], ['button "Refresh"'])

    def test_extras_do_not_change_the_score(self):
        r = self.run_score("extras-main")
        self.assertEqual((r.matched, r.total, r.score, r.verdict), (17, 17, "100.0", "pass"))


class SnapshotFile(ScoreCase):
    def test_malformed_files(self):
        for name in ("bad-no-format", "bad-other-format", "bad-node-no-role", "bad-parent-forward"):
            path = SNAPS / f"{name}.json"
            with self.subTest(snapshot=name):
                with self.assertRaises(Exception) as cm:
                    _pmscore.load_snapshot(str(path))
                self.assertIn(f"cannot read snapshot {path}", str(cm.exception))

    def test_larger_than_64_mib(self):
        """A valid snapshot padded with whitespace past 64 MiB: refused by its size, not by its content."""
        path = WORK / "large.json"
        body = (SNAPS / "full-seeded.json").read_bytes()
        with path.open("wb") as f:
            f.write(body)
            f.write(b" " * (64 * 1024 * 1024 + 1 - len(body)))
        self.assertEqual(path.stat().st_size, 64 * 1024 * 1024 + 1)
        with self.assertRaises(Exception) as cm:
            _pmscore.load_snapshot(str(path))
        self.assertIn(f"cannot read snapshot {path}", str(cm.exception))


# ---------------------------------------------------------------------------------------------------- issue 8

T1, T2, T3 = "Select trusted entity", "Add permissions", "Name, review, and create"
WIZARD = SPECS / "wizard.yaml"
STEP_URL = "http://127.0.0.1:8102/aws/iam/roles/create?step={}"
# the step each item of wizard.yaml is scored on (requirement 5.1)
STEP_OF = {
    "breadcrumbs[IAM]": 1, "breadcrumbs[Roles]": 1, "breadcrumbs[Create role]": 1, "breadcrumbs.order": 1,
    f"steps[{T1}].title": 1, f"steps[{T1}].sections[Trusted entity type].title": 1,
    f"steps[{T1}].sections[Trusted entity type].fields[Use case]": 1,
    f"steps[{T1}].sections[Trusted entity type].fields[Service]": 1,
    f"steps[{T1}].sections[Trusted entity type].fields.order": 1, f"steps[{T1}].sections.order": 1,
    f"steps[{T2}].title": 2, f"steps[{T2}].sections[Permissions policies].title": 2, f"steps[{T2}].sections.order": 2,
    f"steps[{T3}].title": 3, "steps.order": 1, "submit": 3}

MATCHED_FULL = [
    'breadcrumbs[IAM]    step 1: link "IAM"',
    'breadcrumbs[Roles]    step 1: link "Roles"',
    'breadcrumbs[Create role]    step 1: link "Create role"',
    "breadcrumbs.order    step 1: in order",
    f'steps[{T1}].title    step 1: heading "{T1}"',
    f'steps[{T1}].sections[Trusted entity type].title    step 1: heading "Trusted entity type"',
    f'steps[{T1}].sections[Trusted entity type].fields[Use case]    step 1: LabelText "Use case"',
    f'steps[{T1}].sections[Trusted entity type].fields[Service]    step 1: LabelText "Service"',
    f"steps[{T1}].sections[Trusted entity type].fields.order    step 1: in order",
    f"steps[{T1}].sections.order    step 1: in order",
    f'steps[{T2}].title    step 2: heading "{T2}"',
    f'steps[{T2}].sections[Permissions policies].title    step 2: heading "Permissions policies"',
    f"steps[{T2}].sections.order    step 2: in order",
    f'steps[{T3}].title    step 3: heading "{T3}"',
    "steps.order    step 1: in order",
    'submit    step 3: button "Create role"',
]


def get(obj, key):
    return obj[key] if isinstance(obj, dict) else getattr(obj, key)


class WizardCase(ScoreCase):
    def wizard(self, snapshot, spec=WIZARD, state="seeded"):
        """(report, result file body) of `snapshots/<snapshot>.json` scored against the spec at `spec`."""
        if not isinstance(spec, pathlib.Path):
            spec = self.spec(spec)
        else:
            spec = self.spec(path=spec)
        snap = _pmscore.load_snapshot(str(SNAPS / f"{snapshot}.json"))
        result = _pmscore.score(spec, snap, state)
        return Report(_pmscore.render_text(result)), _pmscore.result_json(result, {})

    def detail(self, report, group, item_id):
        rows = [row.split("    ", 1)[1] for row in report.groups[group] if row.split("    ")[0] == item_id]
        self.assertEqual(len(rows), 1, f"{item_id} in {group}:\n{report.text}")
        return rows[0]

    def node_step(self, body, item_id):
        node = next(i for i in body["items"] if i["id"] == item_id)["node"]
        self.assertIsNotNone(node, item_id)
        return node["step"]

    def extras(self, body):
        return [(e["role"], e["name"], e["step"]) for e in body["extras"]]


class WizardScore(WizardCase):
    def test_full_every_item_on_its_own_step(self):
        r, body = self.wizard("wizard-full")
        self.assertEqual((r.matched, r.total, r.score, r.verdict), (16, 16, "100.0", "pass"))
        self.assertEqual(r.counts["unmatched"], 0)
        with_node = [i for i in body["items"] if i["node"] is not None]
        self.assertLessEqual({"breadcrumbs[IAM]", f"steps[{T2}].title", f"steps[{T3}].title", "submit"},
                             {i["id"] for i in with_node})
        for i in with_node:
            self.assertEqual(i["node"]["step"], STEP_OF[i["id"]], i["id"])
        self.assertTrue(self.detail(r, "matched", "steps.order").startswith("step 1: "), r.text)
        self.assertEqual(self.node_step(body, "submit"), 3)

    def test_screen_ignoring_the_step(self):
        r, _ = self.wizard("wizard-ignores-step")
        self.assertEqual(r.ids("unmatched"), [f"steps[{T2}].title", f"steps[{T2}].sections[Permissions policies].title",
                                              f"steps[{T3}].title", "submit"])
        self.assertEqual(r.verdict, "fail")
        self.assertEqual(r.reasons[0],
                         f"critical item unmatched: steps[{T2}].title, steps[{T3}].title, submit")

    def test_step_title_only_on_another_step(self):
        r, _ = self.wizard("wizard-title-on-step2")
        self.assertStatus(r, {f"steps[{T1}].title": "unmatched", f"steps[{T2}].title": "matched"})

    def test_field_only_on_another_step(self):
        r, _ = self.wizard("wizard-field-on-step3")
        self.assertStatus(r, {f"steps[{T1}].sections[Trusted entity type].fields[Service]": "unmatched",
                              f"steps[{T1}].sections[Trusted entity type].fields[Use case]": "matched"})

    def test_navigation_entries_bare_titles_or_links(self):
        for snap in ("wizard-nav-bare-titles", "wizard-nav-links"):
            with self.subTest(snapshot=snap):
                self.assertStatus(self.wizard(snap)[0], {"steps.order": "matched"})

    def test_navigation_entries_swapped(self):
        r, _ = self.wizard("wizard-nav-swapped")
        self.assertStatus(r, {"steps.order": "unmatched", f"steps[{T1}].title": "matched",
                              f"steps[{T2}].title": "matched", f"steps[{T3}].title": "matched"})
        self.assertTrue(self.detail(r, "unmatched", "steps.order").endswith("out of order"), r.text)

    def test_navigation_missing_or_without_the_last_entry(self):
        for snap, title in (("wizard-nav-none", T1), ("wizard-nav-no-step3", T3)):
            with self.subTest(snapshot=snap):
                r, _ = self.wizard(snap)
                self.assertStatus(r, {"steps.order": "unmatched"})
                self.assertTrue(self.detail(r, "unmatched", "steps.order").endswith(
                    f'no navigation entry for "{title}"'), r.text)

    def test_entry_inside_the_breadcrumbs_is_not_a_navigation_entry(self):
        r, _ = self.wizard("wizard-nav-in-breadcrumbs")
        self.assertStatus(r, {"steps.order": "unmatched"})
        self.assertTrue(self.detail(r, "unmatched", "steps.order").endswith(f'no navigation entry for "{T2}"'),
                        r.text)

    def test_submit_on_another_step(self):
        r, _ = self.wizard("wizard-submit-on-step2")
        self.assertStatus(r, {"submit": "unmatched"})
        self.assertEqual(r.reasons[0], "critical item unmatched: submit")

    def test_pass_line_around_fourteen_of_fifteen(self):
        omitted = SPECS / "wizard-omitted.yaml"
        r, _ = self.wizard("wizard-fourteen", omitted)
        self.assertEqual((r.matched, r.total, r.score, r.verdict), (14, 15, "93.3", "pass"))
        self.assertEqual(r.ids("unmatched"), [f"steps[{T1}].sections[Trusted entity type].fields[Service]"])
        r, _ = self.wizard("wizard-thirteen", omitted)
        self.assertEqual((r.matched, r.total, r.score, r.verdict), (13, 15, "86.6", "fail"))
        self.assertEqual(r.reasons, ["score below 90"])

    def test_omitted_step_two_shown_steps(self):
        r, body = self.wizard("wizard-two-steps", SPECS / "wizard-omit-step.yaml")
        self.assertEqual((r.matched, r.total, r.verdict), (13, 13, "pass"))
        self.assertStatus(r, {f"steps[{T3}].title": "matched", "submit": "matched", "steps.order": "matched"})
        self.assertEqual(self.node_step(body, f"steps[{T3}].title"), 2)
        self.assertEqual(self.node_step(body, "submit"), 2)

    def test_one_shown_step(self):
        r, body = self.wizard("wizard-one-step", SPECS / "wizard-one-step.yaml")
        self.assertEqual((r.matched, r.total, r.verdict), (7, 7, "pass"))
        self.assertStatus(r, {"steps.order": "matched", f"steps[{T3}].title": "matched", "submit": "matched"})
        self.assertEqual(self.node_step(body, f"steps[{T3}].title"), 1)
        self.assertEqual(self.node_step(body, "submit"), 1)

    def test_one_shown_step_without_navigation(self):
        r, _ = self.wizard("wizard-one-step-no-nav", SPECS / "wizard-one-step.yaml")
        self.assertStatus(r, {"steps.order": "unmatched"})
        self.assertTrue(self.detail(r, "unmatched", "steps.order").endswith(f'no navigation entry for "{T3}"'),
                        r.text)

    def test_state_empty(self):
        r, _ = self.wizard("wizard-full", state="empty")
        self.assertEqual((r.state, r.matched, r.total, r.score), ("empty", 16, 16, "100.0"))
        self.assertEqual(r.counts["not applicable"], 0)

    def test_extras_once_at_the_first_step(self):
        _, body = self.wizard("wizard-full")
        self.assertEqual(self.extras(body), [("button", "Cancel", 1), ("button", "Next", 1),
                                             ("button", "Previous", 2)])

    def test_claims_hold_over_every_step(self):
        text = WIZARD.read_text()
        old = "  - title: Name, review, and create\n"
        self.assertIn(old, text)
        spec = self.spec(text.replace(old, old + "    sections:\n      - title: Role details\n"
                                            "        fields: [Description]\n"))
        snap = _pmscore.load_snapshot(str(SNAPS / "wizard-description.json"))
        result = _pmscore.score(spec, snap, "seeded")
        r = Report(_pmscore.render_text(result))
        self.assertStatus(r, {f"steps[{T3}].sections[Role details].fields[Description]": "matched"})
        self.assertEqual(self.extras(_pmscore.result_json(result, {})),
                         [("button", "Cancel", 1), ("button", "Next", 1), ("button", "Previous", 2)])

    def test_same_steps_snapshot_twice(self):
        spec = self.spec(path=WIZARD)
        texts = [_pmscore.render_text(_pmscore.score(spec, _pmscore.load_snapshot(str(SNAPS / "wizard-full.json")),
                                                     "seeded")).encode() for _ in range(2)]
        self.assertEqual(texts[0], texts[1])

    def test_wizard_needs_a_steps_snapshot(self):
        spec = self.spec(path=WIZARD)
        path = SNAPS / "full-seeded.json"
        with self.assertRaises(_pmscore.SnapshotError) as cm:
            _pmscore.score(spec, _pmscore.load_snapshot(str(path)), "seeded")
        self.assertEqual(str(cm.exception), f"cannot read snapshot {path}: a wizard needs a steps snapshot")

    def test_steps_snapshot_for_another_kind(self):
        spec = self.spec()
        path = SNAPS / "wizard-full.json"
        with self.assertRaises(_pmscore.SnapshotError) as cm:
            _pmscore.score(spec, _pmscore.load_snapshot(str(path)), "seeded")
        self.assertEqual(str(cm.exception), f"cannot read snapshot {path}: a steps snapshot for a spec of kind table")

    def test_steps_snapshot_with_too_few_steps(self):
        spec = self.spec(path=WIZARD)
        path = SNAPS / "wizard-two-steps.json"
        with self.assertRaises(_pmscore.SnapshotError) as cm:
            _pmscore.score(spec, _pmscore.load_snapshot(str(path)), "seeded")
        self.assertEqual(str(cm.exception), f"cannot read snapshot {path}: it holds 2 steps, the spec shows 3")


class StepsSnapshotFile(WizardCase):
    def refused(self, path):
        with self.assertRaises(_pmscore.SnapshotError) as cm:
            _pmscore.load_snapshot(str(path))
        return str(cm.exception)

    def test_valid_steps_snapshot(self):
        path = SNAPS / "wizard-full.json"
        steps = list(get(_pmscore.load_snapshot(str(path)), "steps"))
        self.assertEqual([get(s, "url") for s in steps], [STEP_URL.format(k) for k in (1, 2, 3)])
        raw = json.loads(path.read_text())["steps"]
        self.assertEqual([len(get(s, "nodes")) for s in steps], [len(e["nodes"]) for e in raw])
        self.assertEqual([get(n, "name") for n in get(steps[1], "nodes")], [n["name"] for n in raw[1]["nodes"]])

    def test_steps_missing_not_a_list_or_empty(self):
        for name in ("wizard-bad-no-steps", "wizard-bad-steps-not-list", "wizard-bad-steps-empty"):
            path = SNAPS / f"{name}.json"
            with self.subTest(snapshot=name):
                msg = self.refused(path)
                prefix = f"cannot read snapshot {path}: "
                self.assertTrue(msg.startswith(prefix), msg)
                self.assertIn("steps", msg[len(prefix):])  # the why names the steps, not the format

    def test_entry_node_without_role(self):
        path = SNAPS / "wizard-bad-node-no-role.json"
        self.assertEqual(self.refused(path), f"cannot read snapshot {path}: step 2: node 3 has no role or name")

    def test_entry_of_another_format(self):
        path = SNAPS / "wizard-bad-entry-format.json"
        msg = self.refused(path)
        self.assertTrue(msg.startswith(f"cannot read snapshot {path}: step 1: "), msg)

    def test_larger_than_64_mib(self):
        """The steps file padded with whitespace to exactly 64 MiB loads; one byte more is refused by its size."""
        path = WORK / "large-steps.json"
        body = (SNAPS / "wizard-full.json").read_bytes()
        limit = 64 * 1024 * 1024
        with path.open("wb") as f:
            f.write(body)
            f.write(b" " * (limit - len(body)))
        self.assertEqual(path.stat().st_size, limit)
        self.assertEqual(len(get(_pmscore.load_snapshot(str(path)), "steps")), 3)
        with path.open("ab") as f:
            f.write(b" ")
        self.assertEqual(path.stat().st_size, limit + 1)
        self.assertEqual(self.refused(path), f"cannot read snapshot {path}: larger than 67108864 bytes")


class WizardReport(WizardCase):
    def test_matched_lines_carry_the_step(self):
        r, _ = self.wizard("wizard-full")
        self.assertEqual(r.groups["matched"], MATCHED_FULL)

    def test_unmatched_lines_carry_the_step(self):
        r, _ = self.wizard("wizard-ignores-step")
        self.assertEqual(r.groups["unmatched"], [
            f'steps[{T2}].title    step 2: heading "{T2}"',
            f'steps[{T2}].sections[Permissions policies].title    step 2: heading "Permissions policies"',
            f'steps[{T3}].title    step 3: heading "{T3}"',
            'submit    step 3: button "Create role"'])

    def test_extra_lines_carry_the_step(self):
        r, _ = self.wizard("wizard-full")
        self.assertEqual(r.groups["extra"], ['step 1: button "Cancel"', 'step 1: button "Next"',
                                             'step 2: button "Previous"'])

    def test_omitted_and_not_scored_lines_carry_no_step(self):
        r, _ = self.wizard("wizard-section-absent", SPECS / "wizard-omitted.yaml")
        self.assertEqual(r.groups["omitted"], [
            f"steps[{T2}].sections[Permissions policies].title    the emulator has no managed policies to list"])
        self.assertEqual(r.groups["not scored"],
                         [f"steps[{T1}].sections[Trusted entity type].fields[Use case]    control: input"])

    def test_blocked_requests_of_every_step_once(self):
        r, _ = self.wizard("wizard-blocked")
        self.assertEqual(r.groups["blocked requests"], ["http://example.com/a.js", "http://example.com/b.js"])

    def test_result_file_fields(self):
        _, body = self.wizard("wizard-blocked")
        self.assertEqual(body["url"], STEP_URL.format(1))
        self.assertEqual(body["step_urls"], [STEP_URL.format(k) for k in (1, 2, 3)])
        matched = [i for i in body["items"] if i["status"] == "matched" and i["node"] is not None]
        self.assertEqual(len(matched), 11)
        for i in matched:
            self.assertIn("step", i["node"], i["id"])
        self.assertTrue(body["extras"])
        for e in body["extras"]:
            self.assertIn("step", e, e)
        self.assertEqual(body["blocked"], ["http://example.com/a.js", "http://example.com/b.js"])


# ---------------------------------------------------------------------------------------------------- issue 46

GC = "sections[General configuration]"
DIRECTORY = "the emulator has no directory buckets"
SHOWN = "omitted item shown: "


class OmittedCase(WizardCase):
    def row(self, report, item_id, group="omitted"):
        """The whole line of `item_id` in `group`, without its indent."""
        rows = [row for row in report.groups[group] if row.split("    ")[0] == item_id]
        self.assertEqual(len(rows), 1, f"{item_id} in {group}:\n{report.text}")
        return rows[0]

    def assertShown(self, report, item_id, node, reason=R):
        """`item_id` is shown at `node` (`<role> "<name>"`, for a wizard with its `step <k>: `) and named by the
        reason line."""
        self.assertEqual(self.row(report, item_id), f"{item_id}    shown: {node}    {reason}")
        self.assertEqual(report.reasons, [SHOWN + item_id], report.text)
        self.assertEqual(report.verdict, "fail", report.text)

    def assertNotShown(self, report, item_id, reason=R):
        """`item_id` keeps today's omitted line and no reason line names it (true on main as well)."""
        self.assertEqual(self.row(report, item_id), f"{item_id}    {reason}")
        self.assertFalse([x for x in report.reasons if x.startswith(SHOWN)], report.text)


class OmittedShown(OmittedCase):
    """R3.1, R3.4, R3.5: an omitted item that the screen shows fails the run."""

    def test_bucket_list_tab_absent(self):
        r = self.run_score("full-seeded")
        self.assertEqual(r.text.splitlines()[0],
                         "structure s3.bucket-list state=seeded score=100.0 (17/17) omitted=2/21 verdict=pass")
        self.assertEqual(r.reasons, [])
        self.assertEqual(r.groups["omitted"], [f"tabs[Directory buckets]    {DIRECTORY}", f"tabs.order    {DIRECTORY}"])

    def test_bucket_list_tab_shown(self):
        r = self.run_score("tab-shown")
        self.assertEqual(r.text.splitlines()[0],
                         "structure s3.bucket-list state=seeded score=100.0 (17/17) omitted=2/21 verdict=fail")
        self.assertEqual(r.reasons, ["omitted item shown: tabs[Directory buckets]"])
        self.assertEqual(r.groups["omitted"], [
            f'tabs[Directory buckets]    shown: tab "Directory buckets"    {DIRECTORY}', f"tabs.order    {DIRECTORY}"])
        self.assertEqual(r.counts["extra"], 0)

    def test_list_block_omitted_and_shown(self):
        r = self.run_score("detail-fields", self.spec(SPEC_D + omit_entry("tabs")))
        self.assertEqual(r.verdict, "fail")
        self.assertEqual(r.reasons, ["omitted item shown: tabs[Objects], tabs[Properties]"])
        self.assertEqual((r.matched, r.total), (6, 6))

    def test_section_omitted_and_shown(self):
        r = self.run_score("detail-fields", self.spec(SPEC_D + omit_entry(GC)))
        self.assertEqual(r.reasons,
                         [f"omitted item shown: {GC}.title, {GC}.fields[Bucket name], {GC}.fields[AWS Region]"])
        self.assertEqual(self.row(r, f"{GC}.fields[Bucket name]"),
                         f'{GC}.fields[Bucket name]    shown: LabelText "Bucket name"    {R}')
        self.assertEqual(self.row(r, f"{GC}.fields[AWS Region]"),
                         f'{GC}.fields[AWS Region]    shown: term "AWS Region"    {R}')

    def test_field_claimed_by_a_scored_item_is_not_shown(self):
        """Guard: passes on main (R3.2, third bullet)."""
        spec = self.spec(SPEC_D + "  - title: Tags\n    fields: [AWS Region]\n" + omit_entry("sections[Tags]"))
        r = self.run_score("detail-fields", spec)
        self.assertEqual((r.verdict, r.reasons), ("pass", []), r.text)
        self.assertNotShown(r, "sections[Tags].fields[AWS Region]")

    def test_tab_out_of_order_omitted_and_shown(self):
        spec = self.spec(SPEC_D.replace("tabs: [Objects, Properties]", "tabs: [Objects, Properties, Permissions]")
                         + omit_entry("tabs[Objects]"))
        r = self.run_score("tabs-omitted-out-of-order", spec)
        self.assertStatus(r, {"tabs.order": "matched"})
        self.assertShown(r, "tabs[Objects]", 'tab "Objects"')

    def test_shown_reason_comes_after_todays_reasons(self):
        more = "fields: [Bucket name, AWS Region, Owner, Size, Versioning]"
        spec = self.spec(SPEC_D.replace("title: bucket-a", "title: other")
                         .replace("fields: [Bucket name, AWS Region]", more) + omit_entry("tabs[Properties]"))
        r = self.run_score("detail-fields", spec)
        self.assertEqual(r.reasons, ["critical item unmatched: header.title", "score below 90",
                                     "omitted item shown: tabs[Properties]"])
        self.assertEqual(r.verdict, "fail")


SPEC_F = """\
screen: s3.bucket-create
service: s3
kind: form
route: /s3/buckets/create
header:
  title: Create bucket
sections:
  - title: General configuration
    fields: [Bucket name, Bucket kind]
"""


class OmittedShownByKind(OmittedCase):
    """R3.1, D2.2: each kind of item is looked for where its rule looks."""

    def test_label_with_an_empty_name(self):
        item_id = f"{GC}.fields[Bucket kind]"
        r = self.run_score("labeltext-empty-name", self.spec(SPEC_F + omit_entry(item_id)))
        self.assertShown(r, item_id, 'LabelText ""')
        claimed = self.spec(SPEC_F + "  - title: Other\n    fields: [Bucket kind]\n" + omit_entry(item_id))
        self.assertNotShown(self.run_score("labeltext-empty-name", claimed), item_id)

    def bucket_list(self, path, shown_on, node, absent_on, spec_text=None):
        spec = self.spec(spec_text or omit_more(path))
        with self.subTest(snapshot=shown_on):
            self.assertShown(self.run_score(shown_on, spec), path, node)
        with self.subTest(snapshot=absent_on):
            self.assertNotShown(self.run_score(absent_on, spec), path)

    def test_breadcrumb(self):
        self.bucket_list("breadcrumbs[Amazon S3]", "full-seeded", 'link "Amazon S3"', "breadcrumbs-no-nav")

    def test_pagination(self):
        self.bucket_list("table.pagination", "full-seeded", 'button "Previous page"', "filter-pagination-missing")

    def test_filter(self):
        self.bucket_list("table.filter", "full-seeded", 'searchbox "Find buckets by name"',
                         "filter-pagination-missing")

    def test_counter(self):
        self.bucket_list("header.counter", "full-seeded", 'heading "General purpose buckets (3)"', "heading-no-counter")

    def test_selection(self):
        r = self.run_score("full-seeded", self.spec(omit_more("table.selection")))
        self.assertShown(r, "table.selection", 'radio "Select bucket-a"')
        none = self.spec(omit_more("table.selection").replace("selection: single", "selection: none"))
        self.assertNotShown(self.run_score("full-seeded", none), "table.selection")


EMPTY_TITLE_ONLY = variant("    title: No buckets\n    action: Create bucket\n", "    title: No buckets\n")


class OmittedShownStates(OmittedCase):
    """R3.2: an item is looked for only in a state it applies to."""

    def spec_title_omitted(self):
        if not EMPTY_TITLE_ONLY.endswith(f"    reason: {DIRECTORY}\n"):
            raise AssertionError("bucket-list.yaml does not end with its omitted block")
        return self.spec(EMPTY_TITLE_ONLY + f"  - item: table.empty.title\n    reason: {R}\n")

    def test_seeded_run_does_not_look_for_the_empty_title(self):
        """Guard: passes on main."""
        r = self.run_score("seeded-with-empty-block", self.spec_title_omitted())
        self.assertStatus(r, {"table.empty.title": "omitted"})
        self.assertNotShown(r, "table.empty.title")

    def test_empty_run_finds_the_empty_title(self):
        r = self.run_score("empty-full", self.spec_title_omitted(), state="empty")
        self.assertEqual(r.verdict, "fail")
        self.assertIn("omitted item shown: table.empty.title", r.reasons)
        self.assertTrue(self.row(r, "table.empty.title").startswith("table.empty.title    shown: "), r.text)


class OmittedCount(OmittedCase):
    """R4.1, R4.5: the first line says how many of the spec's items were left out; no number fails by itself."""

    def test_spec_without_omitted(self):
        r = self.run_score("ten-nine", self.spec(path=SPECS / "ten-items.yaml"))
        self.assertTrue(r.text.splitlines()[0].endswith(" score=90.0 (9/10) omitted=0/10 verdict=pass"), r.text)

    def test_most_items_omitted_passes(self):
        r = self.run_score("detail-title-only", self.spec(SPEC_D + omit_entry("tabs", "sections")))
        self.assertTrue(r.text.splitlines()[0].endswith(" score=100.0 (1/1) omitted=8/9 verdict=pass"), r.text)


class OmittedResultFile(OmittedCase):
    """R4.2: the result file carries the counts and, per omitted item, whether it is shown."""

    def body(self, snapshot):
        snap = _pmscore.load_snapshot(str(SNAPS / f"{snapshot}.json"))
        return _pmscore.result_json(_pmscore.score(self.spec(), snap, "seeded"), {})

    def test_tab_shown(self):
        body = self.body("tab-shown")
        self.assertEqual((body["omitted"], body["spec_items"]), (2, 21))
        self.assertEqual(body["omitted_shown"], ["tabs[Directory buckets]"])
        items = {i["id"]: i for i in body["items"]}
        tab = items["tabs[Directory buckets]"]
        self.assertEqual((tab["status"], tab["shown"]), ("omitted", True))
        self.assertEqual((tab["node"]["role"], tab["node"]["name"]), ("tab", "Directory buckets"))
        self.assertIs(items["tabs.order"]["shown"], False)
        self.assertIsNone(items["tabs.order"]["node"])
        count = lambda s: sum(1 for i in body["items"] if i["status"] == s)
        self.assertEqual(body["matched"] + count("unmatched") + body["omitted"] + count("not-applicable"),
                         body["spec_items"])

    def test_nothing_shown(self):
        body = self.body("full-seeded")
        self.assertEqual(body["omitted_shown"], [])
        omitted = [i for i in body["items"] if i["status"] == "omitted"]
        self.assertEqual(len(omitted), 2)
        for i in omitted:
            self.assertIs(i["shown"], False, i["id"])


OMIT_STEP = SPECS / "wizard-omit-step.yaml"
POLICIES = f"steps[{T2}].sections[Permissions policies].title"
ATTACH = "the emulator has no managed policies to attach"


class WizardOmittedShown(OmittedCase):
    """R3.3: an omitted step is shown by its navigation entry or its heading; an omitted section of a shown step
    is looked for on that step's tree."""

    def test_omitted_section_shown_on_its_step(self):
        r, body = self.wizard("wizard-full", SPECS / "wizard-omitted.yaml")
        self.assertShown(r, POLICIES, 'step 2: heading "Permissions policies"',
                         "the emulator has no managed policies to list")
        self.assertEqual(self.node_step(body, POLICIES), 2)

    def test_omitted_section_absent(self):
        r, _ = self.wizard("wizard-section-absent", SPECS / "wizard-omitted.yaml")
        self.assertTrue(r.text.splitlines()[0].endswith(" score=100.0 (15/15) omitted=1/16 verdict=pass"), r.text)

    def test_omitted_step_absent(self):
        r, _ = self.wizard("wizard-two-steps", OMIT_STEP)
        self.assertIn(" (13/13) omitted=3/16 verdict=pass", r.text.splitlines()[0])

    def test_omitted_step_in_the_navigation(self):
        r, _ = self.wizard("wizard-omitted-step-in-nav", OMIT_STEP)
        self.assertShown(r, f"steps[{T2}].title", 'step 1: button "Step 2: Add permissions"', ATTACH)
        self.assertStatus(r, {"steps.order": "matched"})

    def test_omitted_step_heading(self):
        r, _ = self.wizard("wizard-omitted-step-heading", OMIT_STEP)
        self.assertShown(r, f"steps[{T2}].title", 'step 2: heading "Add permissions"', ATTACH)

    def test_omitted_steps_section_not_looked_for(self):
        """Guard: passes on main."""
        r, _ = self.wizard("wizard-omitted-step-section", OMIT_STEP)
        self.assertEqual((r.verdict, r.reasons), ("pass", []), r.text)
        self.assertNotShown(r, POLICIES, ATTACH)

    def test_heading_claimed_by_a_scored_section(self):
        """Guard: passes on main (R3.2, third bullet)."""
        text = OMIT_STEP.read_text()
        old = f"  - title: {T3}\n"
        self.assertEqual(text.count(old), 1)
        spec = text.replace(old, old + "    sections:\n      - title: Add permissions\n")
        r, _ = self.wizard("wizard-omitted-step-heading", spec)
        self.assertStatus(r, {f"steps[{T3}].sections[Add permissions].title": "matched"})
        self.assertNotShown(r, f"steps[{T2}].title", ATTACH)


if __name__ == "__main__":
    unittest.main()
