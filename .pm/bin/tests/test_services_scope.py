"""The selection of the touched services: `_pmscope.select`, the services line and `--push` of `pm-scope`, the
services file and the record of `pm-check`, and the comparison of `pm-merge` (issue 327, requirement R2, R3,
R4.5 to R4.7, R5.1, R5.2; test criteria `test_services_scope`).

Check id `harness.services-scope`. One class per heading of the test criteria.

`M` is the test's own manifest of eight rows (the table of the test criteria): `engine.tagged-r`,
`studio.alpha-one` and `studio.alpha-two` (labelled `on-request`) have the service `alpha`, `studio.beta-one` the
service `beta`, `studio.odd-c` the number 7 (a check of no service), and `engine.plain-a`, `studio.plain-b` and
`studio.beta-plain` none. `S` is `studio/src/providers/aws/area/services/`.

- `Select` calls `_pmscope.select(paths, head=..., base=...)` with the text of `M` for both manifests unless the
  case names others; the answer is the services object `{all, names, why}`.
- `Scope` runs the fixture's own `pm-scope` (see `_fixture.py`) on a git repository whose `main` holds `M` and
  one file at each path of `M`; "a branch with <paths>" is a branch from `main` with one commit of those paths.
- `Check` is `CheckCase` of `test_check_issue.py` under <checkout>/output/tests/services-check/, its `main`
  holding `M` and its files, with an integration stand-in of its own (`STANDIN`): it records each start with its
  arguments in <worktree>/output/ran, does what the n-th entry of <worktree>/output/integration.json says, and
  writes a `report.json` for the commit whose `services` is the sorted list its `--services` file gave (null
  without the option); with a list, a row whose `service` is a string not in it is `not-run`. A stand-in `bun`
  that exits 0 is first on PATH, so a branch that adds `studio/package.json` runs no real Studio step.
- `Merge` uses the unit of `test_merge_scope.py` (W on `feat/7-h1`, registered, with a passing impl review) in a
  fixture whose `main` holds `M` and its files, with a record written by the case: engine and Studio absent, the
  integration step passed with the `services` the case gives, the harness step passed, and `scope` with or
  without `services`. The issue-branch cases use `IssueCase` of `test_issue_branch.py`, its `main` holding `M`.

On a checkout without the change every case fails on its own, not at import: `_pmscope.select` and
`pm-scope --push` do not exist, `pm-scope` prints no services line, `pm-check` starts the integration step
without `--services` and records no `services`, and `pm-merge` does not compare a record's services with the
branch's. The cases whose name says `guard` hold a behavior of today and pass there already.
"""
import json
import pathlib
import re
import shutil
import unittest

from _fixture import git, make, run
from test_check_issue import CheckCase
from test_issue_branch import IssueCase
from test_merge_scope import merge as merge_in, unit as merge_unit
from test_scope import branch, commit, write

try:
    import _pmscope
except ImportError as e:  # every case fails on its own when the module does not exist
    _pmscope, IMPORT_ERROR = None, e

S = "studio/src/providers/aws/area/services/"
MANIFEST = "tests/integration/manifest.jsonl"
ISSUE = "issues/things-that-do-not-work/a.md"
LINE = "  services     "  # the services line of R4.5, up to its answer
SCRIPTS = ("pm-scope", "pm-check", "pm-merge", "pm-emulator-dir", "_pmlib.py", "_pmscope.py")
NONE = object()  # a row without the key `service`

ROWS = (  # check_id, path, service, labels
    ("engine.plain-a", "tests/integration/engine/tests/a.rs", NONE, []),
    ("engine.tagged-r", "tests/integration/engine/tests/r.rs", "alpha", []),
    ("studio.plain-b", "tests/integration/studio/b.spec.ts", NONE, []),
    ("studio.alpha-one", "tests/integration/studio/alpha-one.spec.ts", "alpha", []),
    ("studio.alpha-two", "tests/integration/studio/alpha-two.spec.ts", "alpha", ["on-request"]),
    ("studio.beta-one", "tests/integration/studio/beta.spec.ts", "beta", []),
    ("studio.beta-plain", "tests/integration/studio/beta.spec.ts", NONE, []),
    ("studio.odd-c", "tests/integration/studio/c.spec.ts", 7, []),
)
PATHS = sorted({r[1] for r in ROWS})


def rows_text(rows):
    out = []
    for cid, path, service, labels in rows:
        row = dict(check_id=cid, path=path, module=cid.split(".")[0], operations=[], labels=list(labels))
        if service is not NONE:
            row["service"] = service
        out.append(json.dumps(row) + "\n")
    return "".join(out)


def changed(**by_id):
    """`M` with the rows named given another service (NONE takes it away) or, as a tuple, other labels."""
    rows = []
    for cid, path, service, labels in ROWS:
        if cid in by_id:
            v = by_id[cid]
            if isinstance(v, tuple):
                labels = list(v)
            else:
                service = v
        rows.append((cid, path, service, labels))
    return rows_text(rows)


M = rows_text(ROWS)
NEW_ALPHA = ("studio.alpha-three", "tests/integration/studio/alpha-three.spec.ts", "alpha", [])
NEW_PLAIN = ("studio.plain-new", "tests/integration/studio/new.spec.ts", NONE, [])


def m_files():
    """`M` and one file at each of its paths."""
    return {MANIFEST: M, **{p: f"{p}\n" for p in PATHS}}


# ---------------------------------------------------------------------------------------------------- R2

class Select(unittest.TestCase):
    def select(self, paths, head=M, base=M):
        if _pmscope is None:
            raise IMPORT_ERROR
        fn = getattr(_pmscope, "select", None)
        if fn is None:
            self.fail("_pmscope has no function select")
        return fn(list(paths), head=head, base=base)

    def assertNames(self, paths, names, **kw):
        r = self.select(paths, **kw)
        self.assertIs(r["all"], False, r)
        self.assertEqual(r["names"], names, r)
        return r

    def assertAll(self, paths, named=None, **kw):
        r = self.select(paths, **kw)
        self.assertIs(r["all"], True, r)
        self.assertIsInstance(r["why"], str, r)
        self.assertTrue(r["why"], r)
        if named:
            self.assertIn(named, r["why"])
        return r

    # Given select(paths, M, M)

    def test_a_service_folder_and_a_file_of_its_checks_give_the_service(self):
        for path in (S + "alpha/pages/a.tsx", "studio/references/console/alpha/list.yaml",
                     "tests/integration/studio/alpha-one.spec.ts"):
            with self.subTest(path):
                self.assertNames([path], ["alpha"])

    def test_a_file_of_checks_gives_the_services_its_rows_name(self):
        with self.subTest("beta.spec.ts"):
            self.assertNames(["tests/integration/studio/beta.spec.ts"], ["beta"])
        with self.subTest("b.spec.ts"):
            self.assertNames(["tests/integration/studio/b.spec.ts"], [])

    def test_a_folder_no_row_names_is_still_its_own_service(self):
        self.assertNames([S + "alpha/a.ts", S + "gamma/a.ts"], ["alpha", "gamma"])

    def test_a_folder_segment_not_of_the_form_gives_every_service(self):
        for path in (S + "index.ts", S + "Alpha/a.ts", S + "a_b/a.ts"):
            with self.subTest(path):
                self.assertAll([path])

    def test_unit_tests_issue_files_and_guides_give_nothing(self):
        for path in ("studio/src/app/routes.test.tsx", "studio/src/lib/aws/x.test.ts", ISSUE,
                     ".agents/skills/pm/SKILL.md", "studio/references/workflow.md"):
            with self.subTest(path):
                self.assertNames([path], [])

    def test_a_shared_path_gives_every_service_and_is_named(self):
        for path in ("engine/crates/x/src/lib.rs", "studio/src/lib/aws/client-factory.ts",
                     "studio/src/providers/aws/area/screens.ts", "studio/package.json", "tests/integration/run",
                     "tests/integration/studio/support/alpha.ts", "tests/integration/studio/support/index.ts",
                     ".github/workflows/main.yml", ".pm/bin/pm-check", "LICENSE", "studio/src/app/routes.testing.ts"):
            with self.subTest(path):
                self.assertAll([path], named=path)

    def test_one_shared_path_is_enough(self):
        self.assertAll([S + "alpha/a.ts", "studio/package.json"])

    def test_no_path_gives_no_service(self):
        self.assertNames([], [])

    def test_a_head_manifest_that_cannot_be_read_gives_every_service(self):
        with self.subTest("None"):
            self.assertAll([S + "alpha/a.ts"], head=None)
        with self.subTest("not JSON"):
            self.assertAll([S + "alpha/a.ts"], head=M + "this is not JSON\n")

    # Given paths that hold the manifest (line 3)

    def test_a_label_changed_gives_nothing(self):
        self.assertNames([MANIFEST], [], head=changed(**{"studio.plain-b": ("lifecycle",)}))

    def test_a_service_given_taken_away_or_changed_gives_every_service(self):
        for cid, service in (("studio.plain-b", "beta"), ("studio.beta-one", NONE), ("studio.alpha-one", "beta")):
            with self.subTest(cid):
                self.assertAll([MANIFEST], named=cid, head=changed(**{cid: service}))

    def test_a_new_row_with_a_service(self):
        head = rows_text(ROWS + (NEW_ALPHA,))
        with self.subTest("its file changed"):
            self.assertNames([MANIFEST, NEW_ALPHA[1]], ["alpha"], head=head)
        with self.subTest("its file did not change"):
            self.assertAll([MANIFEST], head=head)

    def test_a_new_row_without_a_service(self):
        r = self.select([MANIFEST], head=rows_text(ROWS + (NEW_PLAIN,)))
        self.assertIs(r["all"], False, r)

    def test_no_manifest_at_the_base(self):
        r = self.select([MANIFEST, *PATHS], base="")
        self.assertIs(r["all"], False, r)

    def test_a_base_manifest_that_cannot_be_read_gives_every_service(self):
        with self.subTest("None"):
            self.assertAll([MANIFEST], base=None)
        with self.subTest("not JSON"):
            self.assertAll([MANIFEST], base="this is not JSON\n")


# ---------------------------------------------------------------------------------------------------- R4.5, R5

def services_lines(text):
    return [ln for ln in text.splitlines() if ln.startswith(LINE)]


class Scope(unittest.TestCase):
    def fixture(self, case):
        return make("services-scope", case, SCRIPTS, m_files())

    def scope(self, co, *args):
        p = run(co, "pm-scope", co, *args)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        return p

    def json(self, co, *args):
        return json.loads(self.scope(co, *args, "--json").stdout)

    def services_line(self, p):
        found = services_lines(p.stdout)
        self.assertEqual(len(found), 1, p.stdout)
        return found[0]

    def test_a_service_path_names_the_service(self):
        co = self.fixture("alpha")
        branch(co, [S + "alpha/a.ts"])
        p = self.scope(co)
        lines = p.stdout.splitlines()
        line = self.services_line(p)
        self.assertTrue(line.startswith(LINE + "alpha"), line)
        modules = [i for i, ln in enumerate(lines)
                   if re.match(r"  (engine|studio|integration|harness) ", ln)]
        self.assertTrue(modules, p.stdout)
        self.assertGreater(lines.index(line), max(modules), p.stdout)
        sv = self.json(co)["services"]
        self.assertIs(sv["all"], False, sv)
        self.assertEqual(sv["names"], ["alpha"], sv)
        self.assertTrue(sv.get("why"), sv)

    def test_a_shared_path_says_every_service_and_names_it(self):
        co = self.fixture("shared")
        branch(co, [S + "alpha/a.ts", "studio/package.json"])
        line = self.services_line(self.scope(co))
        self.assertTrue(line.startswith(LINE + "every service:"), line)
        self.assertIn("studio/package.json", line)

    def test_a_service_given_in_the_commit_says_every_service(self):
        co = self.fixture("tagged")
        git(co, "checkout", "-q", "-b", "feat/x")
        write(co, MANIFEST, changed(**{"studio.plain-b": "beta"}))
        git(co, "add", "-A")
        git(co, "commit", "-q", "-m", "tag")
        line = self.services_line(self.scope(co))
        self.assertTrue(line.startswith(LINE + "every service"), line)

    def test_the_work_trees_manifest_is_read(self):
        co = self.fixture("work-tree")
        branch(co, [S + "alpha/a.ts"])
        write(co, MANIFEST, changed(**{"studio.plain-b": "beta"}))
        line = self.services_line(self.scope(co))
        self.assertTrue(line.startswith(LINE + "every service"), line)

    def test_guard_no_services_line_without_integration(self):
        co = self.fixture("harness-only")
        branch(co, [".pm/bin/a"])
        p = self.scope(co)
        self.assertFalse([ln for ln in p.stdout.splitlines() if "services" in ln], p.stdout)

    def test_json_holds_services_without_integration(self):
        co = self.fixture("harness-only-json")
        branch(co, [".pm/bin/a"])
        self.assertIn("services", self.json(co))

    def test_main_says_every_service(self):
        co = self.fixture("main")
        line = self.services_line(self.scope(co))
        self.assertTrue(line.startswith(LINE + "every service"), line)

    # --push <before> <after> (R5.1, R5.2)

    def test_push_names_the_service_of_its_commit(self):
        co = self.fixture("push")
        before = git(co, "rev-parse", "main")
        commit(co, [S + "beta/a.ts"])
        after = git(co, "rev-parse", "main")
        p = self.scope(co, "--push", before, after)
        lines = p.stdout.splitlines()
        self.assertEqual(len(lines), 1, p.stdout)
        self.assertTrue(lines[0].startswith(LINE + "beta"), p.stdout)
        answer = self.json(co, "--push", before, after)
        self.assertEqual(answer["services"]["names"], ["beta"], answer)
        self.assertEqual(answer["paths"], 1, answer)
        self.assertEqual(answer["line"], lines[0], answer)

    def test_push_counts_every_commit(self):
        co = self.fixture("push-two")
        before = git(co, "rev-parse", "main")
        commit(co, [S + "alpha/a.ts"])
        commit(co, [ISSUE])
        answer = self.json(co, "--push", before, git(co, "rev-parse", "main"))
        self.assertIs(answer["services"]["all"], False, answer)
        self.assertEqual(answer["services"]["names"], ["alpha"], answer)

    def test_push_without_a_usable_commit_before_says_every_service(self):
        co = self.fixture("push-before")
        git(co, "checkout", "-q", "-b", "side")
        commit(co, [ISSUE])
        side = git(co, "rev-parse", "side")
        git(co, "checkout", "-q", "main")
        commit(co, [S + "beta/a.ts"])
        after = git(co, "rev-parse", "main")
        for name, before in (("zeros", "0" * 40), ("no commit", "1234567890" * 4), ("not an ancestor", side),
                             ("an option", "--help")):
            with self.subTest(name):
                p = run(co, "pm-scope", co, "--push", before, after, "--json")
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                try:
                    sv = json.loads(p.stdout)["services"]
                except (ValueError, KeyError, TypeError):
                    self.fail(f"not the object of --push --json:\n{p.stdout}")
                self.assertIs(sv["all"], True, sv)
                self.assertTrue(sv.get("why"), sv)

    def test_push_with_one_argument_exits_2(self):
        co = self.fixture("push-one")
        p = run(co, "pm-scope", co, "--push", git(co, "rev-parse", "main"))
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertNotIn("unrecognized arguments", p.stderr)  # refused by the option, not by its absence

    def test_push_twice_is_the_same_and_writes_nothing(self):
        co = self.fixture("push-twice")
        before = git(co, "rev-parse", "main")
        commit(co, [S + "beta/a.ts"])
        after = git(co, "rev-parse", "main")
        first, second = (run(co, "pm-scope", co, "--push", before, after) for _ in range(2))
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertEqual((first.returncode, first.stdout), (second.returncode, second.stdout))
        self.assertEqual(git(co, "status", "--porcelain"), "")
        self.assertFalse((co / "output").exists())


# ---------------------------------------------------------------------------------------------------- R3, R4.6

STANDIN = r'''#!/usr/bin/env -S python3 -I
"""Stand-in for tests/integration/run (see the docstring of test_services_scope.py)."""
import json, pathlib, subprocess, sys
co = pathlib.Path.cwd().parents[1]
out = co / "output"
out.mkdir(exist_ok=True)
with open(out / "ran", "a") as f:
    f.write(" ".join(["integration", *sys.argv[1:]]) + "\n")
conf = out / "integration.json"
runs = json.loads(conf.read_text())["runs"] if conf.exists() else [{}]
starts = out / "integration-starts"
n = int(starts.read_text()) if starts.exists() else 0
starts.write_text(str(n + 1))
r = runs[min(n, len(runs) - 1)]
rows = [json.loads(x) for x in (co / "tests" / "integration" / "manifest.jsonl").read_text().splitlines() if x.strip()]
skip = set()
if "--not-run" in sys.argv:
    listed = json.loads(pathlib.Path(sys.argv[sys.argv.index("--not-run") + 1]).read_text())
    skip = {c["id"] for c in listed["checks"]}
services = None
if "--services" in sys.argv:
    given = json.loads(pathlib.Path(sys.argv[sys.argv.index("--services") + 1]).read_text())["services"]
    services = None if given is None else sorted(set(given))
left = {x["check_id"] for x in rows if services is not None and isinstance(x.get("service"), str)
        and x["service"] not in services}
report = out / "integration" / "report.json"
report.unlink(missing_ok=True)
if r.get("report", "write") == "write":
    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    def verdict(i):
        if i in r.get("verdicts", {}):
            return r["verdicts"][i]
        return "not-run" if i in skip or i in left else "passed"
    checks = [dict(check_id=x["check_id"], verdict=verdict(x["check_id"]), seconds=1, log=None, message="")
              for x in rows]
    report.parent.mkdir(exist_ok=True)
    report.write_text(json.dumps(dict(commit=commit, services=services, checks=checks)))
print("stand-in integration output, start %d" % (n + 1))
sys.exit(r.get("exit", 0))
'''
BUN = "#!/bin/sh\nexit 0\n"


class Check(CheckCase):
    group = "services-check"

    def fixture(self, row=None, extra=None, **kw):
        co = super().fixture(row, {**m_files(), "tests/integration/run": STANDIN, **(extra or {})}, **kw)
        (self.stub / "bun").write_text(BUN)
        (self.stub / "bun").chmod(0o755)
        return co

    def given(self, paths=(S + "alpha/a.ts",), *runs):
        """Issue 9's branch and worktree with one commit of `paths` (kind diff), and what its stand-in does."""
        self.fixture()
        self.w9 = self.issue_branch()
        self.commit(self.w9, list(paths), "a change")
        self.standin(self.w9, *(runs or ({},)))
        return self.w9

    def starts(self, w):
        """The arguments of each start of the integration stand-in in `w`."""
        return [ln.split()[1:] for ln in self.ran(w) or [] if ln.split()[0] == "integration"]

    def services_file(self, w, args):
        """The file named after the one `--services` of a start's arguments."""
        self.assertEqual(args.count("--services"), 1, args)
        p = pathlib.Path(args[args.index("--services") + 1])
        return p if p.is_absolute() else pathlib.Path(w) / "tests" / "integration" / p

    def one_start(self, w, p):
        starts = self.starts(w)
        self.assertEqual(len(starts), 1, self.out(p))
        return starts[0]

    def test_a_service_branch_runs_with_its_services_file(self):
        w = self.given()
        p = self.check(w)
        args = self.one_start(w, p)
        f = self.services_file(w, args)
        self.assertEqual(json.loads(f.read_text())["services"], ["alpha"])
        self.assertTrue([ln for ln in services_lines(p.stdout) if ln.startswith(LINE + "alpha")], p.stdout)
        rec = self.last(w)
        self.assertEqual(rec["scope"]["services"]["names"], ["alpha"], rec["scope"])
        self.assertEqual(self.entry(rec, "integration").get("services"), ["alpha"], rec["steps"])
        self.ok(p)

    def test_on_request_and_services_together(self):
        w = self.given()
        p = self.check(w, "--on-request")
        args = self.one_start(w, p)
        self.assertIn("--on-request", args)
        self.services_file(w, args)

    def test_the_retry_has_the_same_arguments(self):
        w = self.given((S + "alpha/a.ts",), dict(exit=1), dict(exit=0))
        p = self.check(w)
        starts = self.starts(w)
        self.assertEqual(len(starts), 2, self.out(p))
        self.assertEqual(starts[0], starts[1])
        self.services_file(w, starts[0])

    def test_a_shared_path_runs_every_service(self):
        w = self.given((S + "alpha/a.ts", "studio/package.json"))
        p = self.check(w)
        args = self.one_start(w, p)
        self.assertNotIn("--services", args)
        e = self.entry(self.last(w), "integration")
        self.assertIn("services", e, e)
        self.assertIsNone(e["services"], e)

    def test_a_file_of_checks_of_no_service_runs_no_service(self):
        w = self.given(("tests/integration/studio/b.spec.ts",))
        p = self.check(w)
        f = self.services_file(w, self.one_start(w, p))
        self.assertEqual(json.loads(f.read_text())["services"], [])

    def assertEveryService(self, rec, kind):
        sv = rec["scope"].get("services")
        self.assertIsNotNone(sv, rec["scope"])
        self.assertIs(sv["all"], True, sv)
        self.assertIn(kind, sv["why"])

    def test_full_and_main_run_every_service(self):
        with self.subTest("--full"):
            w = self.given()
            p = self.check(w, "--full")
            self.assertNotIn("--services", self.one_start(w, p))
            self.assertEveryService(self.last(w), "full")
        with self.subTest("main"):
            self.fixture("main")
            self.standin(self.co, {})
            p = self.check(self.co)
            self.assertNotIn("--services", self.one_start(self.co, p))
            self.assertEqual(self.last(self.co)["scope"]["kind"], "main")
            self.assertEveryService(self.last(self.co), "main")

    def test_only_integration_runs_every_service(self):
        w = self.given()
        p = self.check(w, "--only", "integration")
        self.assertNotIn("--services", self.one_start(w, p))
        self.assertEveryService(self.last(w), "only")

    def test_left_out_checks_count_as_not_run(self):
        w = self.given((S + "alpha/a.ts",), dict(verdicts={"engine.plain-a": "not-run", "studio.plain-b": "not-run"}))
        p = self.check(w)
        self.assertEqual(self.entry(self.last(w), "integration")["checks"]["not_run"], 3, self.out(p))

    def test_an_earlier_services_file_is_removed(self):
        w = self.given()
        f = w / "output" / "checks" / "services.json"
        self.check(w)
        self.assertTrue(f.exists(), f)
        self.commit(w, ["studio/package.json"], "a shared path")
        self.check(w)
        self.assertFalse(f.exists(), f)

    def test_checks_runs_every_service(self):
        w = self.given()
        p = self.check(w, "--checks", "studio.beta-one")
        self.assertNotIn("--services", self.one_start(w, p))
        rec = json.loads((w / "output" / "checks" / "checks.json").read_text())
        self.assertEveryService(rec, "checks")

    def test_guard_unit_defers_the_step(self):
        self.fixture()
        self.issue_branch()
        s1 = self.unit(9, "s1", [S + "alpha/a.ts"])
        self.standin(s1, {})
        p = self.check(s1)
        self.assertEqual(self.starts(s1), [], self.out(p))
        self.assertEqual(self.entry(self.last(s1), "integration")["status"], "deferred")

    def test_no_report_no_services_key(self):
        # the run was narrowed (`--services`, the scope's services); without a report the entry says nothing
        w = self.given((S + "alpha/a.ts",), dict(report="none"))
        p = self.check(w)
        self.services_file(w, self.one_start(w, p))
        rec = self.last(w)
        self.assertEqual(rec["scope"]["services"]["names"], ["alpha"], rec["scope"])
        e = self.entry(rec, "integration")
        self.assertNotIn("services", e, e)


# ---------------------------------------------------------------------------------------------------- R4.7

ABSENT = object()  # an entry or a scope without the key `services`


def merge_checkout(case):
    co = make("services-merge", case, SCRIPTS, m_files())
    wt = co.parent / f"{co.name}-7-h1"
    if wt.exists():  # the worktree of an earlier run of this case
        shutil.rmtree(wt)
    (co / "home").mkdir()
    return co


def merge_record(w, services=ABSENT, scope_services=True, integration="passed"):
    """The pm-check record of W's head: engine and Studio absent, the integration step `integration` with
    `services` (ABSENT: no key), the harness step passed, and `scope` with `services` when `scope_services`."""
    step = dict(name="integration", module="integration", status=integration,
                seconds=0 if integration == "not-needed" else 1,
                log=None if integration == "not-needed" else "output/logs/check-integration.log")
    if services is not ABSENT:
        step["services"] = services
    steps = [dict(name="engine", module="engine", status="absent", seconds=0, log=None),
             dict(name="studio", module="studio", status="absent", seconds=0, log=None), step,
             dict(name="harness-test", module="harness", status="passed", seconds=1,
                  log="output/logs/check-harness-test.log")]
    scope = dict(kind="diff", reason="written by the case", main=git(w, "rev-parse", "main"),
                 base=git(w, "merge-base", "main", "HEAD"), paths=1, target="main",
                 modules={m: dict(called=True, why=["the case"]) for m in ("engine", "studio", "integration",
                                                                             "harness")})
    if scope_services:
        scope["services"] = dict(all=services is None, names=services if isinstance(services, list) else [],
                                 why="written by the case")
    rec = dict(at="2026-11-17T00:00:00+00:00", commit=git(w, "rev-parse", "HEAD"), dirty=False, full=False,
               on_request=False, passed=True, failed=[], flaky=[], scope=scope, steps=steps)
    out = w / "output" / "checks"
    out.mkdir(parents=True, exist_ok=True)
    (out / "last.json").write_text(json.dumps(rec))


def refusal(text):
    """The lines of a refusal that end `run pm-check again`."""
    return [ln for ln in text.splitlines() if ln.rstrip().endswith("run pm-check again")]


class Merge(unittest.TestCase):
    def given(self, case, paths, **record):
        co = merge_checkout(case)
        merge_record(merge_unit(co, paths), **record)
        return co

    def assertMerged(self, co, p):
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(git(co, "log", "-1", "--format=%s", "main"), "merge: #7 h1 (feat/7-h1)")

    def assertRefused(self, co, p, before, *words):
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("cannot merge", p.stderr)
        self.assertEqual(git(co, "rev-parse", "main"), before)
        found = [ln for ln in refusal(p.stderr) if all(w in ln for w in words)]
        self.assertTrue(found, f"no line ending 'run pm-check again' holds {words!r} in:\n{p.stderr}")

    def refused(self, case, paths, *words, **record):
        co = self.given(case, paths, **record)
        before = git(co, "rev-parse", "main")
        self.assertRefused(co, merge_in(co, 7, "h1"), before, *words)

    def test_a_record_that_ran_the_branchs_services_merges(self):
        for row, services in (("alpha", ["alpha"]), ("alpha-beta", ["alpha", "beta"]), ("null", None)):
            with self.subTest(row):
                co = self.given(f"ran-{row}", [S + "alpha/a.ts"], services=services)
                self.assertMerged(co, merge_in(co, 7, "h1"))

    def test_a_record_that_did_not_run_the_branchs_service_is_refused(self):
        with self.subTest("beta"):
            self.refused("narrow-beta", [S + "alpha/a.ts"], "alpha", "beta", services=["beta"])
        with self.subTest("none"):
            self.refused("narrow-none", [S + "alpha/a.ts"], "alpha", services=[])

    def test_a_shared_path_needs_every_service(self):
        self.refused("shared", [S + "alpha/a.ts", "studio/package.json"], "every service", services=["alpha"])

    def test_a_service_given_in_the_manifest_needs_every_service(self):
        self.refused("tagged", {MANIFEST: changed(**{"studio.plain-b": "beta"})}, services=[])

    def test_a_record_that_does_not_say_is_refused(self):
        co = self.given("unsaid", [S + "alpha/a.ts"])
        before = git(co, "rev-parse", "main")
        p = merge_in(co, 7, "h1")
        self.assertRefused(co, p, before)
        self.assertTrue([ln for ln in p.stderr.splitlines() if "does not say which services" in ln], p.stderr)

    def test_guard_a_record_from_before_merges(self):
        co = self.given("before", [S + "alpha/a.ts"], scope_services=False)
        self.assertMerged(co, merge_in(co, 7, "h1"))

    def test_guard_no_integration_asks_no_question(self):
        co = self.given("harness", [".pm/bin/a"], integration="not-needed", scope_services=False)
        self.assertMerged(co, merge_in(co, 7, "h1"))


class IssueMerge(IssueCase):
    group = "services-issue"

    def fixture(self, row=None, extra=None, **kw):
        return super().fixture(row, {**m_files(), **(extra or {})}, **kw)

    def with_services(self, path, services):
        """The record at `path` with the integration step's `services` and the scope's."""
        rec = json.loads(path.read_text())
        for s in rec["steps"]:
            if s["name"] == "integration":
                s["services"] = services
        rec["scope"]["services"] = dict(all=False, names=services, why="written by the case")
        path.write_text(json.dumps(rec, indent=1))

    def test_issue_branch_into_main_is_held_to_its_services(self):
        self.fixture()
        w9 = self.issue_branch()
        s1 = self.unit(9, "s1", [S + "alpha/a.ts"])
        self.record(s1, integration="deferred")
        self.review(9, "s1")
        self.ok(self.script("pm-merge", 9, "s1"))
        main = self.head("main")
        whole = self.record(w9, integration="passed")
        self.with_services(whole, ["beta"])
        p = self.script("pm-merge", 9)
        self.assertNotEqual(p.returncode, 0, self.out(p))
        self.assertTrue([ln for ln in refusal(p.stderr) if "alpha" in ln], self.out(p))
        self.assertEqual(self.head("main"), main)
        self.with_services(whole, ["alpha"])
        self.ok(self.script("pm-merge", 9))
        self.assertEqual(git(self.co, "log", "-1", "--format=%s", "main"), "merge: #9 (feat/9)")

    def test_guard_unit_into_its_issue_branch_is_judged_as_today(self):
        self.fixture()
        self.issue_branch()
        s1 = self.unit(9, "s1", [S + "alpha/a.ts"])
        self.review(9, "s1")
        self.record(s1, integration="deferred")
        feat = self.head("feat/9")
        self.ok(self.script("pm-merge", 9, "s1"))
        self.assertNotEqual(self.head("feat/9"), feat)
        self.assertTrue(self.is_ancestor("feat/9-s1", "feat/9"))


if __name__ == "__main__":
    unittest.main()
