"""The stop is looked for during the load and the scoring of a snapshot (issue 31).

`_pmscore.load_snapshot(path, look=...)` and `_pmscore.score(spec, snap, state, look=...)` call `look` (a function
of no argument) while they work; whatever `look` raises leaves them. The cases count those calls with a counting
look and stop the work with a look that raises `Stop` (derived from `BaseException`, as `pm-structure`'s
`Terminated` is) at its j-th call. The `Run` cases run this checkout's `.pm/bin/pm-structure --snapshot` on a
fixture worktree built as in `test_terminate.py` (`.git` pointing nowhere) and reap it with `os.wait4`, so that its
CPU time (user plus system) is known.

A padded snapshot of N nodes is `fixtures/structure/snapshots/full-seeded.json` with `StaticText` nodes (name of 20
characters, parent the `main` node) appended until it has N nodes; N = 1 is a file whose `nodes` is the one
`RootWebArea` node of `full-seeded.json`. Every file a case writes is under its own directory
<checkout>/output/tests/stop-work-<case>-<pid>/, which the case removes.
"""
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import threading
import time
import unittest

try:
    import _pmscore
    import _pmspec
except ImportError as e:  # every case fails on its own when a module does not exist
    _pmscore, IMPORT_ERROR = None, e

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]
FIXTURES = HERE / "fixtures" / "structure"
SNAPS = FIXTURES / "snapshots"
SPECS = FIXTURES / "specs"
FULL_SEEDED = SNAPS / "full-seeded.json"
WIZARD_FULL = SNAPS / "wizard-full.json"
BUCKET_LIST = SPECS / "bucket-list.yaml"
WIZARD = SPECS / "wizard.yaml"
NODE_MODULES = CHECKOUT / "studio" / "node_modules"
SCREEN = "s3.bucket-list-seeded"

EVERY = 1024                        # at least one look per this many JSON objects or nodes (requirement R3)
WALKLESS = ("order", "counter", "pagination")  # bucket-list.yaml kinds decided without a walk over the nodes
SNAPSHOT_BYTES = 60 * 1024 * 1024   # the size test_terminate.SnapshotRun.big_snapshot pads to
START_BOUND = 60                    # seconds for the lock file to appear
RUN_BOUND = 180                     # a run still going after this is killed and the case fails
POLL = 0.02


class Stop(BaseException):
    pass


class Counting:
    """A look that counts its calls and returns None."""

    def __init__(self):
        self.calls = 0

    def __call__(self):
        self.calls += 1


class RaisesAt(Counting):
    """A look that counts its calls and at the j-th raises its one `Stop` instance."""

    def __init__(self, j):
        super().__init__()
        self.j = j
        self.raised = Stop(f"look {j}")

    def __call__(self):
        super().__call__()
        if self.calls == self.j:
            raise self.raised


def clean_env():
    """The caller's environment without git variables that would point git at another repository."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


class Case(unittest.TestCase):
    def setUp(self):
        if _pmscore is None:
            self.fail(f"_pmscore or _pmspec cannot be imported: {IMPORT_ERROR}")
        self.root = CHECKOUT / "output" / "tests" / f"stop-work-{self._testMethodName}-{os.getpid()}"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.root, True)

    def padded(self, n, name=None, **changes):
        """The path of a padded snapshot of `n` nodes under the case's directory; `changes` replace top-level keys."""
        snap = json.loads(FULL_SEEDED.read_text())
        if n == 1:
            snap["nodes"] = [snap["nodes"][0]]
        else:
            main = next(i for i, node in enumerate(snap["nodes"]) if node["role"] == "main")
            self.assertGreaterEqual(n, len(snap["nodes"]), "a padded snapshot only adds nodes")
            snap["nodes"].extend([{"role": "StaticText", "name": "x" * 20, "parent": main}]
                                 * (n - len(snap["nodes"])))
        self.assertEqual(snap["nodes"][0]["role"], "RootWebArea")
        snap.update(changes)
        path = self.root / (name or f"padded-{n}.json")
        path.write_text(json.dumps(snap))
        return str(path)

    def write(self, name, data):
        path = self.root / name
        path.write_bytes(data)
        return str(path)

    def snapshot_error(self, call):
        """The text of the SnapshotError `call()` raises."""
        with self.assertRaises(_pmscore.SnapshotError) as cm:
            call()
        return str(cm.exception)

    def assertStops(self, call, look):
        """`call()` lets the look's own Stop instance out and the look was called exactly j times."""
        with self.assertRaises(Stop) as cm:
            call()
        self.assertIs(cm.exception, look.raised, "the Stop that left is not the look's own instance")
        self.assertEqual(look.calls, look.j, f"the look was called {look.calls} times, it raised at call {look.j}")


class Load(Case):
    def test_counting_look_5000_nodes(self):
        n = 5000
        path = self.padded(n)
        look = Counting()
        self.assertEqual(_pmscore.load_snapshot(path, look=look), _pmscore.load_snapshot(path))
        self.assertGreaterEqual(look.calls, 2 + 2 * (n // EVERY))

    def test_counting_look_1_and_1024_nodes(self):
        for n, least in ((1, 2), (1024, 4)):
            with self.subTest(nodes=n):
                self.assertEqual(2 + 2 * (n // EVERY), least)
                path = self.padded(n)
                look = Counting()
                self.assertEqual(_pmscore.load_snapshot(path, look=look), _pmscore.load_snapshot(path))
                self.assertGreaterEqual(look.calls, least)

    def test_look_that_raises_stops_the_load(self):
        path = self.padded(5000)
        counting = Counting()
        _pmscore.load_snapshot(path, look=counting)
        last = counting.calls
        for case, j in (("first", 1), ("second", 2), ("middle", (last + 1) // 2), ("last", last)):
            with self.subTest(case=case, j=j):
                look = RaisesAt(j)
                self.assertStops(lambda: _pmscore.load_snapshot(path, look=look), look)

    def test_other_format_looks_in_the_parse_alone(self):
        n = 5000
        path = self.padded(n, "other-format.json", format="other/1")
        without = self.snapshot_error(lambda: _pmscore.load_snapshot(path))
        self.assertEqual(without, f"cannot read snapshot {path}: format is not pm-structure-snapshot/1")
        look = Counting()
        self.assertEqual(self.snapshot_error(lambda: _pmscore.load_snapshot(path, look=look)), without)
        self.assertGreaterEqual(look.calls, 2 + n // EVERY)

    def test_not_json_and_not_utf8(self):
        for case, data, least in (("not JSON", b"{", 2), ("not UTF-8", b"\xff", 1)):
            with self.subTest(case=case):
                path = self.write(f"{case.replace(' ', '-')}.json", data)
                text = f"cannot read snapshot {path}: not JSON"
                self.assertEqual(self.snapshot_error(lambda: _pmscore.load_snapshot(path)), text)
                look = Counting()
                self.assertEqual(self.snapshot_error(lambda: _pmscore.load_snapshot(path, look=look)), text)
                self.assertGreaterEqual(look.calls, least)

    def test_steps_file_counting_look(self):
        path = str(WIZARD_FULL)
        look = Counting()
        steps = _pmscore.load_snapshot(path, look=look)
        self.assertIsInstance(steps, _pmscore.Steps)
        self.assertEqual(steps, _pmscore.load_snapshot(path))
        self.assertGreaterEqual(look.calls, 2)

    def test_steps_file_look_that_raises_at_the_last_call(self):
        path = str(WIZARD_FULL)
        counting = Counting()
        _pmscore.load_snapshot(path, look=counting)
        look = RaisesAt(counting.calls)
        self.assertStops(lambda: _pmscore.load_snapshot(path, look=look), look)

    def test_missing_file_makes_no_look(self):
        path = str(self.root / "missing.json")
        look = Counting()
        self.assertEqual(self.snapshot_error(lambda: _pmscore.load_snapshot(path, look=look)),
                         self.snapshot_error(lambda: _pmscore.load_snapshot(path)))
        self.assertEqual(look.calls, 0)


class Score(Case):
    def setUp(self):
        super().setUp()
        self.spec = _pmspec.load(str(BUCKET_LIST))

    def walks(self, spec):
        """I, the number of the spec's items, and P, those whose candidates are found by a walk over the nodes."""
        return len(spec.items), sum(1 for item in spec.items if item.kind not in WALKLESS)

    def test_counting_look_5000_nodes(self):
        n = 5000
        path = self.padded(n)
        i, p = self.walks(self.spec)
        self.assertEqual((i, p), (20, 15), "bucket-list.yaml is not the spec the criteria count")
        look = Counting()
        result = _pmscore.score(self.spec, _pmscore.load_snapshot(path), "seeded", look=look)
        reference = _pmscore.score(self.spec, _pmscore.load_snapshot(path), "seeded")
        self.assertEqual(_pmscore.result_json(result, {}), _pmscore.result_json(reference, {}))
        self.assertEqual(_pmscore.render_text(result), _pmscore.render_text(reference))
        least = i + (p + 1) * (n // EVERY)
        self.assertEqual(least, 84)
        self.assertGreaterEqual(look.calls, least)

    def test_counting_look_full_seeded(self):
        path = str(FULL_SEEDED)
        i, _ = self.walks(self.spec)
        look = Counting()
        result = _pmscore.score(self.spec, _pmscore.load_snapshot(path), "seeded", look=look)
        reference = _pmscore.score(self.spec, _pmscore.load_snapshot(path), "seeded")
        self.assertEqual(len(_pmscore.load_snapshot(path).nodes), 69)
        self.assertEqual(_pmscore.result_json(result, {}), _pmscore.result_json(reference, {}))
        self.assertEqual(_pmscore.render_text(result), _pmscore.render_text(reference))
        self.assertEqual(_pmscore.result_json(result, {})["verdict"], "pass")
        self.assertGreaterEqual(look.calls, i)

    def test_look_that_raises_stops_the_scoring(self):
        path = self.padded(5000)
        counting = Counting()
        _pmscore.score(self.spec, _pmscore.load_snapshot(path), "seeded", look=counting)
        last = counting.calls
        for case, j in (("first", 1), ("middle", (last + 1) // 2), ("last", last)):
            with self.subTest(case=case, j=j):
                snap = _pmscore.load_snapshot(path)
                look = RaisesAt(j)
                self.assertStops(lambda: _pmscore.score(self.spec, snap, "seeded", look=look), look)

    def test_wizard_counting_look(self):
        spec = _pmspec.load(str(WIZARD))
        path = str(WIZARD_FULL)
        look = Counting()
        result = _pmscore.score(spec, _pmscore.load_snapshot(path), "seeded", look=look)
        reference = _pmscore.score(spec, _pmscore.load_snapshot(path), "seeded")
        self.assertEqual(_pmscore.result_json(result, {}), _pmscore.result_json(reference, {}))
        self.assertGreaterEqual(look.calls, len(spec.items))

    def test_snapshot_that_does_not_fit(self):
        path = str(WIZARD_FULL)
        without = self.snapshot_error(lambda: _pmscore.score(self.spec, _pmscore.load_snapshot(path), "seeded"))
        look = Counting()
        self.assertEqual(self.snapshot_error(
            lambda: _pmscore.score(self.spec, _pmscore.load_snapshot(path), "seeded", look=look)), without)


class Module(unittest.TestCase):
    def test_pmscore_imports_no_signal_or_process_module(self):
        code = ("import sys; sys.path.insert(0, sys.argv[1]); import _pmscore; "
                "print('\\n'.join(sorted(sys.modules)))")
        out = subprocess.run([sys.executable, "-I", "-c", code, str(BIN)], capture_output=True, text=True,
                             env=clean_env(), timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        modules = set(out.stdout.split())
        self.assertIn("_pmscore", modules)
        for name in ("_pmproc", "signal", "subprocess"):
            self.assertNotIn(name, modules, f"importing _pmscore imports {name}")


class Reaped:
    """One pm-structure process, reaped by a thread with os.wait4: exit status, CPU time, stdout and stderr."""

    def __init__(self, proc, out, err):
        self.proc, self.out, self.err = proc, out, err
        self.exited = threading.Event()
        self.code = self.cpu = self.stdout = self.stderr = None
        threading.Thread(target=self.reap, daemon=True).start()

    def reap(self):
        _, status, usage = os.wait4(self.proc.pid, 0)
        self.code = os.waitstatus_to_exitcode(status)
        self.cpu = usage.ru_utime + usage.ru_stime
        self.proc.returncode = self.code  # reaped here; Popen must not wait for it again
        self.exited.set()


class Run(Case):
    def worktree(self, name="wt"):
        wt = self.root / name
        (wt / "studio").mkdir(parents=True)
        os.symlink(NODE_MODULES, wt / "studio" / "node_modules")
        (wt / ".git").write_text("gitdir: ./missing-gitdir\n")  # git stops here instead of finding the checkout
        return wt

    def large(self):
        """A padded snapshot of about 60 MiB, of the node count test_terminate.SnapshotRun.big_snapshot computes."""
        snap = json.loads(FULL_SEEDED.read_text())
        main = next(i for i, n in enumerate(snap["nodes"]) if n["role"] == "main")
        node = {"role": "StaticText", "name": "x" * 20, "parent": main}
        count = (SNAPSHOT_BYTES - len(json.dumps(snap))) // (len(json.dumps(node)) + 2)
        path = self.padded(len(snap["nodes"]) + count, "large.json")
        size = os.stat(path).st_size
        self.assertTrue(50 * 1024 * 1024 < size < 64 * 1024 * 1024, size)
        return path

    def start(self, wt, snapshot, name):
        """pm-structure <wt> bucket-list.yaml --snapshot <snapshot> in its own session, output in files."""
        files = [open(self.root / f"{name}.{stream}", "w+") for stream in ("out", "err")]
        for f in files:
            self.addCleanup(f.close)
        cmd = [str(BIN / "pm-structure"), str(wt), str(BUCKET_LIST), "--snapshot", str(snapshot)]
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=files[0], stderr=files[1], env=clean_env(),
                                start_new_session=True)
        run = Reaped(proc, *files)
        self.addCleanup(self.kill, run)
        return run

    def kill(self, run):
        if not run.exited.is_set():
            try:
                os.kill(run.proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            run.exited.wait(RUN_BOUND)

    def finish(self, run):
        if not run.exited.wait(RUN_BOUND):
            self.kill(run)
            self.fail(f"pm-structure did not end within {RUN_BOUND} s")
        run.stdout, run.stderr = (f.seek(0) or f.read() for f in (run.out, run.err))
        return run

    def signalled(self, wt, snapshot, sig, name):
        """A run signalled with `sig` once its lock file exists (bounded wait), then reaped."""
        lock = wt / "output" / "structure" / f"{SCREEN}.lock"
        run = self.start(wt, snapshot, name)
        deadline = time.monotonic() + START_BOUND
        while not lock.exists():
            if run.exited.wait(POLL):
                self.finish(run)
                self.fail(f"pm-structure ended (exit {run.code}) before its lock file existed; "
                          f"stdout:\n{run.stdout}\nstderr:\n{run.stderr}")
            if time.monotonic() > deadline:
                self.fail(f"no lock file within {START_BOUND} s")
        os.kill(run.proc.pid, sig)
        return self.finish(run)

    def result_path(self, wt):
        return wt / "output" / "structure" / f"{SCREEN}.json"

    def result(self, wt):
        return json.loads(self.result_path(wt).read_text())

    def detail(self, run):
        return f"exit {run.code}, CPU {run.cpu:.2f} s; stdout:\n{run.stdout}\nstderr:\n{run.stderr}"

    def test_signalled_run_skips_the_work(self):
        snapshot = self.large()
        left_wt, signalled_wt = self.worktree("wt-left"), self.worktree("wt-signalled")
        left = self.finish(self.start(left_wt, snapshot, "left"))
        self.assertEqual(left.code, 0, self.detail(left))
        self.assertEqual(self.result(left_wt).get("verdict"), "pass")
        stopped = self.signalled(signalled_wt, snapshot, signal.SIGTERM, "signalled")
        self.assertEqual(stopped.code, 2, self.detail(stopped))
        self.assertLess(stopped.cpu, left.cpu / 2,
                        f"the signalled run used {stopped.cpu:.2f} s of CPU, the one left alone {left.cpu:.2f} s")

    def test_signal_during_the_work_reports_the_stop(self):
        snapshot = self.large()
        for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            with self.subTest(case=sig.name):
                wt = self.worktree(f"wt-{sig.name}")
                run = self.signalled(wt, snapshot, sig, sig.name)
                detail = self.detail(run)
                self.assertEqual(run.code, 2, detail)
                self.assertEqual(run.stderr.splitlines(), [f"pm-structure: terminated by {sig.name}"], detail)
                self.assertEqual(run.stdout.splitlines(), [f"result: {self.result_path(wt)}"], detail)
                result = self.result(wt)
                self.assertEqual(result.get("verdict"), "error", result)
                self.assertEqual(result.get("error"), f"terminated by {sig.name}", result)
                self.assertFalse((wt / "output" / "structure" / f"{SCREEN}.lock").exists(), "the lock file is left")

    def test_unsignalled_run_passes(self):
        wt = self.worktree()
        run = self.finish(self.start(wt, FULL_SEEDED, "full-seeded"))
        detail = self.detail(run)
        self.assertEqual(run.code, 0, detail)
        self.assertEqual(run.stderr, "", detail)
        self.assertEqual(run.stdout.splitlines()[-1:], [f"result: {self.result_path(wt)}"], detail)
        result = self.result(wt)
        self.assertEqual(result.get("verdict"), "pass", result)
        self.assertEqual(result.get("score"), 100, result)


if __name__ == "__main__":
    unittest.main()
