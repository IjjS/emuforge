"""The orphaned processes of a worktree: finding them, stopping them, the sweep, `pm-worktree orphans` and `rm`,
and the sweep of `pm-pane reset` and `close` (issue 472, R1 to R5); and what they all leave out (issue 477): a running
pm-check's own stand-ins and a live crit's live-server.

Check id `harness.orphans`. One class per `Unit` heading of the issue's test criteria (`## test_orphans.py`).

Every case runs on its own fixture checkout `F` (`_fixture.make`), so `_pmlib.ROOT` is `F` and the real `.pm/run` is
never read or written. `F/.pm/run/worktrees.json` names three worktrees, sibling folders of `F` (never inside it):
`wt-a`, `wt-a-b` (its path is `wt-a`'s with `-b` appended: the prefix trap) and `wt-b`; the `rm` cases add `wt-r`,
a real `git worktree add` of `F`, registered as `pm-worktree new` registers one.

The library is reached through a driver: a child process that imports the fixture's `_pmorphans`, may set its
`GRACE`, `SETTLE`, `POLL`, `BOUND`, `PS` and `LSOF`, runs one call per request and answers with its result or the
exception it raised, so a missing `_pmorphans` fails each case with its own message. The driver also starts the
library cases' stand-ins. On Linux it makes itself a child subreaper and passes the reapers `{1, <its PID>}`, so what
its stand-ins orphan is held by it; on macOS the reapers are `{1}`. The command cases start their stand-ins
themselves and first assert that a stand-in's parent is 1.

Stand-ins, written by each case under `F/output/standins/`: `orphan.py <cwd> <pidfile> [--ignore-term] [--after <s>]
[--child <cwd2>] [--on-term-spawn <cwd3>] [--move-on-usr1 <cwd4>] [--role <role>]` (the starter forks and exits at
once, so the child's parent is a reaper; the child writes `<role> <pid>` lines to the pid file and sleeps up to a
120 s bound; none spins a core); `launch.py` (starts processes in its own group, records them and exits, so they are
orphans of one group); a `pm-check` stand-in; `ps` and `lsof` stand-ins that exit 1 or 2, print a line `ps` would
not print, sleep past `BOUND`, or print the real table with the `uid` of named PIDs changed; and, first on PATH for
the commands, a `herdr` stand-in and a `docker` stand-in; and `live-server`, impeccable's live-server as `ps` shows
it (bash run under the name `impeccable` with the word `live-server`), started through `launch.py`. For issue 477 a
case records the `pm-check` stand-in, started through `launch.py`, as a live run in `wt-a/output/checks/
running.json`, starts its "tests' stand-ins" under `wt-a/output/tests/`, and registers the crit pane `i1-crit` of
issue 1 (every fixture worktree's issue) in `F/.pm/run/panes.json`. The herdr stand-in answers `agent list`,
`pane list`, `agent wait`, `agent prompt`, `pane wait-output` and `pane close`, appends each call to
`F/output/herdr-calls.log`, and for the `/clear` prompt and the brief prompt also whether each PID of the case's pid files is alive. For a
command case where `ps` fails, the fixture's copy of `_pmorphans.py` has its `PS` set to the stand-in that exits 1.

Every PID a case made is killed at the case's end, whether it passed or not, after checking that its command line
names the case's fixture folder. Nothing is signalled by name or pattern, and no process group is signalled.
"""
import ast
import datetime as dt
import json
import os
import pathlib
import re
import select
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
import unittest

from _fixture import BIN, CHECKOUT, clean_env, git, make, run

GROUP = "orphans"
SCRIPTS = ["pm-pane", "pm-worktree", "pm-watchd", "pm-emulator-dir"]
PY = sys.executable
LINUX = sys.platform.startswith("linux")
REAL_PS = "/bin/ps" if os.path.exists("/bin/ps") else "/usr/bin/ps"
CALL_WAIT = 90     # seconds a case waits for one answer of the driver
READY_WAIT = 10    # seconds a case waits for a stand-in to be in place
GONE_WAIT = 10     # seconds a case waits for a stopped process to be gone
COMMAND_WAIT = 120  # seconds one command may take
SETTLE = 5
GRACE = 0.5
OLD_START = "Thu Jan  1 00:00:00 1970"
SUBREAPER = "the orphan's parent is {}, not 1: a subreaper holds it"

# probe/e1-orphan-cmd.txt of the issue: the command line of the fork worker that the 2026-11-18 `pkill` left behind
E1_CMD = ("/usr/local/bin/node --experimental-import-meta-resolve --require /private/tmp/claude-501/-Users-injae-"
          "Documents-GitHub-emuforge/520bbb26-0d90-40af-b9aa-4cbe6df75b21/scratchpad/wt472/studio/node_modules/vitest/"
          "suppress-warnings.cjs --conditions node --conditions development /private/tmp/claude-501/-Users-injae-"
          "Documents-GitHub-emuforge/520bbb26-0d90-40af-b9aa-4cbe6df75b21/scratchpad/wt472/studio/node_modules/vitest/"
          "dist/workers/forks.js")

ORPHAN = f'''#!{PY} -I
"""Stand-in orphan: the starter forks and exits at once; the child records itself and sleeps up to 120 s."""
import os, signal, subprocess, sys, time
args = sys.argv[1:]
cwd, pidfile, opts, i = args[0], args[1], {{}}, 2
while i < len(args):
    if args[i] == "--ignore-term":
        opts[args[i]] = True
        i += 1
    else:
        opts[args[i]] = args[i + 1]
        i += 2
role = opts.get("--role", "orphan")


def record(r, pid):
    with open(pidfile, "a") as f:
        f.write(f"{{r}} {{pid}}\\n")


def rest():
    end = time.time() + 120
    while time.time() < end:
        time.sleep(0.2)
    os._exit(0)


if os.fork():
    os._exit(0)
fd = os.open(os.devnull, os.O_RDWR)
for n in (0, 1, 2):
    os.dup2(fd, n)
if "--ignore-term" in opts:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
if "--on-term-spawn" in opts:
    def spawn(*_):
        subprocess.run([sys.executable, "-I", os.path.abspath(__file__), opts["--on-term-spawn"], pidfile,
                        "--role", "spawned"], stdin=fd, stdout=fd, stderr=fd, timeout=30)
        os._exit(0)
    signal.signal(signal.SIGTERM, spawn)
if "--move-on-usr1" in opts:
    def move(*_):
        os.chdir(opts["--move-on-usr1"])
        record("moved", os.getpid())
    signal.signal(signal.SIGUSR1, move)
if "--after" in opts:
    record(role, os.getpid())
    time.sleep(float(opts["--after"]))
os.chdir(cwd)
if "--child" in opts:
    if os.fork() == 0:
        os.chdir(opts["--child"])
        record("child", os.getpid())
        rest()
if "--after" not in opts:
    record(role, os.getpid())
rest()
'''

SLEEPER = f'''#!{PY} -I
import time
end = time.time() + 120
while time.time() < end:
    time.sleep(0.2)
'''

LAUNCH = f'''#!{PY} -I
"""Starts each [role, cwd, argv] of argv[2] in this process's group, records `<role> <pid>`, and exits at once."""
import json, os, subprocess, sys
pidfile, spec = sys.argv[1], json.loads(sys.argv[2])
with open(pidfile, "a") as f:
    for role, cwd, argv in spec:
        p = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
        f.write(f"{{role}} {{p.pid}}\\n")
os._exit(0)
'''

PS_UID = f'''#!{PY} -I
"""The real ps table, with the uid of the PIDs that uid.json names changed to its other uid."""
import json, os, re, subprocess, sys
spec = json.loads(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "uid.json")).read())
args = sys.argv[1:]
fields = []
for i, a in enumerate(args):
    if a == "-o" and i + 1 < len(args):
        fields += [f.split("=")[0] for f in args[i + 1].split(",")]
words = 0
for f in fields:
    if f == "uid":
        break
    words += 5 if f == "lstart" else 1
p = subprocess.run([{REAL_PS!r}, *args], capture_output=True, text=True)
out = []
for line in p.stdout.splitlines():
    parts = line.split()
    if "uid" in fields and parts and parts[0] in spec["pids"]:
        m = re.match(r"(\\s*(?:\\S+\\s+){{%d}})(\\S+)(.*)" % words, line, re.S)
        if m:
            line = m.group(1) + str(spec["uid"]) + m.group(3)
    out.append(line)
sys.stdout.write("\\n".join(out) + ("\\n" if out else ""))
sys.stderr.write(p.stderr)
sys.exit(p.returncode)
'''

DRIVER = r'''
"""Driver of the tests of _pmorphans: one JSON request per line on stdin, one JSON answer per line on stdout."""
import json, os, subprocess, sys, time

BIN_DIR = sys.argv[1]
sys.path.insert(0, BIN_DIR)
DETACHED = sys.argv[2:3] == ["--detached"]
if DETACHED:
    if os.fork():
        os._exit(0)
    fd = os.open(os.devnull, os.O_RDWR)
    for n in (0, 1, 2):
        os.dup2(fd, n)
    os.chdir(sys.argv[3])


def reapers():
    if not sys.platform.startswith("linux"):
        return frozenset({1})
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), "prctl PR_SET_CHILD_SUBREAPER failed")
    return frozenset({1, os.getpid()})


REAPERS = reapers()
try:
    import _pmorphans as M
    MISSING = None
except Exception as e:
    M, MISSING = None, f"{type(e).__name__}: {e}"
KEPT = []


def out_proc(p):
    return p._asdict() if hasattr(p, "_asdict") else {"not a Proc": repr(p)}


def in_proc(d):
    return M.Proc(**{f: d.get(f) for f in M.Proc._fields})


def out_result(v):
    if isinstance(v, M.CannotTell):
        return {"cannot_tell": str(v)}
    stopped, left = v
    out = {"stopped": [out_proc(p) for p in stopped], "left": [out_proc(p) for p in left]}
    if getattr(v, "kept", None):
        out["kept"] = [[out_proc(p), why] for p, why in v.kept]
    return out


def reap():
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return


def call(req):
    op = req["op"]
    if op == "spawn":
        p = subprocess.Popen(req["argv"], cwd=req["cwd"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
        if req.get("wait", True):
            p.wait(timeout=30)
        else:
            KEPT.append(p)
        return {"pid": p.pid, "reapers": sorted(REAPERS)}
    if op == "reapers":
        return sorted(REAPERS)
    if M is None:
        return None
    for k, v in req.get("set", {}).items():
        setattr(M, k, v)
    if op == "set":
        return None
    if op == "name_of":
        return M.name_of(req["command"])
    if op == "worktree_paths":
        return [list(x) for x in M.worktree_paths()]
    if op == "find":
        return [out_proc(p) for p in M.find(req["root"], reapers=REAPERS)]
    if op == "find_stop":
        found = M.find(req["root"], reapers=REAPERS)
        if req.get("start"):
            found = [p._replace(start=req["start"]) for p in found]
        return {"found": [out_proc(p) for p in found], **out_result(M.stop(found, req["root"], reapers=REAPERS))}
    if op == "stop":
        return out_result(M.stop([in_proc(d) for d in req["procs"]], req["root"], reapers=REAPERS))
    if op == "sweep":
        t = time.monotonic()
        r = M.sweep([tuple(x) for x in req["roots"]], reapers=REAPERS, settle_min=req.get("settle_min", 0))
        return {"result": {k: out_result(v) for k, v in r.items()}, "elapsed": time.monotonic() - t}
    if op == "scan_left":
        found, kept = M.scan_left([req["root"]], reapers=REAPERS)
        return {"found": [out_proc(p) for p in found[req["root"]]],
                "kept": [[out_proc(p), why] for p, why in kept[req["root"]]]}
    if op == "line":
        r = req["result"]
        if "cannot_tell" in r:
            v = M.CannotTell(r["cannot_tell"])
        elif "kept" in r:
            v = M.Swept([in_proc(d) for d in r["stopped"]], [in_proc(d) for d in r["left"]],
                        kept=[(in_proc(d), why) for d, why in r["kept"]])
        else:
            v = ([in_proc(d) for d in r["stopped"]], [in_proc(d) for d in r["left"]])
        return M.line(req["name"], v)
    raise ValueError(f"unknown op {op}")


def answer(req):
    reap()
    try:
        value = call(req)
        out = {"missing": MISSING} if M is None and req["op"] not in ("spawn", "reapers") else {"value": value}
    except Exception as e:
        out = {"raised": type(e).__name__, "text": str(e)}
    reap()
    return json.dumps(out, default=str)


if DETACHED:
    text = answer(json.loads(sys.argv[4]))
    tmp = sys.argv[5] + ".tmp"
    with open(tmp, "w") as f:
        f.write(json.dumps({"pid": os.getpid(), "answer": json.loads(text)}))
    os.replace(tmp, sys.argv[5])
    os._exit(0)
for line in sys.stdin:
    print(answer(json.loads(line)), flush=True)
'''

HERDR = f'''#!{PY} -I
"""Stand-in herdr for the tests of pm-pane; reads herdr.json beside it, records each call in its calls log."""
import json, os, pathlib, subprocess, sys
here = pathlib.Path(__file__).resolve().parent
cfg = json.loads((here / "herdr.json").read_text())
state_p = here / "herdr-state.json"
state = json.loads(state_p.read_text()) if state_p.exists() else {{"sessions": {{}}}}
args = sys.argv[1:]


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    r = subprocess.run([{REAL_PS!r}, "-o", "stat=", "-p", str(pid)], capture_output=True, text=True)
    return r.returncode == 0 and not r.stdout.strip().startswith("Z")


def pids():
    out = []
    for f in cfg["pidfiles"]:
        try:
            text = open(f).read()
        except OSError:
            continue
        out += [int(w.split()[1]) for w in text.splitlines() if len(w.split()) == 2]
    return out


entry = {{"args": args}}
if args[:2] == ["agent", "prompt"] and len(args) >= 4 and (args[3] == "/clear" or args[3].startswith("Read ")):
    entry["alive"] = {{str(p): alive(p) for p in pids()}}
with open(cfg["calls"], "a") as f:
    f.write(json.dumps(entry) + "\\n")
if args[:2] == ["agent", "list"]:
    print(json.dumps({{"result": {{"agents": [
        dict(name=n, pane_id=p, agent_status=cfg["status"], cwd=cfg["cwds"][n],
             agent_session={{"value": state["sessions"].get(n, "s1-" + n)}}) for n, p in cfg["panes"].items()]}}}}))
elif args[:2] == ["pane", "list"]:
    print(json.dumps({{"result": {{"panes": [dict(pane_id=p, agent="claude") for p in cfg["panes"].values()]}}}}))
elif args[:2] == ["agent", "prompt"]:
    if len(args) >= 4 and args[3] == "/clear":
        state["sessions"][args[2]] = "s2-" + args[2]
        state_p.write_text(json.dumps(state))
    print("{{}}")
elif args[:2] == ["pane", "wait-output"]:
    if cfg.get("no_marker"):
        sys.exit(1)
    print("{{}}")
elif args[:2] == ["pane", "close"]:
    if cfg.get("on_close"):
        subprocess.Popen(cfg["on_close"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True).wait(timeout=30)
    print("{{}}")
else:
    print("{{}}")
'''

# impeccable's live-server as `ps` shows it (`impeccable live-server --port=… --target=<dir>`): bash under the name
# `impeccable` with the word `live-server`; it sleeps in steps of 0.2 s up to a 120 s bound, so a child it leaves is
# gone at once
LIVE_SERVER = """#!/bin/bash
exec -a impeccable /bin/bash -c 'end=$((SECONDS+120)); while [ $SECONDS -lt $end ]; do sleep 0.2; done' \\
    live-server "$@"
"""
DOCKER = "#!/bin/sh\nexit 0\n"
PS_EXIT1 = "#!/bin/sh\nexit 1\n"
PS_GARBAGE = "#!/bin/sh\necho 'this is not a line of ps'\nexit 0\n"
SLOW = f"#!{PY} -I\nimport time\ntime.sleep(30)\n"
LSOF_EXIT2 = "#!/bin/sh\nexit 2\n"


def alive(pid):
    """True while `pid` runs and is not a zombie."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    r = subprocess.run([REAL_PS, "-o", "stat=", "-p", str(pid)], capture_output=True, text=True, timeout=30)
    return r.returncode == 0 and not r.stdout.strip().startswith("Z")


def ps_field(pid, field):
    r = subprocess.run([REAL_PS, "-o", f"{field}=", "-p", str(pid)], capture_output=True, text=True, timeout=30)
    return r.stdout.strip() if r.returncode == 0 else None


def exe_name(pid):
    """The basename of the first word of the process's command line, as `ps` shows it."""
    cmd = ps_field(pid, "command") or ""
    return os.path.basename(cmd.split()[0]) if cmd.split() else "?"


def lines(r):
    return r.stdout.splitlines()


def index_of(rows, pred, what):
    for i, row in enumerate(rows):
        if pred(row):
            return i
    raise AssertionError(f"no line {what} in:\n" + "\n".join(rows))


class Driver:
    """One driver process for one case."""

    def __init__(self, case):
        self.case = case
        self.err = case.standins / "driver.err"
        with open(self.err, "w") as err:
            self.p = subprocess.Popen([PY, "-I", str(case.standins / "driver.py"), str(case.co / ".pm" / "bin")],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, text=True,
                                      env=clean_env(), cwd=str(case.co), start_new_session=True)
        self.reapers = None

    def ask(self, op, **kw):
        try:
            self.p.stdin.write(json.dumps(dict(op=op, **kw)) + "\n")
            self.p.stdin.flush()
        except BrokenPipeError:
            pass
        ready, _, _ = select.select([self.p.stdout], [], [], CALL_WAIT)
        line = self.p.stdout.readline() if ready else ""
        if not line:
            how = "the driver ended" if ready else f"no answer within {CALL_WAIT} s"
            self.close()
            self.case.fail(f"{op} gave no answer ({how}): {self.err.read_text()[-2000:]}")
        out = json.loads(line)
        if "missing" in out:
            self.case.fail(f"_pmorphans cannot be imported from the fixture's .pm/bin: {out['missing']}")
        return out

    def call(self, op, **kw):
        out = self.ask(op, **kw)
        self.case.assertNotIn("raised", out, f"{op} raised {out.get('raised')}: {out.get('text')}")
        return out["value"]

    def raises(self, op, **kw):
        """(exception name, text) of a call that must raise."""
        out = self.ask(op, **kw)
        self.case.assertIn("raised", out, f"{op} raised nothing; it gave {out.get('value')!r}")
        return out["raised"], out["text"]

    def close(self):
        if self.p.poll() is None:
            try:
                self.p.stdin.close()
                self.p.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                self.p.kill()
                self.p.wait(timeout=30)
        try:
            self.p.stdout.close()
        except OSError:
            pass


class Case(unittest.TestCase):
    """A fixture checkout `F` with three registered sibling worktrees and the stand-ins."""

    def setUp(self):
        name = f"{type(self).__name__}-{self._testMethodName[5:]}"[:64]
        self.co = make(GROUP, name, SCRIPTS)
        self.pidfiles, self.pids, self.popens, self.driver = [], [], [], None
        self.addCleanup(self.end_processes)
        self.standins = self.co / "output" / "standins"
        (self.standins / "bin").mkdir(parents=True)
        self.stub = self.co / "output" / "stub"
        self.stub.mkdir(parents=True)
        for rel, text in {"orphan.py": ORPHAN, "sleeper.py": SLEEPER, "launch.py": LAUNCH, "driver.py": DRIVER,
                          "bin/pm-check": SLEEPER, "ps-uid": PS_UID, "ps-exit1": PS_EXIT1, "ps-garbage": PS_GARBAGE,
                          "ps-slow": SLOW, "lsof-exit2": LSOF_EXIT2, "lsof-slow": SLOW,
                          "live-server": LIVE_SERVER}.items():
            self.write(self.standins / rel, text)
        self.write(self.standins / "lsof-exit1", f"#!/bin/sh\necho started >> {shlex.quote(str(self.marker))}\nexit 1\n")
        self.write(self.stub / "herdr", HERDR)
        self.write(self.stub / "docker", DOCKER)
        self.wt = {}
        for n in ("wt-a", "wt-a-b", "wt-b", "wt-r", "elsewhere"):
            p = pathlib.Path(f"{self.co}-{n}")
            if p.exists():
                shutil.rmtree(p)
            if n != "wt-r":
                p.mkdir(parents=True)
            self.wt[n] = os.path.realpath(p)
        self.assertEqual(self.wt["wt-a-b"], self.wt["wt-a"] + "-b")
        self.registry([self.entry(n, i) for i, n in enumerate(("wt-a", "wt-a-b", "wt-b"))])

    @property
    def marker(self):
        return self.standins / "lsof-started"

    def write(self, path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        path.chmod(0o755)

    def entry(self, name, slot):
        return dict(name=name, path=self.wt[name], issue="1", unit=name[3:], branch=f"feat/1-{name[3:]}",
                    base="main", slot=slot, ports={"studio": 8190 + slot, "engine": 8390 + slot,
                                                   "emulator": 9390 + slot},
                    created="2026-11-18T00:00:00+00:00")

    def registry(self, entries):
        run_dir = self.co / ".pm" / "run"
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "worktrees.json").write_text(json.dumps(entries) if not isinstance(entries, str) else entries)

    # processes

    def drv(self, **settings):
        if self.driver is None:
            self.driver = Driver(self)
            self.driver.reapers = set(self.driver.call("reapers"))
        if settings:
            self.driver.call("set", set=settings)
        return self.driver

    def pidfile(self):
        f = self.standins / f"pids-{len(self.pidfiles)}.txt"
        f.touch()
        self.pidfiles.append(f)
        return f

    def roles(self, pidfile, want, bound=READY_WAIT):
        """{role: pid} of the pid file once it names every role of `want`."""
        end = time.time() + bound
        while True:
            got = {}
            for row in pidfile.read_text().splitlines():
                parts = row.split()
                if len(parts) == 2:
                    got.setdefault(parts[0], int(parts[1]))
            if all(r in got for r in want) or time.time() > end:
                self.assertTrue(all(r in got for r in want), f"the stand-in recorded {got}, not {want}")
                return got
            time.sleep(0.05)

    def orphaned(self, pid, allowed):
        """Waits until the parent of `pid` is one of `allowed`; fails with the subreaper message otherwise."""
        end = time.time() + READY_WAIT
        while True:
            ppid = ps_field(pid, "ppid")
            if ppid is not None and int(ppid) in allowed:
                return
            if time.time() > end:
                self.fail(SUBREAPER.format(ppid))
            time.sleep(0.05)

    def orphan(self, cwd, *opts, via="driver", want=None):
        """Starts orphan.py; returns {role: pid} once the stand-in recorded every role it will record first."""
        pidfile = self.pidfile()
        argv = [PY, "-I", str(self.standins / "orphan.py"), str(cwd), str(pidfile), *map(str, opts)]
        if via == "driver":
            self.drv().call("spawn", argv=argv, cwd=str(self.standins))
            allowed = self.driver.reapers
        else:
            subprocess.Popen(argv, cwd=str(self.standins), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True, env=clean_env()).wait(timeout=30)
            allowed = {1}
        want = want or (["orphan", "child"] if "--child" in opts else ["orphan"])
        got = self.roles(pidfile, want)
        self.orphaned(got["orphan"], allowed)
        return got

    def launch(self, spec):
        """launch.py in a group of its own, started by the driver: {role: pid} of what it started, and the group."""
        pidfile = self.pidfile()
        g = self.drv().call("spawn", argv=[PY, "-I", str(self.standins / "launch.py"), str(pidfile),
                                           json.dumps(spec)], cwd=str(self.standins))["pid"]
        got = self.roles(pidfile, [role for role, _, _ in spec])
        for pid in got.values():
            self.orphaned(pid, self.driver.reapers)
        return got, g

    def child(self, cwd):
        """A process of the case itself (a live parent) with its cwd at `cwd`."""
        p = subprocess.Popen([PY, "-I", str(self.standins / "sleeper.py")], cwd=str(cwd), stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.popens.append(p)
        return p.pid

    def gone(self, pid, bound=GONE_WAIT):
        end = time.time() + bound
        while alive(pid):
            if time.time() > end:
                return False
            time.sleep(0.05)
        return True

    def assertGone(self, pid):
        self.assertTrue(self.gone(pid), f"{pid} is still alive")

    def assertAlive(self, pid):
        self.assertTrue(alive(pid), f"{pid} is not alive")

    def end_processes(self):
        """Kills every PID this case made whose command line names the case's fixture folder."""
        mine = set(self.pids)
        for f in self.pidfiles:
            try:
                for row in f.read_text().splitlines():
                    parts = row.split()
                    if len(parts) == 2 and parts[1].isdigit():
                        mine.add(int(parts[1]))
            except OSError:
                pass
        for pid in sorted(mine):
            if alive(pid) and str(self.co) in (ps_field(pid, "command") or ""):
                try:
                    os.kill(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
        for p in self.popens:
            if p.poll() is None:
                p.kill()
            p.wait(timeout=30)
        if self.driver is not None:
            self.driver.close()
        for pid in sorted(mine):
            self.gone(pid)

    # results

    def pids_of(self, procs):
        return sorted(p["pid"] for p in procs)

    # what the sweep leaves out (issue 477)

    def check_running(self, wt="wt-a"):
        """A live pm-check stand-in, started in a group of its own and recorded in <wt>/output/checks/running.json;
        its PID."""
        got, g = self.launch([["pmcheck", self.wt[wt], [PY, "-I", str(self.standins / "bin" / "pm-check"), "run"]]])
        f = pathlib.Path(self.wt[wt]) / "output" / "checks" / "running.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(dict(pm_check_pid=got["pmcheck"], pgid=g, step="harness-test",
                                     started=dt.datetime.now().astimezone().isoformat(timespec="seconds"))))
        return got["pmcheck"]

    def tests_dir(self, wt="wt-a"):
        """<wt>/output/tests/<group>/<case>, where a harness test of a check running in <wt> works."""
        d = pathlib.Path(self.wt[wt]) / "output" / "tests" / "group" / "case"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def live_server(self, cwd):
        """impeccable's live-server stand-in, an orphan with its cwd at `cwd`; its PID once `ps` names it
        `impeccable`."""
        got, _ = self.launch([["live", str(cwd), [str(self.standins / "live-server"), "--port=8400",
                                                  f"--target={cwd}"]]])
        pid = got["live"]
        end = time.time() + READY_WAIT
        while exe_name(pid) != "impeccable":
            self.assertLess(time.time(), end, f"the live-server stand-in {pid} is {ps_field(pid, 'command')!r}")
            time.sleep(0.05)
        return pid

    def crit(self, issue="1", gone=False):
        """F/.pm/run/panes.json with the crit pane i<issue>-crit, cwd F (as pm-pane registers one)."""
        run_dir = self.co / ".pm" / "run"
        f = run_dir / "panes.json"
        reg = [r for r in (json.loads(f.read_text()) if f.exists() else []) if r.get("role") != "crit"]
        reg.append(dict(name=f"i{issue}-crit", issue=issue, role="crit", unit=None, kind="claude",
                        model="claude-opus-5-5", side="other", pane_id=f"p-crit-{issue}", tab_id="t1",
                        cwd=str(self.co), brief=None, started="2026-11-18T00:00:00+00:00", session=None, gone=gone,
                        resets=0))
        f.write_text(json.dumps(reg))


# ---------------------------------------------------------------------------------------------------------- Name

class Name(Case):
    """Given `_pmorphans.name_of(command)`. Fails on main: `_pmorphans` does not exist."""

    def name(self, command):
        return self.drv().call("name_of", command=command)

    def test_e1_fork_worker_is_forks_js(self):
        """regression"""
        self.assertEqual(self.name(E1_CMD), "forks.js")

    def test_vitest_bin_is_vitest(self):
        self.assertEqual(self.name("node /x/node_modules/.bin/vitest run src/x.test.ts"), "vitest")

    def test_node20_skips_options_and_their_values(self):
        self.assertEqual(self.name("node20 -r a.js --conditions node b.js"), "b.js")

    def test_bun_skips_run_and_x(self):
        self.assertEqual(self.name("bun run test:unit"), "test:unit")
        self.assertEqual(self.name("bun x vitest"), "vitest")

    def test_node_with_nothing_left_is_node(self):
        self.assertEqual(self.name("node --require"), "node")
        self.assertEqual(self.name("node"), "node")

    def test_other_program_is_its_basename(self):
        self.assertEqual(self.name("/usr/bin/python3 /x/y.py"), "python3")

    def test_empty_is_a_question_mark(self):
        self.assertEqual(self.name(""), "?")


# ----------------------------------------------------------------------------------------------------- Worktrees

class Worktrees(Case):
    """Given F's registry, `_pmorphans.worktree_paths()`. Fails on main: `_pmorphans` does not exist."""

    def paths(self):
        return [tuple(x) for x in self.drv().call("worktree_paths")]

    def three(self):
        return [(n, self.wt[n]) for n in ("wt-a", "wt-a-b", "wt-b")]

    def test_registry_order_and_real_paths(self):
        self.assertEqual(self.paths(), self.three())

    def test_symbolic_link_gives_the_real_path(self):
        link = pathlib.Path(f"{self.co}-link-b")
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(self.wt["wt-b"])
        entries = [self.entry(n, i) for i, n in enumerate(("wt-a", "wt-a-b"))]
        entries.append({**self.entry("wt-b", 2), "path": str(link)})
        self.registry(entries)
        self.assertEqual(self.paths(), self.three())

    def test_checkout_ancestor_under_relative_and_missing_are_left_out(self):
        under = self.co / "under"
        under.mkdir()
        bad = [("is-f", str(self.co)), ("ancestor", str(self.co.parent)), ("under", str(under)),
               ("relative", "output"), ("missing", f"{self.co}-missing")]
        entries = [self.entry("wt-a", 0)]
        for i, (n, p) in enumerate(bad):
            entries.append({**self.entry("wt-a", 10 + i), "name": n, "path": p})
        entries += [self.entry("wt-a-b", 1), self.entry("wt-b", 2)]
        self.registry(entries)
        self.assertEqual(self.paths(), self.three())

    def test_name_main_or_with_a_space_is_left_out(self):
        entries = [self.entry("wt-a", 0), {**self.entry("wt-b", 5), "name": "main", "path": self.wt["elsewhere"]},
                   self.entry("wt-a-b", 1), {**self.entry("wt-b", 6), "name": "has space",
                                             "path": self.wt["elsewhere"]}, self.entry("wt-b", 2)]
        self.registry(entries)
        self.assertEqual(self.paths(), self.three())

    def test_registry_that_does_not_parse_gives_none(self):
        self.registry("[{not json")
        self.assertEqual(self.paths(), [])


# ---------------------------------------------------------------------------------------------------------- Find

class Find(Case):
    """Given F, a driver, and stand-ins made by the case. Fails on main: `_pmorphans` does not exist, so nothing
    finds an orphan."""

    def find(self, name):
        return self.drv().call("find", root=self.wt[name])

    def running(self, record):
        f = pathlib.Path(self.wt["wt-a"]) / "output" / "checks" / "running.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(record if isinstance(record, str) else json.dumps(record))

    def record(self, pid, pgid):
        return dict(pm_check_pid=pid, pgid=pgid, step="harness",
                    started=dt.datetime.now().astimezone().isoformat(timespec="seconds"))

    def test_orphan_of_wt_a_is_found_with_its_name(self):
        pid = self.orphan(self.wt["wt-a"])["orphan"]
        found = self.find("wt-a")
        self.assertEqual(self.pids_of(found), [pid], found)
        self.assertEqual(found[0]["name"], exe_name(pid), found)
        self.assertEqual(self.find("wt-b"), [])

    def test_orphan_in_a_folder_under_the_worktree_is_found(self):
        """regression"""
        studio = pathlib.Path(self.wt["wt-a"]) / "studio"
        studio.mkdir()
        pid = self.orphan(studio)["orphan"]
        self.assertEqual(self.pids_of(self.find("wt-a")), [pid])

    def test_prefix_trap(self):
        pid = self.orphan(self.wt["wt-a-b"])["orphan"]
        self.assertEqual(self.pids_of(self.find("wt-a-b")), [pid])
        self.assertEqual(self.find("wt-a"), [])

    def test_child_inside_is_found_and_outside_is_not(self):
        sub = pathlib.Path(self.wt["wt-a"]) / "sub"
        sub.mkdir()
        inside = self.orphan(self.wt["wt-a"], "--child", sub)
        self.assertEqual(self.pids_of(self.find("wt-a")), sorted([inside["orphan"], inside["child"]]))
        outside = self.orphan(self.wt["wt-a"], "--child", self.wt["elsewhere"])
        found = self.pids_of(self.find("wt-a"))
        self.assertIn(outside["orphan"], found)
        self.assertNotIn(outside["child"], found)

    def test_process_with_a_live_parent_is_not_found(self):
        pid = self.child(self.wt["wt-a"])
        self.drv()
        self.assertEqual(self.find("wt-a"), [], f"the case's own child {pid} was found")

    def test_symbolic_link_that_resolves_outside_is_not_found(self):
        link = pathlib.Path(self.wt["wt-a"]) / "out-link"
        link.symlink_to(self.wt["elsewhere"])
        self.orphan(link)
        self.assertEqual(self.find("wt-a"), [])

    def test_recorded_live_pm_check_and_its_group_are_kept_out(self):
        wt = self.wt["wt-a"]
        got, g = self.launch([["pmcheck", wt, [PY, "-I", str(self.standins / "bin" / "pm-check"), "run"]],
                              ["orphan", wt, [PY, "-I", str(self.standins / "sleeper.py")]]])
        self.assertEqual(ps_field(got["orphan"], "pgid"), str(g))
        self.running(self.record(got["pmcheck"], g))
        self.assertEqual(self.find("wt-a"), [])

    def test_stale_record_keeps_nothing_out(self):
        dead = self.drv().call("spawn", argv=[PY, "-I", "-c", "pass"], cwd=str(self.standins))["pid"]
        got, g = self.launch([["orphan", self.wt["wt-a"], [PY, "-I", str(self.standins / "sleeper.py")]]])
        self.running(self.record(dead, g))
        self.assertIn(got["orphan"], self.pids_of(self.find("wt-a")))

    def test_record_of_a_pm_check_stop_keeps_nothing_out(self):
        wt = self.wt["wt-a"]
        got, g = self.launch([["pmcheck", wt, [PY, "-I", str(self.standins / "bin" / "pm-check"), wt, "--stop"]],
                              ["orphan", wt, [PY, "-I", str(self.standins / "sleeper.py")]]])
        self.running(self.record(got["pmcheck"], g))
        self.assertIn(got["orphan"], self.pids_of(self.find("wt-a")))

    def test_record_that_does_not_parse_keeps_nothing_out(self):
        pid = self.orphan(self.wt["wt-a"])["orphan"]
        self.running("{not json")
        self.assertEqual(self.pids_of(self.find("wt-a")), [pid])

    def test_the_driver_itself_is_not_found(self):
        answer = self.standins / "detached.json"
        req = json.dumps(dict(op="find", root=self.wt["wt-a"]))
        subprocess.Popen([PY, "-I", str(self.standins / "driver.py"), str(self.co / ".pm" / "bin"), "--detached",
                          self.wt["wt-a"], req, str(answer)], cwd=str(self.standins), stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
                         env=clean_env()).wait(timeout=30)
        end = time.time() + CALL_WAIT
        while not answer.exists() and time.time() < end:
            time.sleep(0.1)
        self.assertTrue(answer.exists(), "the detached driver gave no answer")
        got = json.loads(answer.read_text())
        self.pids.append(got["pid"])
        out = got["answer"]
        if "missing" in out:
            self.fail(f"_pmorphans cannot be imported from the fixture's .pm/bin: {out['missing']}")
        self.assertNotIn("raised", out, out)
        self.assertNotIn(got["pid"], self.pids_of(out["value"]), out)

    def test_other_uid_is_not_found(self):
        x = self.orphan(self.wt["wt-a"])["orphan"]
        y = self.orphan(self.wt["wt-a"], "--child", self.wt["wt-a"])
        other = 0 if os.getuid() != 0 else 1
        (self.standins / "uid.json").write_text(json.dumps({"pids": [str(x), str(y["child"])], "uid": other}))
        found = self.pids_of(self.drv(PS=str(self.standins / "ps-uid")).call("find", root=self.wt["wt-a"]))
        self.assertNotIn(x, found)
        self.assertNotIn(y["child"], found)
        self.assertIn(y["orphan"], found)

    def test_ps_failing_is_cannot_tell(self):
        self.orphan(self.wt["wt-a"])
        d = self.drv(BOUND=1)
        for ps, want in (("ps-exit1", "ps failed: exit 1"), ("ps-garbage", "ps line not understood: "),
                         ("ps-slow", "ps timed out")):
            with self.subTest(ps=ps):
                name, text = d.raises("find", root=self.wt["wt-a"], set={"PS": str(self.standins / ps)})
                self.assertEqual(name, "CannotTell", text)
                if want.endswith(": "):
                    self.assertTrue(text.startswith(want), text)
                else:
                    self.assertEqual(text, want)

    def test_cwds_lsof(self):
        pid = self.orphan(self.wt["wt-a"])["orphan"]
        d = self.drv(BOUND=1, SETTLE=1, GRACE=GRACE)
        if LINUX:
            found = d.call("find", root=self.wt["wt-a"], set={"LSOF": str(self.standins / "lsof-exit1")})
            self.assertEqual(self.pids_of(found), [pid])
            self.assertFalse(self.marker.exists(), "lsof was started on Linux")
            return
        found = d.call("find", root=self.wt["wt-a"], set={"LSOF": str(self.standins / "lsof-exit1")})
        self.assertEqual(found, [])
        swept = d.call("sweep", roots=[["wt-a", self.wt["wt-a"]]])["result"]
        self.assertEqual(swept, {"wt-a": {"stopped": [], "left": []}})
        self.assertAlive(pid)
        for lsof in ("lsof-exit2", "lsof-slow"):
            with self.subTest(lsof=lsof):
                name, text = d.raises("find", root=self.wt["wt-a"], set={"LSOF": str(self.standins / lsof)})
                self.assertEqual(name, "CannotTell", text)


# ---------------------------------------------------------------------------------------------------------- Stop

class Stop(Case):
    """Given an orphan of wt-a found by `find`, GRACE 0.5 in the driver. Fails on main: `_pmorphans` does not exist,
    so nothing stops an orphan."""

    def find_stop(self, **kw):
        return self.drv(GRACE=GRACE).call("find_stop", root=self.wt["wt-a"], **kw)

    def test_orphan_that_ends_on_sigterm(self):
        pid = self.orphan(self.wt["wt-a"])["orphan"]
        r = self.find_stop()
        self.assertEqual(self.pids_of(r["stopped"]), [pid], r)
        self.assertEqual(r["left"], [], r)
        self.assertGone(pid)

    def test_orphan_that_ignores_sigterm(self):
        pid = self.orphan(self.wt["wt-a"], "--ignore-term")["orphan"]
        r = self.find_stop()
        self.assertEqual(self.pids_of(r["stopped"]), [pid], r)
        self.assertGone(pid)

    def test_other_start_is_not_signalled(self):
        pid = self.orphan(self.wt["wt-a"])["orphan"]
        r = self.find_stop(start=OLD_START)
        self.assertEqual(self.pids_of(r["found"]), [pid], r)
        self.assertEqual((r["stopped"], r["left"]), ([], []), r)
        self.assertAlive(pid)

    def test_orphan_that_moved_out_is_not_signalled(self):
        pid = self.orphan(self.wt["wt-a"], "--move-on-usr1", self.wt["elsewhere"])["orphan"]
        found = self.drv(GRACE=GRACE).call("find", root=self.wt["wt-a"])
        self.assertEqual(self.pids_of(found), [pid])
        os.kill(pid, signal.SIGUSR1)
        self.roles(self.pidfiles[-1], ["orphan", "moved"])
        r = self.driver.call("stop", procs=found, root=self.wt["wt-a"])
        self.assertEqual((r["stopped"], r["left"]), ([], []), r)
        self.assertAlive(pid)

    def test_no_group_signal(self):
        """requirement E6"""
        pidfile = self.pidfile()
        script = (f"({shlex.quote(PY)} -I {shlex.quote(str(self.standins / 'orphan.py'))} "
                  f"{shlex.quote(self.wt['wt-a'])} {shlex.quote(str(pidfile))} &); "
                  f"exec {shlex.quote(PY)} -I {shlex.quote(str(self.standins / 'sleeper.py'))}")
        shell = self.drv(GRACE=GRACE).call("spawn", argv=["/bin/sh", "-c", script], cwd=str(self.standins),
                                           wait=False)["pid"]
        self.pids.append(shell)
        pid = self.roles(pidfile, ["orphan"])["orphan"]
        self.orphaned(pid, self.driver.reapers)
        self.assertEqual(ps_field(pid, "pgid"), ps_field(shell, "pgid"))
        r = self.find_stop()
        self.assertEqual(self.pids_of(r["stopped"]), [pid], r)
        self.assertGone(pid)
        self.assertAlive(shell)

    def test_orphan_outside_every_worktree_is_left_alone(self):
        pid = self.orphan(self.wt["elsewhere"])["orphan"]
        self.drv(GRACE=GRACE, SETTLE=SETTLE).call("sweep", roots=[["wt-a", self.wt["wt-a"]]])
        self.assertAlive(pid)


# --------------------------------------------------------------------------------------------------------- Sweep

class Sweep(Case):
    """Given a driver, GRACE 0.5, SETTLE 5; then `_pmorphans.line(name, result)`. Fails on main: `_pmorphans` does
    not exist."""

    def sweep(self, names=("wt-a",), settle_min=0, **settings):
        d = self.drv(GRACE=GRACE, SETTLE=SETTLE, **settings)
        return d.call("sweep", roots=[[n, self.wt[n]] for n in names], settle_min=settle_min)

    def test_two_of_wt_a_stopped_and_wt_b_left(self):
        a1 = self.orphan(self.wt["wt-a"])["orphan"]
        a2 = self.orphan(self.wt["wt-a"])["orphan"]
        b = self.orphan(self.wt["wt-b"])["orphan"]
        r = self.sweep()["result"]
        self.assertEqual(self.pids_of(r["wt-a"]["stopped"]), sorted([a1, a2]), r)
        self.assertGone(a1)
        self.assertGone(a2)
        self.assertAlive(b)

    def test_orphan_appearing_after_a_second_is_stopped(self):
        pid = self.orphan(self.wt["wt-a"], "--after", 1)["orphan"]
        r = self.sweep(settle_min=2)["result"]
        self.assertIn(pid, self.pids_of(r["wt-a"]["stopped"]), r)
        self.assertGone(pid)

    def test_process_started_on_sigterm_is_stopped_too(self):
        first = self.orphan(self.wt["wt-a"], "--on-term-spawn", self.wt["wt-a"])["orphan"]
        r = self.sweep()["result"]
        spawned = self.roles(self.pidfiles[-1], ["orphan", "spawned"])["spawned"]
        self.assertEqual(self.pids_of(r["wt-a"]["stopped"]), sorted([first, spawned]), r)
        self.assertGone(first)
        self.assertGone(spawned)

    def test_nothing_gives_two_empty_lists_in_time(self):
        out = self.sweep()
        self.assertEqual(out["result"], {"wt-a": {"stopped": [], "left": []}})
        self.assertLessEqual(out["elapsed"], SETTLE + 1, out)

    def test_ps_failing_on_the_first_look_is_cannot_tell(self):
        pid = self.orphan(self.wt["wt-a"])["orphan"]
        r = self.sweep(PS=str(self.standins / "ps-exit1"))["result"]
        self.assertEqual(list(r), ["wt-a"], r)
        self.assertIn("cannot_tell", r["wt-a"], r)
        self.assertAlive(pid)

    def line(self, result):
        return self.drv().call("line", name="wt-a", result=result)

    def test_line_two_stopped_by_pid(self):
        r = dict(stopped=[dict(pid=202, name="vitest"), dict(pid=101, name="forks.js")], left=[])
        self.assertEqual(self.line(r), "stopped 2 orphaned processes of wt-a: 101 forks.js, 202 vitest")

    def test_line_one_stopped_one_left(self):
        r = dict(stopped=[dict(pid=101, name="forks.js")], left=[dict(pid=202, name="vitest")])
        self.assertEqual(self.line(r), "stopped 1 orphaned processes of wt-a: 101 forks.js; not stopped: 202 vitest")

    def test_line_none_and_cannot_tell(self):
        self.assertEqual(self.line(dict(stopped=[], left=[])), "no orphaned processes in wt-a")
        self.assertEqual(self.line(dict(cannot_tell="ps timed out")),
                         "cannot tell the orphaned processes of wt-a: ps timed out")


# ------------------------------------------------------------------------------------------------------- LeftOut

class LeftOut(Case):
    """Issue 477: given a driver; a pm-check stand-in recorded live in wt-a's output/checks/running.json; stand-ins
    of its tests under wt-a/output/tests/; a live-server stand-in and the crit pane i1-crit of wt-a's issue 1.
    Fails on main: `_pmorphans` has no `scan_left`, finds the stand-ins and the live-server, and its line names
    nothing left running."""

    def find(self, name="wt-a"):
        return self.drv().call("find", root=self.wt[name])

    def scan(self, name="wt-a"):
        return self.drv().call("scan_left", root=self.wt[name])

    def kept(self, name="wt-a"):
        return sorted((k[0]["pid"], k[1]) for k in self.scan(name)["kept"])

    def sweep(self, name="wt-a"):
        return self.drv(GRACE=GRACE, SETTLE=SETTLE).call("sweep", roots=[[name, self.wt[name]]])["result"][name]

    def test_a_running_check_s_stand_in_and_its_child_are_left_out(self):
        check = self.check_running()
        d = self.tests_dir()
        o = self.orphan(d, "--child", d)
        self.assertEqual(self.find(), [])
        self.assertEqual(self.kept(), [(o["orphan"], f"the running pm-check {check}")])

    def test_one_started_before_the_check_is_found(self):
        pid = self.orphan(self.tests_dir())["orphan"]
        time.sleep(1.1)  # ps gives start times in whole seconds
        self.check_running()
        self.assertEqual(self.pids_of(self.find()), [pid])

    def test_one_outside_output_tests_is_found(self):
        self.check_running()
        pid = self.orphan(self.wt["wt-a"])["orphan"]
        self.assertEqual(self.pids_of(self.find()), [pid])

    def test_without_a_live_check_one_under_output_tests_is_found(self):
        pid = self.orphan(self.tests_dir())["orphan"]
        self.assertEqual(self.pids_of(self.find()), [pid])
        dead = self.drv().call("spawn", argv=[PY, "-I", "-c", "pass"], cwd=str(self.standins))["pid"]
        f = pathlib.Path(self.wt["wt-a"]) / "output" / "checks" / "running.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(dict(pm_check_pid=dead, pgid=dead, step="harness-test", started="")))
        self.assertEqual(self.pids_of(self.find()), [pid], "a record of a pm-check that ended")

    def test_another_worktree_s_check_leaves_nothing_out_here(self):
        self.check_running("wt-b")
        pid = self.orphan(self.tests_dir("wt-a"))["orphan"]
        self.assertEqual(self.pids_of(self.find()), [pid])

    def test_the_sweep_leaves_the_check_s_own_running_and_stops_the_rest(self):
        check = self.check_running()
        own = self.orphan(self.tests_dir())["orphan"]
        other = self.orphan(self.wt["wt-a"])["orphan"]
        r = self.sweep()
        self.assertEqual(self.pids_of(r["stopped"]), [other], r)
        self.assertEqual([(k[0]["pid"], k[1]) for k in r.get("kept", [])], [(own, f"the running pm-check {check}")],
                         r)
        self.assertAlive(own)
        self.assertGone(other)

    def test_a_live_crit_s_live_server_is_left_out(self):
        self.crit()
        pid = self.live_server(self.wt["wt-a"])
        self.assertEqual(self.find(), [])
        self.assertEqual(self.kept(), [(pid, "live pane i1-crit")])
        r = self.sweep()
        self.assertEqual(r["stopped"], [], r)
        self.assertAlive(pid)

    def test_the_live_server_is_found_with_the_crit_gone_absent_or_of_another_issue(self):
        pid = self.live_server(self.wt["wt-a"])
        for how in ("absent", "gone", "other issue"):
            if how == "gone":
                self.crit(gone=True)
            elif how == "other issue":
                self.crit(issue="2")
            self.assertEqual(self.pids_of(self.find()), [pid], f"crit {how}")

    def test_another_program_is_found_beside_a_live_crit(self):
        self.crit()
        pid = self.orphan(self.wt["wt-a"])["orphan"]
        self.assertEqual(self.pids_of(self.find()), [pid])

    def line(self, result):
        return self.drv().call("line", name="wt-a", result=result)

    def test_line_names_what_was_left_running_and_why(self):
        r = dict(stopped=[dict(pid=101, name="forks.js")], left=[],
                 kept=[[dict(pid=303, name="impeccable"), "live pane i1-crit"],
                       [dict(pid=203, name="sleep"), "the running pm-check 9"],
                       [dict(pid=202, name="Python"), "the running pm-check 9"]])
        self.assertEqual(self.line(r), "stopped 1 orphaned processes of wt-a: 101 forks.js; left running: "
                                       "202 Python, 203 sleep (the running pm-check 9); 303 impeccable "
                                       "(live pane i1-crit)")
        r = dict(stopped=[], left=[], kept=[[dict(pid=202, name="Python"), "the running pm-check 9"]])
        self.assertEqual(self.line(r), "no orphaned processes in wt-a; left running: 202 Python "
                                       "(the running pm-check 9)")


# ------------------------------------------------------------------------------------------------------ commands

class Command(Case):
    """The scripts of F run with the stand-ins first on PATH and HOME in F."""

    def env(self):
        e = {k: v for k, v in clean_env().items() if not k.startswith("HERDR")}
        e["PATH"] = f"{self.stub}{os.pathsep}{e.get('PATH', '/usr/bin:/bin')}"
        e["HOME"] = str(self.co / "home")
        (self.co / "home").mkdir(exist_ok=True)
        return e

    def fail_ps(self):
        """The fixture's copy of _pmorphans.py with its PS set to the stand-in that exits 1 (when the copy exists)."""
        f = self.co / ".pm" / "bin" / "_pmorphans.py"
        if not f.exists():
            return
        text, n = re.subn(r"(?m)^PS\s*=\s*(\"[^\"]*\"|'[^']*')", f"PS = {str(self.standins / 'ps-exit1')!r}",
                          f.read_text(), count=1)
        self.assertEqual(n, 1, "the fixture's _pmorphans.py has no PS = \"…\" line to set")
        f.write_text(text)

    def cmd(self, script, *args):
        return run(self.co, script, *args, env=self.env(), timeout=COMMAND_WAIT)

    def ours(self, cwd, *opts):
        """An orphan started by the case itself; its parent must be 1 (REAPERS of the commands)."""
        return self.orphan(cwd, *opts, via="test")["orphan"]

    def sweep_line(self, row):
        return "orphaned processes" in row


class Worktree(Command):
    """Given F and F/.pm/bin/pm-worktree. Fails on main: pm-worktree has no `orphans` command, and `rm` stops
    nothing."""

    def add_wt_r(self):
        git(self.co, "worktree", "add", "-q", "-b", "feat/1-r", self.wt["wt-r"], "main")
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        e = {**self.entry("wt-r", 3), "ports": {"studio": 8193, "engine": 8393, "emulator": port}}
        out = pathlib.Path(self.wt["wt-r"]) / "output"
        out.mkdir(parents=True, exist_ok=True)
        (out / "ports.json").write_text(json.dumps(e["ports"]))
        self.registry([self.entry(n, i) for i, n in enumerate(("wt-a", "wt-a-b", "wt-b"))] + [e])
        (self.co / ".pm" / "run" / "ports.json").write_text(json.dumps({"3": self.wt["wt-r"]}))

    def assertRemoved(self, r):
        self.assertFalse(os.path.exists(self.wt["wt-r"]), r.stdout + r.stderr)
        names = [w["name"] for w in json.loads((self.co / ".pm" / "run" / "worktrees.json").read_text())]
        self.assertNotIn("wt-r", names)

    def test_orphans_lists_one(self):
        pid = self.ours(self.wt["wt-a"])
        r = self.cmd("pm-worktree", "orphans", "wt-a")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(len(lines(r)), 1, r.stdout)
        pattern = rf"wt-a {pid} \S+ [0-9.]+% {re.escape(exe_name(pid))} {re.escape(self.wt['wt-a'])}"
        self.assertRegex(lines(r)[0], f"^{pattern}$")
        self.assertAlive(pid)

    def test_orphans_none(self):
        r = self.cmd("pm-worktree", "orphans", "wt-a")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(lines(r), ["no orphaned processes in wt-a"])

    def test_orphans_of_every_worktree_in_registry_order(self):
        a = self.ours(self.wt["wt-a"])
        b = self.ours(self.wt["wt-b"])
        r = self.cmd("pm-worktree", "orphans")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rows = lines(r)
        ia = index_of(rows, lambda x: x.startswith(f"wt-a {a} "), f"for {a} of wt-a")
        iab = index_of(rows, lambda x: x == "no orphaned processes in wt-a-b", "for wt-a-b")
        ib = index_of(rows, lambda x: x.startswith(f"wt-b {b} "), f"for {b} of wt-b")
        self.assertLess(ia, iab, rows)
        self.assertLess(iab, ib, rows)

    def test_orphans_of_an_unknown_name_is_refused(self):
        r = self.cmd("pm-worktree", "orphans", "nope")
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("pm-worktree: no worktree nope", r.stderr.splitlines())

    def test_orphans_stop_sweeps_only_the_named(self):
        a = self.ours(self.wt["wt-a"])
        ab = self.ours(self.wt["wt-a-b"])
        name = exe_name(ab)
        r = self.cmd("pm-worktree", "orphans", "wt-a-b", "--stop")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(f"stopped 1 orphaned processes of wt-a-b: {ab} {name}", lines(r))
        self.assertGone(ab)
        self.assertAlive(a)

    def test_orphans_during_a_check_lists_its_stand_in_as_left_running(self):
        """issue 477"""
        check = self.check_running()
        pid = self.ours(self.tests_dir())
        r = self.cmd("pm-worktree", "orphans", "wt-a")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(lines(r), ["no orphaned processes in wt-a",
                                    f"wt-a left running: {pid} {exe_name(pid)} (the running pm-check {check})"])

    def test_orphans_stop_during_a_check_leaves_its_stand_in_and_stops_the_rest(self):
        """issue 477"""
        check = self.check_running()
        own = self.ours(self.tests_dir())
        other = self.ours(self.wt["wt-a"])
        r = self.cmd("pm-worktree", "orphans", "wt-a", "--stop")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(f"stopped 1 orphaned processes of wt-a: {other} {exe_name(other)}; left running: {own} "
                      f"{exe_name(own)} (the running pm-check {check})", lines(r))
        self.assertGone(other)
        self.assertAlive(own)

    def test_orphans_stop_leaves_a_live_crit_s_live_server(self):
        """issue 477"""
        self.crit()
        pid = self.live_server(self.wt["wt-a"])
        r = self.cmd("pm-worktree", "orphans", "wt-a", "--stop")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(f"no orphaned processes in wt-a; left running: {pid} impeccable (live pane i1-crit)", lines(r))
        self.assertAlive(pid)

    def test_rm_sweeps_before_the_removal(self):
        self.add_wt_r()
        pid = self.ours(self.wt["wt-r"])
        name = exe_name(pid)
        r = self.cmd("pm-worktree", "rm", "wt-r")
        rows = lines(r)
        i = index_of(rows, lambda x: x == f"stopped 1 orphaned processes of wt-r: {pid} {name}", f"for {pid}")
        j = index_of(rows, lambda x: x.startswith("$ ") or x.startswith("removed "), "of the removal")
        self.assertLess(i, j, rows)
        self.assertGone(pid)
        self.assertRemoved(r)

    def test_rm_with_none(self):
        self.add_wt_r()
        r = self.cmd("pm-worktree", "rm", "wt-r")
        self.assertIn("no orphaned processes in wt-r", lines(r))
        self.assertIn(f"removed {self.wt['wt-r']}", lines(r))
        self.assertRemoved(r)

    def test_orphans_when_ps_fails(self):
        self.ours(self.wt["wt-a"])
        self.fail_ps()
        r = self.cmd("pm-worktree", "orphans", "wt-a")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("cannot tell the orphaned processes of wt-a: ps failed: exit 1", lines(r))

    def test_orphans_stop_when_ps_fails(self):
        pid = self.ours(self.wt["wt-a"])
        self.fail_ps()
        r = self.cmd("pm-worktree", "orphans", "wt-a", "--stop")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("cannot tell the orphaned processes of wt-a: ps failed: exit 1", lines(r))
        self.assertAlive(pid)

    def test_rm_when_ps_fails(self):
        self.add_wt_r()
        self.ours(self.wt["wt-r"])
        self.fail_ps()
        r = self.cmd("pm-worktree", "rm", "wt-r")
        self.assertIn("cannot tell the orphaned processes of wt-r: ps failed: exit 1", lines(r))
        self.assertRemoved(r)


class Pane(Command):
    """Given F, the herdr stand-in, F/.pm/run/panes.json with live panes i1-worker-h1 (cwd wt-a), i1-worker-h2
    (cwd wt-b) and i1-rev (cwd F), each opened with a brief. Fails on main: pm-pane stops nothing on reset or
    close."""

    PANES = (("i1-worker-h1", "p-h1", "worker", "h1", "wt-a"), ("i1-worker-h2", "p-h2", "worker", "h2", "wt-b"),
             ("i1-rev", "p-rev", "rev", None, None))

    def setUp(self):
        super().setUp()
        self.calls = self.co / "output" / "herdr-calls.log"
        brief = self.co / "output" / "brief.md"
        brief.write_text("brief\n")
        reg = []
        for name, pane, role, unit, wt in self.PANES:
            reg.append(dict(name=name, issue="1", role=role, unit=unit, kind="claude", model="claude-opus-5-5",
                            side="harness" if unit else "other", pane_id=pane, tab_id="t1",
                            cwd=self.wt[wt] if wt else str(self.co), brief=str(brief),
                            started="2026-11-18T00:00:00+00:00", session="s1-" + name, gone=False, resets=0))
        (self.co / ".pm" / "run" / "panes.json").write_text(json.dumps(reg))
        self.herdr()

    def herdr(self, status="idle", no_marker=False, on_close=None):
        cfg = dict(calls=str(self.calls), status=status, no_marker=no_marker, on_close=on_close,
                   pidfiles=[str(f) for f in self.pidfiles],
                   panes={n: p for n, p, _, _, _ in self.PANES},
                   cwds={n: (self.wt[w] if w else str(self.co)) for n, _, _, _, w in self.PANES})
        (self.stub / "herdr.json").write_text(json.dumps(cfg))

    def cmd(self, *args):
        self.herdr(**getattr(self, "herdr_cfg", {}))
        return super().cmd("pm-pane", *args)

    def logged(self):
        return [json.loads(x) for x in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def prompt(self, pred):
        return [c for c in self.logged() if c["args"][:2] == ["agent", "prompt"] and len(c["args"]) >= 4
                and pred(c["args"][3])]

    def registered(self):
        return [r["name"] for r in json.loads((self.co / ".pm" / "run" / "panes.json").read_text())]

    def test_reset_sweeps_after_clear_and_before_the_brief(self):
        """regression"""
        pid = self.ours(self.wt["wt-a"])
        r = self.cmd("reset", "i1-worker-h1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rows = lines(r)
        i = index_of(rows, lambda x: re.fullmatch(rf"stopped 1 orphaned processes of wt-a: {pid} \S+", x),
                     f"stopping {pid}")
        j = index_of(rows, lambda x: x.startswith("reset i1-worker-h1:"), "of the reset")
        self.assertLess(i, j, rows)
        clear = self.prompt(lambda t: t == "/clear")
        brief = self.prompt(lambda t: t.startswith("Read "))
        self.assertEqual(len(clear), 1, self.logged())
        self.assertEqual(len(brief), 1, self.logged())
        self.assertIs(clear[0]["alive"].get(str(pid)), True, clear)
        self.assertIs(brief[0]["alive"].get(str(pid)), False, brief)

    def test_reset_with_none(self):
        r = self.cmd("reset", "i1-worker-h1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("no orphaned processes in wt-a", lines(r))
        index_of(lines(r), lambda x: x.startswith("reset i1-worker-h1:"), "of the reset")
        self.assertEqual(len(self.prompt(lambda t: t.startswith("Read "))), 1, self.logged())

    def test_reset_of_a_pane_in_the_main_checkout_sweeps_nothing(self):
        """guard"""
        pid = self.ours(self.co)
        r = self.cmd("reset", "i1-rev")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([x for x in lines(r) if self.sweep_line(x)], [], r.stdout)
        self.assertAlive(pid)

    def test_reset_without_the_marker_sweeps_nothing(self):
        """guard"""
        pid = self.ours(self.wt["wt-a"])
        self.herdr_cfg = dict(no_marker=True)
        r = self.cmd("reset", "i1-worker-h1")
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.prompt(lambda t: t == "/clear"), [], self.logged())
        self.assertAlive(pid)

    def test_reset_of_a_blocked_agent_sweeps_nothing(self):
        """guard"""
        pid = self.ours(self.wt["wt-a"])
        self.herdr_cfg = dict(status="blocked")
        r = self.cmd("reset", "i1-worker-h1")
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("i1-worker-h1 is blocked at a dialog", r.stderr)
        self.assertAlive(pid)

    def test_reset_when_ps_fails(self):
        self.ours(self.wt["wt-a"])
        self.fail_ps()
        r = self.cmd("reset", "i1-worker-h1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rows = lines(r)
        i = index_of(rows, lambda x: x == "cannot tell the orphaned processes of wt-a: ps failed: exit 1",
                     "cannot tell")
        j = index_of(rows, lambda x: x.startswith("reset i1-worker-h1:"), "of the reset")
        self.assertLess(i, j, rows)
        self.assertEqual(len(self.prompt(lambda t: t.startswith("Read "))), 1, self.logged())

    def test_close_when_ps_fails(self):
        self.fail_ps()
        r = self.cmd("close", "i1-worker-h1")
        rows = lines(r)
        i = index_of(rows, lambda x: x.startswith("closed i1-worker-h1 "), "closed")
        j = index_of(rows, lambda x: x == "cannot tell the orphaned processes of wt-a: ps failed: exit 1",
                     "cannot tell")
        self.assertLess(i, j, rows)
        self.assertIn(["pane", "close", "p-h1"], [c["args"] for c in self.logged()])
        self.assertNotIn("i1-worker-h1", self.registered())

    def test_close_sweeps_the_pane_s_worktree_only(self):
        a = self.ours(self.wt["wt-a"])
        b = self.ours(self.wt["wt-b"])
        r = self.cmd("close", "i1-worker-h1")
        rows = lines(r)
        i = index_of(rows, lambda x: x.startswith("closed i1-worker-h1 "), "closed")
        j = index_of(rows, lambda x: re.fullmatch(rf"stopped 1 orphaned processes of wt-a: {a} \S+", x),
                     f"stopping {a}")
        self.assertLess(i, j, rows)
        self.assertGone(a)
        self.assertAlive(b)

    def test_close_stops_an_orphan_made_by_the_close(self):
        """regression"""
        pidfile = self.pidfile()
        self.herdr_cfg = dict(on_close=[PY, "-I", str(self.standins / "orphan.py"), self.wt["wt-a"], str(pidfile),
                                        "--after", "1"])
        r = self.cmd("close", "i1-worker-h1")
        pid = self.roles(pidfile, ["orphan"])["orphan"]
        index_of(lines(r), lambda x: re.fullmatch(rf"stopped 1 orphaned processes of wt-a: {pid} \S+", x),
                 f"stopping {pid}")
        self.assertGone(pid)

    def test_close_of_an_issue_sweeps_each_worktree_in_order(self):
        a = self.ours(self.wt["wt-a"])
        b = self.ours(self.wt["wt-b"])
        r = self.cmd("close", "--issue", "1")
        swept = [x for x in lines(r) if self.sweep_line(x)]
        self.assertEqual(len(swept), 2, r.stdout)
        self.assertRegex(swept[0], rf"^stopped 1 orphaned processes of wt-a: {a} \S+$")
        self.assertRegex(swept[1], rf"^stopped 1 orphaned processes of wt-b: {b} \S+$")
        self.assertGone(a)
        self.assertGone(b)

    def test_reset_during_a_check_leaves_its_stand_in_running_and_says_so(self):
        """issue 477"""
        check = self.check_running()
        pid = self.ours(self.tests_dir())
        r = self.cmd("reset", "i1-worker-h1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(f"no orphaned processes in wt-a; left running: {pid} {exe_name(pid)} (the running pm-check "
                      f"{check})", lines(r))
        brief = self.prompt(lambda t: t.startswith("Read "))
        self.assertEqual(len(brief), 1, self.logged())
        self.assertIs(brief[0]["alive"].get(str(pid)), True, brief)
        self.assertAlive(pid)

    def test_close_during_a_check_leaves_its_stand_in_running_and_says_so(self):
        """issue 477"""
        check = self.check_running()
        pid = self.ours(self.tests_dir())
        r = self.cmd("close", "i1-worker-h1")
        self.assertIn(f"no orphaned processes in wt-a; left running: {pid} {exe_name(pid)} (the running pm-check "
                      f"{check})", lines(r))
        self.assertAlive(pid)

    def test_close_leaves_a_live_crit_s_live_server(self):
        """issue 477"""
        self.crit()
        pid = self.live_server(self.wt["wt-a"])
        r = self.cmd("close", "i1-worker-h1")
        self.assertIn(f"no orphaned processes in wt-a; left running: {pid} impeccable (live pane i1-crit)", lines(r))
        self.assertAlive(pid)

    def test_sweep_lines_are_logged(self):
        self.ours(self.wt["wt-a"])
        self.ours(self.wt["wt-b"])
        printed = []
        for args in (("reset", "i1-worker-h1"), ("close", "i1-worker-h2")):
            r = self.cmd(*args)
            got = [x for x in lines(r) if self.sweep_line(x)]
            self.assertEqual(len(got), 1, (args, r.stdout, r.stderr))
            printed += got
        events = (self.co / ".pm" / "run" / "events.log").read_text().splitlines()
        logged = [e.split(" ", 1)[1] for e in events if " " in e]
        for line in printed:
            self.assertIn("orphans " + line, logged)


# -------------------------------------------------------------------------------------------------------- Safety

class Safety(unittest.TestCase):
    """Given the source of _pmorphans.py and _pmorphanevent.py (read with `ast`). Fails on main: `_pmorphans`
    does not exist."""

    FILES = ("_pmorphans.py", "_pmorphanevent.py")
    EXCEPTIONS = ("SubprocessError", "TimeoutExpired", "CalledProcessError")

    def trees(self):
        out = []
        for f in self.FILES:
            path = BIN / f
            self.assertTrue(path.is_file(), f"{path} does not exist")
            out.append((f, ast.parse(path.read_text())))
        return out

    def test_no_group_signal_no_name_kill_no_shell(self):
        for f, tree in self.trees():
            docs = {id(d.body[0].value) for d in ast.walk(tree)
                    if isinstance(d, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
                    and ast.get_docstring(d) is not None}
            for n in ast.walk(tree):
                where = f"{f}:{getattr(n, 'lineno', '?')}"
                if isinstance(n, ast.Attribute):
                    self.assertNotIn(n.attr, ("killpg", "pthread_kill"), where)
                if isinstance(n, ast.Name):
                    self.assertNotIn(n.id, ("killpg", "pthread_kill"), where)
                if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs:
                    for word in ("docker", "pkill", "killall"):
                        self.assertNotIn(word, n.value, where)
                if isinstance(n, ast.keyword) and n.arg == "shell":
                    self.assertFalse(isinstance(n.value, ast.Constant) and n.value.value is True, where)

    def test_every_subprocess_call_is_ps_or_lsof_with_env_and_timeout(self):
        for f, tree in self.trees():
            for n in ast.walk(tree):
                where = f"{f}:{getattr(n, 'lineno', '?')}"
                if isinstance(n, ast.ImportFrom) and n.module == "subprocess":
                    for a in n.names:
                        self.assertIn(a.name, self.EXCEPTIONS, f"{where}: from subprocess import {a.name}")
                if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                        and isinstance(n.func.value, ast.Name) and n.func.value.id == "subprocess"):
                    continue
                self.assertTrue(n.args and isinstance(n.args[0], ast.List) and n.args[0].elts, where)
                first = n.args[0].elts[0]
                self.assertTrue(isinstance(first, ast.Name) and first.id in ("PS", "LSOF"), where)
                kw = {k.arg: k.value for k in n.keywords}
                self.assertTrue(isinstance(kw.get("env"), ast.Name) and kw["env"].id == "ENV", where)
                self.assertIn("timeout", kw, where)


if __name__ == "__main__":
    unittest.main()
