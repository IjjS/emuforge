"""pm-check asks for room and is answered WAIT with an expected wait when there is none (issue 478, part 2; the
owner's decision "Checks" in .pm/issue-478/decisions.md, the pm's review decision on the plan).

Each case builds a fixture checkout (`_fixture.make`) under <checkout>/output/tests/check-room/<case>/ holding its
own pm-check and helpers, so `_pmlib.ROOT` is the fixture and its .pm/run is its own. The fixture is on `main` at its
only commit, so pm-check runs kind `main`: engine and studio are absent and the integration step, a stand-in
tests/integration/run that appends `integration` to output/ran and exits 0, is the one heavy step. A folder of
machine stand-ins (`top`, `vm_stat`, `sysctl`) is first on PATH: idle by default, busy (CPU 99 %) or full (memory
30.5 GB) where a case says so. A running check is a recorded file in .pm/run/checks/ whose pid is a live stand-in
process named pm-check; recorded step durations are lines of .pm/run/check-durations.jsonl.
"""
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time
import unittest

from _fixture import IDLE, clean_env, make, machine_bin, run

GROUP = "check-room"
RUN_STANDIN = "#!/bin/sh\necho integration >> ../../output/ran\nexit 0\n"
HARNESS_STANDIN = "#!/bin/sh\necho harness >> ../../../output/ran\nexit 0\n"
BUSY = dict(IDLE, top="#!/bin/sh\necho 'CPU usage: 90.0% user, 9.0% sys, 1.0% idle'\n"
                      "echo 'CPU usage: 90.0% user, 9.0% sys, 1.0% idle'\n")
FULL = dict(IDLE, vm_stat="#!/bin/sh\necho 'Pages active:                            2000000.'\n")
WAIT_LINE = re.compile(r"^WAIT (\d+)s: (.+); running: (.+); expected room at \d\d:\d\d:\d\d; (.+)$")
TAIL_OTHER = "run pm-check again after it"


class RoomCase(unittest.TestCase):
    def fixture(self, case, machine=IDLE, harness=False):
        files = {"tests/integration/run": RUN_STANDIN}
        if harness:
            files[".pm/bin/tests/run"] = HARNESS_STANDIN
        self.co = make(GROUP, case, ("pm-check",), files)
        self.run_dir = self.co / ".pm" / "run"
        self.machine = machine_bin(f"{GROUP}-{case}", machine)
        self.pane = None
        return self.co

    def env(self):
        env = {k: v for k, v in clean_env().items() if not k.startswith(("AWS_", "EMUFORGE_", "HERDR_"))}
        env.pop("EMULATOR_PORT", None)
        env["PATH"] = f"{self.machine}{os.pathsep}{env['PATH']}"
        if self.pane:
            env["HERDR_PANE_ID"] = self.pane
        return env

    def check(self, *args):
        return run(self.co, "pm-check", self.co, *args, env=self.env(), timeout=120)

    def set_machine(self, machine):
        machine_bin(self.machine.name, machine)

    def out(self, p):
        return f"exit {p.returncode}\nstdout:\n{p.stdout}\nstderr:\n{p.stderr}"

    def ran(self):
        f = self.co / "output" / "ran"
        return f.read_text().split() if f.exists() else []

    def wait_line(self, p):
        self.assertEqual(p.returncode, 75, self.out(p))
        last = p.stdout.strip().splitlines()[-1]
        m = WAIT_LINE.match(last)
        self.assertIsNotNone(m, last)
        return int(m.group(1)), m.group(2), m.group(3), m.group(4)

    def live_check(self, started_ago, steps=("integration",), step=None, step_ago=None):
        """A live stand-in process named pm-check, recorded as a heavy check that started `started_ago` s ago."""
        d = self.co / "output" / "standin"
        d.mkdir(parents=True, exist_ok=True)
        prog = d / "pm-check"
        prog.write_text("#!/bin/sh\nsleep 120\n")
        prog.chmod(0o755)
        # in a session of its own, ended whole: the shell's `sleep` must not outlive the case as an orphan
        proc = subprocess.Popen([str(prog)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, start_new_session=True)
        self.addCleanup(self.end_group, proc)
        now = time.time()
        steps = list(steps)
        entry = dict(pid=proc.pid, checkout=f"/x/emuforge-{proc.pid}", started=now - started_ago, steps=steps,
                     step=step or steps[0], step_started=now - (started_ago if step_ago is None else step_ago))
        d = self.run_dir / "checks"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{proc.pid}.json").write_text(json.dumps(entry))
        return entry

    @staticmethod
    def end_group(proc):
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()

    def durations(self, rows):
        self.run_dir.mkdir(parents=True, exist_ok=True)
        with open(self.run_dir / "check-durations.jsonl", "a") as f:
            for step, seconds in rows:
                f.write(json.dumps(dict(at="2026-11-18T00:00:00+00:00", step=step, seconds=seconds,
                                        status="passed")) + "\n")

    def last(self):
        return json.loads((self.co / "output" / "checks" / "last.json").read_text())


class NoRoom(RoomCase):
    def test_busy_cpu_answers_wait_writes_no_record_and_runs_nothing(self):
        self.fixture("busy", BUSY)
        p = self.check()
        wait, why, running, tail = self.wait_line(p)
        self.assertEqual((wait, why, running, tail), (60, "cpu 99% > 90%", "no check", TAIL_OTHER))
        self.assertEqual(self.ran(), [])
        self.assertFalse((self.co / "output" / "checks" / "last.json").exists())
        self.assertFalse((self.run_dir / "waiting.json").exists(), "an unregistered caller is not remembered")
        self.assertEqual(list((self.run_dir / "checks").glob("*.json")), [])

    def test_memory_over_its_limit_answers_wait_naming_memory(self):
        self.fixture("full", FULL)
        _, why, _, _ = self.wait_line(self.check())
        self.assertEqual(why, "memory 30.5GB > 22.5GB")
        self.assertEqual(self.ran(), [])

    def test_the_expected_wait_is_the_least_a_running_check_still_needs_by_its_recorded_steps(self):
        self.fixture("expected", BUSY)
        self.durations([("engine-test", 100), ("engine-test", 300), ("engine-test", 200), ("engine-fmt", 10)])
        # a: rest of engine-fmt (10 - 4, at least 30) + engine-test (median 200) = 230
        a = self.live_check(500, steps=("engine-fmt", "engine-test"), step_ago=4)
        # b: integration never recorded (300) less 100 s elapsed = 200
        b = self.live_check(500, steps=("integration",), step_ago=100)
        wait, why, running, _ = self.wait_line(self.check())
        self.assertTrue(195 <= wait <= 200, wait)
        self.assertEqual(why, "cpu 99% > 90%")
        parts = dict(re.match(r"(\S+) \S+ \(about (\S+) left\)", r).groups() for r in running.split(", "))
        self.assertEqual(set(parts), {pathlib.Path(a["checkout"]).name, pathlib.Path(b["checkout"]).name}, running)
        self.assertRegex(parts[pathlib.Path(a["checkout"]).name], r"^3m(4[5-9]|50)s$")
        self.assertRegex(parts[pathlib.Path(b["checkout"]).name], r"^3m(1[5-9]|20)s$")

    def test_a_check_started_under_a_minute_ago_holds_the_next_for_the_rest_of_the_minute(self):
        self.fixture("settle")
        self.live_check(10)
        wait, why, _, _ = self.wait_line(self.check())
        self.assertTrue(45 <= wait <= 50, wait)
        self.assertRegex(why, r"^a check started \d+s ago has not shown its load yet$")
        self.assertEqual(self.ran(), [])


class Room(RoomCase):
    def test_more_than_two_heavy_checks_run_when_there_is_room(self):
        # the limit of two heavy runs is gone (the owner's decision "Checks")
        self.fixture("third")
        others = [self.live_check(120), self.live_check(120)]
        p = self.check()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertIn("PASSED", p.stdout)
        self.assertEqual(self.ran(), ["integration"])
        left = sorted(f.name for f in (self.run_dir / "checks").glob("*.json"))
        self.assertEqual(left, sorted(f"{o['pid']}.json" for o in others), "the run's own entry outlived it")
        self.assertEqual(self.last()["waited"], dict(seconds=0, asks=0))

    def test_a_run_of_no_heavy_module_starts_on_a_busy_machine(self):
        self.fixture("harness-only", BUSY, harness=True)
        p = self.check("--only", "harness")
        self.assertNotIn("WAIT", p.stdout, self.out(p))
        self.assertEqual(self.ran(), ["harness"])

    def test_a_dead_check_s_entry_is_dropped_and_holds_nothing(self):
        self.fixture("dead")
        proc = subprocess.Popen(["true"])
        proc.wait()
        d = self.run_dir / "checks"
        d.mkdir(parents=True)
        (d / f"{proc.pid}.json").write_text(json.dumps(dict(pid=proc.pid, checkout="/x/a", started=time.time(),
                                                            steps=["integration"], step="integration",
                                                            step_started=time.time())))
        p = self.check()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertFalse((d / f"{proc.pid}.json").exists())

    def test_each_step_that_ran_is_recorded_with_its_duration(self):
        self.fixture("durations")
        p = self.check()
        self.assertEqual(p.returncode, 0, self.out(p))
        rows = [json.loads(ln) for ln in (self.run_dir / "check-durations.jsonl").read_text().splitlines()]
        self.assertEqual([(r["step"], r["status"]) for r in rows], [("integration", "passed")])
        self.assertIsInstance(rows[0]["seconds"], (int, float))


class Waited(RoomCase):
    def test_the_record_of_a_started_check_holds_how_long_it_waited_in_all(self):
        self.fixture("waited", BUSY)
        self.wait_line(self.check())
        self.wait_line(self.check())
        wf = self.co / "output" / "checks" / "waited.json"
        w = json.loads(wf.read_text())
        self.assertEqual(w["asks"], 2)
        wf.write_text(json.dumps(dict(w, first_at=w["first_at"] - 100)))  # the first WAIT 100 s earlier
        self.set_machine(IDLE)
        p = self.check()
        self.assertEqual(p.returncode, 0, self.out(p))
        waited = self.last()["waited"]
        self.assertEqual(waited["asks"], 2)
        self.assertTrue(100 <= waited["seconds"] < 160, waited)
        self.assertFalse(wf.exists())
        p = self.check()
        self.assertEqual(self.last()["waited"], dict(seconds=0, asks=0), self.out(p))


class Asker(RoomCase):
    def test_a_registered_pane_is_remembered_and_told_to_end_its_turn(self):
        self.fixture("pane", BUSY)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        (self.run_dir / "panes.json").write_text(json.dumps([dict(name="i9-worker-e1", issue="9", role="worker",
                                                                  side="engine", pane_id="W9")]))
        self.pane = "W9"
        _, _, _, tail = self.wait_line(self.check())
        self.assertEqual(tail, f"end your turn: EVENT room i9-worker-e1 check {self.co} comes when there is room")
        rows = json.loads((self.run_dir / "waiting.json").read_text())
        self.assertEqual([(r["asker"], r["check"], r["issue"]) for r in rows], [("i9-worker-e1", str(self.co), "9")])
        first = rows[0]["at"]
        self.wait_line(self.check())
        rows = json.loads((self.run_dir / "waiting.json").read_text())
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0]["at"], first, "an asker answered again keeps its place")


TICK = """
import json, sys
src = open(sys.argv[1]).read().rsplit("\\nmain()", 1)[0]
ns = {"__file__": sys.argv[1], "__name__": "watchd"}
exec(compile(src, sys.argv[1], "exec"), ns)
reg = json.loads(sys.argv[2])
room = sys.argv[3] == "room"
freed = sys.argv[4]
seen = []
def checks(**kw):
    seen.append(kw)
    return (None if room else "cpu 99% > 90%", 0, [])
given = json.loads(sys.argv[5]) if len(sys.argv) > 5 else None
out = ns["room_tick"]({}, reg, checks=checks, freed=freed, given=given)
print(json.dumps(dict(out=out, asked=seen)))
"""

FREED = """
import json, sys
src = open(sys.argv[1]).read().rsplit("\\nmain()", 1)[0]
ns = {"__file__": sys.argv[1], "__name__": "watchd"}
exec(compile(src, sys.argv[1], "exec"), ns)
st = {}
out = []
for live, checks in json.loads(sys.argv[2]):
    out.append(ns["what_freed"](st, live, checks))
print(json.dumps(out))
"""


class Watchd(unittest.TestCase):
    """pm-watchd's room_tick on the fixture's waiting.json, with check_room replaced by a given answer."""

    def tick(self, reg, room, freed="a check ended", given=None, asked=False):
        args = [json.dumps(reg), room, freed] + ([json.dumps(given)] if given else [])
        p = subprocess.run([sys.executable, "-I", "-c", TICK, str(self.co / ".pm" / "bin" / "pm-watchd"), *args],
                           capture_output=True, text=True, env=clean_env(), timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        got = json.loads(p.stdout.strip().splitlines()[-1])
        return (got["out"], got["asked"]) if asked else got["out"]

    def waiting(self, rows):
        self.co = make(GROUP, "watchd", ("pm-watchd",))
        run_dir = self.co / ".pm" / "run"
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "waiting.json").write_text(json.dumps(rows))
        return run_dir

    def test_nothing_freed_judges_nothing_issue_497(self):
        run_dir = self.waiting([dict(asker="i9-gone", check="/x/g", issue="9", reason="r", at="t0", expected="e"),
                                dict(asker="i9-worker-e1", check="/x/a", issue="9", reason="r", at="t1", expected="e")])
        out, asked = self.tick([dict(name="i9-worker-e1")], "room", freed="", asked=True)
        self.assertEqual(out, [], "a wake-up that freed nothing told a waiting pane")
        self.assertEqual(asked, [], "a wake-up that freed nothing judged the room")
        left = [r["asker"] for r in json.loads((run_dir / "waiting.json").read_text())]
        self.assertEqual(left, ["i9-worker-e1"], "a gone asker's row is dropped all the same")

    def test_the_timer_reading_is_given_to_the_judgement_issue_497(self):
        self.waiting([dict(asker="i9-worker-e1", check="/x/a", issue="9", reason="r", at="t1", expected="e")])
        reading = {"mem": [10.0, 0.0, 0.0], "cpu": 20.0}
        out, asked = self.tick([dict(name="i9-worker-e1")], "room", freed="the machine is under its limits",
                               given=reading, asked=True)
        self.assertEqual(out, ["EVENT room i9-worker-e1 check /x/a"])
        self.assertEqual(asked, [dict(given=reading)], "the judgement measured again instead of taking the reading")

    def test_what_frees_room_is_a_check_that_ended_or_a_pane_that_closed_issue_497(self):
        self.co = make(GROUP, "watchd-freed", ("pm-watchd",))
        looks = [({"a": "/w/a", "b": "/w/b"}, ["1.json", "2.json"]),   # first look: nothing seen before
                 ({"a": "/w/a", "b": "/w/b"}, ["1.json", "2.json"]),   # nothing changed
                 ({"a": "/w/a", "b": "/w/b"}, ["1.json", "2.json", "3.json"]),  # a check started: frees nothing
                 ({"a": "/w/a", "b": "/w/b"}, ["2.json", "3.json"]),   # a check ended
                 ({"a": "/w/a", "b": "/w/b", "c": "/w/c"}, ["2.json", "3.json"]),  # a pane opened: frees nothing
                 ({"a": "/w/a", "c": "/w/c"}, ["2.json", "3.json"]),   # b closed or gone
                 ({}, [])]                                             # both at once
        p = subprocess.run([sys.executable, "-I", "-c", FREED, str(self.co / ".pm" / "bin" / "pm-watchd"),
                            json.dumps(looks)], capture_output=True, text=True, env=clean_env(), timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        got = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertEqual(got, [[[], []], [[], []], [[], []], [["a check ended"], []], [[], []],
                               [["a pane closed"], ["/w/b"]], [["a check ended", "a pane closed"], ["/w/a", "/w/c"]]])

    def test_the_longest_waiting_asker_is_told_once_there_is_room_and_one_per_look(self):
        self.co = make(GROUP, "watchd", ("pm-watchd",))
        run_dir = self.co / ".pm" / "run"
        run_dir.mkdir(parents=True, exist_ok=True)
        rows = [dict(asker="i9-gone", check="/x/g", issue="9", reason="r", at="t0", expected="e"),
                dict(asker="i9-worker-e1", check="/x/a", issue="9", reason="r", at="t1", expected="e"),
                dict(asker="i9-worker-e2", check="/x/b", issue="9", reason="r", at="t2", expected="e")]
        (run_dir / "waiting.json").write_text(json.dumps(rows))
        reg = [dict(name="i9-worker-e1"), dict(name="i9-worker-e2")]
        self.assertEqual(self.tick(reg, "none"), [])
        left = [r["asker"] for r in json.loads((run_dir / "waiting.json").read_text())]
        self.assertEqual(left, ["i9-worker-e1", "i9-worker-e2"], "a gone asker's row is dropped, the others wait")
        self.assertEqual(self.tick(reg, "room"), ["EVENT room i9-worker-e1 check /x/a"])
        left = [r["asker"] for r in json.loads((run_dir / "waiting.json").read_text())]
        self.assertEqual(left, ["i9-worker-e2"])
        self.assertEqual(self.tick(reg, "room"), ["EVENT room i9-worker-e2 check /x/b"])


GUIDES = pathlib.Path(__file__).resolve().parents[3] / ".agents" / "skills" / "pm"


def flat(text):
    return re.sub(r"\s+", " ", text)


class Docs(unittest.TestCase):
    """The guides say what a WAIT answer asks of a pane, and none keeps the limit of two heavy runs."""

    def read(self, rel):
        return flat((GUIDES / rel).read_text())

    def test_pane_mode_and_lead_say_end_your_turn_until_event_room_check(self):
        for rel in ("references/pane-mode.md", "references/lead.md"):
            with self.subTest(rel):
                text = self.read(rel)
                self.assertIn("`WAIT", text)
                self.assertIn("end your turn", text)
                self.assertIn("EVENT room <", text)
                self.assertRegex(text, r"EVENT room <\w+> check <worktree>")

    def test_the_lead_table_reruns_the_check_on_event_room(self):
        self.assertIn("| `EVENT room <you> check <worktree>` | run the `pm-check` that was answered `WAIT` again |",
                      (GUIDES / "references" / "lead.md").read_text())

    def test_the_briefs_of_the_panes_that_run_pm_check_name_the_wait_answer(self):
        for rel in ("references/briefs/worker.md", "references/briefs/harness-engineer.md"):
            with self.subTest(rel):
                self.assertIn("A `WAIT` answer: end your turn until `EVENT room`", self.read(rel))

    def test_no_guide_keeps_the_limit_of_two_heavy_runs_or_a_queue_of_checks(self):
        for f in sorted(GUIDES.rglob("*.md")):
            text = flat(f.read_text())
            for gone in ("at most two heavy runs", "queues behind other", "`pm-check` queues itself"):
                with self.subTest(f=f.name, gone=gone):
                    self.assertNotIn(gone, text)

    def test_the_pm_check_help_states_the_ask(self):
        p = subprocess.run([sys.executable, "-I", str(GUIDES.parents[2] / ".pm" / "bin" / "pm-check"), "--help"],
                           capture_output=True, text=True, timeout=60)
        text = flat(p.stdout)
        for wanted in ("asks for room", "exits 75", "There is no limit on the number of runs", "`waited`",
                       "EVENT room <name> check <checkout>"):
            with self.subTest(wanted):
                self.assertIn(wanted, text)


if __name__ == "__main__":
    unittest.main()
