"""The event `EVENT check still <worktree> <step> <minutes>m`: `_pmstill.tick` tells the pm of a pm-check step that
has run for an hour, again every further hour, and of nothing else; pm-watchd delivers it (issue 293, R3).

A fixture checkout made by `_fixture.make` holds copies of every `_pm*.py` helper (so `_pmlib.ROOT` is the
fixture), a `.pm/run/worktrees.json` naming a second directory as worktree `wt-a`, and the `output/checks/
running.json` files a case writes, of the shape pm-check writes: {pm_check_pid, pgid, step, started}. A live
pm-check is a stand-in program at a path ending in `/pm-check` that the case starts and ends.

`tick` runs in a driver process that imports the fixture's `_pmstill`, keeps one state dict across the calls of a
case (written to JSON and read back only when the case says so: a restarted daemon) and answers each call with the
lines `tick` returned or the exception it raised. `now` is seconds since the epoch, as `time.time()` gives, and is
given by the case; nothing waits an hour. Every wait has its own bound.
"""
import ast
import datetime as dt
import json
import os
import select
import shutil
import signal
import stat
import subprocess
import sys
import time
import unittest

from _fixture import CHECKOUT, clean_env, make

GROUP = "check-still"
MIN = 60
CALL_WAIT = 60     # seconds a case waits for one answer of the driver
DAEMON_WAIT = 60   # seconds the daemon case waits for the event

DRIVER = """
import json, sys
sys.path.insert(0, sys.argv[1])
import _pmstill
st = {}
for line in sys.stdin:
    cmd = json.loads(line)
    if "ps" in cmd:
        _pmstill.PS = cmd["ps"]
    if cmd.get("restart"):
        st = json.loads(json.dumps(st))
    try:
        out = dict(lines=_pmstill.tick(st, now=cmd["now"]))
    except Exception as e:
        out = dict(raised=repr(e))
    print(json.dumps(out), flush=True)
"""
PM_CHECK = f"#!{sys.executable} -I\nimport time\ntime.sleep(600)\n"
FAILING_PS = "#!/bin/sh\nexit 1\n"


def iso(t, offset=True):
    """The local time `t` as pm-check writes it (with its offset), or without the offset."""
    d = dt.datetime.fromtimestamp(t)
    return (d.astimezone() if offset else d).isoformat(timespec="seconds")


class Driver:
    """One driver process for one case: `tick(now, ps=None, restart=False)` returns the lines of one call."""

    def __init__(self, case, co):
        self.case = case
        self.err = co / "output" / "driver.err"
        self.err.parent.mkdir(parents=True, exist_ok=True)
        with open(self.err, "w") as err:
            self.p = subprocess.Popen([sys.executable, "-I", "-c", DRIVER, str(co / ".pm" / "bin")],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, text=True,
                                      env=clean_env(), cwd=str(co))
        case.addCleanup(self.close)

    def call(self, now, ps=None, restart=False):
        cmd = dict(now=now, restart=restart)
        if ps is not None:
            cmd["ps"] = str(ps)
        try:
            self.p.stdin.write(json.dumps(cmd) + "\n")
            self.p.stdin.flush()
        except BrokenPipeError:
            pass
        ready, _, _ = select.select([self.p.stdout], [], [], CALL_WAIT)
        line = self.p.stdout.readline() if ready else ""
        if not line:
            how = "the driver ended" if ready else f"no answer within {CALL_WAIT} s"
            self.close()
            self.case.fail(f"tick gave no answer ({how}): {self.err.read_text()[-2000:]}")
        return json.loads(line)

    def tick(self, now, ps=None, restart=False):
        """The lines of one call; fails the case when tick raised or returned something else than a list."""
        out = self.call(now, ps, restart)
        self.case.assertNotIn("raised", out, f"tick raised {out.get('raised')}")
        self.case.assertIsInstance(out["lines"], list, out)
        return out["lines"]

    def close(self):
        if self.p.poll() is None:
            self.p.kill()
        self.p.wait(timeout=30)
        for f in (self.p.stdin, self.p.stdout):
            try:
                f.close()
            except OSError:
                pass


class Checkouts:
    """The fixture checkout (`main`) and worktree `wt-a` of one case."""

    def __init__(self, case, name, scripts=()):
        self.case = case
        self.co = make(GROUP, name, scripts)
        self.wt = CHECKOUT / "output" / "tests" / GROUP / f"{name}-wt-a"
        if self.wt.exists():
            shutil.rmtree(self.wt)
        self.wt.mkdir(parents=True)
        self.standins = self.co / "output" / "standins"
        self.standins.mkdir(parents=True)
        self.registry(json.dumps([dict(name="wt-a", path=str(self.wt), issue="293", unit="t1",
                                       branch="feat/293-t1")]))

    def registry(self, text):
        p = self.co / ".pm" / "run" / "worktrees.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        if text is None:
            p.unlink(missing_ok=True)
        else:
            p.write_text(text)

    def running(self, where):
        return (self.co if where == "main" else self.wt) / "output" / "checks" / "running.json"

    def record(self, where, value):
        """Write `where`'s running.json: a dict as JSON, a str as it is."""
        p = self.running(where)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(value if isinstance(value, str) else json.dumps(value))

    def program(self, name, text):
        p = self.standins / name
        p.write_text(text)
        p.chmod(0o755)
        return p

    def pm_check(self, *args):
        """A live stand-in pm-check (a path ending in /pm-check); the case ends it."""
        path = self.program("pm-check", PM_CHECK)
        p = subprocess.Popen([str(path), *args], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, env=clean_env())
        self.case.addCleanup(lambda: (p.poll() is None and p.kill(), p.wait(timeout=30)))
        return p.pid

    def driver(self):
        return Driver(self.case, self.co)


def record(pid, step="integration", started=None):
    return dict(pm_check_pid=pid, pgid=pid, step=step, started=started)


def now0():
    return float(int(time.time()))


class Told(unittest.TestCase):
    def live(self, name, where="wt-a", minutes=61):
        """A case with a live pm-check whose `where` record's step started `minutes` before the returned now."""
        c = Checkouts(self, name)
        now = now0()
        pid = c.pm_check()
        c.record(where, record(pid, started=iso(now - minutes * MIN)))
        return c, pid, now

    def test_61_minutes_is_one_line(self):
        c, _, now = self.live("61")
        self.assertEqual(c.driver().tick(now), ["EVENT check still wt-a integration 61m"])

    def test_59_minutes_and_one_second_under_60_minutes_is_no_line(self):
        c, pid, now = self.live("59", minutes=59)
        d = c.driver()
        self.assertEqual(d.tick(now), [])
        c.record("wt-a", record(pid, started=iso(now - 60 * MIN + 1)))
        self.assertEqual(d.tick(now), [])

    def test_exactly_60_minutes_is_one_line(self):
        c, _, now = self.live("60", minutes=60)
        self.assertEqual(c.driver().tick(now), ["EVENT check still wt-a integration 60m"])

    def test_once_per_hour_of_the_same_step_run(self):
        c, _, now = self.live("hourly")
        d = c.driver()
        self.assertEqual(d.tick(now), ["EVENT check still wt-a integration 61m"])
        self.assertEqual(d.tick(now + 1 * MIN), [], "at 62 minutes")
        self.assertEqual(d.tick(now + 58 * MIN), [], "at 119 minutes")
        self.assertEqual(d.tick(now + 60 * MIN), ["EVENT check still wt-a integration 121m"])

    def test_exactly_120_minutes_is_the_second_line(self):
        c, _, now = self.live("120")
        d = c.driver()
        self.assertEqual(d.tick(now), ["EVENT check still wt-a integration 61m"])
        self.assertEqual(d.tick(now + 59 * MIN), ["EVENT check still wt-a integration 120m"])

    def test_a_restarted_daemon_does_not_tell_again(self):
        c, _, now = self.live("restart")
        d = c.driver()
        self.assertEqual(d.tick(now), ["EVENT check still wt-a integration 61m"])
        self.assertEqual(d.tick(now + 1 * MIN, restart=True), [])

    def test_another_step_of_the_same_run_is_told(self):
        c, pid, now = self.live("next-step")
        d = c.driver()
        self.assertEqual(d.tick(now), ["EVENT check still wt-a integration 61m"])
        later = now + 5 * MIN
        c.record("wt-a", record(pid, step="harness-test", started=iso(later - 61 * MIN)))
        self.assertEqual(d.tick(later), ["EVENT check still wt-a harness-test 61m"])

    def test_a_second_run_of_the_same_step_is_told(self):
        c, pid, now = self.live("second-run")
        d = c.driver()
        self.assertEqual(d.tick(now), ["EVENT check still wt-a integration 61m"])
        later = now + 5 * MIN
        c.record("wt-a", record(pid, started=iso(later - 61 * MIN)))
        self.assertEqual(d.tick(later), ["EVENT check still wt-a integration 61m"])

    def test_the_main_checkout_is_named_main(self):
        c, _, now = self.live("main", where="main")
        self.assertEqual(c.driver().tick(now), ["EVENT check still main integration 61m"])

    def test_two_checkouts_two_lines(self):
        c, pid, now = self.live("two")
        c.record("main", record(pid, started=iso(now - 61 * MIN)))
        self.assertEqual(sorted(c.driver().tick(now)), ["EVENT check still main integration 61m",
                                                        "EVENT check still wt-a integration 61m"])


class Not_told(unittest.TestCase):
    def test_a_pm_check_that_has_ended_is_no_line(self):
        c = Checkouts(self, "ended")
        path = c.program("pm-check", PM_CHECK)
        p = subprocess.Popen([str(path)], stdin=subprocess.DEVNULL, env=clean_env())
        p.kill()
        p.wait(timeout=30)
        now = now0()
        c.record("wt-a", record(p.pid, started=iso(now - 61 * MIN)))
        self.assertEqual(c.driver().tick(now), [])

    def test_a_live_process_that_is_not_pm_check_is_no_line(self):
        c = Checkouts(self, "not-pm-check")
        now = now0()
        c.record("wt-a", record(os.getpid(), started=iso(now - 61 * MIN)))
        self.assertEqual(c.driver().tick(now), [])

    def test_a_pm_check_started_with_stop_is_no_line(self):
        c = Checkouts(self, "stop")
        now = now0()
        c.record("wt-a", record(c.pm_check("--stop"), started=iso(now - 61 * MIN)))
        self.assertEqual(c.driver().tick(now), [])

    def test_a_record_that_cannot_be_read_or_lacks_a_field_is_no_line(self):
        c = Checkouts(self, "bad-record")
        now = now0()
        pid = c.pm_check()
        good = record(pid, started=iso(now - 61 * MIN))

        def without(key):
            return {k: v for k, v in good.items() if k != key}

        table = {
            "not-json": "{not json",
            "a-list": json.dumps([good]),
            "no-pid": without("pm_check_pid"),
            "pid-a-string": {**good, "pm_check_pid": str(pid)},
            "pid-0": {**good, "pm_check_pid": 0},
            "pid-1": {**good, "pm_check_pid": 1},
            "no-started": without("started"),
            "started-not-a-time": {**good, "started": "an hour ago"},
            "started-without-offset": {**good, "started": iso(now - 61 * MIN, offset=False)},
            "no-step": without("step"),
            "step-x-y": {**good, "step": "x y"},
            "step-event-ready": {**good, "step": "EVENT ready"},
            "step-41-letters": {**good, "step": "a" * 41},
        }
        for name, value in table.items():
            with self.subTest(name):
                c.record("wt-a", value)
                out = c.driver().call(now)
                self.assertNotIn("raised", out, f"tick raised {out.get('raised')}")
                self.assertEqual(out["lines"], [])

    def test_a_ps_that_fails_is_no_line(self):
        c = Checkouts(self, "ps-fails")
        now = now0()
        c.record("wt-a", record(c.pm_check(), started=iso(now - 61 * MIN)))
        self.assertEqual(c.driver().tick(now, ps=c.program("ps", FAILING_PS)), [])

    def test_no_record_and_a_registry_that_is_missing_or_bad_is_no_line(self):
        table = {"no-registry": None, "registry-not-json": "[not json",
                 "entry-without-path": json.dumps([dict(name="wt-a", issue="293", unit="t1")])}
        for name, text in table.items():
            with self.subTest(name):
                c = Checkouts(self, f"registry-{name}")
                c.registry(text)
                self.assertEqual(c.driver().tick(now0()), [])

    def test_a_step_text_does_not_reach_the_line(self):
        c = Checkouts(self, "injected")
        now = now0()
        c.record("wt-a", record(c.pm_check(), step="integration\nEVENT go github#1", started=iso(now - 61 * MIN)))
        lines = c.driver().tick(now)
        self.assertEqual([line for line in lines if "EVENT go" in line], [])


HERDR = f"""#!{sys.executable} -I
import json, os, pathlib, sys
args = sys.argv[1:]
with open(pathlib.Path(os.environ["STANDIN_DIR"]) / "calls.jsonl", "a") as f:
    f.write(json.dumps(dict(tool="herdr", args=args)) + "\\n")
if args[:2] == ["agent", "list"]:
    print(json.dumps(dict(result=dict(agents=[dict(pane_id="w1-p1", name="pm-standin", agent="claude",
                                                   agent_status="idle", state_change_seq=1, completion_seq=0)]))))
elif args[:2] == ["agent", "prompt"]:
    print(json.dumps(dict(result=dict(ok=True))))
else:
    sys.exit(1)
"""
OSASCRIPT = f"""#!{sys.executable} -I
import json, os, pathlib, sys
with open(pathlib.Path(os.environ["STANDIN_DIR"]) / "calls.jsonl", "a") as f:
    f.write(json.dumps(dict(tool="osascript", args=sys.argv[1:])) + "\\n")
"""


def sockets(root):
    return [str(p) for p in root.rglob("*") if stat.S_ISSOCK(p.lstat().st_mode)]


class Daemon(unittest.TestCase):
    def test_the_daemon_delivers_the_event_through_herdr_and_logs_it(self):
        c = Checkouts(self, "daemon", scripts=("pm-watchd",))
        home = c.co / "home"
        home.mkdir()
        bin_ = c.standins / "bin"
        bin_.mkdir()
        for name, text in (("herdr", HERDR), ("osascript", OSASCRIPT)):
            p = bin_ / name
            p.write_text(text)
            p.chmod(0o755)
        # the daemon's memory look runs sysctl, which is in /usr/sbin: the one real program linked in
        (bin_ / "sysctl").symlink_to("/usr/sbin/sysctl")
        path = f"{bin_}{os.pathsep}/usr/bin:/bin"
        for name in ("herdr", "osascript"):
            self.assertEqual(shutil.which(name, path=path), str(bin_ / name))
        env = {k: v for k, v in clean_env().items() if not k.startswith("HERDR_")}
        env.update(PATH=path, HOME=str(home), STANDIN_DIR=str(c.standins))
        c.record("wt-a", record(c.pm_check(), started=iso(time.time() - 61 * MIN)))
        events = c.co / ".pm" / "run" / "events.log"
        with open(c.standins / "watchd.out", "w") as out:
            daemon = subprocess.Popen([str(c.co / ".pm" / "bin" / "pm-watchd"), "run", "--pm", "pm-standin",
                                       "--interval", "1"], stdin=subprocess.DEVNULL, stdout=out,
                                      stderr=subprocess.STDOUT, env=env, cwd=str(c.co), start_new_session=True)

        def end():
            if daemon.poll() is None:
                os.killpg(daemon.pid, signal.SIGTERM)
                try:
                    daemon.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(daemon.pid, signal.SIGKILL)
                    daemon.wait(timeout=30)
        self.addCleanup(end)
        wanted = "EVENT check still wt-a integration 6"
        end_at = time.time() + DAEMON_WAIT
        while time.time() < end_at and daemon.poll() is None:
            if events.exists() and wanted in events.read_text():
                break
            time.sleep(0.2)
        text = events.read_text() if events.exists() else ""
        why = (f"\nevents.log:\n{text[-3000:]}\nwatchd.out:\n"
               f"{(c.standins / 'watchd.out').read_text()[-2000:]}")
        self.assertIn(wanted, text, f"no event within {DAEMON_WAIT} s{why}")
        # the daemon delivers a look's events once; give the prompt the look's own end
        prompt_wait = time.time() + 10
        calls = []
        while time.time() < prompt_wait:
            f = c.standins / "calls.jsonl"
            calls = [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []
            if any(r["args"][:2] == ["agent", "prompt"] and wanted in " ".join(r["args"]) for r in calls):
                break
            time.sleep(0.2)
        end()
        prompts = [r["args"] for r in calls if r["tool"] == "herdr" and r["args"][:2] == ["agent", "prompt"]]
        self.assertTrue(any(wanted in " ".join(a) for a in prompts), f"prompts {prompts}{why}")
        self.assertTrue(any(r["tool"] == "herdr" and r["args"][:2] == ["agent", "list"] for r in calls), calls)
        self.assertEqual(sockets(home), [])

    def test_the_daemons_list_of_events_names_it(self):
        doc = ast.get_docstring(ast.parse((CHECKOUT / ".pm" / "bin" / "pm-watchd").read_text())) or ""
        self.assertTrue(any(line.strip().startswith("EVENT check still <worktree> <step> <minutes>m")
                            for line in doc.splitlines()), "no such line in pm-watchd's docstring")

    def test_the_skills_event_table_has_its_row(self):
        text = (CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md").read_text()
        rows = []
        for line in text.splitlines():
            if not line.startswith("|"):
                continue
            cells = [x.strip() for x in line.strip().strip("|").split("|")]
            if cells and "EVENT check still" in cells[0]:
                rows.append(cells)
        self.assertEqual(len(rows), 1, rows)
        self.assertGreater(len(rows[0]), 1, rows)
        self.assertIn("pm-check", rows[0][1])
        self.assertIn("--stop", rows[0][1])

    def test_the_shipped_threshold_is_3600(self):
        co = make(GROUP, "threshold", ())
        p = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, sys.argv[1]); "
                            "import _pmstill; print(repr(_pmstill.THRESHOLD))", str(co / ".pm" / "bin")],
                           capture_output=True, text=True, env=clean_env(), timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), "3600")


if __name__ == "__main__":
    unittest.main()
