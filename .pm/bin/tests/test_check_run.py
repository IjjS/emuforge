"""pm-check: an intermittent failure is retried once and recorded, and --stop ends one worktree's run only."""
import json
import os
import pathlib
import signal
import subprocess
import time
import unittest

from _fixture import clean_env, make, run

SCRIPTS = ("pm-check", "_pmlib.py")
# fails the first time it runs in a checkout, passes afterwards (the marker lives in the ignored output/)
FLAKY = """#!/bin/sh
m=../../../output/ran-once
if [ -e "$m" ]; then echo second run; exit 0; fi
mkdir -p ../../../output && touch "$m"; echo first run fails; exit 1
"""
FAIL = "#!/bin/sh\necho always fails\nexit 1\n"
# starts a child that would outlive it, records both pids, then waits
SLOW = """#!/bin/sh
mkdir -p ../../../output
sleep 300 &
echo "$$ $!" > ../../../output/pids
wait
"""


def last(co):
    return json.loads((co / "output" / "checks" / "last.json").read_text())


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


class Retry(unittest.TestCase):
    def test_fail_then_pass_is_flaky_and_recorded(self):
        co = make("check-run", "flaky", SCRIPTS, {".pm/bin/tests/run": FLAKY})
        p = run(co, "pm-check", co)
        rec = last(co)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertTrue(rec["passed"])
        self.assertEqual(rec["flaky"], ["harness-test"])
        step = rec["steps"][-1]
        self.assertEqual(step["status"], "flaky")
        self.assertIn("first run fails", pathlib.Path(step["first_log"]).read_text())
        self.assertIn("second run", pathlib.Path(step["log"]).read_text())
        flakes = [json.loads(x) for x in (co / ".pm" / "run" / "flakes.jsonl").read_text().splitlines()]
        self.assertEqual([(f["step"], f["commit"]) for f in flakes], [("harness-test", rec["commit"])])
        self.assertIn("flaky", p.stdout)

    def test_no_retry_fails_on_the_first_failure(self):
        co = make("check-run", "no-retry", SCRIPTS, {".pm/bin/tests/run": FLAKY})
        p = run(co, "pm-check", co, "--no-retry")
        self.assertEqual(p.returncode, 1)
        self.assertEqual(last(co)["failed"], ["harness-test"])
        self.assertFalse((co / ".pm" / "run" / "flakes.jsonl").exists())

    def test_failing_twice_is_failed(self):
        co = make("check-run", "twice", SCRIPTS, {".pm/bin/tests/run": FAIL})
        p = run(co, "pm-check", co)
        rec = last(co)
        self.assertEqual(p.returncode, 1)
        self.assertEqual((rec["failed"], rec["flaky"]), (["harness-test"], []))
        self.assertTrue(pathlib.Path(rec["steps"][-1]["first_log"]).exists())
        self.assertFalse((co / ".pm" / "run" / "flakes.jsonl").exists())


class Stop(unittest.TestCase):
    def start(self, case):
        co = make("check-run", case, SCRIPTS, {".pm/bin/tests/run": SLOW})
        proc = subprocess.Popen([str(co / ".pm" / "bin" / "pm-check"), str(co)], stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, env=clean_env(), start_new_session=True)
        self.addCleanup(lambda: proc.poll() is None and os.killpg(proc.pid, signal.SIGKILL))
        pids = co / "output" / "pids"
        end = time.time() + 20
        while not (pids.exists() and pids.read_text().strip()) and time.time() < end:
            time.sleep(0.05)
        step_pid, child_pid = map(int, pids.read_text().split())
        self.addCleanup(lambda: [alive(x) and os.kill(x, signal.SIGKILL) for x in (step_pid, child_pid)])
        return co, proc, step_pid, child_pid

    def test_stop_ends_the_run_and_everything_it_started(self):
        co, proc, step_pid, child_pid = self.start("stop")
        rec = json.loads((co / "output" / "checks" / "running.json").read_text())
        self.assertEqual((rec["pm_check_pid"], rec["pgid"], rec["step"]), (proc.pid, step_pid, "harness-test"))
        p = run(co, "pm-check", co, "--stop")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        proc.wait(timeout=20)
        time.sleep(0.2)
        self.assertFalse(alive(step_pid))
        self.assertFalse(alive(child_pid))
        self.assertFalse((co / "output" / "checks" / "running.json").exists())

    def test_stop_leaves_another_worktrees_run_alone(self):
        co_a, proc_a, step_a, child_a = self.start("stop-a")
        co_b, proc_b, step_b, child_b = self.start("stop-b")
        run(co_a, "pm-check", co_a, "--stop")
        proc_a.wait(timeout=20)
        self.assertIsNone(proc_b.poll())
        self.assertTrue(alive(step_b) and alive(child_b))
        run(co_b, "pm-check", co_b, "--stop")
        proc_b.wait(timeout=20)

    def test_stop_from_another_worktree_is_refused(self):
        co_a, proc_a, step_a, child_a = self.start("refuse-a")
        other = make("check-run", "refuse-b", SCRIPTS)
        # the caller sits in another checkout and uses the first one's script, as a pane would with <Root>/.pm/bin
        p = subprocess.run([str(co_a / ".pm" / "bin" / "pm-check"), str(co_a), "--stop"], capture_output=True, text=True,
                           env=clean_env(), cwd=str(other))
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("refused", p.stderr)
        self.assertIsNone(proc_a.poll())
        self.assertTrue(alive(step_a))
        run(co_a, "pm-check", co_a, "--stop")
        proc_a.wait(timeout=20)

    def test_sigterm_to_the_run_ends_its_step(self):
        co, proc, step_pid, child_pid = self.start("sigterm")
        os.kill(proc.pid, signal.SIGTERM)
        proc.wait(timeout=20)
        time.sleep(0.2)
        self.assertFalse(alive(step_pid))
        self.assertFalse(alive(child_pid))

    def test_stop_without_a_run_says_so(self):
        co = make("check-run", "none", SCRIPTS)
        p = run(co, "pm-check", co, "--stop")
        self.assertEqual(p.returncode, 0)
        self.assertIn("no pm-check run is recorded", p.stdout)
