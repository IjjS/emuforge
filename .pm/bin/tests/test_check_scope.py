"""pm-check runs the steps of the modules a checkout's changes call for, and records the others (issue 52).

Interface used (design 3.2): the record `output/checks/last.json` gains `scope` (as `pm-scope --json` prints it)
and `module` on every entry of `steps`; a step not called for has status `not-needed`, `seconds` 0 and `log` null.

Each case builds a fixture checkout (see `_fixture.py`) with stand-in steps that append their module's name to
`output/ran`: `.pm/bin/tests/run` for `harness` and, where a case has it, `tests/integration/run`. No case lets
the integration stand-in run, so no case takes a check slot or waits for the CPU. Every case fails on `main`,
where `_pmscope.py` and `pm-scope` do not exist and the fixture cannot be built.
"""
import json
import re
import unittest

from _fixture import git, make, run

SCRIPTS = ("pm-scope", "pm-check", "pm-merge", "pm-emulator-dir", "_pmlib.py", "_pmscope.py")
MODULES = ("engine", "studio", "integration", "harness")
ISSUE = "issues/things-that-do-not-work/a.md"
RULE8 = "the harness scripts, their tests and the guides those tests read"  # requirement R2, rule 8
HARNESS_RUN = "#!/bin/sh\nmkdir -p ../../../output\necho harness >> ../../../output/ran\nexit {code}\n"
INTEGRATION_RUN = "#!/bin/sh\nmkdir -p ../../output\necho integration >> ../../output/ran\nexit 0\n"
STEP_LINE = re.compile(r"^\s*\S+\s+(absent|not needed|passed|failed|flaky|error)\b")


def fixture(case, harness_code=0, integration=True):
    files = {".pm/bin/tests/run": HARNESS_RUN.format(code=harness_code)}
    if integration:
        files["tests/integration/run"] = INTEGRATION_RUN
    return make("check-scope", case, SCRIPTS, files)


def branch(co, paths, name="feat/x"):
    """A branch made from `main` in `co` with one commit that creates `paths`."""
    git(co, "checkout", "-q", "-b", name)
    for rel in paths:
        p = co / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f"{rel}\n")
    git(co, "add", "-A")
    git(co, "commit", "-q", "-m", name)


def pm_check(co, *args):
    return run(co, "pm-check", co, *args, timeout=300)


def record(co):
    return json.loads((co / "output" / "checks" / "last.json").read_text())


def entry(rec, name):
    found = [s for s in rec["steps"] if s["name"] == name]
    return found[0] if found else None


def ran(co):
    f = co / "output" / "ran"
    return f.read_text().splitlines() if f.exists() else None


class CheckScope(unittest.TestCase):
    def out(self, p):
        return p.stdout + p.stderr

    # Given F with both stand-in steps, on a branch with paths .pm/bin/a

    def test_harness_branch_runs_the_harness_step_only(self):
        co = fixture("harness-only")
        branch(co, [".pm/bin/a"])
        p = pm_check(co)
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(ran(co), ["harness"])
        rec = record(co)
        self.assertEqual(entry(rec, "harness-test")["status"], "passed")
        integration = entry(rec, "integration")
        self.assertEqual((integration["status"], integration["seconds"], integration["log"]), ("not-needed", 0, None))
        for name in ("engine", "studio"):
            self.assertEqual(entry(rec, name)["status"], "absent", rec["steps"])
        for s in rec["steps"]:
            self.assertIn("module", s, s)
        self.assertEqual([entry(rec, n)["module"] for n in ("engine", "studio", "integration", "harness-test")],
                         list(MODULES))
        self.assertIs(rec["passed"], True)
        self.assertIs(rec["full"], False)

    def test_record_scope_is_pm_scopes_answer(self):
        co = fixture("one-decision")
        branch(co, [".pm/bin/a"])
        p = pm_check(co)
        self.assertEqual(p.returncode, 0, self.out(p))
        s = run(co, "pm-scope", co, "--json")
        self.assertEqual(s.returncode, 0, s.stdout + s.stderr)
        self.assertEqual(record(co)["scope"], json.loads(s.stdout))

    def test_scope_lines_come_before_the_first_step(self):
        co = fixture("printed")
        branch(co, [".pm/bin/a"])
        p = pm_check(co)
        lines = p.stdout.splitlines()
        first = next(i for i, ln in enumerate(lines) if STEP_LINE.match(ln))
        before = lines[:first]
        self.assertTrue(any(ln.lstrip().startswith("scope: diff") for ln in before), p.stdout)
        self.assertTrue(any("harness" in ln and RULE8 in ln for ln in before), p.stdout)
        self.assertTrue(any("integration" in ln and "not needed" in ln for ln in lines), p.stdout)

    def test_harness_only_run_takes_no_slot(self):
        co = fixture("no-slot")
        branch(co, [".pm/bin/a"])
        p = pm_check(co)
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertFalse((co / ".pm" / "run" / "check-slots").exists())

    def test_failing_harness_step_fails_the_run(self):
        co = fixture("harness-fails", harness_code=1)
        branch(co, [".pm/bin/a"])
        p = pm_check(co)
        self.assertEqual(p.returncode, 1, self.out(p))
        rec = record(co)
        self.assertEqual(rec["failed"], ["harness-test"])
        self.assertEqual(entry(rec, "integration")["status"], "not-needed")

    def test_full_with_only_is_a_usage_error(self):
        co = fixture("full-only")
        branch(co, [".pm/bin/a"])
        p = pm_check(co, "--full", "--only", "harness")
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertFalse((co / "output" / "checks" / "last.json").exists())

    # Given F with both stand-in steps, on a branch whose only path is an issue file

    def test_issue_file_only_runs_nothing_and_passes(self):
        co = fixture("issue-only")
        branch(co, [ISSUE])
        p = pm_check(co)
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertIsNone(ran(co))
        rec = record(co)
        self.assertEqual([entry(rec, n)["status"] for n in ("integration", "harness-test")], ["not-needed"] * 2)
        self.assertIs(rec["passed"], True)
        self.assertIn("nothing was called for", p.stdout)

    def test_issue_file_only_with_an_untracked_file_does_not_pass(self):
        co = fixture("issue-only-dirty")
        branch(co, [ISSUE])
        (co / "issues" / "things-that-do-not-work" / "b.md").write_text("b\n")
        p = pm_check(co)
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertIs(record(co)["passed"], False)

    def test_only_is_a_partial_run(self):
        co = fixture("issue-only-only")
        branch(co, [ISSUE])
        p = pm_check(co, "--only", "harness")
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertEqual(ran(co), ["harness"])
        rec = record(co)
        self.assertEqual(rec["scope"]["kind"], "only")
        self.assertIs(rec["passed"], False)

    # Given F with the harness stand-in only, where the stand-in exits 1

    def test_step_not_called_for_is_not_run_and_absent_module_is_called(self):
        co = fixture("product-absent", harness_code=1, integration=False)
        branch(co, ["studio/src/a.tsx"])
        p = pm_check(co)
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertIsNone(ran(co))
        rec = record(co)
        self.assertEqual(entry(rec, "harness-test")["status"], "not-needed")
        self.assertEqual(entry(rec, "integration")["status"], "absent")
        self.assertIs(rec["scope"]["modules"]["integration"]["called"], True)
        self.assertIs(rec["passed"], True)

    # Given F with the harness stand-in only, where the stand-in exits 0

    def test_unknown_path_calls_for_every_module(self):
        co = fixture("unknown", integration=False)
        branch(co, ["LICENSE"])
        p = pm_check(co)
        rec = record(co)
        self.assertEqual(entry(rec, "harness-test")["status"], "passed", self.out(p))
        self.assertEqual({m for m in MODULES if rec["scope"]["modules"][m]["called"]}, set(MODULES))
        self.assertIs(rec["full"], False)

    def test_full_runs_every_module(self):
        co = fixture("full", integration=False)
        branch(co, [ISSUE])
        p = pm_check(co, "--full")
        rec = record(co)
        self.assertEqual(entry(rec, "harness-test")["status"], "passed", self.out(p))
        self.assertEqual(rec["scope"]["kind"], "full")
        self.assertIs(rec["full"], True)

    def test_on_main_the_harness_step_is_left_out(self):
        co = fixture("on-main", integration=False)
        p = pm_check(co)
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertIsNone(ran(co))
        rec = record(co)
        self.assertEqual(entry(rec, "harness-test")["status"], "not-needed")
        self.assertEqual(rec["scope"]["kind"], "main")
        self.assertIs(rec["full"], False)
        self.assertIs(rec["passed"], True)

    def test_full_on_main_runs_the_harness_step(self):
        co = fixture("on-main-full", integration=False)
        p = pm_check(co, "--full")
        rec = record(co)
        self.assertEqual(entry(rec, "harness-test")["status"], "passed", self.out(p))
        self.assertEqual(rec["scope"]["kind"], "full")
        self.assertIs(rec["full"], True)

    def test_no_main_branch_runs_every_module(self):
        co = fixture("trunk", integration=False)
        git(co, "branch", "-m", "main", "trunk")
        (co / ISSUE).parent.mkdir(parents=True)
        (co / ISSUE).write_text("a\n")
        git(co, "add", "-A")
        git(co, "commit", "-q", "-m", "issue file")
        p = pm_check(co)
        rec = record(co)
        self.assertEqual(entry(rec, "harness-test")["status"], "passed", self.out(p))
        self.assertEqual(rec["scope"]["kind"], "full")
        self.assertTrue(rec["scope"]["reason"].startswith("cannot read the changes"), rec["scope"]["reason"])


if __name__ == "__main__":
    unittest.main()
