"""pm-check's harness module and the harness test entry point .pm/bin/tests/run.

Each case builds a fixture checkout under <checkout>/output/tests/check-step/<case>/ with its own copy of
pm-check (and the _pmlib.py it imports), its own stand-in .pm/bin/tests/run from fixtures/check-step/ and a
clean git tree, then runs that copy of pm-check on it.
"""
import json
import os
import pathlib
import shutil
import subprocess
import unittest

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]
FIXTURES = HERE / "fixtures" / "check-step"
WORK = CHECKOUT / "output" / "tests" / "check-step"
MARKER = "check-step fixture marker line"


def clean_env():
    """The caller's environment without git variables that would point git at another repository."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=fixture", "-c", "user.email=fixture@localhost",
                    "-c", "commit.gpgsign=false", *args],
                   check=True, capture_output=True, text=True, env=clean_env())


def fresh(name):
    d = WORK / name
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    return d


def make_checkout(name, run=None):
    """A fixture checkout: pm-check and _pmlib.py copied from this checkout, tests/run from `run` (or none)."""
    co = fresh(name)
    b = co / ".pm" / "bin"
    b.mkdir(parents=True)
    for f in ("pm-check", "_pmlib.py"):
        shutil.copy2(BIN / f, b / f)
    (b / "pm-check").chmod(0o755)
    if run:
        (b / "tests").mkdir()
        shutil.copy2(FIXTURES / run, b / "tests" / "run")
        (b / "tests" / "run").chmod(0o755)
    shutil.copy2(FIXTURES / "gitignore", co / ".gitignore")
    git(co, "init", "-q")
    git(co, "add", "-A")
    git(co, "commit", "-q", "-m", "fixture")
    return co


def pm_check(co, *args):
    return subprocess.run([str(co / ".pm" / "bin" / "pm-check"), str(co), *args],
                          capture_output=True, text=True, env=clean_env(), timeout=120)


def record(co):
    return json.loads((co / "output" / "checks" / "last.json").read_text())


def step(rec, name):
    found = [s for s in rec["steps"] if s["name"] == name]
    return found[0] if found else None


class PmCheckHarnessModule(unittest.TestCase):
    def test_run_exit_0_is_passed(self):
        co = make_checkout("pass", "run-pass")
        p = pm_check(co)
        rec = record(co)
        self.assertEqual(step(rec, "harness-test")["status"], "passed", p.stdout + p.stderr)
        self.assertFalse(rec["dirty"])
        self.assertTrue(rec["passed"])
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_run_exit_1_is_failed(self):
        co = make_checkout("fail", "run-fail")
        p = pm_check(co)
        rec = record(co)
        self.assertEqual(step(rec, "harness-test")["status"], "failed", p.stdout + p.stderr)
        self.assertIn("harness-test", rec["failed"])
        self.assertFalse(rec["passed"])
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)

    def test_no_run_is_absent_and_not_a_failure(self):
        co = make_checkout("absent")
        p = pm_check(co)
        rec = record(co)
        harness = step(rec, "harness")
        self.assertIsNotNone(harness, rec)
        self.assertEqual(harness["status"], "absent")
        self.assertIsNone(step(rec, "harness-test"))
        self.assertEqual(rec["failed"], [])
        self.assertTrue(rec["passed"])
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_list_names_harness_present(self):
        co = make_checkout("list", "run-pass")
        p = pm_check(co, "--list")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        lines = [ln for ln in p.stdout.splitlines() if ln.split()[:1] == ["harness"]]
        self.assertEqual(len(lines), 1, p.stdout)
        self.assertIn("present", lines[0].split())
        self.assertIn("harness-test", lines[0])

    def test_only_harness_runs_only_harness_test(self):
        co = make_checkout("only", "run-pass")
        p = pm_check(co, "--only", "harness")
        rec = record(co)
        self.assertEqual([s["name"] for s in rec["steps"]], ["harness-test"], p.stdout + p.stderr)
        self.assertEqual(step(rec, "harness-test")["status"], "passed")
        self.assertIs(rec["full"], False)

    def test_run_output_is_in_the_step_log(self):
        co = make_checkout("log", "run-pass")
        pm_check(co)
        log = co / "output" / "logs" / "check-harness-test.log"
        self.assertEqual(pathlib.Path(step(record(co), "harness-test")["log"]).resolve(), log.resolve())
        self.assertIn(MARKER, log.read_text().splitlines())


def make_tests_dir(name, cases):
    """A directory holding a copy of this checkout's tests/run and the named fixture cases as test_<case>.py."""
    d = fresh(name)
    shutil.copy2(HERE / "run", d / "run")
    (d / "run").chmod(0o755)
    for case in cases:
        shutil.copy2(FIXTURES / f"case_{case}.py", d / f"test_{case}.py")
    return d


def run_tests(d):
    return subprocess.run([str(d / "run")], cwd=str(d), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, env=clean_env(), timeout=120)


class TestsRun(unittest.TestCase):
    def test_all_pass_exit_0(self):
        p = run_tests(make_tests_dir("run-all-pass", ["pass"]))
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertIn("test_fixture_passes", p.stdout)

    def test_one_failure_exit_1_and_named(self):
        p = run_tests(make_tests_dir("run-one-fails", ["pass", "fail"]))
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertIn("test_fixture_fails_on_purpose", p.stdout)

    def test_one_error_exit_1_and_named(self):
        p = run_tests(make_tests_dir("run-one-errors", ["pass", "error"]))
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertIn("test_fixture_errors_on_purpose", p.stdout)


if __name__ == "__main__":
    unittest.main()
