"""pm-structure on saved snapshots: report, exit status, result files, --record, --table, and the archive.

Each case copies this checkout's .pm/bin (without tests/) into <checkout>/output/tests/records-<case>-<pid>/,
whose copied _pmlib.py takes that directory as its ROOT, so --record, --table and pm-archive write there and never
to the real .pm/. A fixture worktree with one git commit sits beside it as wt/. The directory is removed when the
case ends. Rows written directly by a case (for --table) have the fields of design 2.6.

The detail of a matched item that rests on more than one node (`table.pagination`: two buttons) is its first node
in document order, so text A shows `button "Previous page"`; `header.counter` shows the node `header.title`
matched.
"""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import unittest

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]
FIXTURES = HERE / "fixtures" / "structure"
SPECS = FIXTURES / "specs"
SNAPS = FIXTURES / "snapshots"
BUCKET_LIST = SPECS / "bucket-list.yaml"

MATCHED_FULL = [
    'breadcrumbs[Amazon S3]    link "Amazon S3"',
    'breadcrumbs[Buckets]    link "Buckets"',
    "breadcrumbs.order    in order",
    'header.title    heading "General purpose buckets (3)"',
    'header.counter    heading "General purpose buckets (3)"',
    'header.actions[Empty]    button "Empty"',
    'header.actions[Delete]    button "Delete"',
    'header.actions[Create bucket]    button "Create bucket"',
    "header.actions.order    in order",
    'header.primary_action    button "Create bucket"',
    'table.selection    radio "Select bucket-a"',
    'table.filter    searchbox "Find buckets by name"',
    'table.pagination    button "Previous page"',
    'table.columns[Name]    columnheader "Name"',
    'table.columns[AWS Region]    columnheader "AWS Region"',
    'table.columns[Creation date]    columnheader "Creation date"',
    "table.columns.order    in order",
]


def text_a(wt):
    return "\n".join([
        "structure s3.bucket-list state=seeded score=100.0 (17/17) verdict=pass",
        "requires also: state=empty",
        "unmatched (0)",
        "matched (17)",
        *("  " + m for m in MATCHED_FULL),
        "omitted (1)",
        "  header.actions[Copy ARN]    emulator returns 501 for the operation behind it",
        "not applicable (2)",
        "  table.empty.title    state=seeded",
        "  table.empty.action    state=seeded",
        "not scored (0)",
        "extra (0)",
        "blocked requests (0)",
        f"result: {wt}/output/structure/s3.bucket-list-seeded.json",
    ]) + "\n"


def text_b(wt):
    return "\n".join([
        "structure s3.bucket-list state=seeded score=94.1 (16/17) verdict=fail",
        "requires also: state=empty",
        "reason: critical item unmatched: table.columns[AWS Region]",
        "unmatched (1)",
        '  table.columns[AWS Region]    columnheader "AWS Region"',
        "matched (16)",
        *("  " + m for m in MATCHED_FULL if not m.startswith("table.columns[AWS Region]")),
        "omitted (1)",
        "  header.actions[Copy ARN]    emulator returns 501 for the operation behind it",
        "not applicable (2)",
        "  table.empty.title    state=seeded",
        "  table.empty.action    state=seeded",
        "not scored (0)",
        "extra (0)",
        "blocked requests (0)",
        f"result: {wt}/output/structure/s3.bucket-list-seeded.json",
    ]) + "\n"


FORM_SPEC = """\
screen: s3.create-bucket
service: s3
kind: form
route: /s3/buckets/create
header:
  title: Create bucket
sections:
  - title: General configuration
    fields:
      - label: Bucket name
        control: input
        required: true
        constraint: Bucket names must be unique
      - AWS Region
"""

ROW_FIELDS = {"point", "screen", "state", "score", "matched", "total", "verdict", "critical_unmatched", "requires",
              "commit", "dirty", "spec_sha256", "result"}


def clean_env(extra_path=None):
    """The caller's environment without git variables that would point git at another repository."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    if extra_path:
        env["PATH"] = f"{extra_path}{os.pathsep}{env.get('PATH', '')}"
    return env


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), "-c", "user.name=fixture", "-c", "user.email=fixture@localhost",
                           "-c", "commit.gpgsign=false", *args],
                          check=True, capture_output=True, text=True, env=clean_env()).stdout.strip()


class RecordsCase(unittest.TestCase):
    def setUp(self):
        self.root = CHECKOUT / "output" / "tests" / f"records-{self._testMethodName}-{os.getpid()}"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.addCleanup(shutil.rmtree, self.root, True)
        shutil.copytree(BIN, self.root / ".pm" / "bin", ignore=shutil.ignore_patterns("tests", "__pycache__"))
        self.bin = self.root / ".pm" / "bin"
        if not (self.bin / "pm-structure").exists():
            self.fail(f"pm-structure does not exist in {BIN}")
        self.wt = self.root / "wt"
        self.wt.mkdir()
        (self.wt / ".gitignore").write_text("output/\n")
        (self.wt / "README.md").write_text("fixture worktree\n")
        git(self.wt, "init", "-q")
        git(self.wt, "add", "-A")
        git(self.wt, "commit", "-q", "-m", "fixture")
        self.commit = git(self.wt, "rev-parse", "HEAD")
        self.out = self.wt / "output" / "structure"

    def structure(self, *args, wt=None, env=None):
        cmd = [str(self.bin / "pm-structure")]
        if args[:1] != ("--table",):
            cmd.append(str(wt or self.wt))
        cmd += [str(a) for a in args]
        return subprocess.run(cmd, capture_output=True, text=True, env=env or clean_env(), timeout=120)

    def snap(self, name):
        return SNAPS / f"{name}.json"

    def spec_file(self, text, name="spec.yaml"):
        p = self.root / name
        p.write_text(text)
        return p

    def result(self, state="seeded", screen="s3.bucket-list"):
        return json.loads((self.out / f"{screen}-{state}.json").read_text())

    def issue(self, n):
        d = self.root / ".pm" / f"issue-{n}"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def rows(self, n):
        return json.loads((self.root / ".pm" / f"issue-{n}" / "structure-scores.json").read_text())

    def assertExit(self, p, code):
        self.assertEqual(p.returncode, code, f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")

    def assertOneErrorLine(self, p, contains):
        lines = p.stderr.splitlines()
        self.assertEqual(len(lines), 1, p.stderr)
        self.assertTrue(lines[0].startswith("pm-structure: "), lines[0])
        self.assertIn(contains, lines[0])

    def assertUsage(self, p):
        self.assertExit(p, 2)
        self.assertIn("usage:", p.stderr)


def status_map(result):
    return {i["id"]: i["status"] for i in result["items"]}


class Snapshot(RecordsCase):
    def test_full_match_text_a_and_result_file(self):
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("full-seeded"))
        self.assertExit(p, 0)
        self.assertEqual(p.stdout, text_a(self.wt))
        r = self.result()
        self.assertEqual(r["verdict"], "pass")
        self.assertEqual(float(r["score"]), 100.0)
        self.assertEqual((r["matched"], r["total"]), (17, 17))
        statuses = status_map(r)
        self.assertEqual(len(statuses), 20)
        self.assertEqual(sum(1 for s in statuses.values() if s == "matched"), 17)
        self.assertEqual(statuses["header.actions[Copy ARN]"], "omitted")
        self.assertEqual(statuses["table.empty.title"], "not-applicable")
        self.assertEqual(statuses["table.empty.action"], "not-applicable")
        self.assertEqual(r["spec_sha256"], hashlib.sha256(BUCKET_LIST.read_bytes()).hexdigest())
        self.assertEqual(r["commit"], self.commit)
        self.assertIs(r["dirty"], False)

    def test_failing_snapshot_exit_1(self):
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("missing-aws-region"))
        self.assertExit(p, 1)
        self.assertEqual(self.result()["verdict"], "fail")

    def test_twice_is_identical(self):
        first = self.structure(BUCKET_LIST, "--snapshot", self.snap("full-seeded"))
        r1 = self.result()
        second = self.structure(BUCKET_LIST, "--snapshot", self.snap("full-seeded"))
        r2 = self.result()
        self.assertExit(first, 0)
        self.assertExit(second, 0)
        self.assertEqual(first.stdout.encode(), second.stdout.encode())
        self.assertIn("at", r1)
        r1.pop("at"), r2.pop("at")
        self.assertEqual(r1, r2)

    def test_spec_needing_both_states_says_so(self):
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("full-seeded"))
        self.assertExit(p, 0)
        self.assertEqual(p.stdout.splitlines()[1], "requires also: state=empty")
        self.assertEqual(set(self.result()["requires"]), {"seeded", "empty"})

    def test_state_empty_result_file(self):
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("empty-full"), "--state", "empty")
        self.assertExit(p, 0)
        r = self.result("empty")
        self.assertEqual(status_map(r)["table.empty.title"], "matched")
        self.assertEqual(status_map(r)["table.empty.action"], "matched")
        self.assertFalse((self.out / "s3.bucket-list-seeded.json").exists())

    def test_state_empty_text(self):
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("empty-full"), "--state", "empty")
        self.assertExit(p, 0)
        lines = p.stdout.splitlines()
        self.assertEqual(lines[0], "structure s3.bucket-list state=empty score=100.0 (18/18) verdict=pass")
        self.assertEqual(lines[1], "requires also: state=seeded")
        i = lines.index("not applicable (1)")
        self.assertEqual(lines[i + 1], "  table.selection    state=empty")
        self.assertEqual(lines[-1], f"result: {self.wt}/output/structure/s3.bucket-list-empty.json")

    def test_form_fields_not_scored_after_not_applicable(self):
        p = self.structure(self.spec_file(FORM_SPEC), "--snapshot", self.snap("form-fields"))
        self.assertExit(p, 0)
        lines = p.stdout.splitlines()
        na = next(i for i, ln in enumerate(lines) if ln.startswith("not applicable ("))
        ns = lines.index("not scored (3)")
        self.assertGreater(ns, na)
        scored = lines[ns + 1:ns + 4]
        self.assertTrue(all(ln.startswith("  ") and "Bucket name" in ln for ln in scored), scored)
        joined = "\n".join(scored)
        self.assertIn("control: input", joined)
        self.assertIn("required: ", joined)
        self.assertIn("constraint: Bucket names must be unique", joined)
        self.assertEqual(lines[ns + 4], "extra (0)")

    def test_unreadable_spec_or_yaml_error(self):
        bad = self.spec_file(BUCKET_LIST.read_text().replace("  title: General", "\ttitle: General"), "tab.yaml")
        for spec in (self.root / "missing.yaml", bad):
            with self.subTest(spec=spec.name):
                p = self.structure(spec, "--snapshot", self.snap("full-seeded"))
                self.assertExit(p, 2)
                self.assertOneErrorLine(p, f"spec {spec}")
                self.assertEqual(p.stdout, "")
                self.assertEqual(list(self.out.glob("*.json")) if self.out.exists() else [], [])

    def test_later_spec_error_writes_an_error_result(self):
        spec = self.spec_file(BUCKET_LIST.read_text() + "colour: blue\n")
        p = self.structure(spec, "--snapshot", self.snap("full-seeded"))
        self.assertExit(p, 2)
        path = self.out / "s3.bucket-list-seeded.json"
        self.assertEqual(p.stdout, f"result: {path}\n")
        self.assertOneErrorLine(p, "colour")
        r = json.loads(path.read_text())
        self.assertEqual(r["verdict"], "error")
        self.assertTrue(any(isinstance(v, str) and "colour" in v for v in r.values()), r)

    def test_not_a_snapshot(self):
        path = self.snap("bad-no-format")
        p = self.structure(BUCKET_LIST, "--snapshot", path)
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, f"cannot read snapshot {path}")

    def test_usage_errors(self):
        cases = {
            "no source": [BUCKET_LIST],
            "two sources": [BUCKET_LIST, "--snapshot", self.snap("full-seeded"), "--serve", self.root],
            "unknown state": [BUCKET_LIST, "--snapshot", self.snap("full-seeded"), "--state", "other"],
        }
        for name, args in cases.items():
            with self.subTest(case=name):
                self.assertUsage(self.structure(*args))

    def test_no_ax_json_for_a_snapshot_run(self):
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("full-seeded"))
        self.assertExit(p, 0)
        self.assertTrue((self.out / "s3.bucket-list-seeded.json").exists())
        self.assertEqual(list(self.out.glob("*.ax.json")), [])

    def test_commit_unreadable(self):
        nogit = self.root / "nogit"
        nogit.mkdir()
        (nogit / ".git").write_text("gitdir: ./missing-gitdir\n")  # git stops here instead of finding the checkout
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("full-seeded"), wt=nogit)
        self.assertExit(p, 0)
        r = json.loads((nogit / "output" / "structure" / "s3.bucket-list-seeded.json").read_text())
        self.assertIsNone(r["commit"])
        self.assertIsNone(r["dirty"])
        self.assertEqual(r["verdict"], "pass")

    def test_missing_aws_region_text_b(self):
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("missing-aws-region"))
        self.assertExit(p, 1)
        self.assertEqual(p.stdout, text_b(self.wt))


class Record(RecordsCase):
    def test_record_appends_one_row(self):
        self.issue(4)
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("full-seeded"), "--record", "4", "final")
        self.assertExit(p, 0)
        rows = self.rows(4)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertLessEqual(ROW_FIELDS, set(row))
        self.assertEqual((row["point"], row["screen"], row["state"], row["verdict"]),
                         ("final", "s3.bucket-list", "seeded", "pass"))
        self.assertEqual(float(row["score"]), 100.0)
        self.assertEqual((row["matched"], row["total"]), (17, 17))
        self.assertEqual(list(row["critical_unmatched"]), [])
        self.assertEqual(set(row["requires"]), {"seeded", "empty"})
        self.assertEqual(row["commit"], self.commit)
        self.assertIs(row["dirty"], False)
        self.assertEqual(row["spec_sha256"], hashlib.sha256(BUCKET_LIST.read_bytes()).hexdigest())
        self.assertEqual(pathlib.Path(row["result"]), self.out / "s3.bucket-list-seeded.json")

    def test_record_twice_two_rows(self):
        self.issue(4)
        for _ in range(2):
            self.assertExit(self.structure(BUCKET_LIST, "--snapshot", self.snap("missing-aws-region"),
                                           "--record", "4", "final"), 1)
        rows = self.rows(4)
        self.assertEqual(len(rows), 2)
        self.assertEqual([r["critical_unmatched"] for r in rows], [["table.columns[AWS Region]"]] * 2)

    def test_record_issue_folder_missing(self):
        p = self.structure(BUCKET_LIST, "--snapshot", self.snap("full-seeded"), "--record", "99", "final")
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, "no issue folder .pm/issue-99")
        self.assertTrue((self.out / "s3.bucket-list-seeded.json").exists())

    def test_record_usage_errors(self):
        self.issue(4)
        for issue, point in (("x", "final"), ("0", "final"), ("4", "mock")):
            with self.subTest(issue=issue, point=point):
                self.assertUsage(self.structure(BUCKET_LIST, "--snapshot", self.snap("full-seeded"),
                                                "--record", issue, point))
        self.assertFalse((self.root / ".pm" / "issue-4" / "structure-scores.json").exists())

    def test_record_error_row(self):
        self.issue(4)
        spec = self.spec_file(BUCKET_LIST.read_text() + "colour: blue\n")
        p = self.structure(spec, "--snapshot", self.snap("full-seeded"), "--record", "4", "final")
        self.assertExit(p, 2)
        rows = self.rows(4)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["verdict"], rows[0]["screen"], rows[0]["point"]), ("error", "s3.bucket-list", "final"))
        self.assertIsNone(rows[0]["score"])
        self.assertIsNone(rows[0]["matched"])
        self.assertIsNone(rows[0]["total"])


def row(state, verdict, requires=("seeded", "empty"), point="final", screen="s3.bucket-list", at="2026-11-15T10:00:00+09:00"):
    scored = verdict != "error"
    return {"point": point, "screen": screen, "state": state, "score": (100.0 if verdict == "pass" else 94.1) if scored else None,
            "matched": (17 if verdict == "pass" else 16) if scored else None, "total": 17 if scored else None,
            "verdict": verdict, "critical_unmatched": [] if verdict != "fail" else ["table.columns[AWS Region]"],
            "requires": list(requires), "commit": "0" * 40, "dirty": False, "spec_sha256": "a" * 64,
            "result": f"/x/output/structure/{screen}-{state}.json", "at": at}


class Table(RecordsCase):
    def table(self, rows):
        d = self.issue(4)
        (d / "structure-scores.json").write_text(json.dumps(rows, indent=1))
        p = self.structure("--table", "4")
        self.assertExit(p, 0)
        return p.stdout

    def point_line(self, out, point="final", screen="s3.bucket-list"):
        found = [ln for ln in out.splitlines() if ln.strip() and not ln.lstrip().startswith("|")
                 and point in ln and screen in ln]
        self.assertEqual(len(found), 1, out)
        return found[0]

    def assertPassed(self, line):
        self.assertTrue(line.rstrip().endswith("passed"), line)
        self.assertNotIn("not passed", line)

    def test_missing_state(self):
        line = self.point_line(self.table([row("seeded", "pass")]))
        self.assertIn("not passed (missing state=empty)", line)

    def test_both_states_passed(self):
        self.assertPassed(self.point_line(self.table([row("seeded", "pass"), row("empty", "pass")])))

    def test_latest_error_after_pass(self):
        line = self.point_line(self.table([row("seeded", "pass", ("seeded",)),
                                           row("seeded", "error", ("seeded",), at="2026-11-15T11:00:00+09:00")]))
        self.assertIn("not passed (state=seeded error)", line)

    def test_later_pass_after_fail(self):
        self.assertPassed(self.point_line(self.table([row("seeded", "fail"), row("empty", "pass"),
                                                      row("seeded", "pass", at="2026-11-15T11:00:00+09:00")])))

    def test_seeded_only_spec_passed(self):
        self.assertPassed(self.point_line(self.table([row("seeded", "pass", ("seeded",))])))

    def test_markdown_table(self):
        rows = [row("seeded", "fail"), row("seeded", "pass"), row("empty", "pass"),
                row("seeded", "pass", ("seeded",), point="baseline", screen="s3.ten-items")]
        out = self.table(rows)
        table = [ln.strip() for ln in out.splitlines() if ln.lstrip().startswith("|")]
        header = [c.strip() for c in table[0].strip("|").split("|")]
        self.assertEqual(header, ["point", "screen", "state", "score", "verdict", "critical unmatched", "commit"])
        self.assertTrue(set(table[1].replace("|", "").replace(" ", "")) <= set("-:"), table[1])
        self.assertEqual(len(table) - 2, len(rows), out)
        self.point_line(out, "baseline", "s3.ten-items")


class Archive(RecordsCase):
    def test_archive_keeps_structure_scores_and_writes_the_table(self):
        d = self.issue(99999)
        rows = [row("seeded", "pass"), row("empty", "pass")]
        (d / "structure-scores.json").write_text(json.dumps(rows, indent=1))
        stub = self.root / "stub-bin"
        stub.mkdir()
        calls = self.root / "herdr-calls.log"
        (stub / "herdr").write_text(f'#!/bin/sh\necho "$*" >> "{calls}"\n'
                                    'echo \'{"result": {"agents": [], "panes": [], "tabs": []}}\'\n')
        (stub / "herdr").chmod(0o755)
        env = clean_env(stub)
        table = self.structure("--table", "99999", env=env)
        self.assertExit(table, 0)
        p = subprocess.run([str(self.bin / "pm-archive"), "99999", "--yes", "--force"], capture_output=True,
                           text=True, env=env, timeout=120)
        self.assertExit(p, 0)
        kept = self.root / ".pm" / "archive" / "99999" / "structure-scores.json"
        self.assertEqual(json.loads(kept.read_text()), rows)
        summary = (self.root / ".pm" / "archive" / "99999.md").read_text()
        self.assertIn("## Structure scores\n", summary)
        section = summary.split("## Structure scores\n", 1)[1].split("\n## ", 1)[0]
        self.assertEqual(section.strip(), table.stdout.strip())
        seen = calls.read_text().splitlines() if calls.exists() else []
        self.assertEqual([c for c in seen if c.startswith(("pane close", "tab close", "agent prompt"))], [], seen)


class ArchiveGuide(unittest.TestCase):
    def test_archive_guide_keep_list_names_structure_scores(self):
        guide = (CHECKOUT / ".agents" / "skills" / "pm" / "references" / "archive.md").read_text()
        keep = guide.split("## Keep list", 1)[1].split("\n## ", 1)[0]
        self.assertIn("structure-scores.json", keep)


if __name__ == "__main__":
    unittest.main()
