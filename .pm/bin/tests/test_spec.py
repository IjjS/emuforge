"""_pmspec: the YAML subset reader, spec validation, the items of R5.1, omitted entries (R5.4) and states (R5.3).

Interface used (design 2.1): `_pmspec.load(path)` returns a Spec or raises `_pmspec.SpecError`.

- `spec.items`: the items in spec order; each has `id`, `name` (the expected accessible name, None for items that
  have none, such as order items), `list` (the list id it belongs to, or None) and `states` (the states it
  applies to, a collection of "seeded" and "empty");
- `spec.omitted`: one entry per `omitted` entry, with `path`, `reason` and `items` (the item ids it covers);
- `spec.not_scored`: `(spec path, key, value)` per form field key other than `label`;
- `spec.needs_states`: the states the spec needs to be scored in.

Each attribute may be an attribute or a mapping key. Spec texts written by a case go to
<checkout>/output/tests/spec-<pid>/ and are removed when the case ends.
"""
import os
import pathlib
import shutil
import unittest

try:
    import _pmspec
except ImportError as e:  # every case fails on its own when the module does not exist
    _pmspec, IMPORT_ERROR = None, e

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
FIXTURES = HERE / "fixtures" / "structure"
SPECS = FIXTURES / "specs"
WORK = CHECKOUT / "output" / "tests" / f"spec-{os.getpid()}"
MIB = 1024 * 1024

BASE = """\
screen: s3.bucket-list
service: s3
kind: table
route: /s3/buckets
header:
  title: General purpose buckets
table:
  columns: [Name, AWS Region]
"""

DETAIL = """\
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
  - title: Tags
    fields: [Key, Value]
"""


def get(obj, key):
    return obj[key] if isinstance(obj, dict) else getattr(obj, key)


def ids(spec):
    return [get(i, "id") for i in get(spec, "items")]


def item(spec, item_id):
    found = [i for i in get(spec, "items") if get(i, "id") == item_id]
    if len(found) != 1:
        raise AssertionError(f"{item_id} found {len(found)} times in {ids(spec)}")
    return found[0]


def omitted_ids(spec):
    return {i for e in get(spec, "omitted") for i in get(e, "items")}


def total(spec, state):
    gone = omitted_ids(spec)
    return sum(1 for i in get(spec, "items") if get(i, "id") not in gone and state in set(get(i, "states")))


class SpecCase(unittest.TestCase):
    def setUp(self):
        if _pmspec is None:
            self.fail(f"_pmspec cannot be imported: {IMPORT_ERROR}")
        WORK.mkdir(parents=True, exist_ok=True)
        self.addCleanup(shutil.rmtree, WORK, True)
        self.n = 0

    def write(self, text, name=None):
        self.n += 1
        p = WORK / (name or f"{self._testMethodName}-{self.n}.yaml")
        p.write_text(text)
        return p

    def load_text(self, text):
        return _pmspec.load(str(self.write(text)))

    def refused(self, text, line=None, contains=()):
        """Assert that `text` is refused with `spec <path>:<line>:` (or `spec <path>`), naming `contains`."""
        p = self.write(text)
        with self.assertRaises(_pmspec.SpecError) as cm:
            _pmspec.load(str(p))
        msg = str(cm.exception)
        prefix = f"spec {p}:{line}:" if line is not None else f"spec {p}"
        self.assertTrue(msg.startswith(prefix), f"{msg!r} does not start with {prefix!r}")
        for c in contains:
            self.assertIn(c, msg)
        return msg


class BucketList(SpecCase):
    def test_bucket_list_items_states_omitted_and_totals(self):
        spec = _pmspec.load(str(SPECS / "bucket-list.yaml"))
        self.assertEqual(ids(spec), [
            "breadcrumbs[Amazon S3]", "breadcrumbs[Buckets]", "breadcrumbs.order", "header.title", "header.counter",
            "header.actions[Copy ARN]", "header.actions[Empty]", "header.actions[Delete]",
            "header.actions[Create bucket]", "header.actions.order", "header.primary_action", "table.selection",
            "table.filter", "table.pagination", "table.columns[Name]", "table.columns[AWS Region]",
            "table.columns[Creation date]", "table.columns.order", "table.empty.title", "table.empty.action"])
        self.assertEqual(set(get(item(spec, "table.empty.title"), "states")), {"empty"})
        self.assertEqual(set(get(item(spec, "table.empty.action"), "states")), {"empty"})
        self.assertEqual(set(get(item(spec, "table.selection"), "states")), {"seeded"})
        for i in get(spec, "items"):
            if get(i, "id") not in ("table.empty.title", "table.empty.action", "table.selection"):
                self.assertEqual(set(get(i, "states")), {"seeded", "empty"}, get(i, "id"))
        entries = get(spec, "omitted")
        self.assertEqual(len(entries), 1)
        self.assertEqual(list(get(entries[0], "items")), ["header.actions[Copy ARN]"])
        self.assertEqual(get(entries[0], "reason"), "emulator returns 501 for the operation behind it")
        self.assertEqual(total(spec, "seeded"), 17)
        self.assertEqual(total(spec, "empty"), 18)


class Syntax(SpecCase):
    def test_flow_and_block_sequences_give_the_same_items(self):
        flow = self.load_text(BASE)
        block = self.load_text(BASE.replace("  columns: [Name, AWS Region]\n",
                                            "  columns:\n    - Name\n    - AWS Region\n"))
        self.assertEqual(ids(flow), ids(block))
        self.assertIn("table.columns[AWS Region]", ids(block))

    def test_quoted_scalars_are_unescaped(self):
        single = self.load_text(BASE.replace("title: General purpose buckets", "title: 'It''s here'"))
        self.assertEqual(get(item(single, "header.title"), "name"), "It's here")
        double = self.load_text(BASE.replace("title: General purpose buckets", 'title: "Say \\"hi\\""'))
        self.assertEqual(get(item(double, "header.title"), "name"), 'Say "hi"')

    def test_comment_dropped_and_quoted_hash_kept(self):
        spec = self.load_text(BASE.replace("title: General purpose buckets", "title: General purpose buckets   # c")
                              .replace("columns: [Name, AWS Region]", 'columns: ["Name #1", AWS Region]  # c'))
        self.assertEqual(get(item(spec, "header.title"), "name"), "General purpose buckets")
        self.assertIn("table.columns[Name #1]", ids(spec))
        self.assertEqual(get(item(spec, "table.columns[Name #1]"), "name"), "Name #1")

    def test_one_leading_document_marker_loads(self):
        self.assertEqual(ids(self.load_text("---\n" + BASE)), ids(self.load_text(BASE)))


# One case per refused construct of D2.1: (name, spec text, line the error names).
REFUSED = [
    ("tab_indentation", BASE.replace("  title: General", "\ttitle: General"), 6),
    ("anchor", BASE.replace("title: General purpose buckets", "title: &t General purpose buckets"), 6),
    ("alias", BASE.replace("service: s3", "service: *svc"), 2),
    ("tag", BASE.replace("service: s3", "service: !str s3"), 2),
    ("literal_block_scalar", BASE.replace("  title: General purpose buckets\n",
                                          "  title: |\n    General purpose buckets\n"), 6),
    ("folded_block_scalar", BASE.replace("  title: General purpose buckets\n",
                                         "  title: >\n    General purpose buckets\n"), 6),
    ("flow_map", BASE.replace("table:\n  columns: [Name, AWS Region]\n", "table: {columns: [Name]}\n"), 7),
    ("complex_key", BASE.replace("route: /s3/buckets\n", "? route\n: /s3/buckets\n"), 4),
    ("second_document", BASE + "---\nscreen: s3.other\n", 9),
    ("document_end", BASE + "...\n", 9),
    ("continued_plain_scalar", BASE.replace("  title: General purpose buckets\n",
                                            "  title: General purpose\n    buckets\n"), 7),
    ("inconsistent_indentation", BASE.replace("  title: General purpose buckets\n",
                                              "    title: General purpose buckets\n  counter: true\n"), 7),
    ("unterminated_quote", BASE.replace("title: General purpose buckets", 'title: "General purpose buckets'), 6),
    ("unterminated_flow_sequence", BASE.replace("columns: [Name, AWS Region]", "columns: [Name, AWS Region"), 8),
]


def _refused_case(text, line):
    def test(self):
        self.refused(text, line)
    return test


class Refused(SpecCase):
    pass


for _name, _text, _line in REFUSED:
    setattr(Refused, f"test_refused_{_name}", _refused_case(_text, _line))


class PlainScalars(SpecCase):
    def title_refused_then_quoted(self, value):
        with self.subTest(value=value):
            self.refused(BASE.replace("title: General purpose buckets", f"title: {value}"), 6)
            quoted = '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
            spec = self.load_text(BASE.replace("title: General purpose buckets", f"title: {quoted}"))
            self.assertEqual(get(item(spec, "header.title"), "name"), value)

    def test_colon_space_trailing_colon_and_leading_indicator(self):
        for value in ("General: purpose", "General purpose:", "%Total", "@home", "`code`", ",comma", "]x", "}x",
                      ":x", "-x", "?x"):
            self.title_refused_then_quoted(value)

    def test_words_yaml_does_not_read_as_strings(self):
        for value in ("null", "~", "True", "yes", "off", "n", "12", "1.5", ".inf", "0x1f"):
            self.title_refused_then_quoted(value)

    def test_flow_sequence_quoted_comma_and_bracket_unquoted_bracket(self):
        spec = self.load_text(BASE.replace("columns: [Name, AWS Region]", 'columns: ["Name, Region", "[x]"]'))
        self.assertEqual([get(i, "name") for i in get(spec, "items") if get(i, "id").startswith("table.columns[")],
                         ["Name, Region", "[x]"])
        self.refused(BASE.replace("columns: [Name, AWS Region]", "columns: [Name, a]b]"), 8)


class Validation(SpecCase):
    def test_duplicate_key(self):
        self.refused(BASE.replace("  title: General purpose buckets\n",
                                  "  title: General purpose buckets\n  title: Buckets\n"), 7, ("title",))

    def test_unknown_key_top_level(self):
        self.refused(BASE + "colour: blue\n", contains=("colour",))

    def test_unknown_key_header(self):
        self.refused(BASE.replace("  title: General purpose buckets\n",
                                  "  title: General purpose buckets\n  subtitle: All\n"), contains=("subtitle",))

    def test_unknown_key_table(self):
        self.refused(BASE + "  sorting: name\n", contains=("sorting",))

    def test_unknown_key_table_empty(self):
        self.refused(BASE + "  empty:\n    title: No buckets\n    icon: bucket\n", contains=("icon",))

    def test_unknown_key_section(self):
        self.refused(DETAIL.replace("  - title: Tags\n", "  - title: Tags\n    note: later\n"), contains=("note",))

    def test_unknown_key_field(self):
        self.refused(DETAIL.replace("    fields: [Key, Value]\n",
                                    "    fields:\n      - label: Key\n        hint: a key\n"), contains=("hint",))

    def test_unknown_key_omitted_entry(self):
        self.refused(BASE + "omitted:\n  - item: table.columns[Name]\n    reason: not shown\n    by: me\n",
                     contains=("by",))

    def _missing(self, line, key):
        self.refused(BASE.replace(line, ""), contains=(key,))

    def test_missing_screen(self):
        self._missing("screen: s3.bucket-list\n", "screen")

    def test_missing_kind(self):
        self._missing("kind: table\n", "kind")

    def test_missing_route(self):
        self._missing("route: /s3/buckets\n", "route")

    def test_missing_header_title(self):
        self.refused(BASE.replace("  title: General purpose buckets\n", "  counter: true\n"), contains=("title",))

    def test_invalid_screen(self):
        for value in ('"S3.Buckets"', "s3", "../x.y", "s3.bucket list"):
            with self.subTest(screen=value):
                self.refused(BASE.replace("screen: s3.bucket-list", f"screen: {value}"), contains=("screen",))

    def test_table_without_columns_or_empty_columns(self):
        self.refused(BASE.replace("  columns: [Name, AWS Region]\n", "  filter: text\n"), contains=("columns",))
        self.refused(BASE.replace("columns: [Name, AWS Region]", "columns: []"), contains=("columns",))

    def test_primary_action_not_in_actions(self):
        self.refused(BASE.replace("  title: General purpose buckets\n",
                                  "  title: General purpose buckets\n  actions: [Delete]\n"
                                  "  primary_action: Create bucket\n"), contains=("primary_action",))

    def test_duplicate_name_in_one_list(self):
        self.refused(BASE.replace("columns: [Name, AWS Region]", "columns: [Name, Name]"),
                     contains=("columns", "Name"))

    def test_enum_and_type_errors(self):
        cases = [
            ("selection", BASE + "  selection: double\n"),
            ("filter", BASE + "  filter: fuzzy\n"),
            ("kind", BASE.replace("kind: table", "kind: list")),
            ("counter", BASE.replace("  title: General purpose buckets\n",
                                     '  title: General purpose buckets\n  counter: "yes"\n')),
            ("pagination", BASE + '  pagination: "true"\n'),
        ]
        for key, text in cases:
            with self.subTest(key=key):
                self.refused(text, contains=(key,))

    def test_wizard_dashboard_and_steps_are_not_supported(self):
        for text in (BASE.replace("kind: table", "kind: wizard"), BASE.replace("kind: table", "kind: dashboard"),
                     BASE + "steps: [Choose, Review]\n"):
            with self.subTest(text=text.splitlines()[2] if "steps" not in text else "steps"):
                msg = self.refused(text)
                self.assertTrue(msg.endswith("is not supported"), msg)


FORM = """\
screen: s3.create-bucket
service: s3
kind: form
route: /s3/buckets/create
header:
  title: Create bucket
sections:
  - title: General configuration
    fields:
{field}
"""


class FieldsAndFlags(SpecCase):
    def test_plain_label_and_label_mapping_give_the_same_item(self):
        plain = self.load_text(FORM.format(field="      - Bucket name"))
        mapping = self.load_text(FORM.format(field="      - label: Bucket name\n        control: input\n"
                                                   "        required: true\n"
                                                   "        constraint: Bucket names must be unique"))
        self.assertEqual(ids(plain), ids(mapping))
        field = "sections[General configuration].fields[Bucket name]"
        self.assertIn(field, ids(mapping))
        self.assertEqual(get(item(mapping, field), "name"), "Bucket name")
        self.assertEqual(list(get(plain, "not_scored")), [])
        rows = list(get(mapping, "not_scored"))
        self.assertEqual(sorted((k, v) for _, k, v in rows),
                         [("constraint", "Bucket names must be unique"), ("control", "input"), ("required", True)])
        for path, _, _ in rows:
            self.assertIn("Bucket name", path)

    def test_field_as_flow_map_is_refused(self):
        self.refused(FORM.format(field="      - {label: Bucket name}"), 10)

    def test_counter_and_pagination_false_add_no_item_true_adds_one(self):
        off = self.load_text(BASE.replace("  title: General purpose buckets\n",
                                          "  title: General purpose buckets\n  counter: false\n")
                             + "  pagination: false\n")
        self.assertNotIn("header.counter", ids(off))
        self.assertNotIn("table.pagination", ids(off))
        on = self.load_text(BASE.replace("  title: General purpose buckets\n",
                                         "  title: General purpose buckets\n  counter: true\n")
                            + "  pagination: true\n")
        self.assertEqual(ids(on).count("header.counter"), 1)
        self.assertEqual(ids(on).count("table.pagination"), 1)
        self.assertEqual(len(ids(on)), len(ids(off)) + 2)

    def test_detail_tabs_and_sections(self):
        self.assertEqual(ids(self.load_text(DETAIL)), [
            "header.title", "tabs[Objects]", "tabs[Properties]", "tabs.order",
            "sections[General configuration].title", "sections[General configuration].fields[Bucket name]",
            "sections[General configuration].fields[AWS Region]", "sections[General configuration].fields.order",
            "sections[Tags].title", "sections[Tags].fields[Key]", "sections[Tags].fields[Value]",
            "sections[Tags].fields.order", "sections.order"])


class Files(SpecCase):
    def padded(self, size):
        """BASE followed by comment lines, `size` bytes in all."""
        filler = size - len(BASE.encode())
        lines = ["#" + "x" * 998 + "\n"] * (filler // 1000)
        rest = filler % 1000
        if rest:
            lines[0] = "#" + "x" * (998 + rest) + "\n"
        return BASE + "".join(lines)

    def test_size_limit(self):
        exact = self.write(self.padded(MIB), "exact.yaml")
        self.assertEqual(exact.stat().st_size, MIB)
        self.assertIn("header.title", ids(_pmspec.load(str(exact))))
        over = self.write(self.padded(MIB + 1), "over.yaml")
        self.assertEqual(over.stat().st_size, MIB + 1)
        with self.assertRaises(_pmspec.SpecError) as cm:
            _pmspec.load(str(over))
        self.assertIn(str(over), str(cm.exception))

    def test_missing_path_or_directory(self):
        for p in (WORK / "missing.yaml", WORK):
            with self.subTest(path=str(p)):
                with self.assertRaises(_pmspec.SpecError) as cm:
                    _pmspec.load(str(p))
                self.assertIn(f"cannot read spec {p}", str(cm.exception))


DETAIL_OMIT = DETAIL + "omitted:\n  - item: {path}\n    reason: {reason}\n"


class Omitted(SpecCase):
    def test_list_element_is_the_only_item_omitted(self):
        spec = _pmspec.load(str(SPECS / "bucket-list.yaml"))
        self.assertEqual(omitted_ids(spec), {"header.actions[Copy ARN]"})
        self.assertNotIn("header.actions.order", omitted_ids(spec))
        self.assertEqual(get(item(spec, "header.actions[Copy ARN]"), "list"), "header.actions")

    def test_list_element_is_left_out_of_the_order(self):
        """Observed through the scorer: Copy ARN after Create bucket does not break header.actions.order."""
        import _pmscore
        spec = _pmspec.load(str(SPECS / "bucket-list.yaml"))
        snap = _pmscore.load_snapshot(str(FIXTURES / "snapshots" / "order-omitted-out-of-order.json"))
        text = _pmscore.render_text(_pmscore.score(spec, snap, "seeded"))
        self.assertIn("  header.actions.order    in order", text.splitlines())

    def test_block_list_and_section(self):
        cases = {
            "table.pagination": (BASE + "  pagination: true\n" + "omitted:\n  - item: table.pagination\n"
                                 "    reason: the emulator lists every bucket in one page\n",
                                 {"table.pagination"}),
            "tabs": (DETAIL_OMIT.format(path="tabs", reason="the emulator has no objects view"),
                     {"tabs[Objects]", "tabs[Properties]", "tabs.order"}),
            "sections[General configuration]": (
                DETAIL_OMIT.format(path="sections[General configuration]", reason="no meaning without an account"),
                {"sections[General configuration].title", "sections[General configuration].fields[Bucket name]",
                 "sections[General configuration].fields[AWS Region]",
                 "sections[General configuration].fields.order"}),
        }
        for path, (text, expected) in cases.items():
            with self.subTest(path=path):
                spec = self.load_text(text)
                self.assertEqual(omitted_ids(spec), expected)
                entry = get(spec, "omitted")[0]
                self.assertEqual(get(entry, "path"), path)

    def test_path_naming_nothing(self):
        self.refused(DETAIL_OMIT.format(path="table.columns[Owner]", reason="not shown"),
                     contains=("omitted table.columns[Owner]:",))

    def test_reason_missing_or_blank(self):
        missing = DETAIL + "omitted:\n  - item: tabs\n"
        blank = DETAIL_OMIT.format(path="tabs", reason='"   "')
        for text in (missing, blank):
            with self.subTest(text=text.splitlines()[-1]):
                self.refused(text, contains=("omitted tabs:",))


class States(SpecCase):
    def test_needs_states(self):
        cases = [
            (BASE + "  empty:\n    title: No buckets\n", {"seeded", "empty"}),
            (BASE + "  selection: single\n", {"seeded", "empty"}),
            (BASE + "  selection: multi\n", {"seeded", "empty"}),
            (BASE + "  selection: none\n", {"seeded"}),
            (BASE, {"seeded"}),
        ]
        for text, states in cases:
            with self.subTest(states=states, text=text.splitlines()[-1]):
                self.assertEqual(set(get(self.load_text(text), "needs_states")), states)

    def test_items_per_state(self):
        spec = self.load_text(BASE + "  selection: single\n  empty:\n    title: No buckets\n"
                                     "    action: Create bucket\n")
        for i in ("table.empty.title", "table.empty.action"):
            self.assertNotIn("seeded", set(get(item(spec, i), "states")), i)
            self.assertIn("empty", set(get(item(spec, i), "states")), i)
        self.assertIn("seeded", set(get(item(spec, "table.selection"), "states")))
        self.assertNotIn("empty", set(get(item(spec, "table.selection"), "states")))
        multi = self.load_text(BASE + "  selection: multi\n")
        self.assertEqual(set(get(item(multi, "table.selection"), "states")), {"seeded"})
        none = self.load_text(BASE + "  selection: none\n")
        self.assertEqual(set(get(item(none, "table.selection"), "states")), {"seeded", "empty"})


if __name__ == "__main__":
    unittest.main()
