"""_pmscore: snapshot reading, matching (R5.2), order items, extras (R5.6), score and pass line (R5.5).

Interface used (design 2.5): `_pmscore.load_snapshot(path)`, `_pmscore.score(spec, snapshot, state)` and
`_pmscore.render_text(result)`, the standard output of R3 for a scored run (the `result:` line may be left to the
command). The cases read that text, whose form R3 fixes, rather than the result's attributes. Each snapshot is a
file under fixtures/structure/snapshots/ named by its condition; spec variants written by a case go to
<checkout>/output/tests/score-<pid>/ and are removed when the case ends.
"""
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

FIRST = re.compile(r"^structure (\S+) state=(\S+) score=(\d+\.\d) \((\d+)/(\d+)\) verdict=(pass|fail)$")
GROUP = re.compile(r"^(unmatched|matched|omitted|not applicable|not scored|extra|blocked requests) \((\d+)\)$")


class Report:
    """The parts of an R3 report: first line fields, reason lines and the groups with their item lines."""

    def __init__(self, text):
        self.text = text
        lines = text.splitlines()
        m = FIRST.match(lines[0])
        if not m:
            raise AssertionError(f"first line {lines[0]!r} is not the R3 form")
        self.screen, self.state, self.score, matched, total, self.verdict = m.groups()
        self.matched, self.total = int(matched), int(total)
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

    def test_omitted_copy_arn_absent_or_present(self):
        absent = self.run_score("full-seeded")
        present = self.run_score("copy-arn-present")
        for r in (absent, present):
            self.assertEqual(r.total, 17)
            self.assertEqual(r.groups["omitted"],
                             ["header.actions[Copy ARN]    emulator returns 501 for the operation behind it"])
        self.assertEqual(present.groups["extra"], [])

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
        self.assertStatus(self.run_score("order-omitted-out-of-order"), {"header.actions.order": "matched"})


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

NOTHING = """\
screen: s3.nothing
service: s3
kind: table
route: /s3/nothing
header:
  title: Nothing
table:
  columns: [Name]
  empty:
    title: No things
omitted:
  - item: header.title
    reason: the emulator has no title for this view
  - item: table.columns
    reason: the emulator lists no columns for this view
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

    def test_nothing_to_score(self):
        spec = self.spec(NOTHING)
        snap = _pmscore.load_snapshot(str(SNAPS / "full-seeded.json"))
        with self.assertRaises(_pmspec.SpecError) as cm:
            _pmscore.score(spec, snap, "seeded")
        self.assertIn("nothing to score", str(cm.exception))


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


if __name__ == "__main__":
    unittest.main()
