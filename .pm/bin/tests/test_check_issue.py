"""pm-check on the issue branch: the fast check, the whole check, single checks (--checks) and the failed checks a
report names (issue 63, requirement R3; test criteria `test_check_issue`).

Check id `harness.check-issue`. One class per heading of the test criteria.

The fixture, its stand-ins and the helpers are those of `test_issue_branch.py` (see its docstring), under
<checkout>/output/tests/check-issue/<case>/. pm-check is run with the unit's or the issue's worktree as its
checkout, from the fixture's main checkout. A case that lets the integration stand-in run finds the stand-in
`top` first on PATH, so the run never waits for the CPU; its check slots are the fixture's own
(<fixture>/.pm/run/check-slots/slot-<i>.lock), and a case that holds them takes their locks itself.

Interface used (design 2.3): the `integration` entry of a record has `checks` (`passed`, `failed`, `error`,
`not_run`), null when there is no report of the run; a `--checks` run writes output/checks/checks.json, a
timestamped `*-checks.json` and output/checks/checks-not-run.json (`{"checks": [{"id", "reason"}]}`), its step
log is output/logs/checks-integration.log, and its `integration` entry has `asked` ({id: verdict}).

On a checkout without the change every case fails on its own, not at import: `pm-worktree new <id>` and
`--checks` do not exist there, and a record has no `checks`. The case whose name says `guard` passes there.
"""
import fcntl
import json
import os
import pathlib
import re
import subprocess
import time
import unittest

from _fixture import git
from test_issue_branch import HARNESS_PATH, ISSUE_FILE, PRODUCT_PATH, IssueCase, exact, line_with, manifest

NO_REPORT = "integration: no report of this run"
VERDICTS = ("passed", "failed", "error", "not-run")


class CheckCase(IssueCase):
    group = "check-issue"

    def check(self, w, *args, timeout=300):
        return self.script("pm-check", w, *args, timeout=timeout)

    def standin(self, w, *runs):
        """What the integration stand-in does at its first, second, … start in `w` (the last entry after that)."""
        out = pathlib.Path(w) / "output"
        out.mkdir(parents=True, exist_ok=True)
        (out / "integration.json").write_text(json.dumps(dict(runs=list(runs) or [{}])))
        (out / "integration-starts").unlink(missing_ok=True)

    def harness_exit(self, w, code):
        out = pathlib.Path(w) / "output"
        out.mkdir(parents=True, exist_ok=True)
        (out / "harness-exit").write_text(f"{code}\n")

    def ran(self, w):
        f = pathlib.Path(w) / "output" / "ran"
        return f.read_text().splitlines() if f.exists() else None

    def modules_ran(self, w):
        return [ln.split()[0] for ln in self.ran(w) or []]

    def last(self, w):
        return json.loads((pathlib.Path(w) / "output" / "checks" / "last.json").read_text())

    def entry(self, rec, name):
        found = [s for s in rec["steps"] if s["name"] == name]
        self.assertEqual(len(found), 1, rec["steps"])
        return found[0]

    def hold_slots(self):
        """Take both of the fixture's check slots; each file object holds one lock until it is closed."""
        d = self.co / ".pm" / "run" / "check-slots"
        d.mkdir(parents=True, exist_ok=True)
        held = []
        for i in range(2):
            f = open(d / f"slot-{i}.lock", "w")
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            held.append(f)
            self.addCleanup(f.close)
        return held


# ---------------------------------------------------------------------------------------------------- R3.1, R3.2

class FastCheck(CheckCase):
    def given(self, row=None):
        """Issue 9 and unit s1 with a product path and a harness path."""
        self.fixture(row)
        self.w9 = self.issue_branch()
        self.s1 = self.unit(9, "s1", [PRODUCT_PATH, HARNESS_PATH])

    def test_fast_check_leaves_integration_to_the_issue_branch(self):
        self.given()
        p = self.check(self.s1)
        self.ok(p)
        self.assertIn("PASSED", p.stdout)
        self.assertNotIn("NOT PASSED", p.stdout)
        self.assertLine(p.stdout, "integration", "deferred", exact("feat/9"))
        rec = self.last(self.s1)
        e = self.entry(rec, "integration")
        self.assertEqual((e["status"], e["seconds"], e["log"]), ("deferred", 0, None), e)
        self.assertEqual(self.entry(rec, "harness-test")["status"], "passed")
        self.assertEqual(rec["failed"], [])
        self.assertIn("harness", self.modules_ran(self.s1))
        self.assertNotIn("integration", self.modules_ran(self.s1))
        sc = self.scope(self.s1)
        self.assertEqual(rec["scope"], sc)
        self.assertEqual((sc["kind"], sc.get("target")), ("unit", "feat/9"), sc)

    def test_fast_check_takes_no_slot(self):
        self.given()
        self.hold_slots()
        try:
            p = self.check(self.s1, timeout=120)
        except subprocess.TimeoutExpired:
            self.fail("pm-check waited for a check slot although no product step runs")
        self.ok(p)

    def test_failing_harness_step_fails_the_fast_check(self):
        self.given()
        self.harness_exit(self.s1, 1)
        p = self.check(self.s1)
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertIn("NOT PASSED", p.stdout)
        self.assertEqual(self.last(self.s1)["failed"], ["harness-test"])

    def test_dirty_tree_fails_whatever_was_deferred(self):
        self.given()
        (self.s1 / "issues" / "things-that-do-not-work").mkdir(parents=True, exist_ok=True)
        (self.s1 / ISSUE_FILE).write_text("untracked\n")
        p = self.check(self.s1)
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertIs(self.last(self.s1)["dirty"], True)

    def test_full_defers_nothing(self):
        self.given()
        self.standin(self.s1, {})
        p = self.check(self.s1, "--full")
        self.assertIn("integration", self.modules_ran(self.s1), self.out(p))
        rec = self.last(self.s1)
        self.assertEqual([s["name"] for s in rec["steps"] if s["status"] == "deferred"], [], rec["steps"])

    def test_merge_accepts_the_fast_record(self):
        self.given()
        self.ok(self.check(self.s1))
        self.review(9, "s1")
        feat = self.head("feat/9")
        self.ok(self.script("pm-merge", 9, "s1"))
        self.assertNotEqual(self.head("feat/9"), feat)
        self.assertTrue(self.is_ancestor("feat/9-s1", "feat/9"))

    def test_whole_check_on_the_issue_worktree(self):
        self.given()
        self.ok(self.check(self.s1))
        self.review(9, "s1")
        self.ok(self.script("pm-merge", 9, "s1"))
        self.standin(self.w9, {})
        p = self.check(self.w9)
        self.ok(p)
        self.assertIn("integration", self.modules_ran(self.w9))
        self.assertIn("harness", self.modules_ran(self.w9))
        rec = self.last(self.w9)
        self.assertEqual((rec["scope"]["kind"], rec["scope"].get("target")), ("diff", "main"), rec["scope"])
        self.assertEqual((self.entry(rec, "integration")["status"], self.entry(rec, "harness-test")["status"]),
                         ("passed", "passed"))
        self.assertEqual([s["name"] for s in rec["steps"] if s["status"] == "deferred"], [])
        p = self.script("pm-merge", 9)
        self.ok(p)
        self.assertEqual(git(self.co, "log", "-1", "--format=%s", "main"), "merge: #9 (feat/9)")

    def test_guard_old_path_runs_integration(self):
        self.fixture()
        u = self.unit(8, "s1", [PRODUCT_PATH])
        self.standin(u, {})
        p = self.check(u)
        self.ok(p)
        self.assertIn("integration", self.modules_ran(u))
        self.assertEqual(self.entry(self.last(u), "integration")["status"], "passed")


# ---------------------------------------------------------------------------------------------------- R3.4

class NamedChecks(CheckCase):
    def given(self, row=None, paths=(PRODUCT_PATH,)):
        """A unit of issue 8 with a product path: the old path, so the integration step runs."""
        self.fixture(row)
        self.u = self.unit(8, "s1", paths)
        return self.u

    def test_failed_and_error_checks_are_named(self):
        self.given()
        self.standin(self.u, dict(exit=1, verdicts={"studio.b": "failed", "engine.a": "error", "studio.c": "passed"}))
        p = self.check(self.u, "--no-retry")
        self.assertEqual(p.returncode, 1, self.out(p))
        rec = self.last(self.u)
        checks = self.entry(rec, "integration").get("checks")
        self.assertEqual(checks, dict(passed=1, failed=["studio.b"], error=["engine.a"], not_run=0), rec["steps"])
        lines = p.stdout.splitlines()
        verdict = next(i for i, ln in enumerate(lines) if ln.startswith("NOT PASSED"))
        before = "\n".join(lines[:verdict])
        self.assertLine(before, "failed checks (1): studio.b")
        self.assertLine(before, "error checks (1): engine.a")
        self.assertEqual(rec["failed"], ["integration"])

    def test_first_ten_are_named(self):
        ids = [f"studio.f-{i:02d}" for i in range(1, 13)]
        self.given(paths={PRODUCT_PATH: "s1\n", "tests/integration/manifest.jsonl": manifest(ids)})
        self.standin(self.u, dict(exit=1, every="failed"))
        p = self.check(self.u, "--no-retry")
        self.assertEqual(p.returncode, 1, self.out(p))
        line = self.assertLine(p.stdout, "failed checks (12)")
        for i in ids[:10]:
            self.assertRegex(line, exact(i))
        for i in ids[10:]:
            self.assertNotRegex(line, exact(i))
        self.assertIn("and 2 more", line)
        self.assertEqual(sorted(self.entry(self.last(self.u), "integration")["checks"]["failed"]), ids)

    def test_every_check_passed(self):
        self.given()
        self.standin(self.u, dict(exit=0))
        p = self.check(self.u, "--no-retry")
        self.ok(p)
        checks = self.entry(self.last(self.u), "integration").get("checks")
        self.assertIsNotNone(checks)
        self.assertEqual((checks["passed"], checks["failed"], checks["error"]), (3, [], []), checks)
        self.assertFalse([ln for ln in p.stdout.splitlines() if ln.startswith(("failed checks", "error checks"))],
                         p.stdout)

    def test_no_report_of_this_run(self):
        def stale(u):
            """A report of this commit that the case wrote an hour before the run."""
            rep = u / "output" / "integration" / "report.json"
            rep.parent.mkdir(parents=True, exist_ok=True)
            rep.write_text(json.dumps(dict(commit=self.head(repo=u), checks=[
                dict(check_id=i, verdict="passed", seconds=1, log=None, message="") for i in ("engine.a", "studio.b",
                                                                                              "studio.c")])))
            an_hour_ago = time.time() - 3600
            os.utime(rep, (an_hour_ago, an_hour_ago))

        rows = {"none": ("none", None), "stale": ("keep", stale), "other-commit": ("other-commit", None),
                "not-json": ("text", None)}
        for row, (mode, before) in rows.items():
            with self.subTest(row):
                u = self.given(row)
                if before:
                    before(u)
                self.standin(u, dict(exit=1, report=mode))
                p = self.check(u, "--no-retry")
                e = self.entry(self.last(u), "integration")
                self.assertIn("checks", e, e)
                self.assertIsNone(e["checks"], e)
                self.assertIn(NO_REPORT, p.stdout, self.out(p))
                self.assertEqual(e["status"], "failed")

    def test_flaky_step_names_no_failed_check(self):
        self.given()
        self.standin(self.u, dict(exit=1, verdicts={"studio.b": "failed"}), dict(exit=0))
        p = self.check(self.u)
        e = self.entry(self.last(self.u), "integration")
        self.assertEqual(e["status"], "flaky", self.out(p))
        self.assertIsNotNone(e.get("checks"), e)
        self.assertEqual(e["checks"]["failed"], [], e)


# ---------------------------------------------------------------------------------------------------- R3.3

class Checks(CheckCase):
    def given(self, row=None, paths=(PRODUCT_PATH,)):
        """A unit of issue 8 with a product path, and what a passing pm-check of it left: last.json and
        check-integration.log."""
        self.fixture(row)
        self.u = self.unit(8, "s1", paths)
        self.standin(self.u, {})
        self.ok(self.check(self.u))
        self.kept = {f: f.read_bytes() for f in (self.u / "output" / "checks" / "last.json",
                                                 self.u / "output" / "logs" / "check-integration.log") if f.exists()}
        self.ran_before = self.ran(self.u) or []
        return self.u

    def new_starts(self):
        return [ln for ln in (self.ran(self.u) or [])[len(self.ran_before):] if ln.split()[0] == "integration"]

    def checks_json(self):
        return json.loads((self.u / "output" / "checks" / "checks.json").read_text())

    def not_run_list(self):
        return json.loads((self.u / "output" / "checks" / "checks-not-run.json").read_text())

    def asked(self, rec):
        return self.entry(rec, "integration").get("asked")

    def test_one_check_runs_and_is_no_gate(self):
        self.given()
        self.standin(self.u, dict(exit=0))
        p = self.check(self.u, "--checks", "studio.b")
        self.ok(p)
        starts = self.new_starts()
        self.assertEqual(len(starts), 1, starts)
        args = starts[0].split()[1:]
        self.assertEqual(args[0], "--not-run", starts)
        self.assertEqual(pathlib.Path(args[1]).resolve(),
                         (self.u / "output" / "checks" / "checks-not-run.json").resolve())
        listed = self.not_run_list()["checks"]
        self.assertEqual(sorted(c["id"] for c in listed), ["engine.a", "studio.c"], listed)
        for c in listed:
            self.assertTrue(c.get("reason"), c)
        self.assertLine(p.stdout, "passed", exact("studio.b"))
        last_line = p.stdout.strip().splitlines()[-1]
        self.assertIn("partial run (--checks)", last_line)
        self.assertIn("pm-merge", last_line)
        rec = self.checks_json()
        self.assertEqual((rec["scope"]["kind"], rec["passed"]), ("checks", False), rec["scope"])
        self.assertEqual(self.asked(rec), {"studio.b": "passed"})
        copies = sorted((self.u / "output" / "checks").glob("*-checks.json"))
        self.assertEqual(len(copies), 1, copies)
        self.assertEqual(json.loads(copies[0].read_text()), rec)
        self.assertEqual({f: f.read_bytes() for f in self.kept}, self.kept)
        log = self.u / "output" / "logs" / "checks-integration.log"
        self.assertIn("stand-in integration output", log.read_text())

    def test_two_checks_one_failed(self):
        self.given()
        flakes = self.co / ".pm" / "run" / "flakes.jsonl"
        flakes_before = flakes.read_text() if flakes.exists() else ""
        self.standin(self.u, dict(exit=1, verdicts={"studio.b": "failed", "engine.a": "passed"},
                                  messages={"studio.b": "expected 200, got 500\nat step 3"}), dict(exit=0))
        p = self.check(self.u, "--checks", "studio.b", "engine.a")
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertEqual([c["id"] for c in self.not_run_list()["checks"]], ["studio.c"])
        self.assertLine(p.stdout, "failed", exact("studio.b"), "expected 200, got 500")
        self.assertLine(p.stdout, "passed", exact("engine.a"))
        self.assertEqual(len(self.new_starts()), 1, self.ran(self.u))
        self.assertEqual(flakes.read_text() if flakes.exists() else "", flakes_before)

    def test_suite_that_stopped_before_its_checks(self):
        self.given()
        reason = "the emulator did not start"
        self.standin(self.u, dict(exit=127, every="error", message=reason))
        p = self.check(self.u, "--checks", "studio.b")
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertLine(p.stdout, "error", exact("studio.b"), reason)

    def test_no_report_names_no_verdict(self):
        self.given()
        self.standin(self.u, dict(exit=1, report="none"))
        p = self.check(self.u, "--checks", "studio.b")
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertIn(NO_REPORT, p.stdout)
        verdict = re.compile(r"\b(" + "|".join(VERDICTS) + r")\b")
        self.assertIsNone(line_with(p.stdout, exact("studio.b"), verdict), p.stdout)

    def test_refused_before_anything_runs(self):
        rows = {
            "unknown": ((PRODUCT_PATH,), ("--checks", "nope.x"), "nope.x"),
            "path": ((PRODUCT_PATH,), ("--checks", "../x"), None),
            "full": ((PRODUCT_PATH,), ("--checks", "studio.b", "--full"), None),
            "only": ((PRODUCT_PATH,), ("--checks", "studio.b", "--only", "harness"), None),
            "no-manifest": ({PRODUCT_PATH: "s1\n", "tests/integration/manifest.jsonl": None}, ("--checks", "studio.b"),
                            "tests/integration/manifest.jsonl"),
            "no-run": ({PRODUCT_PATH: "s1\n", "tests/integration/run": None}, ("--checks", "studio.b"),
                       "tests/integration/run"),
        }
        for row, (paths, args, named) in rows.items():
            with self.subTest(row):
                self.given(row, paths=paths)
                p = self.check(self.u, *args)
                self.assertEqual(p.returncode, 2, self.out(p))
                self.assertNotIn("unrecognized arguments", p.stderr)  # refused by the option, not by its absence
                self.assertEqual(self.new_starts(), [])
                for f in ("checks.json", "checks-not-run.json"):
                    self.assertFalse((self.u / "output" / "checks" / f).exists(), f)
                if named:
                    self.assertIn(named, p.stderr)

    def test_waits_for_a_slot(self):
        self.given()
        (self.u / "output" / "ran").unlink()
        self.standin(self.u, dict(exit=0))
        held = self.hold_slots()
        log = self.u / "output" / "logs" / "case-checks-queued.log"
        with open(log, "w") as f:
            proc = subprocess.Popen([str(self.co / ".pm" / "bin" / "pm-check"), str(self.u), "--checks", "studio.b"],
                                    stdout=f, stderr=subprocess.STDOUT, env=self.env(), cwd=str(self.co))
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        end = time.time() + 60
        while "queued" not in log.read_text() and proc.poll() is None and time.time() < end:
            time.sleep(0.05)
        self.assertIn("queued", log.read_text(), f"exit {proc.poll()}\n{log.read_text()}")
        self.assertIsNone(proc.poll(), log.read_text())
        self.assertIsNone(self.ran(self.u))
        held[0].close()
        try:
            code = proc.wait(timeout=120)
        except subprocess.TimeoutExpired:
            self.fail(f"pm-check did not end after a slot was freed\n{log.read_text()}")
        self.assertEqual(code, 0, log.read_text())
        self.assertIn("integration", self.modules_ran(self.u))

    def test_checks_record_is_no_gate_on_the_issue_branch(self):
        self.fixture()
        self.issue_branch()
        self.u = self.unit(9, "s1", [PRODUCT_PATH])
        self.review(9, "s1")
        self.ran_before = []
        self.standin(self.u, dict(exit=0))
        p = self.check(self.u, "--checks", "studio.c")
        self.ok(p)
        self.assertEqual(len(self.new_starts()), 1, self.ran(self.u))
        m = self.script("pm-merge", 9, "s1", "--dry-run")
        self.assertRefused(m, "no pm-check run recorded")


if __name__ == "__main__":
    unittest.main()
