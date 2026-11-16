"""harness.ci: the runner helper .github/ci, the text of .github/workflows/main.yml and the not-run list (issue 53).

One class per heading of the issue's test criteria (`test_ci.NotRun`, `Versions`, `Run`, `Real_keys`, `Workflow`,
`List`).

`ci` is run as a program. A case that runs it makes a fixture checkout (`_fixture.make`) under
<checkout>/output/tests/ci/<case>/ holding a copy of .github/ci, copies of the real .pm/bin/pm-check and
_pmlib.py, and the files the case names (a manifest of three rows, a not-run list, a Dockerfile, a report), so
nothing touches the real output/integration, .pm/run or GitHub. A stand-in command is a script the case writes
into its own directory, output/case/ of the fixture; it prints what the case tells it to and exits with the code
the case tells it to.

The nine steps (pm-check's modules engine, studio and integration), their folders and commands, and pm-check's
SCRUB and RETRY are read from the source of the checkout's .pm/bin/pm-check (as literals, without importing it),
never copied here.

Keys: `<40>` is a run of 40 characters of [A-Za-z0-9/+] and `<20>` a run of 20 of [A-Z0-9], made up by the case.
`Real_keys` starts one emulator from the image aws-emulator on a free loopback port and reads that emulator's
emulator_credentials into memory only; no value of it is ever printed, in a failure message or elsewhere.
Docker and the image are required there: without them the case fails naming what is missing, never skips.

Without .github/ci, .github/workflows/main.yml or .github/not-run.json every case fails on its own, saying which
file does not exist.
"""
import ast
import json
import os
import pathlib
import random
import re
import shlex
import shutil
import socket
import string
import subprocess
import sys
import time
import unittest

from _fixture import BIN, CHECKOUT, clean_env, make

GITHUB = CHECKOUT / ".github"
CI = GITHUB / "ci"
WORKFLOW = GITHUB / "workflows" / "main.yml"
NOT_RUN = GITHUB / "not-run.json"
MANIFEST = CHECKOUT / "tests" / "integration" / "manifest.jsonl"
OPEN_ISSUES = CHECKOUT / "issues" / "things-that-do-not-work"
PM_CHECK = BIN / "pm-check"
NINE_MODULES = ("engine", "studio", "integration")
PRODUCT_ISSUE = 54  # the issue of the product form on Docker Engine on Linux

A40 = string.ascii_letters + string.digits + "/+"
A20 = string.ascii_uppercase + string.digits
RNG = random.SystemRandom()

OWNER_PORT = 9297
TAKEN = {OWNER_PORT, *range(8100, 8200), *range(8300, 8400), *range(9300, 9400)}  # the owner's and pm-worktree's
IMAGE = "aws-emulator"
DOCKER_ENV = ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "TMPDIR")
BOUND = 60.0  # seconds the emulator has to write its files and answer health
POLL = 0.25


# ---------------------------------------------------------------------------------------------- pm-check

def pm_check_literals(path=PM_CHECK):
    """STEPS, SCRUB and RETRY as the source of `path` assigns them, read with ast (pm-check is not imported)."""
    found = {}
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if node.targets[0].id in ("STEPS", "SCRUB", "RETRY"):
                found[node.targets[0].id] = ast.literal_eval(node.value)
    missing = {"STEPS", "SCRUB", "RETRY"} - set(found)
    if missing:
        raise AssertionError(f"{path} assigns no literal {', '.join(sorted(missing))}")
    return found


def nine():
    """[(step, folder, argv)] of pm-check's modules engine, studio and integration, in pm-check's order."""
    steps = pm_check_literals()["STEPS"]
    out = []
    for mod in NINE_MODULES:
        folder, _manifest, entries = steps[mod]
        out += [(name, folder, list(argv)) for name, argv in entries]
    return out


# ---------------------------------------------------------------------------------------------- keys

def run_of(alphabet, n):
    """A run of `n` characters of `alphabet` that holds no run of 20 or more of [A-Z0-9] unless it is all of
    A20, and, for A40, at least one character outside A20, so it is unambiguously of its own alphabet."""
    while True:
        s = "".join(RNG.choice(alphabet) for _ in range(n))
        if alphabet == A20 or (re.search(r"[a-z/+]", s) and not re.search(r"[A-Z0-9]{20,}", s)):
            return s


def key40():
    return run_of(A40, 40)


def key20():
    return run_of(A20, 20)


# ---------------------------------------------------------------------------------------------- workflow text

def strip_comment(line):
    return re.sub(r"(^|\s)#.*$", "", line).rstrip()


def unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def top_block(text, key):
    """The lines under the top-level `key:` up to the next top-level key, without blanks and comments, and the
    value on the key's own line. None when the key is not at the top level."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = re.match(rf"^{re.escape(key)}:(.*)$", strip_comment(line))
        if m:
            body = []
            for ln in lines[i + 1:]:
                s = strip_comment(ln)
                if not s.strip():
                    continue
                if not s[0].isspace():
                    break
                body.append(s)
            return m.group(1).strip(), body
    return None


def children(body):
    """{key: (inline value, [deeper lines])} of the lines of `body` at its smallest indent."""
    if not body:
        return {}
    base = min(len(ln) - len(ln.lstrip()) for ln in body)
    out, cur = {}, None
    for ln in body:
        indent = len(ln) - len(ln.lstrip())
        if indent == base:
            m = re.match(r"^\s*([^:\s][^:]*):(.*)$", ln)
            key = m.group(1).strip() if m else ln.strip()
            cur = out.setdefault(key, (m.group(2).strip() if m else "", []))
        elif cur is not None:
            cur[1].append(ln)
    return out


def flow_list(value, deeper):
    """The items of a YAML list written `[a, b]` on the key's line or as `- a` lines under it."""
    if value.startswith("["):
        return [unquote(v) for v in value.strip("[]").split(",") if v.strip()]
    if value:
        return [unquote(value)]
    return [unquote(ln.strip()[1:]) for ln in deeper if ln.strip().startswith("-")]


def workflow_steps(text):
    """The steps of the workflow: from a line `- name: <name>` after `steps:` to the next such line. Each is
    {name, lines}; `lines` holds the step's lines, the `- name:` line first."""
    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines) if re.match(r"^\s*steps:\s*$", strip_comment(ln))), None)
    if start is None:
        raise AssertionError(f"{WORKFLOW} has no `steps:` line")
    steps = []
    for ln in lines[start + 1:]:
        m = re.match(r"^\s*- name:\s*(.*)$", strip_comment(ln))
        if m:
            steps.append(dict(name=unquote(m.group(1)), lines=[ln]))
        elif steps:
            steps[-1]["lines"].append(ln)
    return steps


def step_key(step, key):
    """The value of `key:` in a step (the first one), stripped of a comment and outer quotes; None without it."""
    for ln in step["lines"]:
        m = re.match(rf"^\s*(?:- )?{re.escape(key)}:(.*)$", ln)
        if m:
            return unquote(strip_comment(m.group(1)))
    return None


def ci_path(folder):
    return os.path.relpath(".github/ci", folder)


def expected_run(name, folder, argv):
    """The one-line `run:` of one of the nine: the path to .github/ci, ` run -- ` and pm-check's command; for
    integration ` run --tails -- ./run --not-run ` and the path to .github/not-run.json."""
    if name == "integration":
        return (f"{ci_path(folder)} run --tails -- {shlex.join(argv)} --not-run "
                f"{os.path.relpath('.github/not-run.json', folder)}")
    return f"{ci_path(folder)} run -- {shlex.join(argv)}"


def lines_of(p):
    return (p.stdout + "\n" + p.stderr).splitlines()


# ---------------------------------------------------------------------------------------------- cases

class Case(unittest.TestCase):
    """A fixture checkout with a copy of .github/ci, of pm-check and _pmlib.py, and the case's own files."""

    def files(self):
        return {}

    def setUp(self):
        if not CI.exists():
            self.fail(f"{CI} does not exist")
        case = f"{type(self).__name__}-{self._testMethodName}".lower().replace("_", "-")
        self.co = make("ci", case, ("pm-check", "_pmlib.py"), self.files())
        (self.co / ".github").mkdir(exist_ok=True)
        shutil.copy2(CI, self.co / ".github" / "ci")
        (self.co / ".github" / "ci").chmod(0o755)
        self.dir = self.co / "output" / "case"
        self.dir.mkdir(parents=True)

    def env(self, **extra):
        env = {k: v for k, v in clean_env().items() if k != "GITHUB_STEP_SUMMARY"}
        env.update(extra)
        return env

    def ci(self, *args, env=None, timeout=120):
        return subprocess.run([str(self.co / ".github" / "ci"), *map(str, args)], capture_output=True, text=True,
                              env=env or self.env(), cwd=str(self.co), timeout=timeout)

    def stand_in(self, name, stdout=(), stderr=(), code=0):
        """A command that prints `stdout` lines to standard output, `stderr` lines to standard error, exits `code`."""
        p = self.dir / name
        p.write_text(f"#!{sys.executable} -I\nimport sys\n"
                     f"for line in {list(stdout)!r}:\n    print(line, flush=True)\n"
                     f"for line in {list(stderr)!r}:\n    print(line, file=sys.stderr, flush=True)\n"
                     f"sys.exit({int(code)})\n")
        p.chmod(0o755)
        return p


MANIFEST_ROWS = [
    {"check_id": "engine.ci-fixture-one", "path": "tests/integration/engine/tests/one.rs", "module": "engine",
     "operations": [], "labels": [], "issue": 53},
    {"check_id": "engine.ci-fixture-two", "path": "tests/integration/studio/two.spec.ts", "module": "engine",
     "operations": [], "labels": [], "issue": 53},
    {"check_id": "engine.ci-fixture-three", "path": "tests/integration/engine/tests/three.rs", "module": "engine",
     "operations": [], "labels": [], "issue": 53},
]


def good_list():
    return {
        "checks": [
            {"id": "engine.ci-fixture-one", "reason": "fixture reason one: no form on this runner", "issue": 54},
            {"id": "engine.ci-fixture-two", "reason": "fixture reason two: differs on this runner", "issue": 54},
        ],
        "steps": [{"step": "harness-test", "reason": "fixture reason three: run on the owner's machine"}],
    }


class NotRun(Case):
    def files(self):
        return {"tests/integration/manifest.jsonl": "".join(json.dumps(r) + "\n" for r in MANIFEST_ROWS),
                ".github/not-run.json": json.dumps(good_list(), indent=1) + "\n"}

    def test_every_entry_reported_as_not_run(self):
        summary = self.dir / "summary.md"
        summary.write_text("")
        p = self.ci("not-run", env=self.env(GITHUB_STEP_SUMMARY=str(summary)))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        listed = good_list()
        entries = [(c["id"], c["reason"]) for c in listed["checks"]] + [(s["step"], s["reason"]) for s in listed["steps"]]
        for where, text in (("standard output", p.stdout), ("the summary file", summary.read_text())):
            for name, reason in entries:
                self.assertTrue(any(name in ln and "not run" in ln and reason in ln for ln in text.splitlines()),
                                f"{where} has no line naming {name} with `not run` and its reason:\n{text}")
            self.assertIsNone(re.search(r"\bpassed\b", text, re.IGNORECASE), f"{where} holds `passed`:\n{text}")

    def test_wrong_list_is_refused(self):
        path = self.co / ".github" / "not-run.json"

        def with_change(change):
            def write():
                data = good_list()
                change(data)
                path.write_text(json.dumps(data))
            return write

        def empty_reason(d):
            d["checks"][1]["reason"] = ""

        cases = [
            ("the file is missing", lambda: path.unlink(), "not-run.json"),
            ("the file is not JSON", lambda: path.write_text("{\"checks\": [\n"), "not-run.json"),
            ("an id the manifest does not hold",
             with_change(lambda d: d["checks"][0].update(id="engine.ci-no-such-check")), "engine.ci-no-such-check"),
            ("an empty reason", with_change(empty_reason), "engine.ci-fixture-two"),
            ("the step no-such-step",
             with_change(lambda d: d["steps"].append({"step": "no-such-step", "reason": "r"})), "no-such-step"),
            ("the step engine-test, one of the nine",
             with_change(lambda d: d["steps"].append({"step": "engine-test", "reason": "r"})), "engine-test"),
            ("no harness-test", with_change(lambda d: d.update(steps=[])), "harness-test"),
        ]
        for label, prepare, named in cases:
            with self.subTest(label):
                prepare()
                p = self.ci("not-run")
                self.assertEqual(p.returncode, 1, f"{label}:\n{p.stdout}{p.stderr}")
                self.assertTrue(any(ln.startswith("not-run:") and named in ln for ln in lines_of(p)),
                                f"{label}: no line starts `not-run:` and names {named}:\n{p.stdout}{p.stderr}")


DOCKERFILE = """\
# syntax=docker/dockerfile:1
# the Rust and bun versions equal the toolchains pm-check uses
FROM rust:1.2.3-slim-bookworm AS engine
WORKDIR /src

FROM oven/bun:4.5.6-debian AS studio
WORKDIR /src

FROM debian:bookworm-20261104-slim
"""


class Versions(Case):
    def write(self, text):
        p = self.co / "infra" / "emuforge" / "Dockerfile"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def test_versions_read_from_the_dockerfile(self):
        self.write(DOCKERFILE)
        p = self.ci("versions")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.splitlines(), ["rust=1.2.3", "bun=4.5.6"], p.stdout + p.stderr)

    def test_missing_or_floating_version_is_refused(self):
        cases = [
            ("the rust line is missing", DOCKERFILE.replace("FROM rust:1.2.3-slim-bookworm AS engine\n", "")),
            ("the rust tag is latest", DOCKERFILE.replace("rust:1.2.3-slim-bookworm", "rust:latest")),
            ("the bun tag is latest", DOCKERFILE.replace("oven/bun:4.5.6-debian", "oven/bun:latest")),
        ]
        for label, text in cases:
            with self.subTest(label):
                self.write(text)
                p = self.ci("versions")
                self.assertEqual(p.returncode, 1, f"{label}:\n{p.stdout}{p.stderr}")
                self.assertEqual(p.stdout, "", f"{label}: standard output is not empty")


TAIL_CHECKS = {  # check id: (verdict, the prefix of its log lines)
    "engine.ci-tail-passed": ("passed", "pa"),
    "engine.ci-tail-failed": ("failed", "fa"),
    "engine.ci-tail-error": ("error", "er"),
    "engine.ci-tail-not-run": ("not-run", "nr"),
}


class Run(Case):
    def test_both_streams_and_the_exit_code(self):
        cmd = self.stand_in("seven", stdout=["fixture line on standard output"],
                            stderr=["fixture line on standard error"], code=7)
        p = self.ci("run", "--", cmd)
        self.assertEqual(p.returncode, 7, p.stdout + p.stderr)
        out = p.stdout.splitlines()
        self.assertIn("fixture line on standard output", out, p.stdout)
        self.assertIn("fixture line on standard error", out, p.stdout)

    def test_no_shell(self):
        p = self.ci("run", "--", "/bin/echo", "$(id); x")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("$(id); x", lines_of(p), p.stdout + p.stderr)

    def test_scrub_names_removed(self):
        scrub = pm_check_literals()["SCRUB"]
        env = self.env(FOO="bar", **{name: f"fixture-value-{i}" for i, name in enumerate(scrub)})
        p = self.ci("run", "--", "/usr/bin/env", env=env)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        out = lines_of(p)
        self.assertIn("FOO=bar", out)
        left = [ln for ln in out if any(ln.startswith(name) for name in scrub)]
        self.assertEqual(left, [], "lines that start with a name of SCRUB")

    def test_workflow_commands_stopped(self):
        cmd = self.stand_in("commands", stdout=["before", "::error::x", "after"])
        tokens = []
        for _ in range(2):
            p = self.ci("run", "--", cmd)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            out = p.stdout.splitlines()
            self.assertTrue(out, "no output")
            m = re.fullmatch(r"::stop-commands::(\S+)", out[0])
            self.assertIsNotNone(m, f"the first line is not ::stop-commands::<token>:\n{p.stdout}")
            token = m.group(1)
            self.assertEqual(out[-1], f"::{token}::", f"the last line does not close the token:\n{p.stdout}")
            self.assertIn("::error::x", out[1:-1], p.stdout)
            tokens.append(token)
        self.assertNotEqual(tokens[0], tokens[1], "two calls gave the same token")

    def test_key_forms_replaced(self):
        k40, k20 = key40(), key20()
        rows = [
            ("AWS_SECRET_ACCESS_KEY=<40>", f"AWS_SECRET_ACCESS_KEY={k40}", "AWS_SECRET_ACCESS_KEY=[redacted-40]"),
            ("aws_secret_access_key = <40>", f"aws_secret_access_key = {k40}", "aws_secret_access_key = [redacted-40]"),
            ('"<40>"', f'"{k40}"', '"[redacted-40]"'),
            ("<40>=", f"{k40}=", "[redacted-40]="),
            ("AWS_ACCESS_KEY_ID=<20>", f"AWS_ACCESS_KEY_ID={k20}", "AWS_ACCESS_KEY_ID=[redacted-20]"),
            ("Credential=<20>/…", f"Credential={k20}/20261116/us-east-1/s3/aws4_request",
             "Credential=[redacted-20]/20261116/us-east-1/s3/aws4_request"),
        ]
        for i, (form, line, expected) in enumerate(rows):
            with self.subTest(form):
                cmd = self.stand_in(f"keys-{i}", stdout=[line], stderr=[line])
                p = self.ci("run", "--", cmd)
                self.assertEqual(p.returncode, 0, f"{form}: exit {p.returncode}")
                both = p.stdout + p.stderr
                self.assertFalse(k40 in both or k20 in both, f"{form}: the key is in the output")
                self.assertEqual(lines_of(p).count(expected), 2,
                                 f"{form}: the line from standard output and the one from standard error are not "
                                 f"each `{expected}`")

    def test_other_lengths_unchanged(self):
        line = f"a {run_of(A40, 39)} b {run_of(A40, 41)} c {run_of(A20, 19)} d {run_of(A20, 21)} e"
        cmd = self.stand_in("lengths", stdout=[line])
        p = self.ci("run", "--", cmd)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn(line, lines_of(p), p.stdout + p.stderr)
        self.assertNotIn("[redacted", p.stdout + p.stderr)

    def tails_fixture(self):
        """output/integration/report.json naming one check of each verdict, each with a log of 250 numbered lines;
        line 240 of the failed one's holds a <40>."""
        self.k40 = key40()
        out = self.co / "output" / "integration"
        (out / "logs").mkdir(parents=True)
        checks = []
        for check_id, (verdict, tag) in TAIL_CHECKS.items():
            log = out / "logs" / f"{check_id}.log"
            lines = [f"{tag} {n:04d}" for n in range(1, 251)]
            if verdict == "failed":
                lines[239] = f"{tag} 0240 secret={self.k40}"
            log.write_text("\n".join(lines) + "\n")
            checks.append(dict(check_id=check_id, verdict=verdict, seconds=1, log=str(log), message=""))
        self.report = out / "report.json"
        self.report.write_text(json.dumps(dict(emulator_version="0.0.0", emulator_commit="0000000", commit="fixture",
                                               relay_fidelity=dict(passed=1, total=2), checks=checks), indent=1))

    def headers(self, out):
        return {cid: [i for i, ln in enumerate(out) if cid in ln] for cid in TAIL_CHECKS}

    def test_tails_of_failed_and_error_logs(self):
        self.tails_fixture()
        cmd = self.stand_in("fails", stdout=["fixture command output"], code=1)
        p = self.ci("run", "--tails", "--", cmd)
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertNotIn(self.k40, p.stdout + p.stderr, "the key of line 240 is in the output")
        out = p.stdout.splitlines()
        self.assertIn("fixture command output", out, p.stdout)
        command_at = out.index("fixture command output")
        headers = self.headers(out)
        for cid in ("engine.ci-tail-passed", "engine.ci-tail-not-run"):
            self.assertEqual(headers[cid], [], f"a line names {cid}")
        for cid in ("engine.ci-tail-failed", "engine.ci-tail-error"):
            tag = TAIL_CHECKS[cid][1]
            self.assertEqual(len(headers[cid]), 1, f"not one header line naming {cid}:\n{p.stdout}")
            at = headers[cid][0]
            self.assertGreater(at, command_at, f"the header of {cid} is not after the command's output")
            want = [f"{tag} {n:04d}" for n in range(51, 251)]
            if cid == "engine.ci-tail-failed":
                want[240 - 51] = f"{tag} 0240 secret=[redacted-40]"
            self.assertEqual(out[at + 1:at + 201], want, f"lines 51 to 250 of {cid}'s log do not follow its header")
            self.assertNotIn(f"{tag} 0050", out, f"line 50 of {cid}'s log is in the output")

    def test_tails_none(self):
        self.tails_fixture()
        cases = [("the command exits 0", 0, False), ("the command exits 1 and report.json is missing", 1, True)]
        for label, code, remove in cases:
            with self.subTest(label):
                if remove:
                    self.report.unlink()
                cmd = self.stand_in(f"exit-{code}", stdout=["fixture command output"], code=code)
                p = self.ci("run", "--tails", "--", cmd)
                self.assertEqual(p.returncode, code, f"{label}:\n{p.stdout}{p.stderr}")
                named = [ln for ln in lines_of(p) if any(cid in ln for cid in TAIL_CHECKS)]
                self.assertEqual(named, [], f"{label}: header lines")
                self.assertNotIn("Traceback", p.stdout + p.stderr, label)

    def test_second_run_flaky(self):
        for code in (0, 1):
            with self.subTest(exit=code):
                summary = self.dir / f"summary-{code}.md"
                summary.write_text("")
                cmd = self.stand_in(f"second-{code}", stdout=["fixture command output"], code=code)
                p = self.ci("run", "--second", "engine-test", "--", cmd, env=self.env(GITHUB_STEP_SUMMARY=str(summary)))
                self.assertEqual(p.returncode, code, p.stdout + p.stderr)
                flaky_out = [ln for ln in p.stdout.splitlines() if "flaky" in ln and "engine-test" in ln]
                flaky_summary = [ln for ln in summary.read_text().splitlines() if "flaky" in ln and "engine-test" in ln]
                if code == 0:
                    self.assertTrue(flaky_out, f"no line with flaky and engine-test in the output:\n{p.stdout}")
                    self.assertTrue(flaky_summary, "no line with flaky and engine-test in the summary file")
                else:
                    self.assertEqual(flaky_out, [], "a line with flaky and engine-test in the output")
                    self.assertEqual(flaky_summary, [], "a line with flaky and engine-test in the summary file")


class Real_keys(Case):
    def docker(self, *args, timeout=60):
        env = {k: v for k, v in clean_env().items() if k in DOCKER_ENV}
        try:
            return subprocess.run(["docker", *args], capture_output=True, text=True, env=env, timeout=timeout)
        except FileNotFoundError:
            self.fail("docker is not installed or not on PATH")
        except subprocess.TimeoutExpired:
            self.fail(f"docker {args[0]} did not answer within {timeout} s")

    def free_port(self, root):
        while True:
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                port = s.getsockname()[1]
            if port not in TAKEN and not (root / str(port)).exists():
                return port

    def remove(self):
        """Removes the case's file, its container and then the port's folder; safe to call twice."""
        self.keys_file.unlink(missing_ok=True)
        if self.started:
            self.docker("stop", "-t", "10", self.name, timeout=60)
            self.docker("rm", "-f", self.name, timeout=60)
            self.started = False
        if (self.root / str(self.port)).exists():
            p = subprocess.run([str(BIN / "pm-emulator-dir"), "rm", "--port", str(self.port)], capture_output=True,
                               text=True, env=clean_env(), cwd=str(CHECKOUT), timeout=60)
            self.dir_rm = p

    def test_keys_of_a_real_emulator_replaced(self):
        info = self.docker("info", "--format", "{{.ServerVersion}}")
        if info.returncode != 0:
            self.fail(f"Docker does not answer (docker info exit {info.returncode}): {info.stderr.strip()[-400:]}")
        if self.docker("image", "inspect", "--format", "{{.Id}}", IMAGE).returncode != 0:
            self.fail(f"the image {IMAGE} is missing: docker compose -f infra/aws-emulator/docker-compose.yml build")
        home = pathlib.Path(os.environ["HOME"])
        self.root = home / ".aws" / "emulator"
        self.root.mkdir(parents=True, exist_ok=True)
        self.port = self.free_port(self.root)
        self.name = f"emuforge-ci-keys-{self.port}"
        self.keys_file = self.dir / "keys.txt"
        self.started = False
        self.dir_rm = None
        self.addCleanup(self.remove)

        started = self.docker("run", "-d", "--name", self.name, "--memory", "2g",
                              "-p", f"127.0.0.1:{self.port}:{self.port}", "-e", f"HOME={home}",
                              "-v", f"{self.root}:{self.root}", IMAGE, "-p", str(self.port), "-t", "off")
        if started.returncode != 0:
            self.fail(f"the emulator would not start (docker run exit {started.returncode}): {started.stderr.strip()[-400:]}")
        self.started = True
        folder = self.root / str(self.port)
        ca, creds = folder / "ca.pem", folder / "emulator_credentials"
        deadline = time.monotonic() + BOUND
        status = None
        while True:
            if ca.exists() and creds.exists() and creds.stat().st_size:
                probe = subprocess.run(
                    ["curl", "-q", "-sS", "--noproxy", "*", "--max-time", "5", "--cacert", str(ca),
                     "-o", "/dev/null", "-w", "%{http_code}", f"https://127.0.0.1:{self.port}/__admin/health"],
                    capture_output=True, text=True, env={"PATH": os.environ.get("PATH", "")}, timeout=15)
                status = probe.stdout.strip()
                if status == "200":
                    break
            if time.monotonic() >= deadline:
                self.fail(f"the emulator on 127.0.0.1:{self.port} did not write ca.pem and emulator_credentials and "
                          f"answer health 200 within {BOUND:g} s (last status {status})")
            time.sleep(POLL)

        values = [ln.split("=", 1)[1].strip() for ln in creds.read_text().splitlines() if "=" in ln]
        if len(values) != 2 or not all(values):
            self.fail(f"emulator_credentials does not hold two values ({len(values)} found)")
        named = dict(zip(("the access key id", "the secret access key"), values))
        names = {"the access key id": "AWS_ACCESS_KEY_ID", "the secret access key": "AWS_SECRET_ACCESS_KEY"}
        three = {"NAME=<v>": "{N}={v}", "name = <v>": "{n} = {v}", '"<v>"': '"{v}"'}
        # PM decision (issue 53, decisions.md): a signed request carries the key id after `Credential=`, never the
        # secret, so the key id is written in that form too and the secret in the other three only.
        forms_of = {"the access key id": {**three, "Credential=<v>/x": "Credential={v}/x"},
                    "the secret access key": three}
        fd = os.open(self.keys_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            for label, v in named.items():
                for fmt in forms_of[label].values():
                    f.write(fmt.format(N=names[label], n=names[label].lower(), v=v) + "\n")

        p = self.ci("run", "--", "/bin/cat", self.keys_file)
        both = p.stdout + p.stderr
        leaked = []
        for label, v in named.items():
            for form, fmt in forms_of[label].items():
                if fmt.format(N=names[label], n=names[label].lower(), v=v) in both:
                    leaked.append(f"{label} in the form {form}")
            if v in both and not any(x.startswith(label) for x in leaked):
                leaked.append(f"{label} in another form")
        del values, named, both, p

        self.remove()
        self.assertFalse(self.keys_file.exists(), "the file of keys is still there")
        left = self.docker("ps", "-a", "-q", "--filter", f"name=^/{self.name}$")
        self.assertEqual(left.stdout.strip(), "", f"the container {self.name} is still there")
        self.assertFalse(folder.exists(), f"the folder of port {self.port} is still there "
                                          f"(pm-emulator-dir: {self.dir_rm.stdout.strip() if self.dir_rm else 'not run'})")
        self.assertEqual(leaked, [], "a key of the emulator is in the output of ci run")


class Workflow(unittest.TestCase):
    def setUp(self):
        if not WORKFLOW.exists():
            self.fail(f"{WORKFLOW} does not exist")
        self.text = WORKFLOW.read_text()
        self.steps = workflow_steps(self.text)
        self.by_name = {}
        for i, s in enumerate(self.steps):
            self.by_name.setdefault(s["name"], i)

    def test_triggers(self):
        self.assertEqual(len(re.findall(r"^on:", self.text, re.M)), 1, "not one top-level `on:`")
        value, body = top_block(self.text, "on")
        self.assertEqual(value, "", "`on:` is not a block")
        keys = children(body)
        self.assertEqual(set(keys), {"push", "workflow_dispatch"}, f"the keys of `on:`: {sorted(keys)}")
        push_value, push_body = keys["push"]
        self.assertEqual(push_value, "", "`push:` is not a block")
        push = children(push_body)
        self.assertEqual(set(push), {"branches"}, f"the keys of `push:`: {sorted(push)}")
        self.assertEqual(flow_list(*push["branches"]), ["main"], "the push trigger's branches are not [main]")
        wd_value, wd_body = keys["workflow_dispatch"]
        self.assertIn(wd_value, ("", "{}", "null", "~"), "`workflow_dispatch:` has a value")
        self.assertEqual(wd_body, [], "`workflow_dispatch:` has keys (inputs)")
        for word in ("pull_request", "pull_request_target", "schedule", "workflow_run", "workflow_call"):
            self.assertNotIn(word, self.text)

    def test_rights_secrets_and_aws_names(self):
        perms = [ln for ln in self.text.splitlines() if re.match(r"^\s*permissions:", strip_comment(ln))]
        self.assertEqual(len(perms), 1, f"`permissions:` lines: {perms}")
        self.assertTrue(perms[0].startswith("permissions:"), "`permissions:` is not at the top level")
        value, body = top_block(self.text, "permissions")
        held = [ln.strip() for ln in body] if value == "" else [
            v.strip() for v in value.strip("{}").split(",") if v.strip()]
        self.assertEqual([re.sub(r"\s*:\s*", ": ", h) for h in held], ["contents: read"], "permissions")
        self.assertNotIn("secrets.", self.text)
        names = set(re.findall(r"AWS_[A-Za-z0-9_]*", self.text))
        self.assertLessEqual(names, {"AWS_EC2_METADATA_DISABLED"}, "AWS_ names")

    def test_actions_pinned_and_no_event_text(self):
        uses = [unquote(strip_comment(m)) for m in re.findall(r"^\s*(?:- )?uses:(.*)$", self.text, re.M)]
        for u in uses:
            self.assertRegex(u, r"^actions/(checkout|setup-node)@[0-9a-f]{40}$")
        self.assertNotIn("github.event", self.text)

    def test_the_nine_commands(self):
        last = -1
        for name, folder, argv in nine():
            self.assertIn(name, self.by_name, f"no step named {name}")
            i = self.by_name[name]
            self.assertGreater(i, last, f"{name} is not in pm-check's order")
            last = i
            step = self.steps[i]
            self.assertEqual(step_key(step, "working-directory"), folder, f"{name}: working-directory")
            self.assertEqual(step_key(step, "run"), expected_run(name, folder, argv), f"{name}: run")
            self.assertIn("!cancelled()", step_key(step, "if") or "", f"{name}: if")

    def test_second_runs(self):
        retry = pm_check_literals()["RETRY"]
        names = [n for n, _f, _a in nine()]
        retried = [n for n in names if n in retry]
        for name in retried:
            self.assertIn(name, self.by_name, f"no step named {name}")
            i = self.by_name[name]
            first = self.steps[i]
            self.assertEqual(step_key(first, "continue-on-error"), "true", f"{name}: continue-on-error")
            sid = step_key(first, "id")
            self.assertTrue(sid, f"{name}: no id")
            self.assertLess(i + 1, len(self.steps), f"no step after {name}")
            second = self.steps[i + 1]
            self.assertEqual(second["name"], f"{name} (second run)", f"the step after {name}")
            a, b = shlex.split(step_key(first, "run") or ""), shlex.split(step_key(second, "run") or "")
            self.assertIn("--", a, f"{name}: run has no --")
            self.assertIn("--", b, f"{name} (second run): run has no --")
            ia, ib = a.index("--"), b.index("--")
            self.assertEqual(b[ib:], a[ia:], f"{name} (second run): not the same command")
            opts = b[:ib]
            pair = [j for j in range(len(opts) - 1) if opts[j] == "--second" and opts[j + 1] == name]
            self.assertEqual(len(pair), 1, f"{name} (second run): no --second {name} before --")
            j = pair[0]
            self.assertEqual(opts[:j] + opts[j + 2:], a[:ia], f"{name} (second run): not the same run plus --second")
            self.assertIn(f"steps.{sid}.outcome == 'failure'", step_key(second, "if") or "", f"{name} (second run): if")
        with_coe = [s["name"] for s in self.steps if step_key(s, "continue-on-error") is not None]
        self.assertEqual(sorted(with_coe), sorted(retried), "steps with continue-on-error")
        seconds = [s["name"] for s in self.steps if s["name"].endswith("(second run)")]
        self.assertEqual(sorted(seconds), sorted(f"{n} (second run)" for n in retried), "second-run steps")
        self.assertNotIn("harness-test", [s["name"] for s in self.steps])

    def test_not_run_step_first(self):
        first = self.by_name.get(nine()[0][0])
        self.assertIsNotNone(first, f"no step named {nine()[0][0]}")
        at = [i for i, s in enumerate(self.steps) if ".github/ci not-run" in (step_key(s, "run") or "")]
        self.assertTrue(at, "no step runs .github/ci not-run")
        self.assertLess(at[0], first, ".github/ci not-run does not run before the first of the nine")


class List(unittest.TestCase):
    def setUp(self):
        for f in (CI, NOT_RUN):
            if not f.exists():
                self.fail(f"{f} does not exist")

    def test_the_list_passes_ci(self):
        env = {k: v for k, v in clean_env().items() if k != "GITHUB_STEP_SUMMARY"}
        p = subprocess.run([str(CI), "not-run"], capture_output=True, text=True, env=env, cwd=str(CHECKOUT), timeout=120)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_entries_have_open_issues(self):
        data = json.loads(NOT_RUN.read_text())
        open_ids = set()
        for f in OPEN_ISSUES.glob("*.md"):
            m = re.search(r"^Issue-Id:\s*(\d+)\s*$", f.read_text(), re.M)
            if m:
                open_ids.add(int(m.group(1)))
        checks = data.get("checks", [])
        for entry in checks:
            issue = entry.get("issue")
            self.assertTrue(isinstance(issue, int) and not isinstance(issue, bool),
                            f"{entry.get('id')}: issue is not an integer")
            self.assertIn(issue, open_ids, f"{entry.get('id')}: issue {issue} has no file under {OPEN_ISSUES}")
        if PRODUCT_ISSUE in open_ids:
            listed = {e.get("id"): e.get("issue") for e in checks}
            product = [json.loads(ln)["check_id"] for ln in MANIFEST.read_text().splitlines() if ln.strip()]
            product = [c for c in product if c.startswith("engine.product-")]
            self.assertTrue(product, "the manifest has no engine.product- id")
            for cid in product:
                self.assertEqual(listed.get(cid), PRODUCT_ISSUE, f"{cid} is not in checks with issue {PRODUCT_ISSUE}")


if __name__ == "__main__":
    unittest.main()
