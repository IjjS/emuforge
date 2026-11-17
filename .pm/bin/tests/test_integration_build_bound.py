"""tests/integration/run: the product image build ends within its bound, and what the run and pm-check do at the
bound (issue 293, R1 and R2).

A fixture checkout holds copies of tests/integration/run and the manifest, a root docker-compose.yml, an
engine/Cargo.toml, a studio/package.json with a stand-in studio/node_modules/.bin/playwright, a made-up HOME, and
stand-ins for docker, cargo, bun, node, curl and shasum first on PATH. Every stand-in appends its tool name and its
arguments to <case>/calls.jsonl; the cargo test and playwright stand-ins write `passed` for every manifest check of
their kind. The stand-in docker's `compose ... build` does what STANDIN_BUILD says (BUILDS) and appends its own pid,
the pid of the child it starts (null when it starts none) and its start time to <case>/builds.jsonl. A case about
the bound runs a copy of `run` whose `product_build_bound=600` is lowered to LOWERED seconds; when the copy has no
such line it is left as it is, and a case that then passes its own bound says so. "Gone" means a recorded pid no
longer exists or is a zombie, looked for up to GONE_GRACE seconds so the system can reap what was signalled.

The run's output goes to <case>/run.out, never to a pipe a leftover process could hold. Every wait has its own bound;
each case ends what it started: the run's process group, then each recorded pid whose command line still names the
case's directory. Under_pm_check also runs the fixture's own pm-check with its own .pm/run, and a stand-in `top`
that prints nothing, so pm-check's wait for the CPU (up to five minutes) does not apply to the fixture.
"""
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import time
import unittest

from _fixture import CHECKOUT, clean_env, make

RUN = CHECKOUT / "tests" / "integration" / "run"
MANIFEST = CHECKOUT / "tests" / "integration" / "manifest.jsonl"
GROUP = "integration-build-bound"
TOOLS = ("docker", "cargo", "bun", "node", "curl", "shasum")
SHIPPED = 600     # seconds, requirement R1.1
LOWERED = 3       # seconds, the bound of a fixture's copy
SLACK = 30        # seconds after the bound within which the run has ended (R1.4)
STOP_WITHIN = 5   # seconds after the SIGTERM within which the build is gone (R1.5)
GONE_GRACE = 2    # seconds the system gets to reap a process that was signalled
START_WAIT = 120  # seconds a case waits for the stand-in build to start
PS = "/bin/ps"
CHILD_ENV = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
BUILD_LINE = "#2 [internal] load metadata for standin/base:1"
# What the stand-in build does, by STANDIN_BUILD.
BUILDS = {
    "ok": "exits 0",
    "fail": "exits 1",
    "exit124": "exits 124",
    "hang": "prints BUILD_LINE, starts a child and waits for it, which does not return",
    "hang-ignore": "as hang, and the build and its child ignore SIGTERM",
    "ok-child": "starts a child that keeps running and exits 0",
    "fail-child": "starts a child that keeps running and exits 1",
}

STANDIN = f"""#!{sys.executable} -I
import json, os, pathlib, signal, subprocess, sys, time
tool = os.path.basename(sys.argv[0])
case = pathlib.Path(os.environ["STANDIN_DIR"])
args = sys.argv[1:]
with open(case / "calls.jsonl", "a") as f:
    f.write(json.dumps(dict(tool=tool, args=args, pid=os.getpid())) + "\\n")

CHILD = "import signal, sys, time\\nif sys.argv[1] == 'ignore':\\n    signal.signal(signal.SIGTERM, signal.SIG_IGN)\\ntime.sleep(3600)\\n"


def build(how):
    started = time.time()
    ignore = how == "hang-ignore"
    if ignore:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    child = None
    if how in ("hang", "hang-ignore", "ok-child", "fail-child"):
        print({BUILD_LINE!r}, flush=True)
        # like docker -> docker-compose -> docker-buildx: a child that does the waiting; its last argument names
        # the case, so the test ends only what is its own
        child = subprocess.Popen([sys.executable, "-I", "-c", CHILD, "ignore" if ignore else "default", str(case)])
    with open(case / "builds.jsonl", "a") as f:
        f.write(json.dumps(dict(pid=os.getpid(), child=child and child.pid, started=started)) + "\\n")
    if how in ("hang", "hang-ignore"):
        while True:
            child.wait()
    sys.exit({{"ok": 0, "ok-child": 0, "fail": 1, "fail-child": 1, "exit124": 124}}[how])


def write_verdicts(kind):
    out = pathlib.Path(os.environ["EMUFORGE_IT_VERDICTS"])
    for line in pathlib.Path(os.environ["STANDIN_MANIFEST"]).read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row["path"].endswith(kind):
            (out / (row["check_id"] + ".json")).write_text(json.dumps(dict(
                check_id=row["check_id"], verdict="passed", seconds=0, log=None, message="")))


if tool == "docker" and args[:1] == ["compose"] and args[-1:] == ["build"]:
    build(os.environ.get("STANDIN_BUILD", "ok"))
elif tool == "docker" and "--version" in args:
    print("Version: 0.0.0-standin")
    print("Commit: 0000000")
elif tool == "curl":
    print("ok")
elif tool == "cargo" and args[:1] == ["metadata"]:
    print(json.dumps(dict(target_directory=str(case / "target"))))
elif tool == "cargo" and args[:1] == ["test"]:
    write_verdicts(".rs")
elif tool == "playwright":
    write_verdicts(".spec.ts")
"""
# pm-check's CPU reading: no output, so cpu_pct() is None and the run starts at once
TOP = "#!/bin/sh\nexit 0\n"


def manifest_ids():
    return [json.loads(line)["check_id"] for line in MANIFEST.read_text().splitlines() if line.strip()]


IDS = manifest_ids()
# The rows a default run leaves out since issue 315, and the reason it reports for each (decisions.md, 15:10).
ON_REQUEST = {json.loads(line)["check_id"] for line in MANIFEST.read_text().splitlines()
              if line.strip() and "on-request" in (json.loads(line).get("labels") or [])}
ON_REQUEST_REASON = "on request: not part of a default run; run it with --on-request"
LISTED = {"engine.health-reports-emulator-reachable": "listed engine check: reason one",
          "studio.home-shows-connected": "listed studio check: reason two"}
BOUND_SETTING = re.compile(r"(?m)^[ \t]*(?:readonly[ \t]+)?product_build_bound=(\S*)")


def lowered(text, seconds):
    """`text` with its one `product_build_bound=600` set to `seconds`, and whether there was one to lower."""
    new, n = re.subn(r"(?m)^([ \t]*(?:readonly[ \t]+)?product_build_bound=)600\b", rf"\g<1>{seconds}", text)
    return new, n == 1


def ps(*args):
    try:
        return subprocess.run([PS, *args], capture_output=True, text=True, env=CHILD_ENV, timeout=10,
                              stdin=subprocess.DEVNULL).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def alive(pid):
    """The process exists and is not a zombie."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:  # the pid is another user's now: not the recorded process
        return False
    stat = ps("-o", "stat=", "-p", str(pid))
    return bool(stat) and not stat.startswith("Z")


def left(pids, grace=GONE_GRACE):
    """The pids of `pids` still alive after up to `grace` seconds."""
    end = time.time() + grace
    while True:
        still = [p for p in pids if alive(p)]
        if not still or time.time() >= end:
            return still
        time.sleep(0.05)


def lockable(path):
    """The test can take the lock `path` at once (and lets it go)."""
    with open(path, "a") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        fcntl.flock(f, fcntl.LOCK_UN)
        return True


class Fixture:
    """One fixture checkout with its stand-ins; `case` is its own directory, ignored by the checkout's git.
    `bound` lowers the copy of `run` (None: the copy as shipped); `scripts` are .pm/bin scripts to copy."""

    def __init__(self, name, bound=LOWERED, scripts=(), tools=()):
        text = RUN.read_text()
        self.lowered = None
        if bound is not None:
            text, self.lowered = lowered(text, bound)
        self.co = make(GROUP, name, scripts, {
            "tests/integration/run": text,
            "tests/integration/manifest.jsonl": MANIFEST.read_text(),
            "docker-compose.yml": "services: {}\n",
            "engine/Cargo.toml": '[package]\nname = "fixture"\nversion = "0.0.0"\n',
            "studio/package.json": "{}\n",
            "studio/node_modules/.bin/playwright": STANDIN,
        })
        self.case = self.co / "output" / "case"
        self.bin = self.case / "bin"
        self.bin.mkdir(parents=True)
        for tool, body in [(t, STANDIN) for t in TOOLS] + [(t, TOP) for t in tools]:
            p = self.bin / tool
            p.write_text(body)
            p.chmod(0o755)
        (self.co / "home").mkdir()
        self.proc = None
        self.out_path = self.case / "run.out"

    def env(self, how):
        e = {k: v for k, v in clean_env().items() if not k.startswith(("AWS_", "EMUFORGE_"))}
        e.pop("EMULATOR_PORT", None)
        e.update(PATH=f"{self.bin}{os.pathsep}/usr/bin:/bin", HOME=str(self.co / "home"), STANDIN_DIR=str(self.case),
                 STANDIN_MANIFEST=str(self.co / "tests" / "integration" / "manifest.jsonl"), STANDIN_BUILD=how)
        return e

    def start(self, how, *args, program=None):
        """Start `run` (or `program`) with `args` in a session of its own, the build doing what `how` says."""
        cmd = program or [str(self.co / "tests" / "integration" / "run")]
        with open(self.out_path, "w") as f:
            self.proc = subprocess.Popen([*cmd, *map(str, args)], stdout=f, stderr=subprocess.STDOUT,
                                         stdin=subprocess.DEVNULL, env=self.env(how), cwd=str(self.co),
                                         start_new_session=True)
        self.started = time.time()

    def wait_build(self, seconds=START_WAIT):
        """The first build record, once the stand-in build has started; None when the run ended first or none
        started within `seconds`."""
        end = time.time() + seconds
        while time.time() < end:
            b = self.builds()
            if b:
                return b[0]
            if self.proc.poll() is not None:
                return (self.builds() or [None])[0]
            time.sleep(0.05)
        return None

    def wait(self, until):
        """The exit code once the process has ended, or None when it is still running at the time `until`."""
        try:
            return self.proc.wait(timeout=max(0.0, until - time.time()))
        except subprocess.TimeoutExpired:
            return None

    def builds(self):
        f = self.case / "builds.jsonl"
        return [json.loads(x) for x in f.read_text().splitlines() if x.strip()] if f.exists() else []

    def build_pids(self):
        return [p for b in self.builds() for p in (b["pid"], b["child"]) if p]

    def calls(self, tool=None):
        f = self.case / "calls.jsonl"
        rows = [json.loads(x) for x in f.read_text().splitlines() if x.strip()] if f.exists() else []
        return [r for r in rows if tool is None or r["tool"] == tool]

    def compose_builds(self):
        return [c for c in self.calls("docker") if c["args"][:1] == ["compose"] and c["args"][-1:] == ["build"]]

    def output(self):
        return self.out_path.read_text() if self.out_path.exists() else ""

    def lines(self):
        return [line.rstrip() for line in self.output().splitlines()]

    @property
    def log_path(self):
        return self.co / "output" / "logs" / "integration-product-build.log"

    @property
    def report_path(self):
        return self.co / "output" / "integration" / "report.json"

    def report(self):
        if not self.report_path.exists():
            return None
        return {c["check_id"]: c for c in json.loads(self.report_path.read_text())["checks"]}

    def file(self, name, text):
        p = self.case / name
        p.write_text(text)
        return p

    def why(self):
        """What a failure message adds: the lowering, the end of the output."""
        tail = "\n".join(self.lines()[-12:])
        lowered_text = {None: "the shipped copy", True: f"lowered to {LOWERED} s",
                        False: "no product_build_bound=600 in run to lower"}[self.lowered]
        return f"\n[{lowered_text}; builds {self.builds()}]\n{tail}"

    def end(self):
        """End what the case started: pm-check's recorded step, the process group, the recorded build pids."""
        running = self.co / "output" / "checks" / "running.json"
        if running.exists():
            try:
                pgid = json.loads(running.read_text()).get("pgid")
            except ValueError:
                pgid = None
            subprocess.run([str(self.co / ".pm" / "bin" / "pm-check"), ".", "--stop"], cwd=str(self.co),
                           capture_output=True, env=self.env("ok"), timeout=60)
            if isinstance(pgid, int) and pgid > 1:
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
        if self.proc is not None and self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            self.proc.wait(timeout=30)
        for pid in self.build_pids():
            if alive(pid) and str(self.case) in ps("-o", "command=", "-p", str(pid)):
                os.kill(pid, signal.SIGKILL)


class Outcome:
    """One run of `run` with a build that does not return, watched until the bound plus SLACK after the build
    started: `code` (None: still running then), `elapsed` (seconds from the build's start to the run's end) and
    `left` (the recorded pids alive when the run had ended)."""

    def __init__(self, fx, how, *args, slack=SLACK):
        self.fx = fx
        fx.start(how, *args)
        self.build = fx.wait_build()
        self.code = self.elapsed = None
        self.left = None
        if self.build is None:
            self.code = fx.wait(time.time() + 1)
            return
        self.code = fx.wait(self.build["started"] + LOWERED + slack)
        if self.code is not None:
            self.elapsed = time.time() - self.build["started"]
            self.left = left(fx.build_pids())

    def ended(self, case, slack=SLACK):
        """Fails `case` unless the run ended with 127 within the bound plus `slack` after its build started."""
        case.assertIsNotNone(self.build, f"the stand-in build never started{self.fx.why()}")
        case.assertIsNotNone(self.code, f"the run had not ended {LOWERED + slack} s after its build started"
                                        f"{self.fx.why()}")
        case.assertLessEqual(self.elapsed, LOWERED + slack, self.fx.why())
        case.assertEqual(self.code, 127, self.fx.why())


def reason(fx):
    return f"the product image build did not end within {LOWERED} s, see {fx.log_path}"


class Bound(unittest.TestCase):
    """A build that does not return and holds a child, run once for the class."""

    @classmethod
    def setUpClass(cls):
        cls.fx = Fixture("bound-hang")
        cls.addClassCleanup(cls.fx.end)
        cls.o = Outcome(cls.fx, "hang")

    def test_the_run_exits_127_within_the_bound_with_the_line_the_report_line_and_the_fidelity_line(self):
        self.o.ended(self)
        lines = self.fx.lines()
        self.assertIn(f"integration: {reason(self.fx)}", lines, self.fx.why())
        self.assertIn(f"integration: report {self.fx.report_path}", lines, self.fx.why())
        last = [line for line in lines if line.strip()][-1]
        self.assertTrue(last.startswith("relay fidelity"), f"last line {last!r}{self.fx.why()}")

    def test_the_report_holds_every_check_as_error_with_the_reason_and_the_log_the_build_output(self):
        self.o.ended(self)
        report = self.fx.report()
        self.assertIsNotNone(report, self.fx.why())
        self.assertEqual(sorted(report), sorted(IDS))
        wrong = {i: (c["verdict"], c["message"]) for i, c in report.items()
                 if (c["verdict"], c["message"]) != ("error", reason(self.fx))}
        self.assertEqual(wrong, {}, self.fx.why())
        self.assertIn(BUILD_LINE, self.fx.log_path.read_text().splitlines())

    def test_the_build_and_its_child_are_gone_when_the_run_has_ended(self):
        self.o.ended(self)
        self.assertEqual(len(self.fx.build_pids()), 2, self.fx.why())
        self.assertEqual(self.o.left, [], f"alive after the run ended{self.fx.why()}")

    def test_no_emulator_no_cargo_test_no_playwright_and_the_runs_emulator_name_is_removed(self):
        self.o.ended(self)
        docker = [c["args"] for c in self.fx.calls("docker")]
        # the `docker run --rm ... --version` that pins the version comes before the build; the emulator is `run -d`
        self.assertEqual([a for a in docker if a[:1] == ["run"] and "-d" in a], [], "the run's emulator was started")
        self.assertEqual([c["args"] for c in self.fx.calls("cargo") if c["args"][:1] == ["test"]], [],
                         "cargo test was started")
        self.assertEqual(self.fx.calls("playwright"), [], "Playwright was started")
        m = re.search(r"(?m)^integration: run (\S+), emulator port", self.fx.output())
        self.assertIsNotNone(m, self.fx.why())
        name = f"emuforge-it-emulator-{m.group(1)}"
        self.assertTrue(any(a[:2] == ["image", "rm"] and name in a for a in docker),
                        f"no docker image rm of {name}: {docker}")

    def test_with_a_not_run_list_the_listed_checks_are_error_too(self):
        fx = Fixture("bound-not-run")
        self.addCleanup(fx.end)
        listing = fx.file("list.json", json.dumps(dict(
            checks=[dict(id=i, reason=r, issue=54) for i, r in LISTED.items()],
            steps=[dict(step="harness-test", reason="runs on the owner's machine")])))
        o = Outcome(fx, "hang", "--not-run", listing)
        o.ended(self)
        report = fx.report()
        self.assertIsNotNone(report, fx.why())
        for check_id in LISTED:
            self.assertEqual((report[check_id]["verdict"], report[check_id]["message"]), ("error", reason(fx)))

    def test_a_build_that_ignores_sigterm_is_ended_and_the_run_exits_127_within_the_bound(self):
        fx = Fixture("bound-ignore")
        self.addCleanup(fx.end)
        o = Outcome(fx, "hang-ignore")
        o.ended(self)
        self.assertEqual(len(fx.build_pids()), 2, fx.why())
        self.assertEqual(o.left, [], f"alive after the run ended{fx.why()}")

    def test_the_shipped_value_is_600_once(self):
        found = BOUND_SETTING.findall(RUN.read_text())
        self.assertEqual(found, [str(SHIPPED)], f"product_build_bound settings in {RUN}")


class Ended_in_time(unittest.TestCase):
    """The bound lowered; the build ends by itself."""

    def finished(self, name, how):
        fx = Fixture(name)
        self.addCleanup(fx.end)
        fx.start(how)
        code = fx.wait(time.time() + START_WAIT)
        self.assertIsNotNone(code, f"the run had not ended after {START_WAIT} s{fx.why()}")
        return fx, code

    def checks_ran(self, fx):
        self.assertTrue([c for c in fx.calls("cargo") if c["args"][:1] == ["test"]], "cargo test was not started")
        self.assertTrue(fx.calls("playwright"), "Playwright was not started")

    def test_a_build_that_exits_0_is_as_before(self):
        fx, code = self.finished("ok", "ok")
        self.assertEqual(code, 0, fx.why())
        report = fx.report()
        self.assertIsNotNone(report, fx.why())
        self.assertEqual({i: c["verdict"] for i, c in report.items()
                          if i not in ON_REQUEST and c["verdict"] != "passed"}, {})
        self.assertEqual({i: (c["verdict"], c["message"]) for i, c in report.items() if i in ON_REQUEST},
                         {i: ("not-run", ON_REQUEST_REASON) for i in ON_REQUEST})
        self.assertEqual(sorted(report), sorted(IDS))
        # the fixture's own path holds the word "bound", so the line is looked for by the bound's wording
        named = [line for line in fx.lines() if re.search(rf"did not end within|within {LOWERED} s\b", line)]
        self.assertEqual(named, [])

    def test_a_build_that_exits_1_is_the_subjects_and_the_checks_run(self):
        fx, code = self.finished("fail", "fail")
        self.assertIn(f"integration: product image build failed, see {fx.log_path}", fx.lines(), fx.why())
        self.checks_ran(fx)
        self.assertEqual(code, 0, fx.why())
        report = fx.report()
        self.assertIsNotNone(report, fx.why())
        self.assertEqual([i for i, c in report.items() if c["verdict"] == "error"], [])

    def test_a_child_left_by_a_build_that_exits_0_is_gone_when_the_run_has_ended(self):
        fx, code = self.finished("ok-child", "ok-child")
        self.assertEqual(len(fx.build_pids()), 2, fx.why())
        self.assertEqual(left(fx.build_pids()[1:]), [], f"the build's child is alive after the run ended{fx.why()}")
        self.assertEqual(code, 0, fx.why())

    def test_a_child_left_by_a_build_that_exits_1_is_gone_and_the_checks_ran(self):
        fx, code = self.finished("fail-child", "fail-child")
        self.assertEqual(len(fx.build_pids()), 2, fx.why())
        self.assertEqual(left(fx.build_pids()[1:]), [], f"the build's child is alive after the run ended{fx.why()}")
        self.checks_ran(fx)

    def test_a_build_that_exits_124_by_itself_is_the_bound(self):
        fx, code = self.finished("exit124", "exit124")
        self.assertEqual(code, 127, fx.why())
        report = fx.report()
        self.assertIsNotNone(report, fx.why())
        self.assertEqual(sorted(report), sorted(IDS))
        self.assertEqual({i: c["verdict"] for i, c in report.items() if c["verdict"] != "error"}, {})


class Stopped(unittest.TestCase):
    """`run` as shipped, in a process group of its own, stopped while its build runs."""

    def started(self, name, how):
        fx = Fixture(name, bound=None)
        self.addCleanup(fx.end)
        fx.start(how)
        build = fx.wait_build()
        self.assertIsNotNone(build, f"the stand-in build never started{fx.why()}")
        self.assertIsNone(fx.proc.poll(), f"the run ended before it was stopped{fx.why()}")
        return fx

    def term(self, fx):
        try:
            os.killpg(fx.proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    def settled(self, fx, until):
        """Waits until the run has ended and the build pids are gone, or `until`; returns (ended, alive pids)."""
        while True:
            ended = fx.proc.poll() is not None
            still = [p for p in fx.build_pids() if alive(p)]
            if (ended and not still) or time.time() >= until:
                return ended, still
            time.sleep(0.05)

    def test_sigterm_to_the_group_ends_the_build_and_the_run_and_writes_no_report(self):
        fx = self.started("stop", "hang")
        t0 = time.time()
        self.term(fx)
        ended, still = self.settled(fx, t0 + STOP_WITHIN)
        self.assertEqual(len(fx.build_pids()), 2, fx.why())
        self.assertEqual(still, [], f"alive {STOP_WITHIN} s after the SIGTERM{fx.why()}")
        self.assertTrue(ended, f"the run had not ended {STOP_WITHIN} s after the SIGTERM{fx.why()}")
        self.assertFalse(fx.report_path.exists(), "report.json was written")

    def test_sigterm_twice_ends_a_build_that_ignores_it_within_5_seconds_of_the_first(self):
        fx = self.started("stop-ignore", "hang-ignore")
        t0 = time.time()
        self.term(fx)
        time.sleep(0.5)
        self.term(fx)
        end = t0 + STOP_WITHIN
        while [p for p in fx.build_pids() if alive(p)] and time.time() < end:
            time.sleep(0.05)
        self.assertEqual(len(fx.build_pids()), 2, fx.why())
        self.assertEqual([p for p in fx.build_pids() if alive(p)], [],
                         f"alive {STOP_WITHIN} s after the first SIGTERM{fx.why()}")


class Under_pm_check(unittest.TestCase):
    """The fixture's own pm-check over a build that does not return, the bound lowered, run once for the class."""

    @classmethod
    def setUpClass(cls):
        cls.fx = fx = Fixture("pm-check", scripts=("pm-check",), tools=("top",))
        cls.addClassCleanup(fx.end)
        fx.start("hang", ".", "--only", "integration", program=[str(fx.co / ".pm" / "bin" / "pm-check")])
        cls.build = fx.wait_build()
        cls.code = None
        if cls.build is not None:
            # pm-check's own bound: the run's, then its record and the end of the step's group
            cls.code = fx.wait(cls.build["started"] + LOWERED + SLACK + 30)
        cls.slot_free = cls.running_left = cls.left = None
        if cls.code is not None:
            cls.slot_free = lockable(fx.co / ".pm" / "run" / "check-slots" / "slot-0.lock")
            cls.running_left = (fx.co / "output" / "checks" / "running.json").exists()
            cls.left = left(fx.build_pids())

    def ended(self):
        self.assertIsNotNone(self.build, f"the stand-in build never started{self.fx.why()}")
        self.assertIsNotNone(self.code, f"pm-check had not ended {LOWERED + SLACK + 30} s after the build started"
                                        f"{self.fx.why()}")

    def test_the_step_is_an_error_naming_every_check_and_the_build_ran_once(self):
        self.ended()
        lines = [line for line in self.fx.lines() if line.strip()]
        self.assertTrue(lines[-1].startswith("NOT PASSED"), f"last line {lines[-1]!r}{self.fx.why()}")
        rec = json.loads((self.fx.co / "output" / "checks" / "last.json").read_text())
        steps = [s for s in rec["steps"] if s["name"] == "integration"]
        self.assertEqual(len(steps), 1, rec["steps"])
        step = steps[0]
        self.assertEqual(step["status"], "error", step)
        self.assertIsInstance(step.get("checks"), dict, step)
        self.assertEqual(sorted(step["checks"]["error"]), sorted(IDS))
        self.assertNotIn("first_log", step)
        self.assertTrue(any(re.match(rf"\s*error checks \({len(IDS)}\): ", line) for line in lines),
                        self.fx.why())
        self.assertEqual(len(self.fx.compose_builds()), 1, self.fx.compose_builds())
        self.assertEqual(len(self.fx.builds()), 1, self.fx.builds())

    def test_the_slot_is_free_and_nothing_of_the_build_is_left_when_pm_check_has_ended(self):
        self.ended()
        self.assertTrue(self.slot_free, "check-slots/slot-0.lock is still held")
        self.assertFalse(self.running_left, "running.json is still there")
        self.assertEqual(len(self.fx.build_pids()), 2, self.fx.why())
        self.assertEqual(self.left, [], f"alive after pm-check ended{self.fx.why()}")


if __name__ == "__main__":
    unittest.main()
