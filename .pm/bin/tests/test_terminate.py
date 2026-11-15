"""pm-structure under a signal (issue 12): SIGTERM, SIGHUP or SIGINT during a run that holds its lock.

The browser cases need `@playwright/test` (and its Chromium) in this checkout's `studio/node_modules`; they fail,
never skip, without it. Each runs this checkout's `.pm/bin/pm-structure` (the --record case: a copy of `.pm/bin`
under the case's directory, as `test_records.py` does, so the real `.pm/` is never written) on a fixture worktree
under <checkout>/output/tests/terminate-<case>-<pid>/ built as in `test_capture.py`: `studio/node_modules` is a
symlink to this checkout's and `.git` points nowhere. The page is `fixtures/structure/pages/restless` (it never
settles, so the run lasts until its 10 s settle bound), scored against `specs/bucket-list.yaml`. The signal is
sent once a Chromium process is among the descendants of `pm-structure` (found with `ps`); every descendant PID at
that moment is recorded, and every recorded process still alive at the end of the case is killed.

The --snapshot case builds a valid snapshot of about 60 MiB (`full-seeded.json` padded with `StaticText` nodes
under `main`) and signals the run once its lock file exists; no child runs then.

"Alive" means `os.kill(pid, 0)` succeeds and `ps` does not show the process as a zombie.
"""
import http.server
import json
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import threading
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]
FIXTURES = HERE / "fixtures" / "structure"
PAGES = FIXTURES / "pages"
BUCKET_LIST = FIXTURES / "specs" / "bucket-list.yaml"
FULL_SEEDED = FIXTURES / "snapshots" / "full-seeded.json"
NODE_MODULES = CHECKOUT / "studio" / "node_modules"
SCREEN = "s3.bucket-list-seeded"

EXIT_BOUND = 5          # seconds from the signal to the exit of a browser run (requirement R2)
GONE_BOUND = 5          # seconds from the exit until every recorded descendant is gone (R2)
SNAPSHOT_EXIT_BOUND = 15
START_BOUND = 60        # seconds for Chromium to start, or for the lock file to appear
RUN_BOUND = 180         # a run still going after this is killed and the case fails
POLL = 0.02
SNAPSHOT_BYTES = 60 * 1024 * 1024
ISSUE = 12


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


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


def processes():
    """{pid: (ppid, command)} of every process `ps` lists."""
    out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,command="], capture_output=True, text=True).stdout
    table = {}
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            table[int(parts[0])] = (int(parts[1]), parts[2] if len(parts) == 3 else "")
    return table


def descendants(root):
    """{pid: command} of every descendant of `root`."""
    table = processes()
    children = {}
    for pid, (ppid, _) in table.items():
        children.setdefault(ppid, []).append(pid)
    found, todo = {}, list(children.get(root, []))
    while todo:
        pid = todo.pop()
        if pid not in found:
            found[pid] = table[pid][1]
            todo.extend(children.get(pid, []))
    return found


def is_node(command):
    return os.path.basename(command.split(" ", 1)[0]) == "node"


def is_chromium(command):
    return "chrom" in command.lower() and not is_node(command)


def refused(port):
    """True when a connection to 127.0.0.1:port is refused."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return False
    except ConnectionRefusedError:
        return True


class Run:
    """One pm-structure process: its exit status, output and the time from the first signal to its exit."""

    def __init__(self, proc):
        self.proc = proc
        self.signalled = None
        self.recorded = {}
        self.code = self.stdout = self.stderr = None
        self.took = None
        self.exited_at = None


class TerminateCase(unittest.TestCase):
    def setUp(self):
        self.root = CHECKOUT / "output" / "tests" / f"terminate-{self._testMethodName}-{os.getpid()}"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.root, True)
        self.started = []  # pm-structure processes and the descendants recorded, killed at the end
        self.addCleanup(self.kill_started)
        self.bin = BIN

    def kill_started(self):
        for pid in self.started:
            if alive(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass

    def worktree(self, name="wt"):
        wt = self.root / name
        (wt / "studio").mkdir(parents=True)
        os.symlink(NODE_MODULES, wt / "studio" / "node_modules")
        (wt / ".git").write_text("gitdir: ./missing-gitdir\n")  # git stops here instead of finding the checkout
        return wt

    def start(self, wt, *args, spec=BUCKET_LIST):
        cmd = [str(self.bin / "pm-structure"), str(wt), str(spec), *[str(a) for a in args]]
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, env=clean_env(), start_new_session=True)
        self.started.append(proc.pid)
        self.addCleanup(proc.wait)
        self.addCleanup(proc.stderr.close)
        self.addCleanup(proc.stdout.close)
        return Run(proc)

    def finish(self, run):
        try:
            run.stdout, run.stderr = run.proc.communicate(timeout=RUN_BOUND)
        except subprocess.TimeoutExpired:
            run.proc.kill()
            run.stdout, run.stderr = run.proc.communicate()
            self.fail(f"pm-structure did not end within {RUN_BOUND} s; stderr:\n{run.stderr}")
        run.exited_at = time.monotonic()
        run.code = run.proc.returncode
        if run.signalled is not None:
            run.took = run.exited_at - run.signalled
        return run

    def wait_until(self, run, condition, bound, what):
        """Wait (bounded) for `condition()`; fail when pm-structure ends first or the bound passes."""
        deadline = time.monotonic() + bound
        while True:
            value = condition()
            if value:
                return value
            try:
                run.proc.wait(timeout=POLL)
            except subprocess.TimeoutExpired:
                pass
            else:
                self.finish(run)
                self.fail(f"pm-structure ended (exit {run.code}) before {what}; stdout:\n{run.stdout}\n"
                          f"stderr:\n{run.stderr}")
            if time.monotonic() > deadline:
                self.fail(f"no {what} within {bound} s")

    def wait_for_chromium(self, run):
        """Wait until a Chromium process is among pm-structure's descendants; record every descendant."""
        def chromium():
            found = descendants(run.proc.pid)
            return found if any(is_chromium(c) for c in found.values()) else None

        run.recorded = self.wait_until(run, chromium, START_BOUND, "Chromium process among the descendants")
        self.started.extend(run.recorded)
        return run.recorded

    def signal(self, run, *signals):
        run.signalled = time.monotonic()
        for sig in signals:
            os.kill(run.proc.pid, sig)

    def browser_run(self, wt, *signals, args=None, port=None):
        """Run pm-structure on pages/restless (or with `args`), send `signals` once Chromium runs, wait for it."""
        if args is None:
            args = ("--serve", PAGES / "restless", "--port", port or free_port())
        run = self.start(wt, *args)
        self.wait_for_chromium(run)
        self.signal(run, *signals)
        return self.finish(run)

    def result_path(self, wt):
        return wt / "output" / "structure" / f"{SCREEN}.json"

    def result(self, wt):
        return json.loads(self.result_path(wt).read_text())

    def assertTerminated(self, run, wt, name, bound=EXIT_BOUND):
        """Exit 2 within `bound` s of the signal, the one stderr line and the one stdout line."""
        detail = f"exit {run.code} {run.took:.1f} s after the signal; stdout:\n{run.stdout}\nstderr:\n{run.stderr}"
        self.assertEqual(run.code, 2, detail)
        self.assertLess(run.took, bound, detail)
        self.assertNotIn("Traceback", run.stderr, detail)
        self.assertEqual(run.stderr.splitlines(), [f"pm-structure: terminated by {name}"], detail)
        self.assertEqual(run.stdout.splitlines(), [f"result: {self.result_path(wt)}"], detail)

    def assertNothingLeft(self, run, wt, port=None):
        """No recorded node alive at the exit; no recorded descendant alive within GONE_BOUND s of it; no lock, job
        file or script copy; with `port`, the static server's port refuses connections."""
        nodes = [pid for pid, command in run.recorded.items() if is_node(command)]
        self.assertTrue(nodes, f"no node process among the recorded descendants: {run.recorded}")
        left = [pid for pid in nodes if alive(pid)]
        self.assertEqual(left, [], f"node still alive once pm-structure exited: "
                                   f"{ {pid: run.recorded[pid] for pid in left} }")
        deadline = run.exited_at + GONE_BOUND
        while True:
            left = [pid for pid in run.recorded if alive(pid)]
            if not left or time.monotonic() > deadline:
                break
            time.sleep(min(POLL, max(0, deadline - time.monotonic())))
        self.assertEqual(left, [], f"descendants still alive {GONE_BOUND} s after the exit: "
                                   f"{ {pid: run.recorded[pid] for pid in left} }")
        out = wt / "output" / "structure"
        self.assertFalse((out / f"{SCREEN}.lock").exists(), "the lock file is left")
        self.assertEqual(sorted(p.name for p in out.glob("*.job.json")), [], "a job file is left")
        self.assertEqual(sorted(p.name for p in (wt / "studio" / "output").glob(".structure-capture-*.mjs")), [],
                         "a script copy is left")
        if port is not None:
            self.assertTrue(refused(port), f"port {port} still accepts connections")


class BrowserRun(TerminateCase):
    def setUp(self):
        if not (NODE_MODULES / "@playwright" / "test").exists():
            self.fail(f"@playwright/test is not installed in {NODE_MODULES.parent}; the browser cases need it")
        super().setUp()

    def test_signal_exits_2_with_one_line_each(self):
        for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            with self.subTest(case=sig.name):
                wt = self.worktree(f"wt-{sig.name}")
                run = self.browser_run(wt, sig)
                self.assertTerminated(run, wt, sig.name)

    def test_signal_leaves_nothing(self):
        for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            with self.subTest(case=sig.name):
                wt = self.worktree(f"wt-{sig.name}")
                port = free_port()
                run = self.browser_run(wt, sig, port=port)
                self.assertNothingLeft(run, wt, port)

    def test_signal_replaces_an_earlier_pass(self):
        wt = self.worktree()
        earlier = self.finish(self.start(wt, "--serve", PAGES / "full", "--port", free_port()))
        self.assertEqual(earlier.code, 0, f"the earlier run on pages/full: stdout:\n{earlier.stdout}\n"
                                          f"stderr:\n{earlier.stderr}")
        self.assertEqual(self.result(wt)["verdict"], "pass")
        run = self.browser_run(wt, signal.SIGTERM)
        self.assertEqual(run.code, 2, run.stderr)
        result = self.result(wt)
        self.assertEqual(result.get("verdict"), "error", result)
        self.assertEqual(result.get("error"), "terminated by SIGTERM", result)

    def test_record_appends_one_error_row(self):
        shutil.copytree(BIN, self.root / ".pm" / "bin", ignore=shutil.ignore_patterns("tests", "__pycache__"))
        self.bin = self.root / ".pm" / "bin"
        issue = self.root / ".pm" / f"issue-{ISSUE}"
        issue.mkdir()
        earlier = {"point": "baseline", "screen": "s3.bucket-list", "state": "empty", "score": 100, "matched": 1,
                   "total": 1, "verdict": "pass", "critical_unmatched": [], "requires": ["seeded"], "commit": None,
                   "dirty": None, "spec_sha256": None, "result": "earlier", "at": "2026-11-15T10:00:00+09:00"}
        (issue / "structure-scores.json").write_text(json.dumps([earlier]))
        wt = self.worktree()
        run = self.browser_run(wt, signal.SIGTERM, args=("--serve", PAGES / "restless", "--port", free_port(),
                                                         "--record", ISSUE, "baseline"))
        self.assertEqual(run.code, 2, run.stderr)
        rows = json.loads((issue / "structure-scores.json").read_text())
        self.assertEqual(len(rows), 2, rows)
        self.assertEqual(rows[0], earlier)
        self.assertEqual(rows[1].get("verdict"), "error", rows[1])
        self.assertIsNone(rows[1].get("score", "absent"), rows[1])
        self.assertEqual(rows[1].get("point"), "baseline", rows[1])

    def test_url_run_signal(self):
        page = (PAGES / "restless" / "index.html").read_bytes()

        class Page(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(page)))
                self.end_headers()
                self.wfile.write(page)

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        wt = self.worktree()
        run = self.browser_run(wt, signal.SIGTERM, args=("--url", f"http://127.0.0.1:{server.server_address[1]}"))
        detail = f"exit {run.code} {run.took:.1f} s after the signal; stdout:\n{run.stdout}\nstderr:\n{run.stderr}"
        self.assertEqual(run.code, 2, detail)
        self.assertLess(run.took, EXIT_BOUND, detail)
        self.assertEqual(run.stderr.splitlines(), ["pm-structure: terminated by SIGTERM"], detail)
        self.assertNothingLeft(run, wt)

    def test_second_sigterm_changes_nothing(self):
        wt = self.worktree()
        port = free_port()
        run = self.browser_run(wt, signal.SIGTERM, signal.SIGTERM, port=port)
        self.assertTerminated(run, wt, "SIGTERM")
        self.assertNothingLeft(run, wt, port)

    def test_sigint_then_sigterm_reports_sigint(self):
        wt = self.worktree()
        run = self.browser_run(wt, signal.SIGINT, signal.SIGTERM)
        detail = f"exit {run.code}; stdout:\n{run.stdout}\nstderr:\n{run.stderr}"
        self.assertEqual(run.code, 2, detail)
        self.assertEqual(run.stderr.splitlines(), ["pm-structure: terminated by SIGINT"], detail)


class SnapshotRun(TerminateCase):
    def big_snapshot(self):
        """A valid snapshot of about 60 MiB: full-seeded.json with StaticText nodes added under `main`."""
        snap = json.loads(FULL_SEEDED.read_text())
        main = next(i for i, n in enumerate(snap["nodes"]) if n["role"] == "main")
        node = json.dumps({"role": "StaticText", "name": "padding " + "x" * 200, "parent": main})
        count = (SNAPSHOT_BYTES - len(json.dumps(snap))) // (len(node) + 2)
        snap["nodes"].extend(json.loads(node) for _ in range(count))
        path = self.root / "big-snapshot.json"
        path.write_text(json.dumps(snap))
        size = path.stat().st_size
        self.assertTrue(50 * 1024 * 1024 < size < 64 * 1024 * 1024, size)
        return path

    def test_snapshot_run_signal_while_scoring(self):
        snapshot = self.big_snapshot()
        wt = self.worktree()
        lock = wt / "output" / "structure" / f"{SCREEN}.lock"
        run = self.start(wt, "--snapshot", snapshot)
        self.wait_until(run, lock.exists, START_BOUND, "lock file")
        self.signal(run, signal.SIGTERM)
        self.finish(run)
        self.assertTerminated(run, wt, "SIGTERM", bound=SNAPSHOT_EXIT_BOUND)
        result = self.result(wt)
        self.assertEqual(result.get("verdict"), "error", result)
        self.assertEqual(result.get("error"), "terminated by SIGTERM", result)
        self.assertFalse(lock.exists(), "the lock file is left")


if __name__ == "__main__":
    unittest.main()
