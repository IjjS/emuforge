"""A run takes no later SIGTERM, SIGHUP or SIGINT once its stop is recorded (issue 50): `_pmproc.stop_on` and
`pm-structure` under a storm while an open() waits. The check `harness.storm-wait`.

Every file a case writes is under <checkout>/output/tests/storm-wait-<case>-<pid>/, which the case removes; the
large snapshot is built once for `Run` under storm-wait-snapshot-<pid>/. No case sleeps or starts a browser. Every
wait is on a condition with a bound: START_BOUND for a process to say it is ready or for a lock file to appear,
RUN_BOUND for a process to end. A helper or run still going at RUN_BOUND is sampled with `_hang.sample` (issue 37),
then killed, and the case fails with the sampler's text.

A storm of S is S sent to one process without pause, each `os.kill` after a non-blocking waitpid (`os.wait4` with
WNOHANG) that found the process unreaped, so the PID signalled is never a reaped one.

The helper (HELPER) is a new interpreter (`python3 -I`, this checkout's .pm/bin first on its path, its own session,
stdout and stderr in files) that calls `_pmproc.stop_on({SIGTERM: T, SIGHUP: H, SIGINT: I})`, notes the installed
handlers, wraps each that is a function in one that counts its calls (the handler count) and then calls it, prints
`ready`, opens for reading a FIFO the case made (the wait, until the case opens it for writing), waits (bounded) for
the stop when the case said a signal is sent, and prints one JSON line: the installed handlers, which of T, H, I
`stop_requested()` is, what a first and a second `check()` raised, the handlers `signal.getsignal` gives now, the
handler count and the CPU time of the wait. The helper of the `_pmproc.run` cases calls `run` between the two
`check()` calls and reports what it raised or returned. With `say_taken` (the case of one signal and then a storm
of another) the wrapper also writes the line `taken` to stdout once, the first time it returns with a stop
recorded, so that the storm of the other signal starts only after the first one was taken: the kernel and Python
take two pending signals in the order of their numbers, not in the order they were sent.

The stormed run is `pm-structure <wt> bucket-list.yaml --snapshot <file>` on a fixture worktree as in
`test_terminate.py` (`.git` pointing nowhere) whose `output/structure/` the case has made, in its own session, its
stdout and stderr in files, reaped with `os.wait4` so that its CPU time (user plus system) is known. The FIFO in the
result's place: right after Popen returns the case makes a FIFO at the temp file `write_json` opens,
`output/structure/s3.bucket-list-seeded.json.<pid>.tmp`; the run's open of it waits until the case opens it for
reading (non-blocking, so the case's own loop goes on), and the case reads the result from the FIFO. The storm
starts once the run's lock file exists.

On `main` `_pmproc` has no `stop_on`, so the helper ends with AttributeError before `ready` and every `StopOn` case
fails on that; the `Run` regression case fails on its CPU time.
"""
import errno
import json
import os
import pathlib
import shlex
import shutil
import signal
import subprocess
import sys
import time
import unittest

import _hang

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]
FIXTURES = HERE / "fixtures" / "structure"
BUCKET_LIST = FIXTURES / "specs" / "bucket-list.yaml"
FULL_SEEDED = FIXTURES / "snapshots" / "full-seeded.json"
SCREEN = "s3.bucket-list-seeded"
SIGNALS = (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)

START_BOUND = 60        # seconds for a process to say it is ready, or for the lock file to appear
RUN_BOUND = 180         # a helper or run still going after this is sampled, killed, and the case fails
EXIT_BOUND = 5          # seconds from the FIFO's other end being opened to the exit (R1.3)
GONE_BOUND = 5          # seconds for the child of a timed-out `_pmproc.run` to be gone
STORM = 3               # seconds of storm before the case opens the FIFO's other end
CPU_BOUND = 1.0         # seconds of CPU time of the wait (R1.1)
HANDLER_BOUND = 16      # handler calls in all (R1.2)
PAIR_SIGNALS = 100_000  # signals of the later kind after the first one
SNAPSHOT_BYTES = 60 * 1024 * 1024
ISSUE = 50

HELPER = r'''
import json
import os
import signal
import sys
import time

sys.path.insert(0, sys.argv[1])
import _pmproc

ARGS = json.loads(sys.argv[2])
SIGNALS = (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)


class Stop(BaseException):
    pass


STOPS = {sig: Stop(sig.name) for sig in SIGNALS}
NAMES = {id(exc): sig.name for sig, exc in STOPS.items()}


def kind(handler):
    if handler == signal.SIG_IGN:
        return "SIG_IGN"
    if handler == signal.SIG_DFL:
        return "SIG_DFL"
    return "function" if callable(handler) else repr(handler)


def name(exc):
    return NAMES.get(id(exc), f"{type(exc).__name__}: {exc}")


def cpu():
    t = os.times()
    return t.user + t.system


def check():
    try:
        _pmproc.check()
    except BaseException as e:
        return name(e)
    return None


_pmproc.stop_on(dict(STOPS))
installed = {}
calls = [0]
say = [bool(ARGS.get("say_taken"))]
for sig in SIGNALS:
    handler = signal.getsignal(sig)
    installed[sig.name] = kind(handler)
    if callable(handler):
        def counting(signum, frame, handler=handler):
            calls[0] += 1
            handler(signum, frame)
            if say[0] and _pmproc.stop_requested() is not None:
                say[0] = False
                os.write(1, b"taken\n")
        signal.signal(sig, counting)
print("ready", flush=True)
before = cpu()
with open(ARGS["fifo"], "rb"):
    pass
after = cpu()
if ARGS["signalled"]:
    deadline = time.monotonic() + 60
    while _pmproc.stop_requested() is None and time.monotonic() < deadline:
        pass
checks = [check()]
ran = None
if "script" in ARGS:
    try:
        done = _pmproc.run(["/bin/sh", "-c", ARGS["script"]], timeout=ARGS["timeout"], cwd=ARGS["dir"])
    except BaseException as e:
        ran = {"raised": f"{type(e).__module__}.{type(e).__qualname__}"}
    else:
        ran = {"returncode": done.returncode, "stdout": done.stdout}
checks.append(check())
stop = _pmproc.stop_requested()
print(json.dumps({"installed": installed, "stop": None if stop is None else name(stop), "checks": checks,
                  "now": {sig.name: kind(signal.getsignal(sig)) for sig in SIGNALS}, "count": calls[0],
                  "wait_cpu": after - before, "run": ran}), flush=True)
'''


def clean_env():
    """The caller's environment without git variables that would point git at another repository."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    stat = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(stat) and not stat.startswith("Z")


def drain(fd):
    """What can be read from the non-blocking descriptor `fd` now."""
    data = b""
    while True:
        try:
            chunk = os.read(fd, 65536)
        except BlockingIOError:
            return data
        if not chunk:
            return data
        data += chunk


class Child:
    """A process the case started, reaped with os.wait4: its exit status, CPU time and the moment it was reaped."""

    def __init__(self, proc, name, out, err):
        self.proc, self.name, self.out, self.err = proc, name, out, err
        self.code = self.cpu = self.ended_at = None

    @property
    def pid(self):
        return self.proc.pid

    def reaped(self):
        """A non-blocking waitpid; True once the process is reaped."""
        if self.code is not None:
            return True
        if self.proc.returncode is not None:  # reaped by Popen.poll (the sampler)
            self.code = self.proc.returncode
            return True
        pid, status, usage = os.wait4(self.proc.pid, os.WNOHANG)
        if pid == 0:
            return False
        self.ended_at = time.monotonic()
        self.code = os.waitstatus_to_exitcode(status)
        self.cpu = usage.ru_utime + usage.ru_stime
        self.proc.returncode = self.code
        return True

    def stdout(self):
        return self.out.read_text()

    def stderr(self):
        return self.err.read_text()

    def lines(self):
        return self.stdout().splitlines()


class StormCase(unittest.TestCase):
    def setUp(self):
        self.root = CHECKOUT / "output" / "tests" / f"storm-wait-{self._testMethodName}-{os.getpid()}"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.root, True)
        self.children = []
        self.pids = []  # other processes a case found, killed at the end
        self.addCleanup(self.kill_started)

    def kill_started(self):
        for pid in self.pids:
            if alive(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
        for child in self.children:
            if child.code is None and child.proc.returncode is None:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
                child.proc.wait()

    def spawn(self, cmd, name):
        """Start `cmd` in its own session with stdout and stderr in files under the case's directory."""
        out, err = self.root / f"{name}.out", self.root / f"{name}.err"
        with open(out, "w") as o, open(err, "w") as e:
            proc = subprocess.Popen([str(c) for c in cmd], stdin=subprocess.DEVNULL, stdout=o, stderr=e,
                                    env=clean_env(), start_new_session=True)
        child = Child(proc, name, out, err)
        self.children.append(child)
        return child

    def outputs(self, child):
        return f"stdout:\n{child.stdout()}\nstderr:\n{child.stderr()}"

    def gave_up(self, child, text):
        """Sample the process that passed its bound (issue 37), kill it and fail."""
        sampled = _hang.sample(child.proc, self._testMethodName, text)
        self.kill_started()
        self.fail(f"{text}; {self.outputs(child)}" + sampled)

    def wait_for(self, child, condition, what):
        """Wait (bounded) for `condition()`; fail when the process ends first or START_BOUND passes."""
        deadline = time.monotonic() + START_BOUND
        while not condition():
            if child.reaped():
                self.fail(f"{child.name} ended (exit {child.code}) before {what}; {self.outputs(child)}")
            if time.monotonic() > deadline:
                self.fail(f"no {what} from {child.name} within {START_BOUND} s; {self.outputs(child)}")

    def wait_end(self, child):
        """Wait (bounded) until the process is reaped; past RUN_BOUND sample it and fail."""
        deadline = time.monotonic() + RUN_BOUND
        while not child.reaped():
            if time.monotonic() > deadline:
                self.gave_up(child, f"{child.name} did not end within {RUN_BOUND} s")


class StopOn(StormCase):
    def helper(self, signalled, name="helper", **extra):
        fifo = self.root / f"{name}.fifo"
        os.mkfifo(fifo)
        script = self.root / "helper.py"
        if not script.exists():
            script.write_text(HELPER)
        args = {"fifo": str(fifo), "signalled": signalled, **extra}
        child = self.spawn([sys.executable, "-I", script, BIN, json.dumps(args)], name)
        child.fifo = fifo
        self.wait_for(child, lambda: "ready" in child.lines(), "`ready`")
        return child

    def open_writer(self, child):
        """Open the helper's FIFO for writing once, without blocking; the moment it opened, or None (no reader)."""
        try:
            fd = os.open(child.fifo, os.O_WRONLY | os.O_NONBLOCK)
        except OSError as e:
            if e.errno != errno.ENXIO:
                raise
            return None
        opened = time.monotonic()
        os.close(fd)
        return opened

    def writer(self, child):
        """Open the helper's FIFO for writing, retried (bounded) until the helper waits in its open."""
        deadline = time.monotonic() + START_BOUND
        while True:
            opened = self.open_writer(child)
            if opened is not None:
                return opened
            if child.reaped():
                self.fail(f"{child.name} ended (exit {child.code}) before the writer's open; {self.outputs(child)}")
            if time.monotonic() > deadline:
                self.fail(f"{child.name} did not open its FIFO within {START_BOUND} s; {self.outputs(child)}")

    def report(self, child, opened):
        """Wait for the helper; assert exit 0 within EXIT_BOUND of the writer's open, empty stderr; its JSON."""
        self.wait_end(child)
        detail = f"exit {child.code} {child.ended_at - opened:.3f} s after the writer's open; {self.outputs(child)}"
        self.assertEqual(child.code, 0, detail)
        self.assertLessEqual(child.ended_at - opened, EXIT_BOUND, detail)
        self.assertEqual(child.stderr(), "", detail)
        return json.loads(child.lines()[-1]), detail

    def test_storm_during_the_wait_is_not_taken(self):
        child = self.helper(signalled=True)
        start, opened, sent = time.monotonic(), None, 0
        while not child.reaped():
            now = time.monotonic()
            if now - start > RUN_BOUND:
                self.gave_up(child, f"the helper did not exit within {RUN_BOUND} s of a storm of SIGTERM")
            if opened is None and now - start >= STORM:
                opened = self.open_writer(child)
            os.kill(child.pid, signal.SIGTERM)
            sent += 1
        if opened is None:
            self.fail(f"the helper exited (exit {child.code}) before the writer's open; {self.outputs(child)}")
        report, detail = self.report(child, opened)
        detail = f"{sent} signals; {report}; {detail}"
        self.assertEqual(report["stop"], "SIGTERM", detail)
        self.assertLessEqual(report["wait_cpu"], CPU_BOUND, detail)
        self.assertLessEqual(report["count"], HANDLER_BOUND, detail)

    def test_one_sigterm_is_delivered_once_and_ignores_the_three(self):
        child = self.helper(signalled=True)
        os.kill(child.pid, signal.SIGTERM)
        report, detail = self.report(child, self.writer(child))
        detail = f"{report}; {detail}"
        self.assertEqual(report["stop"], "SIGTERM", detail)
        self.assertEqual(report["checks"], ["SIGTERM", None], detail)
        self.assertEqual(report["now"], {sig.name: "SIG_IGN" for sig in SIGNALS}, detail)

    def test_a_later_signal_of_another_kind_changes_nothing(self):
        for first, later in ((signal.SIGINT, signal.SIGTERM), (signal.SIGHUP, signal.SIGINT),
                             (signal.SIGTERM, signal.SIGHUP)):
            with self.subTest(case=f"{first.name} then {later.name}"):
                child = self.helper(signalled=True, name=f"helper-{first.name}-{later.name}", say_taken=True)
                os.kill(child.pid, first)
                self.wait_for(child, lambda: "taken" in child.lines(), f"`taken` after {first.name}")
                sent = 0
                while sent < PAIR_SIGNALS and not child.reaped():
                    os.kill(child.pid, later)
                    sent += 1
                report, detail = self.report(child, self.writer(child))
                detail = f"{sent} of {later.name}; {report}; {detail}"
                self.assertEqual(report["stop"], first.name, detail)
                self.assertEqual(report["checks"][0], first.name, detail)
                self.assertEqual(report["now"], {sig.name: "SIG_IGN" for sig in SIGNALS}, detail)
                self.assertLessEqual(report["count"], HANDLER_BOUND, detail)

    def test_no_signal_ignores_nothing(self):
        child = self.helper(signalled=False)
        report, detail = self.report(child, self.writer(child))
        detail = f"{report}; {detail}"
        self.assertIsNone(report["stop"], detail)
        self.assertEqual(report["checks"], [None, None], detail)
        self.assertEqual(report["installed"], {sig.name: "function" for sig in SIGNALS}, detail)
        self.assertEqual(report["count"], 0, detail)

    def test_run_after_a_stop_kills_the_child_at_its_timeout(self):
        pidfile = self.root / "child.pid"
        script = f"echo $$ > {shlex.quote(str(pidfile))}; while :; do :; done"
        child = self.helper(signalled=True, script=script, timeout=1, dir=str(self.root))
        os.kill(child.pid, signal.SIGTERM)
        report, detail = self.report(child, self.writer(child))
        detail = f"{report}; {detail}"
        self.assertEqual(report["run"], {"raised": "subprocess.TimeoutExpired"}, detail)
        self.assertTrue(pidfile.exists(), f"the script wrote no PID; {detail}")
        pid = int(pidfile.read_text().strip())
        self.pids.append(pid)
        deadline = time.monotonic() + GONE_BOUND
        while alive(pid):
            if time.monotonic() > deadline:
                self.fail(f"the child {pid} is still alive {GONE_BOUND} s after run raised; {detail}")

    def test_run_after_a_stop_child_inherits_the_ignored_signals(self):
        script = "kill -TERM $$; kill -HUP $$; kill -INT $$; printf alive"
        child = self.helper(signalled=True, script=script, timeout=10, dir=str(self.root))
        os.kill(child.pid, signal.SIGTERM)
        report, detail = self.report(child, self.writer(child))
        self.assertEqual(report["run"], {"returncode": 0, "stdout": "alive"}, f"{report}; {detail}")


class Run(StormCase):
    @classmethod
    def setUpClass(cls):
        """The large snapshot, built once: full-seeded.json padded with StaticText nodes under `main` to about
        60 MiB, as test_terminate.SnapshotRun.big_snapshot builds it."""
        cls.shared = CHECKOUT / "output" / "tests" / f"storm-wait-snapshot-{os.getpid()}"
        if cls.shared.exists():
            shutil.rmtree(cls.shared)
        cls.shared.mkdir(parents=True)
        snap = json.loads(FULL_SEEDED.read_text())
        main = next(i for i, n in enumerate(snap["nodes"]) if n["role"] == "main")
        node = {"role": "StaticText", "name": "x" * 20, "parent": main}
        count = (SNAPSHOT_BYTES - len(json.dumps(snap))) // (len(json.dumps(node)) + 2)
        snap["nodes"].extend([node] * count)
        cls.big = cls.shared / "big-snapshot.json"
        cls.big.write_text(json.dumps(snap))
        size = cls.big.stat().st_size
        if not 50 * 1024 * 1024 < size < 64 * 1024 * 1024:
            raise AssertionError(f"the large snapshot is {size} bytes")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.shared, True)

    def worktree(self, name="wt"):
        wt = self.root / name
        (wt / "output" / "structure").mkdir(parents=True)
        (wt / ".git").write_text("gitdir: ./missing-gitdir\n")  # git stops here instead of finding the checkout
        return wt

    def out(self, wt):
        return wt / "output" / "structure"

    def result_path(self, wt):
        return self.out(wt) / f"{SCREEN}.json"

    def lock(self, wt):
        return self.out(wt) / f"{SCREEN}.lock"

    def start(self, wt, *args, bin=BIN, name="run"):
        """Start pm-structure on `wt` and the bucket-list spec with `args`, from `bin`."""
        return self.spawn([bin / "pm-structure", wt, BUCKET_LIST, *args], name)

    def fifo(self, wt, child):
        path = self.out(wt) / f"{SCREEN}.json.{child.pid}.tmp"
        os.mkfifo(path)
        return path

    def assertStopLines(self, child, wt, name, detail):
        self.assertEqual(child.stderr(), f"pm-structure: terminated by {name}\n", detail)
        self.assertEqual(child.stdout(), f"result: {self.result_path(wt)}\n", detail)

    def test_storm_while_the_result_open_waits(self):
        for sig in SIGNALS:
            with self.subTest(case=sig.name):
                wt = self.worktree(f"wt-{sig.name}")
                child = self.start(wt, "--snapshot", self.big, name=f"run-{sig.name}")
                fifo = self.fifo(wt, child)
                self.wait_for(child, self.lock(wt).exists, "lock file")
                start, reader, opened, data, sent = time.monotonic(), None, None, b"", 0
                try:
                    while not child.reaped():
                        now = time.monotonic()
                        if now - start > RUN_BOUND:
                            self.gave_up(child, f"pm-structure did not exit within {RUN_BOUND} s of a storm of "
                                                f"{sig.name}")
                        if reader is None and now - start >= STORM:
                            reader = os.open(fifo, os.O_RDONLY | os.O_NONBLOCK)
                            opened = time.monotonic()
                        if reader is not None:
                            data += drain(reader)
                        os.kill(child.pid, sig)
                        sent += 1
                    if reader is None:
                        self.fail(f"pm-structure exited (exit {child.code}) before the reader's open; "
                                  f"{self.outputs(child)}")
                    data += drain(reader)
                finally:
                    if reader is not None:
                        os.close(reader)
                took = child.ended_at - opened
                detail = (f"exit {child.code} {took:.3f} s after the reader's open, CPU time {child.cpu:.3f} s, "
                          f"{sent} signals; read from the FIFO: {data[:500]!r}; {self.outputs(child)}")
                self.assertEqual(child.code, 2, detail)
                self.assertLessEqual(took, EXIT_BOUND, detail)
                self.assertLessEqual(child.cpu, CPU_BOUND, detail)
                result = json.loads(data)
                self.assertEqual(result.get("verdict"), "error", detail)
                self.assertEqual(result.get("error"), f"terminated by {sig.name}", detail)
                self.assertStopLines(child, wt, sig.name, detail)
                self.assertFalse(self.lock(wt).exists(), f"the lock file is left; {detail}")

    def test_no_signal_with_the_fifo_passes(self):
        wt = self.worktree()
        child = self.start(wt, "--snapshot", FULL_SEEDED)
        fifo = self.fifo(wt, child)
        self.wait_for(child, self.lock(wt).exists, "lock file")
        reader, data = os.open(fifo, os.O_RDONLY | os.O_NONBLOCK), b""
        try:
            deadline = time.monotonic() + RUN_BOUND
            while not child.reaped():
                if time.monotonic() > deadline:
                    self.gave_up(child, f"pm-structure did not exit within {RUN_BOUND} s")
                data += drain(reader)
            data += drain(reader)
        finally:
            os.close(reader)
        detail = f"exit {child.code}; read from the FIFO: {data[:500]!r}; {self.outputs(child)}"
        self.assertEqual(child.code, 0, detail)
        self.assertEqual(child.stderr(), "", detail)
        self.assertEqual(child.lines()[-1:], [f"result: {self.result_path(wt)}"], detail)
        self.assertEqual(json.loads(data).get("verdict"), "pass", detail)

    def test_record_storm_writes_one_error_row(self):
        shutil.copytree(BIN, self.root / ".pm" / "bin", ignore=shutil.ignore_patterns("tests", "__pycache__"))
        issue = self.root / ".pm" / f"issue-{ISSUE}"
        issue.mkdir()
        wt = self.worktree()
        child = self.start(wt, "--snapshot", self.big, "--record", ISSUE, "final", bin=self.root / ".pm" / "bin")
        self.wait_for(child, self.lock(wt).exists, "lock file")
        sent, deadline = 0, time.monotonic() + RUN_BOUND
        while not child.reaped():
            if time.monotonic() > deadline:
                self.gave_up(child, f"pm-structure did not exit within {RUN_BOUND} s of a storm of SIGTERM")
            os.kill(child.pid, signal.SIGTERM)
            sent += 1
        detail = f"exit {child.code} after {sent} signals; {self.outputs(child)}"
        self.assertEqual(child.code, 2, detail)
        self.assertStopLines(child, wt, "SIGTERM", detail)
        result = json.loads(self.result_path(wt).read_text())
        self.assertEqual(result.get("verdict"), "error", f"{result}; {detail}")
        self.assertEqual(result.get("error"), "terminated by SIGTERM", f"{result}; {detail}")
        rows = json.loads((issue / "structure-scores.json").read_text())
        self.assertEqual(len(rows), 1, f"{rows}; {detail}")
        self.assertEqual(rows[0].get("verdict"), "error", f"{rows}; {detail}")
        self.assertFalse(self.lock(wt).exists(), f"the lock file is left; {detail}")


if __name__ == "__main__":
    unittest.main()
