"""_hang.sample: the sampler of a pm-structure run that passed its bound in test_terminate.py (issue 37).

Interface used (design section 2): `_hang.sample(proc, name, text, recorded=None)` takes the `subprocess.Popen` of
the run, the test method's name, the first line of the failure text and the run's `{pid: command}` or None; it
writes `LOGS/hang-<name>-<pid>.ps` and `.sample` and returns the text the caller appends to its failure message,
and it raises nothing. Module attributes a case points elsewhere and restores: `LOGS`, `PS`, `SAMPLE`,
`PS_TIMEOUT`, `SAMPLE_TIMEOUT`, `SAMPLE_SECONDS`.

Each case works in <checkout>/output/tests/hang-<case>-<pid>/, where it writes its stand-ins for `ps` and
`sample` (shell scripts), kills every process it started and removes every `hang-*` file it caused under
`_hang.LOGS`. Without `_hang` every `Sample` case fails on its own; the `GiveUp` cases still run their inner case.
The cases that use the real `/usr/bin/sample` fail, never skip, where it does not exist (macOS only).

`GiveUp` runs a case class built inside the test from `test_terminate.TerminateCase` or `AfterReport`, with
`fixtures/hang/pm-structure` as its program (`self.bin`), `test_terminate.RUN_BOUND` lowered to 2 for the length
of the test and `_hang.SAMPLE_SECONDS` 1, and the inner case run with its own `unittest.TestResult`.
"""
import os
import pathlib
import re
import shlex
import shutil
import signal
import subprocess
import time
import unittest
from unittest import mock

import test_terminate

try:
    import _hang
except ImportError as e:  # every Sample case fails on its own when the module does not exist
    _hang, IMPORT_ERROR = None, e

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
STANDIN = HERE / "fixtures" / "hang"
DEFAULT_LOGS = CHECKOUT / "output" / "logs"
ATTRS = ("LOGS", "PS", "SAMPLE", "PS_TIMEOUT", "SAMPLE_TIMEOUT", "SAMPLE_SECONDS")
TEXT = "the run did not end"
HEADER = ["PID", "PPID", "PGID", "STAT", "WCHAN", "TIME", "COMMAND"]
RECORDED = "recorded, no longer descendants:"
UNREAPED = "hang sample: the run was still unreaped after the sampling"
SORT = "Sort by top of stack, same collapsed (when >= 5):"
CHILD_ENV = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
AWS = {"AWS_PROFILE": "hang-case-profile", "AWS_ACCESS_KEY_ID": "AKIDHANGCASE",
       "AWS_SECRET_ACCESS_KEY": "hang-case-secret"}
POLL = 0.02
FOUND_BOUND = 10   # seconds for a process the case started to show its children
GONE_BOUND = 5     # seconds for a killed process to be gone


def pid_of(line):
    """The PID a `ps` line starts with, or None."""
    first = line.split(None, 1)[:1]
    return int(first[0]) if first and first[0].isdigit() else None


def lines_of(lines, pid):
    return [line for line in lines if pid_of(line) == pid]


class Kept(unittest.TestResult):
    """A TestResult that also keeps each failure's message."""

    def __init__(self):
        super().__init__()
        self.messages = []

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.messages.append(str(err[1]))


class HangCase(unittest.TestCase):
    def setUp(self):
        self.dir = CHECKOUT / "output" / "tests" / f"hang-{self._testMethodName}-{os.getpid()}"
        if self.dir.exists():
            shutil.rmtree(self.dir)
        self.dir.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.name = self._testMethodName
        if _hang is not None:
            saved = {a: getattr(_hang, a) for a in ATTRS if hasattr(_hang, a)}
            self.addCleanup(self.restore, saved)
            self.logs = pathlib.Path(str(_hang.LOGS))
        else:
            self.logs = DEFAULT_LOGS
        self.forget(self.name)

    @staticmethod
    def restore(saved):
        for a in ATTRS:
            if a in saved:
                setattr(_hang, a, saved[a])
            elif hasattr(_hang, a):
                delattr(_hang, a)

    def forget(self, name):
        """Remove every hang-<name>-* file under the logs directory when the case ends."""
        def remove():
            for path in self.logs.glob(f"hang-{name}-*"):
                path.unlink(missing_ok=True)
        self.addCleanup(remove)

    def script(self, name, body, mode=0o755):
        """A /bin/sh stand-in in the case's directory; return its path."""
        path = self.dir / name
        path.write_text("#!/bin/sh\n" + body)
        path.chmod(mode)
        return str(path)

    def kill(self, proc):
        """Kill `proc`'s process group (its session) and reap it."""
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        proc.wait()

    def spawn(self, cmd):
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=True)
        self.addCleanup(self.kill, proc)
        return proc

    def other(self):
        """A process of the case, in a session of its own, and its command as test_terminate.processes() gives it."""
        proc = self.spawn(["/bin/sleep", "120"])
        return proc, test_terminate.processes()[proc.pid][1]

    def assertGone(self, pids):
        deadline = time.monotonic() + GONE_BOUND
        while True:
            left = [pid for pid in pids if test_terminate.alive(pid)]
            if not left or time.monotonic() > deadline:
                break
            time.sleep(POLL)
        self.assertEqual(left, [], f"still alive {GONE_BOUND} s after the case: {left}")


class Sample(HangCase):
    def setUp(self):
        super().setUp()
        if _hang is None:
            self.fail(f"_hang cannot be imported: {IMPORT_ERROR}")

    def tree(self):
        """A process that sleeps and has one child, which has a child of its own: (proc, child, grandchild)."""
        proc = self.spawn(["/bin/sh", "-c", '/bin/sh -c "/bin/sleep 120 & wait" & wait'])
        deadline = time.monotonic() + FOUND_BOUND
        while True:
            table = test_terminate.processes()
            kids = [pid for pid, (ppid, _) in table.items() if ppid == proc.pid]
            grand = [pid for pid, (ppid, _) in table.items() if ppid in kids]
            if len(kids) == 1 and len(grand) == 1:
                return proc, kids[0], grand[0]
            if time.monotonic() > deadline:
                self.fail(f"the tree did not start within {FOUND_BOUND} s: children {kids}, grandchildren {grand}")
            time.sleep(POLL)

    def call(self, proc, recorded=None, text=TEXT):
        try:
            out = _hang.sample(proc, self.name, text, recorded)
        except BaseException as e:  # the sampler raises nothing
            self.fail(f"_hang.sample raised {type(e).__name__}: {e}")
        self.assertIsInstance(out, str)
        return out

    def paths(self, proc):
        base = os.path.join(str(_hang.LOGS), f"hang-{self.name}-{proc.pid}")
        return base + ".ps", base + ".sample"

    def ps_parts(self, path):
        """(first line, header, tree lines, recorded lines) of a .ps file."""
        lines = pathlib.Path(path).read_text().splitlines()
        self.assertIn(RECORDED, lines, f"{path}:\n" + "\n".join(lines))
        i = lines.index(RECORDED)
        self.assertGreaterEqual(i, 2, f"{path}:\n" + "\n".join(lines))
        return lines[0], lines[1], lines[2:i], lines[i + 1:]

    def assertInOrder(self, lines, expected, text):
        """Each of `expected`, ("=", line) or ("^", prefix), matches a line of `lines`, in this order."""
        at = 0
        for kind, want in expected:
            for i in range(at, len(lines)):
                if (lines[i] == want) if kind == "=" else lines[i].startswith(want):
                    at = i + 1
                    break
            else:
                self.fail(f"no line {'' if kind == '=' else 'starting '}{want!r} after line {at} of:\n{text}")

    def assertPsFile(self, proc, child, grand):
        """The .ps file of the first case: text, header, the three processes and nothing else, the recorded line."""
        ps, _ = self.paths(proc)
        first, header, tree, rest = self.ps_parts(ps)
        detail = pathlib.Path(ps).read_text()
        self.assertEqual(first, TEXT, detail)
        self.assertEqual(header.split(), HEADER, detail)
        self.assertEqual(sorted(pid_of(line) for line in tree), sorted([proc.pid, child, grand]), detail)
        self.assertEqual(lines_of(tree, os.getpid()), [], detail)
        self.assertEqual(rest, [], detail)

    def assertPsBlock(self, out, proc):
        ps, _ = self.paths(proc)
        block = [("=", f"--- hang-{self.name}-{proc.pid}.ps")]
        block += [("=", line) for line in pathlib.Path(ps).read_text().splitlines()]
        self.assertInOrder(out.splitlines(), block, out)

    # -- both programs work

    def test_ps_file_holds_the_text_the_tree_and_the_recorded_line(self):
        proc, child, grand = self.tree()
        self.call(proc)
        self.assertPsFile(proc, child, grand)

    def test_sample_file_holds_a_call_graph(self):
        proc, _, _ = self.tree()
        self.call(proc)
        _, sample = self.paths(proc)
        self.assertTrue(os.path.exists(sample), f"{sample} does not exist")
        lines = pathlib.Path(sample).read_text(errors="replace").splitlines()
        self.assertTrue(any(line.startswith("Call graph:") for line in lines), f"no Call graph: line in {sample}")

    def test_returned_text_names_both_files_and_holds_both_blocks(self):
        proc, _, _ = self.tree()
        out = self.call(proc)
        ps, sample = self.paths(proc)
        self.assertTrue(out.startswith("\n"), repr(out[:80]))
        lines = out.splitlines()
        expected = [("=", f"hang sample: {ps}"), ("=", f"hang sample: {sample}"), ("=", UNREAPED),
                    ("=", f"--- hang-{self.name}-{proc.pid}.ps")]
        expected += [("=", line) for line in pathlib.Path(ps).read_text().splitlines()]
        expected += [("^", f"--- hang-{self.name}-{proc.pid}.sample, Call graph to Binary Images"),
                     ("^", "Call graph:")]
        self.assertInOrder(lines, expected, out)
        self.assertEqual([line for line in lines if line.startswith("Binary Images:")], [], out)

    def test_nothing_is_signalled(self):
        proc, child, _ = self.tree()
        self.call(proc)
        self.assertIsNone(proc.poll(), "the process ended")
        self.assertTrue(test_terminate.alive(proc.pid), "the process is not alive")
        self.assertTrue(test_terminate.alive(child), "the child is not alive")

    def test_ps_runs_before_sample(self):
        order = self.dir / "order"
        _hang.PS = self.script("ps", f'echo ps >> {shlex.quote(str(order))}\nexec /bin/ps "$@"\n')
        _hang.SAMPLE = self.script("sample", f"echo sample >> {shlex.quote(str(order))}\n"
                                             "printf 'Call graph:\\n' > \"$4\"\n")
        proc, _, _ = self.tree()
        self.call(proc)
        self.assertEqual(order.read_text().splitlines(), ["ps", "sample"])

    def test_second_call_overwrites_both_files(self):
        proc, _, _ = self.tree()
        ps, sample = self.paths(proc)
        named = [f"hang sample: {ps}", f"hang sample: {sample}"]
        for call in (1, 2):
            out = self.call(proc)
            self.assertEqual([line for line in out.splitlines() if line in named], named, f"call {call}:\n{out}")
        lines = pathlib.Path(ps).read_text().splitlines()
        self.assertEqual(lines.count(TEXT), 1, "\n".join(lines))

    # -- the recorded set

    def test_recorded_process_that_left_the_tree_is_listed_after_the_recorded_line(self):
        proc, _, _ = self.tree()
        other, command = self.other()
        self.call(proc, {other.pid: command})
        ps, _ = self.paths(proc)
        _, _, tree, rest = self.ps_parts(ps)
        detail = pathlib.Path(ps).read_text()
        self.assertEqual(len(lines_of(rest, other.pid)), 1, detail)
        self.assertEqual(lines_of(tree, other.pid), [], detail)

    def test_recorded_process_with_another_command_is_left_out(self):
        proc, _, _ = self.tree()
        other, command = self.other()
        self.call(proc, {other.pid: "/bin/sleep 999"})
        ps, _ = self.paths(proc)
        lines = pathlib.Path(ps).read_text().splitlines()
        self.assertEqual(lines_of(lines, other.pid), [], "\n".join(lines))

    def test_recorded_descendant_is_listed_once_in_the_tree(self):
        proc, child, _ = self.tree()
        self.call(proc, {child: test_terminate.processes()[child][1]})
        ps, _ = self.paths(proc)
        _, _, tree, rest = self.ps_parts(ps)
        detail = pathlib.Path(ps).read_text()
        self.assertEqual(len(lines_of(tree, child)), 1, detail)
        self.assertEqual(lines_of(rest, child), [], detail)

    def test_no_recorded_set_leaves_nothing_after_the_recorded_line(self):
        proc, _, _ = self.tree()
        for recorded in (None, {}):
            with self.subTest(recorded=recorded):
                self.call(proc, recorded)
                ps, _ = self.paths(proc)
                _, _, _, rest = self.ps_parts(ps)
                self.assertEqual(rest, [], pathlib.Path(ps).read_text())

    # -- a run that ends while it is sampled

    def test_run_that_ends_while_sampled_is_named_with_its_exit_status(self):
        _hang.SAMPLE = self.script("sample", "/bin/sleep 2\nprintf 'Call graph:\\n' > \"$4\"\nexit 0\n")
        proc = self.spawn(["/bin/sleep", "1"])
        out = self.call(proc)
        lines = out.splitlines()
        self.assertIn("hang sample: the run ended while it was sampled: exit 0", lines, out)
        self.assertNotIn(UNREAPED, lines, out)

    # -- one program fails

    def test_missing_sample(self):
        _hang.SAMPLE = str(self.dir / "no-such-sample")
        proc, child, grand = self.tree()
        out = self.call(proc)
        ps, sample = self.paths(proc)
        lines = out.splitlines()
        self.assertIn(f"hang sample: no .sample file: {_hang.SAMPLE} is missing", lines, out)
        self.assertFalse(os.path.exists(sample), f"{sample} exists")
        self.assertEqual([line for line in lines if line.startswith(f"--- hang-{self.name}-{proc.pid}.sample")], [],
                         out)
        self.assertIn(f"hang sample: {ps}", lines, out)
        self.assertPsFile(proc, child, grand)
        self.assertPsBlock(out, proc)

    def test_missing_ps(self):
        _hang.PS = str(self.dir / "no-such-ps")
        proc, _, _ = self.tree()
        out = self.call(proc)
        ps, sample = self.paths(proc)
        self.assertIn(f"hang sample: no .ps file: {_hang.PS} is missing", out.splitlines(), out)
        self.assertFalse(os.path.exists(ps), f"{ps} exists")
        self.assertTrue(os.path.exists(sample), f"{sample} does not exist: the real sample was not run")

    def test_sample_that_cannot_be_run(self):
        _hang.SAMPLE = self.script("sample", "printf 'Call graph:\\n' > \"$4\"\n", mode=0o644)
        proc, _, _ = self.tree()
        out = self.call(proc)
        self.assertIn(f"hang sample: no .sample file: {_hang.SAMPLE} could not be run: Permission denied",
                      out.splitlines(), out)

    def test_sample_that_exits_non_zero(self):
        _hang.SAMPLE = self.script("sample", "printf 'Call graph:\\n' > \"$4\"\nexit 3\n")
        proc, _, _ = self.tree()
        out = self.call(proc)
        _, sample = self.paths(proc)
        self.assertIn(f"hang sample: no .sample file: {_hang.SAMPLE} exited 3", out.splitlines(), out)
        self.assertFalse(os.path.exists(sample), f"{sample} exists")

    def test_sample_that_writes_no_file(self):
        _hang.SAMPLE = self.script("sample", "exit 0\n")
        proc, _, _ = self.tree()
        out = self.call(proc)
        self.assertIn(f"hang sample: no .sample file: {_hang.SAMPLE} wrote no file", out.splitlines(), out)

    def never_ends(self, name):
        """A stand-in that writes its PID and execs its wait, so it is one process; killed with the case."""
        pidfile = self.dir / f"{name}.pid"

        def kill():
            if pidfile.exists() and test_terminate.alive(int(pidfile.read_text())):
                os.kill(int(pidfile.read_text()), signal.SIGKILL)
        self.addCleanup(kill)
        return self.script(name, f"echo $$ > {shlex.quote(str(pidfile))}\nexec /bin/sleep 120\n"), pidfile

    def test_sample_that_passes_its_timeout(self):
        _hang.SAMPLE, pidfile = self.never_ends("sample")
        _hang.SAMPLE_TIMEOUT = 1
        proc, _, _ = self.tree()
        started = time.monotonic()
        out = self.call(proc)
        took = time.monotonic() - started
        self.assertLess(took, 10, out)
        self.assertIn(f"hang sample: no .sample file: {_hang.SAMPLE} passed its 1 s timeout", out.splitlines(), out)
        self.assertTrue(pidfile.exists(), "the sample stand-in was not run")
        self.assertFalse(test_terminate.alive(int(pidfile.read_text())), "the sample stand-in is still alive")

    def test_ps_that_passes_its_timeout(self):
        _hang.PS, pidfile = self.never_ends("ps")
        _hang.PS_TIMEOUT = 1
        proc, _, _ = self.tree()
        started = time.monotonic()
        out = self.call(proc)
        took = time.monotonic() - started
        self.assertLess(took, 10 + _hang.SAMPLE_SECONDS, out)
        self.assertIn(f"hang sample: no .ps file: {_hang.PS} passed its 1 s timeout", out.splitlines(), out)
        self.assertTrue(pidfile.exists(), "the ps stand-in was not run")
        self.assertFalse(test_terminate.alive(int(pidfile.read_text())), "the ps stand-in is still alive")

    def test_ps_that_exits_non_zero(self):
        _hang.PS = self.script("ps", "exit 1\n")
        proc, _, _ = self.tree()
        out = self.call(proc)
        self.assertIn(f"hang sample: no .ps file: {_hang.PS} exited 1", out.splitlines(), out)

    def test_ps_output_that_is_not_utf8(self):
        _hang.PS = self.script("ps", "printf '\\377\\376 not a table \\351\\n'\n")
        proc, _, _ = self.tree()
        out = self.call(proc)
        ps, _ = self.paths(proc)
        self.assertIn(f"hang sample: {ps}", out.splitlines(), out)
        text = pathlib.Path(ps).read_bytes().decode("utf-8")  # what could be decoded, written as UTF-8
        self.assertEqual(text.splitlines()[0], TEXT, text)

    def test_logs_below_a_regular_file(self):
        plain = self.dir / "plain"
        plain.write_text("a regular file\n")
        logs = plain / "logs"
        _hang.LOGS = str(logs) if isinstance(_hang.LOGS, str) else logs
        proc, _, _ = self.tree()
        out = self.call(proc)
        ps, _ = self.paths(proc)
        lines = out.splitlines()
        ps_lines = [m for m in (re.fullmatch(r"hang sample: no \.ps file: cannot write (.+?): (.+)", line)
                                for line in lines) if m]
        self.assertEqual(len(ps_lines), 1, out)
        self.assertIn(ps_lines[0].group(1), (str(logs), ps), out)
        self.assertEqual(len([line for line in lines if re.fullmatch(r"hang sample: no \.sample file: .+", line)]),
                         1, out)

    def test_logs_that_is_not_a_path(self):
        _hang.LOGS = 7
        proc, _, _ = self.tree()
        out = self.call(proc)
        self.assertRegex(out, r"\A\nhang sample: failed: [A-Za-z_][\w.]*: [^\n]*\Z")

    # -- the excerpt of the .sample file

    def excerpt(self, content):
        """Run the sampler with a `sample` stand-in that writes `content`; return (header, block, base header)."""
        built = self.dir / "built.sample"
        built.write_text("\n".join(content) + "\n")
        _hang.SAMPLE = self.script("sample", f"/bin/cat {shlex.quote(str(built))} > \"$4\"\n")
        proc, _, _ = self.tree()
        out = self.call(proc)
        lines = out.splitlines()
        base = f"--- hang-{self.name}-{proc.pid}.sample, Call graph to Binary Images"
        at = [i for i, line in enumerate(lines) if line.startswith(base)]
        self.assertEqual(len(at), 1, out)
        return lines[at[0]], lines[at[0] + 1:], base

    @staticmethod
    def graph(n):
        """A call graph of `n` lines: the `Call graph:` line and n - 1 frames."""
        return ["Call graph:"] + [f"    {i} frame-{i}  (in Python) + {i}" for i in range(1, n)]

    @staticmethod
    def tail(n):
        """A tail of `n` lines from the `Sort by top of stack` line on."""
        return [SORT] + [f"        leaf-{i}  (in libsystem_kernel.dylib)        {i}" for i in range(1, n)]

    HEAD = ["Analysis of sampling sh (pid 1) every 1 millisecond", "Process:         sh [1]", ""]
    IMAGES = ["Binary Images:"] + [f"       0x{i:x} - 0x{i + 1:x} image-{i}" for i in range(5)]

    def test_excerpt_runs_from_call_graph_to_before_binary_images(self):
        part = self.graph(5) + self.tail(3)
        header, block, base = self.excerpt(self.HEAD + part + self.IMAGES)
        self.assertEqual(len(part), 8)
        self.assertEqual(block, part)
        self.assertEqual(header, base)

    def test_excerpt_of_exactly_300_lines_is_whole(self):
        part = self.graph(295) + self.tail(5)
        header, block, base = self.excerpt(self.HEAD + part + self.IMAGES)
        self.assertEqual(len(part), 300)
        self.assertEqual(block, part)
        self.assertEqual(header, base)

    def test_excerpt_of_301_lines_leaves_out_one_line_of_the_call_graph(self):
        graph, tail = self.graph(296), self.tail(5)
        header, block, base = self.excerpt(self.HEAD + graph + tail + self.IMAGES)
        self.assertEqual(len(graph + tail), 301)
        self.assertEqual(block, (graph + tail)[:295] + tail)
        self.assertEqual(header, base + ", 1 lines of the call graph left out")

    def test_excerpt_of_505_lines_keeps_the_whole_tail(self):
        graph, tail = self.graph(500), self.tail(5)
        header, block, base = self.excerpt(self.HEAD + graph + tail + self.IMAGES)
        self.assertEqual(len(block), 300, "\n".join(block[-10:]))
        self.assertEqual(block[-5:], tail)
        self.assertEqual(block[:295], graph[:295])
        self.assertEqual(header, base + ", 205 lines of the call graph left out")

    def test_excerpt_with_a_tail_past_the_limit_is_the_tail(self):
        graph, tail = self.graph(50), self.tail(310)
        header, block, base = self.excerpt(self.HEAD + graph + tail + self.IMAGES)
        self.assertEqual(block, tail)
        self.assertEqual(header, base + ", 50 lines of the call graph left out")

    def test_excerpt_without_binary_images_runs_to_the_last_line(self):
        part = self.graph(5) + self.tail(3)
        header, block, base = self.excerpt(self.HEAD + part)
        self.assertEqual(block, part)
        self.assertEqual(header, base)

    def test_excerpt_without_a_call_graph(self):
        _, block, _ = self.excerpt(self.HEAD + self.tail(3) + self.IMAGES)
        self.assertEqual(block, ["no call graph in the file"])

    # -- what the two programs are given

    def given(self):
        """Run the sampler with stand-ins that write their arguments and environment; return (proc, sample path)."""
        out = {}
        for name, rest in (("ps", 'exec /bin/ps "$@"\n'), ("sample", "printf 'Call graph:\\n' > \"$4\"\n")):
            args, env = (shlex.quote(str(self.dir / f"{name}.{kind}")) for kind in ("args", "env"))
            out[name] = self.script(name, f"printf '%s\\0' \"$@\" > {args}\n/usr/bin/env -0 > {env}\n{rest}")
        _hang.PS, _hang.SAMPLE = out["ps"], out["sample"]
        proc, _, _ = self.tree()
        with mock.patch.dict(os.environ, AWS):
            self.call(proc)
        return proc, self.paths(proc)[1]

    def nul_list(self, name):
        path = self.dir / name
        self.assertTrue(path.exists(), f"{path} was not written: the stand-in was not run")
        return [item for item in path.read_text().split("\0") if item != ""]

    def test_programs_get_their_arguments_only(self):
        proc, sample = self.given()
        self.assertEqual(self.nul_list("ps.args"), ["-A", "-o", "pid,ppid,pgid,stat,wchan,time,command"])
        self.assertEqual(self.nul_list("sample.args"), [str(proc.pid), "3", "-file", sample])

    def test_programs_get_the_fixed_environment(self):
        self.given()
        probe = self.script("probe", '/usr/bin/env -0 > "$1"\n')
        subprocess.run([probe, str(self.dir / "probe.env")], env=CHILD_ENV, check=True, timeout=10)
        by_shell = {item.split("=", 1)[0] for item in self.nul_list("probe.env")} - set(CHILD_ENV)
        for name in ("ps", "sample"):
            with self.subTest(program=name):
                env = dict(item.split("=", 1) for item in self.nul_list(f"{name}.env"))
                self.assertEqual([k for k in env if k.startswith("AWS_")], [], env)
                self.assertEqual({k: env.get(k) for k in CHILD_ENV}, CHILD_ENV, env)
                self.assertEqual(set(env) - by_shell, set(CHILD_ENV), env)


class GiveUp(HangCase):
    def setUp(self):
        super().setUp()
        patch = mock.patch.object(test_terminate, "RUN_BOUND", 2)
        patch.start()
        self.addCleanup(patch.stop)
        if _hang is not None:
            _hang.SAMPLE_SECONDS = 1

    def inner(self, base, body, suffix=""):
        """Run `body(case, seen)` as the one test of a class built from `base` with the stand-in as its program.
        Return (inner test method name, its Kept result, seen); `seen` holds the stand-in's PID and its sleep's."""
        name = "test_inner_" + self._testMethodName.removeprefix("test_") + suffix
        self.forget(name)
        seen = {"sleep": []}

        def setUp(case):
            base.setUp(case)
            case.bin = STANDIN

        Inner = type("Inner", (base,), {"setUp": setUp, name: lambda case: body(case, seen)})
        result = Kept()
        Inner(name).run(result)
        self.assertGone([pid for pid in [seen.get("pid")] + seen["sleep"] if pid])
        return name, result, seen

    @staticmethod
    def standin_started(case, run, seen):
        """Wait until the stand-in's sleep runs; add it to the case's started processes."""
        seen["pid"] = run.proc.pid
        deadline = time.monotonic() + FOUND_BOUND
        while not (found := test_terminate.descendants(run.proc.pid)):
            if time.monotonic() > deadline:
                case.fail(f"the stand-in's sleep did not start within {FOUND_BOUND} s")
            time.sleep(POLL)
        seen["sleep"] = list(found)
        case.started.extend(found)

    @staticmethod
    def snapshot(storm):
        def body(case, seen):
            try:
                seen["code"] = case.snapshot_run(case.root, "run", storm=storm)[0]
            finally:  # the stand-in still runs here when snapshot_run gave up; its sleep goes with the case
                if case.started:
                    seen["pid"] = case.started[0]
                    seen["sleep"] = list(test_terminate.descendants(case.started[0]))
                    case.started.extend(seen["sleep"])
        return body

    def one_failure(self, result):
        detail = "\n".join(tb for _, tb in result.errors + result.failures)
        self.assertEqual((len(result.failures), len(result.errors)), (1, 0), detail)
        return result.messages[0]

    def ps_path(self, name, pid):
        return os.path.join(str(self.logs), f"hang-{name}-{pid}.ps")

    def sample_path(self, name, pid):
        return os.path.join(str(self.logs), f"hang-{name}-{pid}.sample")

    def ps_lines(self, path):
        self.assertTrue(os.path.exists(path), f"{path} does not exist")
        return pathlib.Path(path).read_text().splitlines()

    def markers(self):
        """Stand-ins for ps and sample that each leave a marker file when started; return the markers."""
        marks = [self.dir / "ps.marker", self.dir / "sample.marker"]
        if _hang is not None:
            _hang.PS, _hang.SAMPLE = (self.script(m.stem, f": > {shlex.quote(str(m))}\n") for m in marks)
        return marks

    def assertPassedUnsampled(self, name, result, marks):
        detail = "\n".join(tb for _, tb in result.errors + result.failures)
        self.assertTrue(result.wasSuccessful() and result.testsRun == 1, detail)
        self.assertEqual(sorted(p.name for p in self.logs.glob(f"hang-{name}-*")), [])
        self.assertEqual([m.name for m in marks if m.exists()], [])

    def test_finish(self):
        def body(case, seen):
            run = case.start(case.root)
            self.standin_started(case, run, seen)
            case.finish(run)

        name, result, seen = self.inner(test_terminate.TerminateCase, body)
        message = self.one_failure(result)
        pid, ps = seen["pid"], self.ps_path(name, seen["pid"])
        lines = message.splitlines()
        self.assertTrue(message.startswith("pm-structure did not end within 2 s; stderr:"), message)
        self.assertIn(f"hang sample: {ps}", lines, message)
        self.assertIn(f"hang sample: {self.sample_path(name, pid)}", lines, message)
        self.assertTrue(lines_of(lines, pid), f"no line for the stand-in {pid}:\n{message}")
        self.assertTrue(lines_of(lines, seen["sleep"][0]), f"no line for its sleep {seen['sleep']}:\n{message}")
        self.assertEqual(self.ps_lines(ps)[0], "pm-structure did not end within 2 s")

    def test_storm(self):
        def body(case, seen):
            run = case.start(case.root)
            self.standin_started(case, run, seen)
            case.storm(run, signal.SIGINT)

        name, result, seen = self.inner(test_terminate.TerminateCase, body)
        message = self.one_failure(result)
        text = "pm-structure did not exit within 2 s of a storm of SIGINT"
        ps = self.ps_path(name, seen["pid"])
        self.assertTrue(message.startswith(text), message)
        self.assertIn(f"hang sample: {ps}", message.splitlines(), message)
        self.assertIn(UNREAPED, message.splitlines(), message)
        self.assertEqual(self.ps_lines(ps)[0], text)

    def test_storm_names_a_recorded_process_that_left_the_tree(self):
        other, command = self.other()

        def body(case, seen):
            run = case.start(case.root)
            self.standin_started(case, run, seen)
            run.recorded = {other.pid: command}
            case.storm(run, signal.SIGINT)

        _, result, _ = self.inner(test_terminate.TerminateCase, body)
        message = self.one_failure(result)
        lines = message.splitlines()
        self.assertIn(RECORDED, lines, message)
        after = lines[lines.index(RECORDED) + 1:]
        self.assertTrue(lines_of(after, other.pid), f"no line for {other.pid} after {RECORDED!r}:\n{message}")

    def test_keep_signalling_then_finish_samples_once(self):
        def body(case, seen):
            run = case.start(case.root)
            self.standin_started(case, run, seen)
            case.keep_signalling(run, signal.SIGINT)
            case.finish(run)

        name, result, seen = self.inner(test_terminate.TerminateCase, body)
        message = self.one_failure(result)
        self.assertTrue(message.startswith("pm-structure did not end within 2 s"), message)
        self.assertEqual(sorted(p.name for p in self.logs.glob(f"hang-{name}-*.ps")), [f"hang-{name}-{seen['pid']}.ps"])

    def test_snapshot_run(self):
        name, result, seen = self.inner(test_terminate.AfterReport, self.snapshot(storm=False))
        message = self.one_failure(result)
        ps = self.ps_path(name, seen.get("pid"))
        self.assertTrue(message.startswith("pm-structure --snapshot did not exit within 2 s (run)"), message)
        self.assertIn(f"hang sample: {ps}", message.splitlines(), message)
        lines = self.ps_lines(ps)
        self.assertIn(RECORDED, lines, "\n".join(lines))
        self.assertEqual(lines[lines.index(RECORDED) + 1:], [], "\n".join(lines))

    def test_snapshot_run_storm(self):
        name, result, seen = self.inner(test_terminate.AfterReport, self.snapshot(storm=True))
        message = self.one_failure(result)
        lines = message.splitlines()
        self.assertTrue(message.startswith("pm-structure --snapshot did not exit within 2 s (run)"), message)
        self.assertIn(f"hang sample: {self.ps_path(name, seen.get('pid'))}", lines, message)
        self.assertIn(UNREAPED, lines, message)

    def test_storm_without_sample(self):
        missing = str(self.dir / "no-such-sample")
        if _hang is not None:
            _hang.SAMPLE = missing

        def body(case, seen):
            run = case.start(case.root)
            self.standin_started(case, run, seen)
            case.storm(run, signal.SIGINT)

        _, result, _ = self.inner(test_terminate.TerminateCase, body)
        message = self.one_failure(result)
        self.assertTrue(message.startswith("pm-structure did not exit within 2 s of a storm of SIGINT"), message)
        self.assertIn(f"hang sample: no .sample file: {missing} is missing", message.splitlines(), message)

    def test_storm_and_finish_inside_the_bound_sample_nothing(self):
        marks = self.markers()

        def body(case, seen):
            run = case.start(case.root)
            self.standin_started(case, run, seen)
            case.storm(run, signal.SIGINT)
            case.finish(run)

        with mock.patch.dict(os.environ, {"HANG_STANDIN_ENDS": "1"}):
            name, result, _ = self.inner(test_terminate.TerminateCase, body)
        self.assertPassedUnsampled(name, result, marks)

    def test_snapshot_run_inside_the_bound_samples_nothing(self):
        marks = self.markers()
        for storm in (False, True):
            with self.subTest(storm=storm), mock.patch.dict(os.environ, {"HANG_STANDIN_ENDS": "at-once"}):
                name, result, seen = self.inner(test_terminate.AfterReport, self.snapshot(storm), f"_{storm}")
                self.assertEqual(seen.get("code"), 0, "\n".join(tb for _, tb in result.errors + result.failures))
                self.assertPassedUnsampled(name, result, marks)


class Unchanged(unittest.TestCase):
    def test_bounds(self):
        bounds = {k: getattr(test_terminate, k)
                  for k in ("EXIT_BOUND", "GONE_BOUND", "SNAPSHOT_EXIT_BOUND", "START_BOUND", "RUN_BOUND")}
        self.assertEqual(bounds, {"EXIT_BOUND": 5, "GONE_BOUND": 5, "SNAPSHOT_EXIT_BOUND": 15, "START_BOUND": 60,
                                  "RUN_BOUND": 180})

    def test_docstring_names_the_sample_files(self):
        doc = test_terminate.__doc__ or ""
        for term in ("RUN_BOUND", "output/logs/hang-", ".ps", ".sample"):
            with self.subTest(term=term):
                self.assertIn(term, doc)


if __name__ == "__main__":
    unittest.main()
