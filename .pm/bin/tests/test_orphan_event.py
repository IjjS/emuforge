"""The daemon's event `EVENT orphans <worktree> …`, its call in pm-watchd, and the texts that name the event, the
sweep and the rule (issue 472, R6 and R7; test criteria `test_orphan_event`).

Check id `harness.orphan-event`. One class per heading of the test criteria, one case per line. An always file:
it runs in a few seconds, because the time of every look is given as `now` and no case waits for it.

Interface used (design 5): `_pmorphanevent.tick(st, now=None, reapers=REAPERS)` returns the event lines of one
call and keeps its state in `st`; it looks at most once per `LOOK` (30 s), tells a PID seen for `HOLD` (60 s), and
tells `again` `AGAIN` (300 s) after a told line with `pane=`. Its look takes `_pmorphans`'s process table, so a
case that wants `ps` to fail sets `_pmorphans.PS` (and `_pmorphanevent.PS` when the module has one).

Every case builds a fixture checkout `F` with `_fixture.make` (so `_pmlib.ROOT` is `F` and the real `.pm/run` is
never read or written) whose `.pm/run/worktrees.json` names three worktrees, folders beside `F`: `wt-a`, `wt-a-b`
(the path of `wt-a` with `-b` appended) and `wt-b`. A case that says so registers `P`, the pane `i1-worker-h1` with
`wt-a` as its cwd, in `F/.pm/run/panes.json`, live or `gone`.

`tick` runs in a driver: a child process that imports the fixture's `_pmorphanevent`, keeps one state dict across
the calls of a case, and answers each call with the lines `tick` returned or the exception it raised. A restarted
daemon is a new driver process that starts from the state the first one had, written to a JSON file. When the
module cannot be imported every call answers with that error, so each case fails on its own. On Linux the driver
makes itself a child subreaper and passes `{1, <its PID>}` as the reapers; on macOS `{1}`.

The orphans are stand-ins this file writes, started by the driver: `orphan.py <cwd> <pidfile> [<program> <arg>…]`
forks, the starter exits at once (so the child's parent is a reaper), and the child moves to `<cwd>`, writes its
PID and sleeps until a 120 s bound. With a program the child moves to `<cwd>` and becomes `/bin/sleep 120` (exec),
so a case has orphans of two names; the starter writes the PID once the exec has happened and then exits. No
stand-in spins a core. A case signals only the stand-ins it started, by PID and after checking that the PID still
has the start time it had when it was made; every one is killed at the case's end, passed or not. Nothing is
signalled by name, pattern or group.

For issue 477 a case records a `pm-check` stand-in (an orphan in `wt-a`) as a live run in
`wt-a/output/checks/running.json` and starts a stand-in of its tests under `wt-a/output/tests/`, or registers the
crit pane `i1-crit` of issue 1 and starts impeccable's live-server as `ps` shows it (bash under the name
`impeccable` with the word `live-server`) in `wt-a`; neither is told, an orphan beside them is.

On a checkout without the change every case fails on its own for the reason under its heading: `_pmorphanevent`
does not exist (Tick), `pm-watchd` does not call it (Daemon), no text names the event, the sweep or the rule
(Texts).
"""
import ast
import json
import os
import re
import select
import shutil
import signal
import subprocess
import sys
import time
import unittest

from _fixture import CHECKOUT, clean_env, make

GROUP = "orphan-event"
SCRIPTS = ["pm-pane", "pm-worktree", "pm-watchd", "pm-emulator-dir"]
WORKTREES = ("wt-a", "wt-a-b", "wt-b")
PANE = "i1-worker-h1"
CALL_WAIT = 30     # seconds a case waits for one answer of the driver
GONE_WAIT = 10     # seconds a case waits for a stand-in it ended to be gone
PS = "/bin/ps"
PS_ENV = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}

ORPHAN = f"""#!{sys.executable} -I
import os, sys, time
cwd, pidfile, program = sys.argv[1], sys.argv[2], sys.argv[3:]


def write(pid):
    tmp = pidfile + ".tmp"
    with open(tmp, "w") as f:
        f.write(str(pid))
    os.replace(tmp, pidfile)


if program:
    r, w = os.pipe()  # not inheritable: the exec closes w, which ends the starter's read
    pid = os.fork()
    if pid == 0:
        os.close(r)
        os.chdir(cwd)
        os.execv(program[0], program)
    os.close(w)
    os.read(r, 1)
    write(pid)
    os._exit(0)
if os.fork():
    os._exit(0)
os.chdir(cwd)
write(os.getpid())
end = time.time() + 120
while time.time() < end:
    time.sleep(1)
"""

DRIVER = """
import ctypes, json, os, subprocess, sys, time
sys.path.insert(0, sys.argv[1])
reapers = {1} | {int(x) for x in sys.argv[3].split(",") if x}
if sys.platform.startswith("linux"):
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise SystemExit("prctl PR_SET_CHILD_SUBREAPER failed")
    reapers.add(os.getpid())
try:
    import _pmorphanevent
    import _pmorphans
    missing = None
    ps = {m: getattr(m, "PS") for m in (_pmorphans, _pmorphanevent) if hasattr(m, "PS")}
except Exception as e:
    missing = repr(e)


def reap():
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return


st = json.loads(open(sys.argv[2]).read()) if sys.argv[2] else {}
for line in sys.stdin:
    cmd = json.loads(line)
    try:
        if cmd["op"] == "spawn":
            pidfile = cmd["pidfile"]
            subprocess.run([sys.executable, "-I", cmd["orphan"], cmd["cwd"], pidfile, *cmd["program"]],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30,
                           check=True)
            end = time.time() + 10
            while not os.path.exists(pidfile) and time.time() < end:
                time.sleep(0.02)
            out = dict(pid=int(open(pidfile).read()), reapers=sorted(reapers))
        elif cmd["op"] == "state":
            out = dict(state=json.loads(json.dumps(st)))
        elif missing is not None:
            out = dict(raised=missing)
        else:
            reap()
            for m, real in ps.items():
                m.PS = cmd.get("ps") or real
            out = dict(lines=_pmorphanevent.tick(st, now=cmd["now"], reapers=frozenset(reapers)))
    except Exception as e:
        out = dict(raised=repr(e))
    print(json.dumps(out), flush=True)
"""
FAILING_PS = "#!/bin/sh\nexit 1\n"
PM_CHECK = f"""#!{sys.executable} -I
import time
end = time.time() + 120
while time.time() < end:
    time.sleep(1)
"""
# impeccable's live-server as `ps` shows it: bash under the name `impeccable` with the word `live-server`
LIVE_SERVER = """#!/bin/bash
exec -a impeccable /bin/bash -c 'end=$((SECONDS+120)); while [ $SECONDS -lt $end ]; do sleep 0.2; done' \\
    live-server "$@"
"""
SLEEP = ["/bin/sleep", "120"]  # an orphan of another name than the Python stand-in


def ps_row(pid):
    """(ppid, stat, lstart, command) of a live PID as `ps` gives it, or None when `ps` lists no such PID."""
    p = subprocess.run([PS, "-o", "ppid=,stat=,lstart=,command=", "-p", str(pid)], capture_output=True, text=True,
                       env=PS_ENV, timeout=10, stdin=subprocess.DEVNULL)
    words = p.stdout.split(None, 7) if p.returncode == 0 else []
    if len(words) < 7:
        return None
    return int(words[0]), words[1], " ".join(words[2:7]), words[7] if len(words) > 7 else ""


class Orphan:
    """A stand-in the driver started: its PID, its start time, and the name `ps`'s command line gives it."""

    def __init__(self, pid, row):
        self.pid = pid
        self.start = row[2]
        self.name = os.path.basename(row[3].split()[0]) if row[3].split() else "?"

    def alive(self):
        row = ps_row(self.pid)
        return row is not None and row[2] == self.start and not row[1].startswith("Z")

    def end(self, sig=signal.SIGKILL):
        """Signal the stand-in by its PID, only while that PID still has the start time it had when it was made."""
        if self.alive():
            try:
                os.kill(self.pid, sig)
            except (ProcessLookupError, PermissionError):
                pass


class Driver:
    """One driver process for one case."""

    def __init__(self, case, f, state=None, reapers=()):
        """`state`: a JSON file the driver starts from (a restarted daemon); `reapers`: PIDs added to its own."""
        self.case, self.f = case, f
        self.reapers = []
        f.drivers += 1
        self.err = f.co / "output" / f"driver-{f.drivers}.err"
        with open(self.err, "w") as err:
            self.p = subprocess.Popen([sys.executable, "-I", "-c", DRIVER, str(f.co / ".pm" / "bin"),
                                       str(state or ""), ",".join(map(str, reapers))],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, text=True,
                                      env=clean_env(), cwd=str(f.co))
        case.addCleanup(self.close)

    def call(self, **cmd):
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
            self.case.fail(f"the driver gave no answer ({how}): {self.err.read_text()[-2000:]}")
        return json.loads(line)

    def tick(self, now, ps=None):
        """The lines of one call of tick; fails the case when tick raised or returned something else than a list."""
        out = self.call(op="tick", now=now, ps=str(ps) if ps else None)
        self.case.assertNotIn("raised", out, f"tick raised {out.get('raised')}")
        self.case.assertIsInstance(out["lines"], list, out)
        return out["lines"]

    def state(self):
        out = self.call(op="state")
        self.case.assertNotIn("raised", out, out.get("raised"))
        return out["state"]

    def orphan(self, where, program=()):
        """A stand-in orphan started by the driver with its cwd in `where` (a worktree's name, "F", or a path); with
        `program`, the orphan is that program."""
        cwd = self.f.co if where == "F" else self.f.wt[where] if where in self.f.wt else where
        self.f.n += 1
        pidfile = self.f.co / "output" / "pids" / f"{self.f.n}.pid"
        pidfile.parent.mkdir(parents=True, exist_ok=True)
        out = self.call(op="spawn", orphan=str(self.f.orphan_py), cwd=str(cwd), pidfile=str(pidfile),
                        program=list(program))
        self.case.assertNotIn("raised", out, f"the stand-in did not start: {out.get('raised')}")
        self.reapers = out["reapers"]
        row = ps_row(out["pid"])
        self.case.assertIsNotNone(row, f"the stand-in {out['pid']} is not running")
        o = Orphan(out["pid"], row)
        self.case.addCleanup(o.end)
        self.case.assertIn(row[0], out["reapers"], f"the orphan's parent is {row[0]}, not one of the reapers "
                                                    f"{out['reapers']}")
        return o

    def close(self):
        if self.p.poll() is None:
            self.p.kill()
        self.p.wait(timeout=30)
        for f in (self.p.stdin, self.p.stdout):
            try:
                f.close()
            except OSError:
                pass


class Fixture:
    """`F` and its three worktrees for one case."""

    def __init__(self, case, name):
        self.case = case
        self.co = make(GROUP, name, SCRIPTS)
        self.wt = {}
        for w in WORKTREES:
            p = CHECKOUT / "output" / "tests" / GROUP / f"{name}-{w}"
            if p.exists():
                shutil.rmtree(p)
            p.mkdir(parents=True)
            self.wt[w] = p.resolve()
        self.n = 0
        self.drivers = 0
        self.standins = self.co / "output" / "standins"
        self.standins.mkdir(parents=True)
        self.orphan_py = self.program("orphan.py", ORPHAN)
        run = self.co / ".pm" / "run"
        run.mkdir(parents=True, exist_ok=True)
        (run / "worktrees.json").write_text(json.dumps(
            [dict(name=w, path=str(self.wt[w]), issue="1", unit=f"t{i}", branch=f"feat/1-t{i}")
             for i, w in enumerate(WORKTREES, 1)]))

    def program(self, name, text):
        p = self.standins / name
        p.write_text(text)
        p.chmod(0o755)
        return p

    def pane(self, gone=False):
        """Register `P`, the pane i1-worker-h1 whose cwd is wt-a."""
        (self.co / ".pm" / "run" / "panes.json").write_text(json.dumps([dict(
            name=PANE, issue="1", role="worker", unit="h1", kind="claude", model="claude-opus-5-5", side="harness",
            pane_id="w1-p2", tab_id="w1-t1", cwd=str(self.wt["wt-a"]), brief=None, started="2026-11-18T00:00:00",
            session=None, gone=gone, resets=0)]))

    def crit(self):
        """Register the live crit pane i1-crit of issue 1 (every worktree's issue), cwd F, as pm-pane does."""
        (self.co / ".pm" / "run" / "panes.json").write_text(json.dumps([dict(
            name="i1-crit", issue="1", role="crit", unit=None, kind="claude", model="claude-opus-5-5", side="other",
            pane_id="w1-p3", tab_id="w1-t1", cwd=str(self.co), brief=None, started="2026-11-18T00:00:00",
            session=None, gone=False, resets=0)]))

    def check_running(self, d, wt="wt-a"):
        """A pm-check stand-in, an orphan in `wt`, recorded live in <wt>/output/checks/running.json."""
        o = d.orphan(wt, [str(self.program("pm-check", PM_CHECK)), "run"])
        f = self.wt[wt] / "output" / "checks" / "running.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(dict(pm_check_pid=o.pid, pgid=o.pid, step="harness-test", started="")))
        return o

    def tests_dir(self, wt="wt-a"):
        d = self.wt[wt] / "output" / "tests" / "group" / "case"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def live_server(self, d, wt="wt-a"):
        """impeccable's live-server stand-in, an orphan in `wt`, once `ps` names it `impeccable`."""
        o = d.orphan(wt, [str(self.program("live-server", LIVE_SERVER)), "--port=8400", f"--target={self.wt[wt]}"])
        end = time.time() + CALL_WAIT
        while True:
            row = ps_row(o.pid)
            if row and row[3].split()[:1] == ["impeccable"]:
                return o
            self.case.assertLess(time.time(), end, f"the live-server stand-in is {row}")
            time.sleep(0.05)

    def driver(self, state=None, reapers=()):
        return Driver(self.case, self, state, reapers)


def now0():
    return float(int(time.time()))


def event(wt, orphans, again=False, pane=None):
    """The pattern of a whole event line for `orphans`, with any integer CPU percent."""
    names = {}
    for o in orphans:
        names[o.name] = names.get(o.name, 0) + 1
    groups = ",".join(f"{re.escape(n)}×{k}" for n, k in sorted(names.items(), key=lambda x: (-x[1], x[0])))
    pids = ",".join(str(p) for p in sorted(o.pid for o in orphans))
    tail = f" pane={re.escape(pane)}" if pane else ""
    return (rf"EVENT orphans {'again ' if again else ''}{re.escape(wt)} {len(orphans)} \d+% {groups} "
            rf"pids={pids}{tail}")


def wait_gone(case, o):
    """End a stand-in this case started and wait, bounded, until `ps` no longer shows it alive."""
    o.end()
    end = time.time() + GONE_WAIT
    while o.alive() and time.time() < end:
        time.sleep(0.05)
    case.assertFalse(o.alive(), f"the stand-in {o.pid} is still alive {GONE_WAIT} s after SIGKILL")


class Tick(unittest.TestCase):
    def setup(self, name, pane=None):
        f = Fixture(self, name)
        if pane is not None:
            f.pane(gone=pane == "gone")
        return f, f.driver(), now0()

    def assertLines(self, lines, patterns, why=""):
        self.assertEqual(len(lines), len(patterns), f"{why} lines {lines}")
        for line, pattern in zip(sorted(lines), sorted(patterns)):
            self.assertRegex(line, f"^{pattern}$", why)

    def test_an_orphan_at_its_first_look_is_no_line(self):
        _, d, t = self.setup("first-look")
        d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])

    def test_still_there_60_s_later_is_one_line(self):
        _, d, t = self.setup("held")
        o = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", [o])])

    def test_a_live_pane_in_the_worktree_is_named_and_a_gone_one_is_not(self):
        _, d, t = self.setup("pane-live", pane="live")
        o = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", [o], pane=PANE)], "P live")
        _, d, t = self.setup("pane-gone", pane="gone")
        o = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", [o])], "P gone")

    def test_nothing_changed_is_no_line(self):
        _, d, t = self.setup("unchanged")
        o = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", [o])])
        self.assertEqual(d.tick(t + 90), [])

    def test_a_second_orphan_is_told_with_the_first_after_its_own_60_s(self):
        _, d, t = self.setup("second")
        o1 = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", [o1])])
        o2 = d.orphan("wt-a")
        self.assertEqual(d.tick(t + 90), [])
        self.assertLines(d.tick(t + 150), [event("wt-a", [o1, o2])])

    def test_again_once_300_s_after_a_line_with_pane_regression(self):
        _, d, t = self.setup("again", pane="live")
        o1, o2 = d.orphan("wt-a"), d.orphan("wt-a")
        T = t + 60
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(T), [event("wt-a", [o1, o2], pane=PANE)])
        wait_gone(self, o1)
        self.assertEqual(d.tick(T + 270), [], "before AGAIN")
        self.assertLines(d.tick(T + 300), [event("wt-a", [o2], again=True, pane=PANE)], "at AGAIN")
        self.assertEqual(d.tick(T + 600), [], "told once")

    def test_no_again_after_a_line_without_pane(self):
        _, d, t = self.setup("no-again")
        o = d.orphan("wt-a")
        T = t + 60
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(T), [event("wt-a", [o])])
        self.assertEqual(d.tick(T + 300), [])

    def test_a_later_line_for_a_new_pid_does_not_put_again_off(self):
        _, d, t = self.setup("again-kept", pane="live")
        o1 = d.orphan("wt-a")
        T = t + 60
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(T), [event("wt-a", [o1], pane=PANE)])
        o2 = d.orphan("wt-a")
        self.assertEqual(d.tick(T + 140), [])
        self.assertLines(d.tick(T + 200), [event("wt-a", [o1, o2], pane=PANE)])
        self.assertEqual(d.tick(T + 270), [])
        self.assertLines(d.tick(T + 300), [event("wt-a", [o1, o2], again=True, pane=PANE)], "at T+300")
        self.assertEqual(d.tick(T + 500), [], "not at T+500")

    def test_a_new_orphan_after_a_gone_one_is_told_after_its_own_60_s(self):
        _, d, t = self.setup("gone-new")
        o1 = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", [o1])])
        wait_gone(self, o1)
        self.assertEqual(d.tick(t + 90), [], "the orphan is gone")
        o2 = d.orphan("wt-a")
        self.assertEqual(d.tick(t + 120), [], "the new orphan's first look")
        self.assertEqual(d.tick(t + 150), [], "30 s after it")
        self.assertLines(d.tick(t + 180), [event("wt-a", [o2])], "60 s after it")

    def test_a_restarted_daemon_does_not_tell_again(self):
        f, d, t = self.setup("restart", pane="live")
        o = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", [o], pane=PANE)])
        saved = f.co / "output" / "watchd-state.json"
        saved.write_text(json.dumps(d.state()))
        # a new process from the saved state alone; the first driver stays, as on Linux it is the orphan's parent
        d2 = f.driver(state=saved, reapers=d.reapers)
        self.assertEqual(d2.tick(t + 90), [], "the restarted daemon told the set again")
        self.assertLines(d2.tick(t + 360), [event("wt-a", [o], again=True, pane=PANE)],
                         "the restarted daemon did not keep what it had told (again 300 s after the line)")

    def test_less_than_30_s_after_a_look_is_no_look(self):
        _, d, t = self.setup("look")
        self.assertEqual(d.tick(t), [])
        o = d.orphan("wt-a")
        self.assertEqual(d.tick(t + 29), [], "29 s after the look")
        self.assertEqual(d.tick(t + 30), [], "the look that first sees it")
        self.assertEqual(d.tick(t + 89), [], "59 s after the look that first saw it (60 s after t+29)")
        self.assertLines(d.tick(t + 120), [event("wt-a", [o])])

    def test_a_ps_that_fails_is_no_line_and_no_change(self):
        f, d, t = self.setup("ps-fails")
        o = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        before = d.state()
        self.assertEqual(d.tick(t + 60, ps=f.program("ps", FAILING_PS)), [])
        self.assertEqual(d.state(), before, "the state changed on a failed look")
        self.assertLines(d.tick(t + 61), [event("wt-a", [o])], "the next look with the real ps")

    def test_an_orphan_in_the_main_checkout_is_no_line(self):
        _, d, t = self.setup("main")
        d.orphan("F")
        self.assertEqual(d.tick(t), [])
        self.assertEqual(d.tick(t + 60), [])

    def test_one_line_per_worktree_with_the_names_grouped(self):
        _, d, t = self.setup("two-worktrees")
        # wt-a: the Python stand-in once and sleep twice, so the most common name sorts after the other by name;
        # wt-b: one of each, sleep started first, so a tie is ordered by name and not by PID
        a1, a2, a3 = d.orphan("wt-a"), d.orphan("wt-a", SLEEP), d.orphan("wt-a", SLEEP)
        b1, b2 = d.orphan("wt-b", SLEEP), d.orphan("wt-b")
        self.assertEqual((a2.name, a3.name, b1.name), ("sleep", "sleep", "sleep"))
        self.assertNotEqual(a1.name, "sleep")
        self.assertLess(a1.name, "sleep", "the Python stand-in's name must sort before sleep for the tie")
        self.assertEqual(d.tick(t), [])
        lines = d.tick(t + 60)
        self.assertLines(lines, [event("wt-a", [a1, a2, a3]), event("wt-b", [b1, b2])])
        self.assertTrue(any(f" sleep×2,{a1.name}×1 " in line for line in lines), f"most first: {lines}")
        self.assertTrue(any(f" {b2.name}×1,sleep×1 " in line for line in lines), f"a tie by name: {lines}")

    def test_a_running_check_s_stand_in_is_not_told_and_an_orphan_beside_it_is(self):
        """issue 477"""
        f, d, t = self.setup("check-own")
        check = f.check_running(d)
        own = d.orphan(str(f.tests_dir()))
        other = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", [other])])
        self.assertTrue(own.alive())
        (f.wt["wt-a"] / "output" / "checks" / "running.json").unlink()
        self.assertEqual(d.tick(t + 90), [], "the check ended: its stand-in's first look as an orphan")
        self.assertLines(d.tick(t + 150), [event("wt-a", [other, own, check])], "60 s after the check ended")

    def test_a_live_crit_s_live_server_is_not_told_and_an_orphan_beside_it_is(self):
        """issue 477"""
        f, d, t = self.setup("live-server")
        f.crit()
        f.live_server(d)
        other = d.orphan("wt-a")
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", [other])])

    def test_the_event_stops_nothing(self):
        _, d, t = self.setup("stops-nothing", pane="live")
        orphans = [d.orphan("wt-a"), d.orphan("wt-a")]
        self.assertEqual(d.tick(t), [])
        self.assertLines(d.tick(t + 60), [event("wt-a", orphans, pane=PANE)])
        self.assertEqual([o.pid for o in orphans if not o.alive()], [], "an orphan was stopped")


def calls_of(tree, module, func="tick"):
    """The names under which `tree` can call `module`.`func`: (function names, module names)."""
    funcs, mods = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == module:
            funcs |= {a.asname or a.name for a in node.names if a.name == func}
        if isinstance(node, ast.Import):
            mods |= {a.asname or a.name for a in node.names if a.name == module}
    return funcs, mods


def extend_calls(fn, names):
    """The `events.extend(<tick>(st, …))` calls in `fn` whose tick is one of `names`, as (line, column)."""
    funcs, mods = names
    out = []
    for node in ast.walk(fn):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "extend"
                and isinstance(node.func.value, ast.Name) and node.func.value.id == "events" and node.args):
            continue
        inner = node.args[0]
        if not isinstance(inner, ast.Call):
            continue
        f = inner.func
        named = (isinstance(f, ast.Name) and f.id in funcs) or (
            isinstance(f, ast.Attribute) and f.attr == "tick" and isinstance(f.value, ast.Name) and f.value.id in mods)
        if named and inner.args and isinstance(inner.args[0], ast.Name) and inner.args[0].id == "st":
            out.append((node.lineno, node.col_offset))
    return out


class Daemon(unittest.TestCase):
    def test_run_calls_the_orphan_tick_after_the_still_tick(self):
        tree = ast.parse((CHECKOUT / ".pm" / "bin" / "pm-watchd").read_text())
        run = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"), None)
        self.assertIsNotNone(run, "pm-watchd has no function run")
        still = extend_calls(run, calls_of(tree, "_pmstill"))
        orphans = extend_calls(run, calls_of(tree, "_pmorphanevent"))
        self.assertEqual(len(still), 1, "run has no events.extend(<_pmstill tick>(st))")
        self.assertTrue(orphans, "run has no events.extend(<_pmorphanevent tick>(st, …)): pm-watchd does not call it")
        self.assertGreater(min(orphans), still[0], "the _pmorphanevent tick comes before _pmstill's")


def flat(text):
    return " ".join(text.split())


def help_of(script):
    """`<script> --help` of a fixture's copy, run with no herdr session and no git variables in its environment."""
    co = make(GROUP, f"help-{script}", SCRIPTS)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("HERDR_", "GIT_"))}
    return subprocess.run([sys.executable, "-I", str(co / ".pm" / "bin" / script), "--help"], capture_output=True,
                          text=True, env=env, cwd=str(co), timeout=60, stdin=subprocess.DEVNULL)


def table_rows(text):
    rows = []
    for line in text.splitlines():
        if line.startswith("|"):
            rows.append([x.strip() for x in line.strip().strip("|").split("|")])
    return rows


class Texts(unittest.TestCase):
    def test_the_daemons_docstring_lists_both_lines(self):
        doc = ast.get_docstring(ast.parse((CHECKOUT / ".pm" / "bin" / "pm-watchd").read_text())) or ""
        lines = [line.strip() for line in doc.splitlines()]
        for wanted in ("EVENT orphans <worktree> <n> <cpu>% <name>×<k>,… pids=<pid>,… [pane=<pane>]",
                       "EVENT orphans again <worktree> …"):
            with self.subTest(wanted):
                self.assertTrue(any(line.startswith(wanted) for line in lines),
                                f"no line of pm-watchd's docstring starts with {wanted!r}")

    def test_the_skills_events_table_has_both_rows(self):
        rows = table_rows((CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md").read_text())
        pane = [r for r in rows if len(r) > 1 and "EVENT orphans" in r[0] and "pane=<pane>" in r[0]
                and "again" not in r[0]]
        self.assertEqual(len(pane), 1, f"no single row for `EVENT orphans … pane=<pane>`: {pane}")
        self.assertIn("prompt", pane[0][1], pane[0])
        self.assertIn("PID", pane[0][1], pane[0])
        stop = [r for r in rows if len(r) > 1 and "EVENT orphans again" in r[0] and "without" in r[0]
                and "pane=" in r[0]]
        self.assertEqual(len(stop), 1, f"no single row for `EVENT orphans again …` and `EVENT orphans` without "
                                       f"`pane=`: {stop}")
        self.assertIn("pm-worktree orphans <worktree> --stop", stop[0][1], stop[0])

    def test_the_skills_orphans_rows_say_what_to_look_at_first(self):
        """issue 477"""
        rows = table_rows((CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md").read_text())
        pane = [r for r in rows if len(r) > 1 and "EVENT orphans" in r[0] and "pane=<pane>" in r[0]
                and "again" not in r[0]]
        stop = [r for r in rows if len(r) > 1 and "EVENT orphans again" in r[0] and "without" in r[0]]
        self.assertEqual((len(pane), len(stop)), (1, 1), f"{pane} {stop}")
        act = pane[0][1]
        self.assertIn("First look: `pm-worktree orphans <worktree>`", act, pane[0])
        self.assertLess(act.index("pm-worktree orphans <worktree>"), act.index("prompt"), pane[0])
        for row in (act, stop[0][1]):
            for wanted in ("left running", "running check", "live crit"):
                with self.subTest(wanted, row=row[:40]):
                    self.assertIn(wanted, row)
        self.assertIn("no longer lists is left alone", act, pane[0])

    def test_lead_says_what_the_sweep_of_reset_and_close_leaves_running(self):
        """issue 477"""
        text = flat((CHECKOUT / ".agents" / "skills" / "pm" / "references" / "lead.md").read_text())
        m = re.search(r"`EVENT orphans` is the machine's and goes to the `pm`.*?not yours to stop\.", text)
        self.assertIsNotNone(m, "lead.md does not say where `EVENT orphans` goes and what reset and close leave")
        for wanted in ("pm-pane reset", "close", "left running:", "running check", "live crit", "Before you act"):
            with self.subTest(wanted):
                self.assertIn(wanted, m.group(0))

    def test_the_helps_name_what_the_sweep_leaves_out(self):
        """issue 477"""
        for script in ("pm-pane", "pm-worktree"):
            r = help_of(script)
            self.assertEqual(r.returncode, 0, r.stderr)
            text = flat(r.stdout)
            for wanted in ("left running:", "output/tests/", "live-server", "crit pane"):
                with self.subTest(script=script, wanted=wanted):
                    self.assertIn(wanted, text)

    def test_pane_mode_machine_says_how_a_run_is_started_and_stopped(self):
        text = (CHECKOUT / ".agents" / "skills" / "pm" / "references" / "pane-mode.md").read_text()
        m = re.search(r"^## Machine\n(.*?)(?=^## )", text, re.S | re.M)
        self.assertIsNotNone(m, "pane-mode.md has no section Machine")
        machine = flat(m.group(1))
        for wanted in ("background mode", "foreground call", "never", "detached", "`&`", "nohup", "setsid",
                       "whole", "TaskStop", "pm-check --stop"):
            with self.subTest(wanted):
                self.assertTrue(wanted in machine, f"pane-mode.md's Machine does not say {wanted!r}")
        with self.subTest("( … &)"):
            self.assertTrue("( … &)" in machine or "( ... &)" in machine,
                            "pane-mode.md's Machine does not name `( … &)`")

    def test_pm_pane_help_names_the_sweep(self):
        r = help_of("pm-pane")
        self.assertEqual(r.returncode, 0, r.stderr)
        text = flat(r.stdout)
        self.assertTrue(re.search(r"reset.{0,60}close.{0,60}orphaned processes of the pane's worktree", text),
                        "pm-pane --help does not say reset and close stop the orphaned processes of the pane's "
                        "worktree")
        self.assertTrue("main checkout is not swept" in text,
                        "pm-pane --help does not say a pane in the main checkout is not swept")

    def test_pm_worktree_help_names_orphans_and_the_sweep_of_rm(self):
        r = help_of("pm-worktree")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue("pm-worktree orphans [<name>] [--stop]" in r.stdout,
                        "pm-worktree --help does not show pm-worktree orphans [<name>] [--stop]")
        segments, cur = [], None
        for line in r.stdout.splitlines():
            if not line.strip() or line.startswith(("new ", "rm ", "list", "orphans")):
                if cur is not None:
                    segments.append(flat(" ".join(cur)))
                cur = [line] if line.startswith("rm ") else None
            elif cur is not None:
                cur.append(line)
        if cur is not None:
            segments.append(flat(" ".join(cur)))
        self.assertTrue(segments, "pm-worktree --help has no text on rm")
        self.assertTrue(any("worktree's orphaned processes" in s and "first" in s for s in segments),
                        f"pm-worktree --help does not say rm stops the worktree's orphaned processes first: {segments}")


if __name__ == "__main__":
    unittest.main()
