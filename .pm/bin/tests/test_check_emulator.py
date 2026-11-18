"""pm-check names the emulator of the integration run it records (issue 68, requirement R3; test criteria
`test_check_emulator`).

Check id `harness.check-emulator`. One class per heading of the test criteria.

Every case builds a fixture checkout with `_fixture.make` under <checkout>/output/tests/check-emulator/<case>/ that
holds its own copies of pm-check and the helpers, so `_pmlib.ROOT` is the fixture and its check slots and
`.pm/run` are its own. The fixture has no engine/Cargo.toml and no studio/package.json (both modules are absent),
a stand-in .pm/bin/tests/run (the harness step, exit 0) and a stand-in tests/integration/run with a manifest of two
rows, `engine.a` and `studio.b`. Every script runs with a made-up HOME inside the fixture and a stand-in folder
first on PATH: `top` reports the CPU 98 % idle, so a run never waits for the machine, and `docker` exits 0.

The integration stand-in does what <fixture>/output/integration.json says (`{}` when there is none) and exits with
its `exit` (0 by default). With `report` `write` (the default) it writes output/integration/report.json for the
checkout's commit, one `passed` entry per manifest id (`not-run` for the ids of the `--not-run` list it was given),
`emulator_version` and `emulator_commit` as the file gives them (default `1.0.2` and `abc`) and an
`emulator_image` object; with `other-commit` the same for another commit; with `none` it removes the report; with
`keep` it leaves the report there as it is. A case about a report older than the run writes one itself for the
commit, dated an hour back, and has the stand-in keep it.

The record's entry of the integration step is read from output/checks/last.json, from the timestamped record
pm-check writes beside it (`<date>T<hhmmss>.json`) and, for `--checks`, from output/checks/checks.json. The verdict
line is the line that starts with `PASSED`, `NOT PASSED` or, for `--checks`, `CHECKS`.

On a checkout without the change every case fails on its own, but the cases whose name says `guard` (a step that
is not-needed, deferred or absent), which hold on main already.
"""
import json
import os
import pathlib
import re
import time
import unittest

from _fixture import clean_env, git, make, run

SCRIPTS = ("pm-check",)
GROUP = "check-emulator"
IDS = ("engine.a", "studio.b")
EMULATOR = {"version": "1.0.2", "commit": "abc"}
LINE = "emulator 1.0.2 commit abc"
NO_REPORT = "integration: no report of this run"
STAMPED = re.compile(r"\d{4}-\d{2}-\d{2}T\d{6}\.json")
VERDICT = re.compile(r"(PASSED|NOT PASSED|CHECKS) ")

HARNESS_RUN = "#!/bin/sh\nexit 0\n"
INTEGRATION_RUN = r'''#!/usr/bin/env -S python3 -I
"""Stand-in for tests/integration/run (see the docstring of test_check_emulator.py)."""
import json, pathlib, subprocess, sys
co = pathlib.Path.cwd().parents[1]
out = co / "output"
conf = out / "integration.json"
r = json.loads(conf.read_text()) if conf.exists() else {}
ids = [json.loads(x)["check_id"] for x in (co / "tests" / "integration" / "manifest.jsonl").read_text().splitlines()
       if x.strip()]
skip = set()
if "--not-run" in sys.argv:
    listed = json.loads(pathlib.Path(sys.argv[sys.argv.index("--not-run") + 1]).read_text())
    skip = {c["id"] for c in listed["checks"]}
report = out / "integration" / "report.json"
mode = r.get("report", "write")
if mode != "keep":
    report.unlink(missing_ok=True)
if mode in ("write", "other-commit"):
    commit = "0" * 40 if mode == "other-commit" else subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    checks = [dict(check_id=i, verdict="not-run" if i in skip else "passed", seconds=1, log=None, message="")
              for i in ids]
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(dict(
        commit=commit, checks=checks, emulator_version=r.get("emulator_version", "1.0.2"),
        emulator_commit=r.get("emulator_commit", "abc"),
        emulator_image=dict(id="sha256:" + "1" * 64, machine=dict(version="1.0.2", commit="abc"), compared=True))))
print("stand-in integration output")
sys.exit(r.get("exit", 0))
'''
TOP = "#!/bin/sh\necho 'CPU usage: 1.0% user, 1.0% sys, 98.0% idle'\necho 'CPU usage: 1.0% user, 1.0% sys, 98.0% idle'\n"
DOCKER = "#!/bin/sh\nexit 0\n"


def manifest(ids):
    return "".join(json.dumps(dict(check_id=i)) + "\n" for i in ids)


class Case(unittest.TestCase):
    """A fixture checkout of the record cases and the helpers that drive its pm-check."""

    def fixture(self, integration=True):
        name = f"{type(self).__name__}-{self._testMethodName[5:]}".lower().replace("_", "-")
        files = {".pm/bin/tests/run": HARNESS_RUN}
        if integration:
            files.update({"tests/integration/run": INTEGRATION_RUN, "tests/integration/manifest.jsonl": manifest(IDS)})
        self.co = make(GROUP, name, SCRIPTS, files)
        self.home = self.co / "home"
        self.home.mkdir()
        self.stub = self.co / "output" / "stub-bin"
        self.stub.mkdir(parents=True)
        for n, text in (("top", TOP), ("docker", DOCKER)):
            (self.stub / n).write_text(text)
            (self.stub / n).chmod(0o755)
        return self.co

    def standin(self, **conf):
        (self.co / "output" / "integration.json").write_text(json.dumps(conf))

    def env(self):
        env = {k: v for k, v in clean_env().items() if not k.startswith(("AWS_", "EMUFORGE_"))}
        env.pop("EMULATOR_PORT", None)
        env.update(HOME=str(self.home), PATH=f"{self.stub}{os.pathsep}{env.get('PATH', '')}")
        return env

    def check(self, *args, timeout=300):
        return run(self.co, "pm-check", self.co, *args, env=self.env(), timeout=timeout)

    def out(self, p):
        return f"exit {p.returncode}\nstdout:\n{p.stdout}\nstderr:\n{p.stderr}"

    def records(self):
        """last.json and the newest timestamped record, each as an object."""
        d = self.co / "output" / "checks"
        stamped = sorted(f for f in d.iterdir() if STAMPED.fullmatch(f.name))
        self.assertTrue(stamped, f"no timestamped record in {d}: {sorted(f.name for f in d.iterdir())}")
        return {"last.json": json.loads((d / "last.json").read_text()),
                stamped[-1].name: json.loads(stamped[-1].read_text())}

    def step(self, rec, name="integration"):
        found = [s for s in rec["steps"] if s["name"] == name]
        self.assertEqual(len(found), 1, rec["steps"])
        return found[0]

    def verdict_index(self, p):
        lines = p.stdout.splitlines()
        found = [i for i, ln in enumerate(lines) if VERDICT.match(ln)]
        self.assertTrue(found, f"no verdict line\n{self.out(p)}")
        return lines, found[-1]

    def assertLineBeforeVerdict(self, p):
        lines, verdict = self.verdict_index(p)
        self.assertIn(LINE, lines, self.out(p))
        self.assertLess(lines.index(LINE), verdict, self.out(p))

    def assertNoEmulatorLine(self, p):
        self.assertEqual([ln for ln in p.stdout.splitlines() if ln.startswith("emulator ")], [], self.out(p))

    def assertEmulator(self, p, value):
        """Every record's integration entry has the key `emulator` with `value`."""
        for name, rec in self.records().items():
            entry = self.step(rec)
            self.assertIn("emulator", entry, f"{name}: {entry}\n{self.out(p)}")
            self.assertEqual(entry["emulator"], value, f"{name}: {entry}")


# ---------------------------------------------------------------------------------------------------- R3.1, R3.2

class Record(Case):
    def test_full_records_the_emulator_of_the_report(self):
        self.fixture()
        self.standin()
        p = self.check("--full")
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEmulator(p, EMULATOR)

    def test_full_prints_the_emulator_line_before_the_verdict(self):
        self.fixture()
        self.standin()
        p = self.check("--full")
        self.assertLineBeforeVerdict(p)

    def test_a_failed_step_with_that_report_has_the_key_and_the_line(self):
        self.fixture()
        self.standin(exit=1)
        p = self.check("--full")
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertEqual(self.step(self.records()["last.json"])["status"], "failed")
        self.assertEmulator(p, EMULATOR)
        self.assertLineBeforeVerdict(p)

    def test_checks_records_the_emulator_in_checks_json_and_prints_the_line(self):
        self.fixture()
        self.standin()
        p = self.check("--checks", "engine.a")
        rec = json.loads((self.co / "output" / "checks" / "checks.json").read_text())
        entry = self.step(rec)
        self.assertIn("emulator", entry, f"{entry}\n{self.out(p)}")
        self.assertEqual(entry["emulator"], EMULATOR, entry)
        self.assertLineBeforeVerdict(p)

    def no_report(self, **conf):
        self.fixture()
        self.standin(**conf)
        p = self.check("--full")
        self.assertEmulator(p, None)
        self.assertNoEmulatorLine(p)
        self.assertIn(NO_REPORT, p.stdout.splitlines(), self.out(p))

    def test_no_report_is_null_without_a_line(self):
        self.no_report(report="none")

    def test_a_report_for_another_commit_is_null_without_a_line(self):
        self.no_report(report="other-commit")

    def test_a_report_older_than_the_run_is_null_without_a_line(self):
        self.fixture()
        rep = self.co / "output" / "integration" / "report.json"
        rep.parent.mkdir(parents=True)
        rep.write_text(json.dumps(dict(
            commit=git(self.co, "rev-parse", "HEAD"), emulator_version="1.0.2", emulator_commit="abc",
            checks=[dict(check_id=i, verdict="passed", seconds=1, log=None, message="") for i in IDS])))
        old = time.time() - 3600
        os.utime(rep, (old, old))
        self.standin(report="keep")
        p = self.check("--full")
        self.assertEmulator(p, None)
        self.assertNoEmulatorLine(p)
        self.assertIn(NO_REPORT, p.stdout.splitlines(), self.out(p))

    def test_a_null_version_is_null_without_a_line_and_the_checks_are_read(self):
        self.fixture()
        self.standin(emulator_version=None)
        p = self.check("--full")
        self.assertEmulator(p, None)
        self.assertNoEmulatorLine(p)
        self.assertEqual(self.step(self.records()["last.json"])["checks"],
                         dict(passed=2, failed=[], error=[], not_run=0), self.out(p))

    def assertNoKey(self, p, status):
        for name, rec in self.records().items():
            entry = self.step(rec)
            self.assertEqual(entry["status"], status, f"{name}: {entry}\n{self.out(p)}")
            self.assertNotIn("emulator", entry, f"{name}: {entry}")
        self.assertNoEmulatorLine(p)

    def test_guard_a_not_needed_step_has_no_key(self):
        self.fixture()
        self.standin()
        git(self.co, "checkout", "-q", "-b", "work")
        (self.co / ".pm" / "bin" / "note.txt").write_text("a harness path\n")
        git(self.co, "add", "-A")
        git(self.co, "commit", "-q", "-m", "harness path")
        self.assertNoKey(self.check(), "not-needed")

    def test_guard_a_deferred_step_has_no_key(self):
        self.fixture()
        self.standin()
        git(self.co, "branch", "feat/9")
        git(self.co, "checkout", "-q", "-b", "feat/9-t1")
        (self.co / "studio" / "src").mkdir(parents=True)
        (self.co / "studio" / "src" / "a.txt").write_text("a product path\n")
        git(self.co, "add", "-A")
        git(self.co, "commit", "-q", "-m", "product path")
        self.assertNoKey(self.check(), "deferred")

    def test_guard_an_absent_step_has_no_key(self):
        self.fixture(integration=False)
        self.assertNoKey(self.check("--full"), "absent")


if __name__ == "__main__":
    unittest.main()
