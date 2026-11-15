"""_pmproc: the child environment allowlist and the one way the tool starts a child process (design 2.4, D6 P1 P2).

Interface used: `_pmproc.child_env()` returns a dict; `_pmproc.run(cmd, timeout=..., cwd=...)` runs an argument
list without a shell and returns a `subprocess.CompletedProcess` with text `stdout`, or raises a timeout error
(an exception whose type is or derives from `subprocess.TimeoutExpired` or `TimeoutError`) after killing the
child. The children are `/usr/bin/env` and `/bin/sh`, which add no variable of their own to what they print.

Stop (issue 12): `_pmproc.stop(exc)` records a stop for the process, `_pmproc.stop_requested()` returns it or None,
and `run` raises the recorded exception, killing the child's process group first; any exception that leaves the
wait for the child kills that group too.

The child's tree (issue 25): a stop, the timeout or any exception that leaves the wait kills every process that
descends from the child, also one in a session or group of its own; nothing outside the child's tree is signalled,
and a child that ends by itself is left alone. `_pmproc.PS` is the program that lists the processes; a case sets it
to a path that does not exist or to a stand-in that never answers.
"""
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import time
import unittest
from unittest import mock

try:
    import _pmproc
except ImportError as e:  # every case fails on its own when the module does not exist
    _pmproc, IMPORT_ERROR = None, e

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = HERE.parents[2]
WORK = CHECKOUT / "output" / "tests" / f"proc-{os.getpid()}"

SCRUBBED = ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_CONFIG_FILE",
            "AWS_SHARED_CREDENTIALS_FILE", "AWS_ENDPOINT_URL", "AWS_DEFAULT_PROFILE", "AWS_ROLE_ARN",
            "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_REGION"]
CALLER = {**{k: f"caller-value-of-{k.lower()}" for k in SCRUBBED}, "FOO": "foo-value",
          "PATH": os.environ.get("PATH", "/usr/bin:/bin")}


class ProcCase(unittest.TestCase):
    def setUp(self):
        if _pmproc is None:
            self.fail(f"_pmproc cannot be imported: {IMPORT_ERROR}")
        WORK.mkdir(parents=True, exist_ok=True)
        self.addCleanup(shutil.rmtree, WORK, True)


class ChildEnv(ProcCase):
    def test_allowlist(self):
        with mock.patch.dict(os.environ, CALLER, clear=True):
            env = _pmproc.child_env()
        self.assertEqual(env.get("PATH"), CALLER["PATH"])
        self.assertEqual(env.get("AWS_EC2_METADATA_DISABLED"), "true")
        self.assertEqual([k for k in env if k.startswith("AWS_") and k != "AWS_EC2_METADATA_DISABLED"], [])
        self.assertNotIn("FOO", env)
        for value in CALLER.values():
            if value != CALLER["PATH"]:
                self.assertNotIn(value, env.values())


class Run(ProcCase):
    def test_child_sees_exactly_child_env(self):
        with mock.patch.dict(os.environ, CALLER, clear=True):
            expected = _pmproc.child_env()
            p = _pmproc.run(["/usr/bin/env", "-0"], timeout=10, cwd=str(WORK))
        printed = dict(entry.split("=", 1) for entry in p.stdout.split("\0") if entry)
        self.assertEqual(printed, expected)

    def test_timeout_kills_the_child(self):
        pidfile = WORK / "child.pid"
        script = f'echo $$ > "{pidfile}"; exec sleep 30'
        started = time.monotonic()
        with self.assertRaises((subprocess.TimeoutExpired, TimeoutError)):
            _pmproc.run(["/bin/sh", "-c", script], timeout=1, cwd=str(WORK))
        self.assertLess(time.monotonic() - started, 20)
        pid = int(pidfile.read_text())
        with self.assertRaises(ProcessLookupError, msg=f"child {pid} still runs after the timeout"):
            os.kill(pid, 0)

    def test_shell_metacharacters_are_literal(self):
        marker = WORK / "injected"
        arg = f"a; touch {marker}; echo $(touch {marker}) `touch {marker}` | cat && echo b"
        p = _pmproc.run(["/bin/sh", "-c", 'printf "%s" "$1"', "sh", arg], timeout=10, cwd=str(WORK))
        self.assertEqual(p.stdout, arg)
        self.assertFalse(marker.exists())


# The stop cases (issue 12): each runs DRIVER in a Python process of its own (`python3 -I`, a session of its own),
# because the recorded stop belongs to the process. DRIVER prints one JSON line: what `run` did and what was alive
# when it raised. The child writes its PID and the PID of a background `sleep 30` (a grandchild in the child's
# process group) to files, then waits for the grandchild.
DRIVER = r"""
import json, math, os, shlex, signal, subprocess, sys, time
case, work, bin_dir = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, bin_dir)
import _pmproc

CHILD = ('echo $$ > child.tmp && mv child.tmp child.pid; '
         'sleep 30 & echo $! > grandchild.tmp && mv grandchild.tmp grandchild.pid; wait')
MARKER = os.path.join(work, "marker")


class Marked(Exception):
    pass


def report(**fields):
    sys.stdout.write(json.dumps(fields) + "\n")
    sys.stdout.flush()


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    stat = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(stat) and not stat.startswith("Z")


def pid(name):
    try:
        with open(os.path.join(work, name)) as f:
            return int(f.read())
    except (OSError, ValueError):
        return None


def at_raise(e, expected, signalled):
    # what the case reports once `run` raised: the exception, the time since the signal, and the processes
    raised = time.monotonic()
    child, grandchild = pid("child.pid"), pid("grandchild.pid")
    report(outcome="raised", same=e is expected, type=type(e).__name__, value=repr(e),
           mark=getattr(e, "mark", None), after=raised - signalled.get("at", math.nan),
           child=child, child_alive=child is not None and alive(child),
           grandchild=grandchild, grandchild_alive=grandchild is not None and alive(grandchild))


def needs(*names):
    missing = [n for n in names if not hasattr(_pmproc, n)]
    if missing:
        report(outcome="missing", missing=missing)
        sys.exit(0)


def run_child():
    return _pmproc.run(["/bin/sh", "-c", CHILD], timeout=60, cwd=work)


mode, _, shape = case.partition(":")
shape = shape or mode
SPAWN_FILE = os.path.join(work, "spawn.py")  # written by the case
TREE_TIMEOUT = 8  # seconds: the tree is up well before, and the case waits this long once
SHAPES = {
    "detached": {"name": "child", "kids": [{"name": "grandchild", "how": "session",
                                            "kids": [{"name": "helper", "how": "group"}]}]},
    "levels": {"name": "child", "kids": [{"name": "grandchild", "how": "session",
                                          "kids": [{"name": "great", "how": "session"}]}]},
    "leaderless": {"name": "child", "kids": [{"name": "x", "how": "group"},
                                             {"name": "w", "how": "join:x", "kids": [{"name": "v"}]}],
                   "reap": ["x"]},
    "caller": {"name": "child", "kids": [{"name": "grandchild", "how": "session"}]},
    "by-itself": {"name": "child", "kids": [{"name": "grandchild", "how": "session"}], "exit": True},
    "ps-missing": {"name": "child", "kids": [{"name": "same"}, {"name": "detached", "how": "session"}]},
    "ps-hang": {"name": "child", "kids": [{"name": "grandchild"}]},
}


def names(node):
    return [node["name"]] + [n for kid in node.get("kids", []) for n in names(kid)]


def write_pid(name, value):
    tmp = os.path.join(work, name + ".tmp")
    with open(tmp, "w") as f:
        f.write(str(value))
    os.replace(tmp, os.path.join(work, name + ".pid"))


def stat(p):
    if p is None:
        return None
    return subprocess.run(["ps", "-o", "stat=", "-p", str(p)], capture_output=True, text=True).stdout.strip()


def tree(shape, timeout=60):
    return _pmproc.run([sys.executable, "-I", SPAWN_FILE, work, json.dumps(SHAPES[shape])], timeout=timeout,
                       cwd=work)


def at_raise_tree(e, expected, shape, **extra):
    raised = time.monotonic()
    pids = {n: pid(n + ".pid") for n in names(SHAPES[shape])}
    report(outcome="raised", same=e is expected, type=type(e).__name__, value=repr(e),
           mark=getattr(e, "mark", None), after=raised - signalled.get("at", math.nan), pids=pids,
           alive={n: p is not None and alive(p) for n, p in pids.items()}, **extra)


signalled = {}
if case in ("stop", "scope"):
    needs("stop")
    stop = Marked("stopped by the case")

    def handler(*_):
        signalled["at"] = time.monotonic()
        _pmproc.stop(stop)

    signal.signal(signal.SIGTERM, handler)
    report(outcome="ready")
    try:
        run_child()
        report(outcome="returned")
    except BaseException as e:
        at_raise(e, stop, signalled)
elif case == "keyboard":
    interrupt = KeyboardInterrupt()
    interrupt.mark = "raised by the case's handler"

    def handler(*_):
        signalled["at"] = time.monotonic()
        raise interrupt

    signal.signal(signal.SIGTERM, handler)
    report(outcome="ready")
    try:
        run_child()
        report(outcome="returned")
    except BaseException as e:
        at_raise(e, interrupt, signalled)
elif case == "exit":
    def handler(*_):
        raise SystemExit(2)

    signal.signal(signal.SIGTERM, handler)
    report(outcome="ready")
    run_child()
    report(outcome="returned")
elif case == "before":
    needs("stop")
    stop = Marked("recorded before run")
    _pmproc.stop(stop)
    try:
        _pmproc.run(["/bin/sh", "-c", f'touch "{MARKER}"'], timeout=10, cwd=work)
        report(outcome="returned", marker=os.path.exists(MARKER))
    except BaseException as e:
        report(outcome="raised", same=e is stop, type=type(e).__name__, value=repr(e),
               marker=os.path.exists(MARKER))
elif case == "after-raised":
    needs("stop")
    stop = Marked("raised once")
    _pmproc.stop(stop)
    try:
        _pmproc.run(["/bin/sh", "-c", "true"], timeout=10, cwd=work)
        first = "returned"
    except BaseException as e:
        first = "raised the stop" if e is stop else f"raised {e!r}"
    try:
        p = _pmproc.run(["/bin/sh", "-c", "printf %s child-output-after-the-stop; exit 3"], timeout=10, cwd=work)
        report(outcome="returned", first=first, type=type(p).__name__, stdout=p.stdout, returncode=p.returncode)
    except BaseException as e:
        report(outcome="raised", first=first, type=type(e).__name__, value=repr(e))
elif case == "twice":
    needs("stop")
    first, second = Marked("first"), Marked("second")
    _pmproc.stop(first)
    _pmproc.stop(second)
    try:
        _pmproc.run(["/bin/sh", "-c", "true"], timeout=10, cwd=work)
        report(outcome="returned")
    except BaseException as e:
        report(outcome="raised", which="first" if e is first else "second" if e is second else repr(e))
elif case == "requested":
    needs("stop", "stop_requested")
    stop = Marked("requested")
    before = _pmproc.stop_requested()
    _pmproc.stop(stop)
    recorded = _pmproc.stop_requested()
    try:
        _pmproc.run(["/bin/sh", "-c", "true"], timeout=10, cwd=work)
        ran = "returned"
    except BaseException as e:
        ran = "raised the stop" if e is stop else f"raised {e!r}"
    after = _pmproc.stop_requested()
    report(outcome="done", before=repr(before), recorded=recorded is stop, ran=ran, after=after is stop,
           after_value=repr(after))
elif case == "output":
    # 16 chunks of 16 KiB, about 0.03 s apart: the output spans several of run's waits for the child
    script = ("import sys, time\n"
              "for i in range(16):\n"
              "    sys.stdout.write(chr(97 + i) * 16384); sys.stdout.flush(); time.sleep(0.03)\n"
              "sys.exit(3)\n")
    p = _pmproc.run([sys.executable, "-I", "-c", script], timeout=30, cwd=work)
    report(outcome="returned", type=type(p).__name__, stdout=p.stdout, returncode=p.returncode)
elif mode in ("tree-stop", "tree-keyboard", "tree-timeout", "caller", "ps-missing", "ps-hang"):
    if mode == "tree-keyboard":
        expected = KeyboardInterrupt()
        expected.mark = "raised by the case's handler"

        def handler(*_):
            signalled["at"] = time.monotonic()
            raise expected
    elif mode == "tree-timeout":
        expected = None
    else:
        needs("stop", *(["PS"] if mode.startswith("ps-") else []))
        expected = Marked(f"stopped by the case ({case})")

        def handler(*_):
            signalled["at"] = time.monotonic()
            _pmproc.stop(expected)
    if mode == "ps-missing":
        _pmproc.PS = os.path.join(work, "no-such-ps")
    elif mode == "ps-hang":
        # one process that writes its PID and sleeps 30 s: `exec` keeps the shell's PID
        tmp, final = os.path.join(work, "ps.tmp"), os.path.join(work, "ps.pid")
        _pmproc.PS = os.path.join(work, "ps-stand-in")
        with open(_pmproc.PS, "w") as f:
            f.write(f"#!/bin/sh\necho $$ > {shlex.quote(tmp)} && /bin/mv {shlex.quote(tmp)} {shlex.quote(final)}\n"
                    "exec /bin/sleep 30\n")
        os.chmod(_pmproc.PS, 0o755)
    elif mode == "caller":
        # the caller's own processes: one in a group of its own, one in a session of its own, neither through run
        quiet = dict(stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        write_pid("caller-group", subprocess.Popen(["/bin/sleep", "30"], process_group=0, **quiet).pid)
        write_pid("caller-session", subprocess.Popen(["/bin/sleep", "30"], start_new_session=True, **quiet).pid)
    if mode != "tree-timeout":
        signal.signal(signal.SIGTERM, handler)
    report(outcome="ready")
    try:
        tree(shape, timeout=TREE_TIMEOUT if mode == "tree-timeout" else 60)
        report(outcome="returned")
    except BaseException as e:
        extra = {"timeout": isinstance(e, (subprocess.TimeoutExpired, TimeoutError))}
        if mode == "caller":
            extra["stat"] = {n: stat(pid(n + ".pid")) for n in ("caller-group", "caller-session")}
        if mode == "ps-hang":
            stand_in = pid("ps.pid")
            extra.update(stand_in=stand_in, stand_in_alive=stand_in is not None and alive(stand_in))
        at_raise_tree(e, expected, shape, **extra)
elif mode == "by-itself":
    p = tree(shape)
    pids = {n: pid(n + ".pid") for n in names(SHAPES[shape])}
    report(outcome="returned", type=type(p).__name__, returncode=p.returncode, pids=pids,
           alive={n: q is not None and alive(q) for n, q in pids.items()}, stat=stat(pids["grandchild"]))
"""

# The tree cases (issue 25): the case writes SPAWN into its own directory, and DRIVER runs it as `run`'s child,
# with the shape the case names (DRIVER's SHAPES). A node of SPAWN starts its kids as the shape says (`same`: in its own group; `group`: a new group in its session;
# `join:<kid>`: the group of an earlier kid; `session`: a session of its own), each with stdin, stdout and stderr
# on /dev/null, and waits on a pipe until each kid's subtree is up. It then kills and reaps the kids named in
# `reap`, writes `<name>.pid` and sleeps 30 s (or exits 0 with `exit`): a sleeper. The child writes its PID last,
# once the whole tree is up.
SPAWN = r"""
import json, os, subprocess, sys, time
work, spec = sys.argv[1], json.loads(sys.argv[2])
ready = int(sys.argv[3]) if len(sys.argv) > 3 else None
procs = {}
for kid in spec.get("kids", []):
    how = kid.get("how", "same")
    options = ({"start_new_session": True} if how == "session" else {"process_group": 0} if how == "group"
               else {"process_group": procs[how[5:]].pid} if how.startswith("join:") else {})
    r, w = os.pipe()
    procs[kid["name"]] = subprocess.Popen([sys.executable, "-I", __file__, work, json.dumps(kid), str(w)],
                                          stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                          stderr=subprocess.DEVNULL, pass_fds=(w,), **options)
    os.close(w)
    os.read(r, 1)  # one byte once the kid's subtree is up; end of file if the kid died first
    os.close(r)
for name in spec.get("reap", []):
    procs[name].kill()
    procs[name].wait()
tmp = os.path.join(work, spec["name"] + ".tmp")
with open(tmp, "w") as f:
    f.write(str(os.getpid()))
os.replace(tmp, os.path.join(work, spec["name"] + ".pid"))
if ready is not None:
    os.write(ready, b"r")
    os.close(ready)
if spec.get("exit"):
    sys.exit(0)
time.sleep(30)
"""

BOUND = 60  # seconds a driver may take before the case kills it; the child's sleep is 30 s
POLL = 0.02
EXPECTED_OUTPUT = "".join(chr(97 + i) * 16384 for i in range(16))


def alive(pid):
    """os.kill(pid, 0) succeeds and `ps` does not show the process as a zombie."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    stat = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(stat) and not stat.startswith("Z")


class Stop(ProcCase):
    """_pmproc.stop, stop_requested and run under a signal (issue 12, design D2)."""

    def setUp(self):
        super().setUp()
        self.work = WORK / self._testMethodName
        self.work.mkdir(parents=True)
        self.driver_file = WORK / "driver.py"
        self.driver_file.write_text(DRIVER)
        (self.work / "spawn.py").write_text(SPAWN)
        self.started = []  # PIDs to kill at the end: drivers, children, grandchildren, unrelated processes
        self.addCleanup(self.kill_started)

    def reap(self, proc):
        """Kill what the case started, then wait for `proc`: the wait only reaps, it never waits for a process."""
        self.kill_started()
        proc.wait()

    def kill_started(self):
        for pid in self.started:
            for kill in (os.killpg, os.kill):
                try:
                    kill(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass

    def driver(self, case):
        d = subprocess.Popen([sys.executable, "-I", str(self.driver_file), case, str(self.work), str(BIN)],
                             cwd=str(self.work), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, start_new_session=True)
        self.started.append(d.pid)
        self.addCleanup(self.reap, d)
        self.addCleanup(d.stderr.close)
        self.addCleanup(d.stdout.close)
        return d

    def finish(self, d):
        """The driver's exit status and its JSON lines; the driver is killed past BOUND."""
        try:
            out, err = d.communicate(timeout=BOUND)
        except subprocess.TimeoutExpired:
            d.kill()
            out, err = d.communicate()
            self.fail(f"the driver did not end within {BOUND} s; stderr:\n{err}")
        lines = [json.loads(ln) for ln in out.splitlines() if ln.startswith("{")]
        return d.returncode, lines, err

    def report(self, d):
        code, lines, err = self.finish(d)
        self.assertTrue(lines, f"the driver printed nothing (exit {code}); stderr:\n{err}")
        last = lines[-1]
        self.assertNotEqual(last.get("outcome"), "missing", f"_pmproc lacks {last.get('missing')}")
        return code, last, err

    def wait_ready(self, d, names=("child", "grandchild")):
        """Wait (bounded) until the driver's processes `names` have written their PIDs; return them in order."""
        files = [self.work / f"{name}.pid" for name in names]
        deadline = time.monotonic() + BOUND
        while not all(f.exists() for f in files):
            try:
                d.wait(timeout=POLL)
            except subprocess.TimeoutExpired:
                pass
            else:
                code, lines, err = self.finish(d)
                missing = [n for ln in lines if ln.get("outcome") == "missing" for n in ln["missing"]]
                self.assertFalse(missing, f"_pmproc lacks {missing}")
                self.fail(f"the driver ended (exit {code}) before its child started: {lines}\n{err}")
            if time.monotonic() > deadline:
                self.fail(f"the child did not write its PIDs within {BOUND} s")
        pids = [int(f.read_text()) for f in files]
        self.started.extend(pids)
        return pids

    def assertGone(self, line):
        self.assertFalse(line["child_alive"], f"child {line['child']} is alive when run raised: {line}")
        self.assertFalse(line["grandchild_alive"], f"grandchild {line['grandchild']} is alive when run raised: {line}")

    def test_stop_during_run_raises_it_and_kills_the_group(self):
        d = self.driver("stop")
        self.wait_ready(d)
        os.kill(d.pid, signal.SIGTERM)
        code, line, err = self.report(d)
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], f"run raised {line['value']}, not the exception given to stop")
        self.assertLess(line["after"], 2, f"run raised {line['after']:.2f} s after the signal")
        self.assertGone(line)

    def test_keyboard_interrupt_during_run_propagates_and_kills_the_group(self):
        d = self.driver("keyboard")
        self.wait_ready(d)
        os.kill(d.pid, signal.SIGTERM)
        code, line, err = self.report(d)
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], f"caught {line['value']} (mark {line['mark']!r}), not the handler's")
        self.assertEqual(line["mark"], "raised by the case's handler")
        self.assertGone(line)

    def test_system_exit_during_run_exits_2_and_kills_the_group(self):
        d = self.driver("exit")
        child, grandchild = self.wait_ready(d)
        signalled = time.monotonic()
        os.kill(d.pid, signal.SIGTERM)
        code, lines, err = self.finish(d)
        took = time.monotonic() - signalled
        self.assertEqual(code, 2, f"stdout lines {lines}; stderr:\n{err}")
        self.assertLess(took, 3, f"the process exited {took:.1f} s after the signal")
        self.assertFalse(alive(child), f"child {child} is alive after the process exited")
        self.assertFalse(alive(grandchild), f"grandchild {grandchild} is alive after the process exited")

    def test_stop_recorded_before_run_starts_no_child(self):
        code, line, err = self.report(self.driver("before"))
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], f"run raised {line['value']}, not the recorded stop")
        self.assertFalse(line["marker"], "the child ran: its marker file exists")
        self.assertFalse((self.work / "marker").exists(), "the child ran: its marker file exists")

    def test_run_after_the_stop_was_raised_once_runs_the_child(self):
        code, line, err = self.report(self.driver("after-raised"))
        self.assertEqual(line["first"], "raised the stop", line)
        self.assertEqual(line["outcome"], "returned", line)
        self.assertEqual(line["type"], "CompletedProcess")
        self.assertEqual(line["stdout"], "child-output-after-the-stop")
        self.assertEqual(line["returncode"], 3)

    def test_stop_twice_keeps_the_first(self):
        code, line, err = self.report(self.driver("twice"))
        self.assertEqual(line["outcome"], "raised", line)
        self.assertEqual(line["which"], "first")

    def test_stop_requested(self):
        code, line, err = self.report(self.driver("requested"))
        self.assertEqual(line["before"], "None", line)
        self.assertTrue(line["recorded"], f"stop_requested() after stop(exc) is not exc: {line}")
        self.assertEqual(line["ran"], "raised the stop", line)
        self.assertTrue(line["after"], f"stop_requested() after the stop was raised is {line['after_value']}")

    def test_stop_kills_only_the_childs_group(self):
        unrelated = subprocess.Popen(["sleep", "30"], stdin=subprocess.DEVNULL, start_new_session=True)
        self.started.append(unrelated.pid)
        self.addCleanup(self.reap, unrelated)
        d = self.driver("scope")
        self.wait_ready(d)
        os.kill(d.pid, signal.SIGTERM)
        code, line, err = self.report(d)
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], line)
        self.assertGone(line)
        self.assertEqual(code, 0, f"the calling process did not end on its own (exit {code}); stderr:\n{err}")
        self.assertTrue(alive(unrelated.pid), f"the unrelated sleep {unrelated.pid} was killed")

    def test_output_over_several_waits_is_returned_whole(self):
        code, line, err = self.report(self.driver("output"))
        self.assertEqual(line["outcome"], "returned", line)
        self.assertEqual(line["type"], "CompletedProcess")
        self.assertEqual(len(line["stdout"]), len(EXPECTED_OUTPUT))
        self.assertEqual(line["stdout"], EXPECTED_OUTPUT)
        self.assertEqual(line["returncode"], 3)

    # issue 25: the child's tree

    def stopped(self, case, names):
        """Start the driver's `case`, wait until `names` have written their PIDs, send SIGTERM; its last line."""
        d = self.driver(case)
        self.wait_ready(d, names)
        os.kill(d.pid, signal.SIGTERM)
        return self.report(d)

    def assertTreeGone(self, line, names):
        for name in names:
            self.assertIsNotNone(line["pids"][name], f"{name} wrote no PID: {line}")
            self.assertFalse(line["alive"][name], f"{name} {line['pids'][name]} is alive when run raised: {line}")

    def test_stop_kills_a_detached_grandchild_and_its_helper(self):
        tree = ("child", "grandchild", "helper")
        code, line, err = self.stopped("tree-stop:detached", tree)
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], f"run raised {line['value']}, not the exception given to stop")
        self.assertLess(line["after"], 2, f"run raised {line['after']:.2f} s after the signal")
        self.assertTreeGone(line, tree)

    def test_timeout_kills_a_detached_grandchild_and_its_helper(self):
        tree = ("child", "grandchild", "helper")
        d = self.driver("tree-timeout:detached")
        self.wait_ready(d, tree)
        code, line, err = self.report(d)
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["timeout"], f"run raised {line['value']}, not a timeout error")
        self.assertTreeGone(line, tree)

    def test_keyboard_interrupt_kills_a_detached_grandchild_and_its_helper(self):
        tree = ("child", "grandchild", "helper")
        code, line, err = self.stopped("tree-keyboard:detached", tree)
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], f"caught {line['value']} (mark {line['mark']!r}), not the handler's")
        self.assertEqual(line["mark"], "raised by the case's handler")
        self.assertTreeGone(line, tree)

    def test_stop_kills_two_detached_levels(self):
        tree = ("child", "grandchild", "great")
        code, line, err = self.stopped("tree-stop:levels", tree)
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], line)
        self.assertTreeGone(line, tree)

    def test_stop_kills_a_group_whose_leader_is_gone(self):
        code, line, err = self.stopped("tree-stop:leaderless", ("child", "w", "v"))
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], line)
        self.assertTreeGone(line, ("w", "v"))

    def test_stop_leaves_the_callers_own_processes(self):
        caller = ("caller-group", "caller-session")
        code, line, err = self.stopped("caller", (*caller, "child", "grandchild"))
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], line)
        self.assertEqual(code, 0, f"the calling process did not end on its own (exit {code}); stderr:\n{err}")
        for name in caller:
            pid = int((self.work / f"{name}.pid").read_text())
            self.assertFalse(line["stat"][name].startswith("T"), f"{name} {pid} was stopped when run raised: {line}")
            self.assertTrue(alive(pid), f"{name} {pid} was killed")
            stat = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout
            self.assertFalse(stat.strip().startswith("T"), f"{name} {pid} is stopped: {stat.strip()!r}")

    def test_child_that_ends_by_itself_leaves_its_grandchild(self):
        code, line, err = self.report(self.driver("by-itself"))
        self.started.extend(p for p in line.get("pids", {}).values() if p is not None)
        self.assertEqual(line["outcome"], "returned", line)
        self.assertEqual(line["type"], "CompletedProcess")
        self.assertEqual(line["returncode"], 0, line)
        grandchild = line["pids"]["grandchild"]
        self.assertIsNotNone(grandchild, f"the grandchild wrote no PID: {line}")
        self.assertTrue(line["alive"]["grandchild"], f"grandchild {grandchild} was killed: {line}")
        self.assertTrue(alive(grandchild), f"grandchild {grandchild} was killed")

    def test_stop_without_ps_kills_the_childs_group(self):
        code, line, err = self.stopped("ps-missing", ("child", "same", "detached"))
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], f"run raised {line['value']}, not the exception given to stop")
        self.assertTreeGone(line, ("child", "same"))  # the detached grandchild may be alive; the case kills it

    def test_stop_with_a_ps_that_never_answers_raises_within_5_s(self):
        self.addCleanup(self.kill_stand_in)
        code, line, err = self.stopped("ps-hang", ("child", "grandchild"))
        self.assertEqual(line["outcome"], "raised", line)
        self.assertTrue(line["same"], f"run raised {line['value']}, not the exception given to stop")
        self.assertLess(line["after"], 5, f"run raised {line['after']:.2f} s after the signal")
        self.assertTreeGone(line, ("child", "grandchild"))
        self.assertIsNotNone(line["stand_in"], f"_pmproc.PS was never run: {line}")
        self.assertFalse(line["stand_in_alive"], f"the PS stand-in {line['stand_in']} is alive when run raised")

    def kill_stand_in(self):
        try:
            pid = int((self.work / "ps.pid").read_text())
        except (OSError, ValueError):
            return
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


if __name__ == "__main__":
    unittest.main()
