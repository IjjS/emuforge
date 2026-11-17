"""pm-emulator-dir and its callers: which port folder under ~/.aws/emulator is removed, which is refused (issue 49).

Check id `harness.emulator-dir`. One class per heading of the issue's test criteria.

Every case runs on a fixture checkout (`_fixture.make`) that holds copies of the scripts under test, so the
fixture's `.pm/run` is the registry and the log. Every script runs with HOME=<fixture>/home: the emulator
directory is <fixture>/home/.aws/emulator and no case touches the real one. A stand-in `docker` is first on PATH:
it answers `ps -aq` with the ids of the containers its `docker.json` lists and `inspect` with one line per
container in Docker's compact form (`/name status {"<p>/tcp":[{"HostIp":"127.0.0.1","HostPort":"<p>"}]}`), or
fails or sleeps when the case says so, and records its arguments and the names of its environment variables in
`calls.jsonl`. It finds those files beside itself, because pm-emulator-dir passes docker only an allowlist of
variables. A listener is a real socket the case holds on a loopback port. Ports are free loopback ports the case
draws, outside 9297 and the ranges pm-worktree gives, unless the case names the port.

On a checkout without .pm/bin/pm-emulator-dir every case fails at once, saying so.
"""
import json
import os
import pathlib
import re
import shutil
import socket
import sys
import time
import unittest
import uuid

from _fixture import BIN, clean_env, git, make, run

SCRIPT = "pm-emulator-dir"
PREFIX = "pm-emulator-dir: "
OWNER = 9297
TAKEN = {OWNER, *range(8100, 8200), *range(8300, 8400), *range(9300, 9400)}  # the owner's and pm-worktree's ports

STAND_IN = r'''#!@PYTHON@ -I
"""Stand-in docker for the tests of pm-emulator-dir; reads docker.json beside it, records each call."""
import json, os, pathlib, sys, time
here = pathlib.Path(__file__).resolve().parent
spec = json.loads((here / "docker.json").read_text())
with open(here / "calls.jsonl", "a") as f:
    f.write(json.dumps({"args": sys.argv[1:], "env": sorted(os.environ)}) + "\n")
if spec.get("sleep"):
    time.sleep(spec["sleep"])
if spec.get("fail"):
    sys.exit(1)
cmd = sys.argv[1:2]
if cmd == ["ps"]:
    if spec.get("ps_exit"):
        sys.exit(spec["ps_exit"])
    for c in spec["containers"]:
        print(c["id"])
elif cmd == ["inspect"]:
    count = here / "inspect-count"
    n = int(count.read_text()) if count.exists() else 0
    count.write_text(str(n + 1))
    if spec.get("inspect_fail") == "always" or (spec.get("inspect_fail") == "first" and n == 0):
        print("Error: No such object", file=sys.stderr)
        sys.exit(1)
    if "inspect_lines" in spec:
        print("\n".join(spec["inspect_lines"]))
        sys.exit(0)
    for c in spec["containers"]:
        if c["id"] in sys.argv[2:]:
            print(c["name"], c["status"], json.dumps(c["bindings"], separators=(",", ":")))
else:
    sys.exit(1)
'''


def binding(port, host_port=None):
    """Docker's PortBindings for container port `port` published on `host_port` (default: the same)."""
    return {f"{port}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(host_port or port)}]}


def container(name, status, bindings):
    return dict(id=uuid.uuid4().hex + uuid.uuid4().hex, name=f"/{name}", status=status, bindings=bindings)


def snapshot(path):
    """What "kept" compares: the kind of the path and, for a directory, every entry under it (links not followed)."""
    path = pathlib.Path(path)
    if path.is_symlink():
        return ("link", os.readlink(path))
    if path.is_dir():
        entries = []
        for top, dirs, files in os.walk(path):
            rel = os.path.relpath(top, path)
            entries += [os.path.join(rel, n) for n in dirs + files]
        return ("dir", sorted(entries))
    if path.exists():
        return ("file", path.read_bytes())
    return None


def names(line, path):
    """True when `line` names `path` exactly (not a longer path that starts with it)."""
    return re.search(re.escape(str(path)) + r"(?![\w.-])", line) is not None


class Case(unittest.TestCase):
    """A fixture checkout with a made-up home, a stand-in docker, and helpers to drive pm-emulator-dir."""

    scripts = (SCRIPT, "_pmlib.py")

    def setUp(self):
        if not (BIN / SCRIPT).exists():
            self.fail(f"{BIN / SCRIPT} does not exist")
        case = f"{type(self).__name__}-{self._testMethodName}".lower().replace("_", "-")
        self.co = make("emulator-dir", case, self.scripts)
        for sibling in self.co.parent.glob(f"{self.co.name}-[0-9]*-*"):  # worktrees of an earlier run of this case
            shutil.rmtree(sibling)
        self.home = self.co / "home"
        self.emu = self.home / ".aws" / "emulator"
        self.emu.mkdir(parents=True)
        self.outside = self.co / "output" / "outside"
        self.stub = self.co / "output" / "stub-bin"
        self.stub.mkdir(parents=True)
        (self.stub / "docker").write_text(STAND_IN.replace("@PYTHON@", sys.executable))
        (self.stub / "docker").chmod(0o755)
        self.docker()
        self.drawn = set()
        self.registry_path = self.co / ".pm" / "run" / "worktrees.json"
        self.events = self.co / ".pm" / "run" / "events.log"
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)

    # ---- environment

    def docker(self, containers=(), **behavior):
        """What the stand-in docker answers: `containers`, or fail=True, ps_exit, inspect_fail, inspect_lines, sleep."""
        (self.stub / "docker.json").write_text(json.dumps(dict(containers=list(containers), **behavior)))
        for f in ("calls.jsonl", "inspect-count"):
            (self.stub / f).unlink(missing_ok=True)

    def calls(self):
        f = self.stub / "calls.jsonl"
        return [json.loads(ln) for ln in f.read_text().splitlines()] if f.exists() else []

    def env(self, path=None, **extra):
        env = {**clean_env(), "HOME": str(self.home), **extra}
        env["PATH"] = path or f"{self.stub}{os.pathsep}{env.get('PATH', '')}"
        return env

    def no_docker_path(self):
        """A PATH that finds python3 (for the script's shebang) and no docker."""
        d = self.co / "output" / "no-docker-bin"
        d.mkdir(parents=True, exist_ok=True)
        (d / "python3").write_text(f'#!/bin/sh\nexec "{sys.executable}" "$@"\n')
        (d / "python3").chmod(0o755)
        return str(d)

    def run_script(self, *args, env=None, timeout=60):
        return run(self.co, SCRIPT, *args, env=env or self.env(), timeout=timeout)

    def port(self):
        """A free loopback port outside the owner's and pm-worktree's, not drawn before in this case."""
        while True:
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                p = s.getsockname()[1]
            if p not in TAKEN and p not in self.drawn:
                self.drawn.add(p)
                return p

    def listener(self):
        """A socket listening on a free loopback port for the rest of the case; returns the port."""
        while True:
            s = socket.socket()
            s.bind(("127.0.0.1", 0))
            p = s.getsockname()[1]
            if p in TAKEN or p in self.drawn:
                s.close()
                continue
            s.listen()
            self.addCleanup(s.close)
            self.drawn.add(p)
            return p

    # ---- the emulator directory

    def folder(self, port, files=0, marker=""):
        """The port folder with `files` files; `marker` goes into their names and contents."""
        d = self.emu / str(port)
        d.mkdir(parents=True, exist_ok=True)
        for i in range(files):
            (d / f"file{i}{marker}").write_text(f"content {i} {marker}\n")
        return d

    def four_files(self, port):
        d = self.folder(port)
        for n in ("ca.pem", "config", "emulator_credentials", "truststore.p12"):
            (d / n).write_text("fixture\n")
            (d / n).chmod(0o600)
        return d

    def outside_dir(self):
        self.outside.mkdir(parents=True, exist_ok=True)
        (self.outside / "keep.txt").write_text("outside\n")
        return self.outside

    def locked(self, parent, marker=""):
        """A subdirectory of `parent` without write permission that holds a file, restored when the case ends."""
        sub = parent / f"locked{marker}"
        sub.mkdir()
        (sub / f"inner{marker}").write_text(f"inner {marker}\n")
        sub.chmod(0o500)
        self.addCleanup(lambda: sub.exists() and sub.chmod(0o700))
        return sub

    def state(self):
        """Snapshot of every entry of the emulator directory and of the outside directory."""
        entries = {n: snapshot(self.emu / n) for n in os.listdir(self.emu)} if self.emu.exists() else None
        return entries, snapshot(self.outside)

    # ---- the registry

    def register(self, port, name="w", issue="3", unit="h1", registry_port=None, ports_json=None, **entry):
        """A registered worktree W: a registry entry and a directory whose output/ports.json names the port."""
        path = self.co / "output" / f"wt-{name}"
        (path / "output").mkdir(parents=True, exist_ok=True)
        text = json.dumps(dict(studio=8100, engine=8300, emulator=port)) if ports_json is None else ports_json
        if text is not False:
            (path / "output" / "ports.json").write_text(text)
        wts = json.loads(self.registry_path.read_text()) if self.registry_path.exists() else []
        wts.append(dict(name=name, path=str(path), issue=issue, unit=unit, branch=f"feat/{issue}-{unit}",
                        base="main", ports=dict(studio=8100, engine=8300,
                                                emulator=port if registry_port is None else registry_port), **entry))
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        self.registry_path.write_text(json.dumps(wts))
        return path

    # ---- assertions

    def lines(self, p):
        return [ln for ln in p.stdout.splitlines() if ln.startswith(PREFIX)]

    def assertExit(self, p, code):
        self.assertEqual(p.returncode, code, f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")

    def assertOneLine(self, p, start):
        """Exactly one line, and it starts with PREFIX + `start`; returns it."""
        lines = self.lines(p)
        self.assertEqual(len(lines), 1, p.stdout + p.stderr)
        self.assertTrue(lines[0].startswith(PREFIX + start), f"{lines[0]!r} does not start with {PREFIX + start!r}")
        return lines[0]

    def assertKept(self, before):
        self.assertEqual(self.state(), before)

    def assertFormRefusal(self, line):
        """A refusal of the port's form or of output/ports.json: it did not reach the in-use step, whatever runs on
        the machine's ports."""
        for word in ("in use", "127.0.0.1", "docker"):
            self.assertNotIn(word, line)
        self.assertEqual(self.calls(), [])


# ---------------------------------------------------------------------------------------------- rm --worktree

class RmWorktree(Case):
    def test_empty_folder_is_removed_and_nothing_else(self):
        """regression, R1"""
        p, other = self.port(), self.port()
        w = self.register(p)
        f = self.folder(p)
        self.folder(other, files=2)
        self.folder("telemetry", files=1)
        self.folder(OWNER, files=2)
        before = {n: snapshot(self.emu / n) for n in (str(other), "telemetry", str(OWNER))}
        r = self.run_script("rm", "--worktree", w)
        self.assertExit(r, 0)
        self.assertEqual(self.lines(r), [f"{PREFIX}removed {f} (empty)"])
        self.assertFalse(os.path.lexists(f))
        self.assertEqual({n: snapshot(self.emu / n) for n in before}, before)

    def test_folder_of_a_killed_emulator_is_removed_by_name(self):
        """R1, a killed emulator: the four files"""
        p = self.port()
        self.register(p, name="w-killed")
        f = self.four_files(p)
        r = self.run_script("rm", "--worktree", "w-killed")
        self.assertExit(r, 0)
        self.assertEqual(self.lines(r), [f"{PREFIX}removed {f} (not empty)"])
        self.assertFalse(os.path.lexists(f))

    def test_absent_folder_needs_no_docker(self):
        """R1, design 1.1 step 4"""
        p = self.port()
        w = self.register(p)
        self.folder(self.port(), files=1)
        self.docker(fail=True)
        before = self.state()
        r = self.run_script("rm", "--worktree", w)
        self.assertExit(r, 0)
        self.assertEqual(self.lines(r), [f"{PREFIX}nothing to remove: {self.emu / str(p)} does not exist"])
        self.assertKept(before)

    def test_twice_is_the_same_as_once(self):
        """R1"""
        p = self.port()
        w = self.register(p)
        f = self.folder(p, files=1)
        first, second = self.run_script("rm", "--worktree", w), self.run_script("rm", "--worktree", w)
        self.assertExit(first, 0)
        self.assertExit(second, 0)
        self.assertEqual(self.lines(first), [f"{PREFIX}removed {f} (not empty)"])
        self.assertEqual(self.lines(second), [f"{PREFIX}nothing to remove: {f} does not exist"])

    def test_directory_not_in_the_registry_is_refused(self):
        """R3 d"""
        p = self.port()
        stray = self.co / "output" / "stray"
        (stray / "output").mkdir(parents=True)
        (stray / "output" / "ports.json").write_text(json.dumps(dict(emulator=p)))
        self.register(self.port())  # a registry that exists and does not hold `stray`
        self.folder(p, files=1)
        before = self.state()
        r = self.run_script("rm", "--worktree", stray)
        self.assertExit(r, 1)
        self.assertOneLine(r, "refused worktree ")
        self.assertKept(before)

    def test_unusable_ports_json_is_refused(self):
        """R3 d, R4"""
        variants = {
            "missing": False,
            "not json": "{emulator: 9302",
            "without emulator": json.dumps(dict(studio=8100, engine=8300)),
            "string": json.dumps(dict(emulator="9302")),
            "dotdot": json.dumps(dict(emulator="../9302")),
            "zero": json.dumps(dict(emulator=0)),
            "65536": json.dumps(dict(emulator=65536)),
            "true": json.dumps(dict(emulator=True)),
            "float": '{"emulator": 9302.0}',
        }
        self.folder(9302, files=1)
        self.folder(9303, files=1)
        (self.home / ".aws" / "9302").mkdir()
        for i, (label, text) in enumerate(variants.items()):
            with self.subTest(label):
                self.registry_path.unlink(missing_ok=True)
                w = self.register(9302, name=f"w{i}", ports_json=text)
                before = self.state(), snapshot(self.home / ".aws" / "9302")
                self.docker()
                r = self.run_script("rm", "--worktree", w)
                self.assertExit(r, 1)
                self.assertFormRefusal(self.assertOneLine(r, "refused "))
                self.assertEqual((self.state(), snapshot(self.home / ".aws" / "9302")), before)

    def test_ports_json_differing_from_the_registry_is_refused(self):
        """R3 d"""
        p, q = self.port(), self.port()
        w = self.register(q, registry_port=p)
        self.folder(p, files=1)
        self.folder(q, files=1)
        before = self.state()
        r = self.run_script("rm", "--worktree", w)
        self.assertExit(r, 1)
        self.assertOneLine(r, "refused ")
        self.assertKept(before)

    def test_owners_port_is_refused(self):
        """R3 a"""
        w = self.register(OWNER)
        self.folder(OWNER, files=2)
        before = self.state()
        r = self.run_script("rm", "--worktree", w)
        self.assertExit(r, 1)
        line = self.assertOneLine(r, f"refused port {OWNER}: ")
        self.assertIn("owner", line.split(f"refused port {OWNER}: ", 1)[1].lower())
        self.assertKept(before)


# ------------------------------------------------------------------------------------------------- rm --port

class RmPort(Case):
    def test_folder_is_removed_and_its_siblings_kept(self):
        """R2"""
        p = self.port()
        f = self.folder(p, files=2)
        self.folder(self.port(), files=1)
        self.folder("telemetry", files=1)
        self.folder(OWNER, files=1)
        before = {n: v for n, v in self.state()[0].items() if n != str(p)}
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 0)
        self.assertEqual(self.lines(r), [f"{PREFIX}removed {f} (not empty)"])
        self.assertFalse(os.path.lexists(f))
        self.assertEqual(self.state()[0], before)

    def test_port_65535(self):
        """boundary"""
        f = self.folder(65535, files=1)
        r = self.run_script("rm", "--port", 65535)
        self.assertExit(r, 0)
        self.assertFalse(os.path.lexists(f))

    def test_owners_port_is_refused_before_docker(self):
        """R3 a, step 2 before 6"""
        self.folder(OWNER, files=2)
        before = self.state()
        r = self.run_script("rm", "--port", OWNER)
        self.assertExit(r, 1)
        line = self.assertOneLine(r, f"refused port {OWNER}: ")
        self.assertIn("owner", line.split(f"refused port {OWNER}: ", 1)[1].lower())
        self.assertKept(before)
        self.assertEqual(self.calls(), [])

    def test_a_registered_worktrees_port_goes_through_worktree(self):
        """R2"""
        p = self.port()
        self.register(p, name="w-owns-it")
        self.folder(p, files=1)
        before = self.state()
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 1)
        line = self.assertOneLine(r, "refused ")
        self.assertIn("w-owns-it", line)
        self.assertIn("--worktree", line)
        self.assertKept(before)

    def test_argument_that_is_not_a_port_is_refused(self):
        """R3 d, R4"""
        self.folder(9302, files=1)
        self.folder(9303, files=1)
        (self.home / ".aws" / "9302").mkdir()
        d = self.outside_dir()
        for x in ("0", "65536", "09302", "9302 ", "+9302", "9302/../9303", "../9302", str(d), ""):
            with self.subTest(repr(x)):
                before = self.state(), snapshot(self.home / ".aws" / "9302")
                self.docker()
                r = self.run_script("rm", "--port", x)
                self.assertExit(r, 1)
                self.assertFormRefusal(self.assertOneLine(r, "refused "))
                self.assertEqual((self.state(), snapshot(self.home / ".aws" / "9302")), before)

    def test_registry_that_is_not_a_list_is_refused(self):
        """D 1.1"""
        p = self.port()
        self.folder(p, files=1)
        for label, text in (("object", json.dumps(dict(name="w", ports=dict(emulator=p)))), ("not json", "[{")):
            with self.subTest(label):
                self.registry_path.write_text(text)
                before = self.state()
                r = self.run_script("rm", "--port", p)
                self.assertExit(r, 1)
                line = self.assertOneLine(r, "refused ")
                self.assertIn("registry unreadable", line)
                self.assertKept(before)

    def test_no_registry_means_no_worktree(self):
        """D 1.1, pair of the case above"""
        p = self.port()
        f = self.folder(p, files=1)
        self.registry_path.unlink(missing_ok=True)
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 0)
        self.assertOneLine(r, f"removed {f}")
        self.assertFalse(os.path.lexists(f))


# ---------------------------------------------------------------------------------------------------- in use

class InUse(Case):
    def refused(self, p, contains, **run):
        before = self.state()
        r = self.run_script("rm", "--port", p, **run)
        self.assertExit(r, 1)
        line = self.assertOneLine(r, f"refused port {p}: ")
        self.assertIn(contains, line)
        self.assertKept(before)
        return r

    def test_listener_on_loopback(self):
        """R3 b"""
        p = self.listener()
        self.folder(p, files=2)
        self.refused(p, f"127.0.0.1:{p}")

    def test_container_bound_in_any_state(self):
        """R3 b"""
        p = self.port()
        self.folder(p, files=2)
        for status in ("running", "exited", "created"):
            with self.subTest(status):
                c = container(f"i49-fixture-{status}", status, binding(p))
                self.docker([container("i49-fixture-other", "running", binding(self.port())), c])
                self.refused(p, c["name"].lstrip("/"))

    def test_containers_bound_elsewhere_or_not_at_all(self):
        """R3 b, pair"""
        p = self.port()
        f = self.folder(p, files=2)
        self.docker([container("i49-fixture-elsewhere", "running", binding(p, host_port=self.port())),
                     container("i49-fixture-empty", "exited", {}),
                     container("i49-fixture-null", "created", None)])
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 0)
        self.assertOneLine(r, f"removed {f}")
        self.assertFalse(os.path.lexists(f))

    def test_no_docker_on_path(self):
        """R3 c"""
        p = self.port()
        self.folder(p, files=2)
        self.refused(p, "docker does not answer", env=self.env(path=self.no_docker_path()))

    def test_ps_fails(self):
        """R3 c"""
        p = self.port()
        self.folder(p, files=2)
        self.docker([container("i49-fixture", "running", binding(self.port()))], ps_exit=1)
        self.refused(p, "docker does not answer")

    def test_inspect_fails_every_time(self):
        """D 1.3"""
        p = self.port()
        self.folder(p, files=2)
        self.docker([container("i49-fixture", "running", binding(self.port()))], inspect_fail="always")
        self.refused(p, "docker does not answer")

    def test_inspect_fails_once_then_answers(self):
        """D 1.3, one retry"""
        p = self.port()
        f = self.folder(p, files=2)
        self.docker([container("i49-fixture", "running", binding(self.port()))], inspect_fail="first")
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 0)
        self.assertOneLine(r, f"removed {f}")
        self.assertFalse(os.path.lexists(f))

    def test_inspect_line_that_is_not_json(self):
        """D 1.3"""
        p = self.port()
        self.folder(p, files=2)
        self.docker([container("i49-fixture", "running", binding(self.port()))],
                    inspect_lines=["/i49-fixture running not-json"])
        self.refused(p, "docker does not answer")

    def test_docker_that_does_not_answer_times_out(self):
        """L1"""
        p = self.port()
        self.folder(p, files=2)
        self.docker(sleep=30)
        start = time.monotonic()
        r = self.refused(p, "docker does not answer")
        self.assertLess(time.monotonic() - start, 25)
        self.assertIn("timeout", self.lines(r)[0])

    def test_docker_gets_no_aws_variable_and_fixed_arguments(self):
        """P1, P2"""
        p = self.port()
        self.folder(p, files=2)
        cs = [container("i49-fixture-a", "running", binding(self.port())), container("i49-fixture-b", "exited", {})]
        self.docker(cs)
        r = self.run_script("rm", "--port", p, env=self.env(AWS_PROFILE="fixture", AWS_ACCESS_KEY_ID="AKIAFIXTURE"))
        self.assertExit(r, 0)
        calls = self.calls()
        self.assertTrue(calls)
        for c in calls:
            self.assertEqual([n for n in c["env"] if n.startswith("AWS_")], [], c["env"])
        self.assertEqual(len(calls), 2, calls)
        self.assertEqual(calls[0]["args"], ["ps", "-aq", "--no-trunc"])
        self.assertEqual(calls[1]["args"][0], "inspect", calls[1])
        self.assertEqual(calls[1]["args"][-len(cs):], [c["id"] for c in cs], calls[1])


# ---------------------------------------------------------------------------------------------------- safety

class Safety(Case):
    def test_folder_that_is_a_link_is_refused(self):
        """R3 e"""
        p = self.port()
        d = self.outside_dir()
        os.symlink(d, self.emu / str(p))
        before = self.state()
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 1)
        self.assertOneLine(r, "refused ")
        self.assertKept(before)
        self.assertTrue((d / "keep.txt").exists())

    def test_folder_that_is_a_file_is_refused(self):
        """R3 e"""
        p = self.port()
        (self.emu / str(p)).write_text("a file named as a port\n")
        before = self.state()
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 1)
        self.assertOneLine(r, "refused ")
        self.assertKept(before)

    def test_link_inside_a_folder_is_removed_as_a_link(self):
        """R4"""
        p = self.port()
        d = self.outside_dir()
        f = self.folder(p, files=1)
        os.symlink(d, f / "to-outside")
        before = snapshot(d)
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 0)
        self.assertOneLine(r, f"removed {f}")
        self.assertFalse(os.path.lexists(f))
        self.assertEqual(snapshot(d), before)

    def test_credentials_and_config_are_untouched(self):
        """C1"""
        aws = self.home / ".aws"
        decoys = {aws / "credentials": "[default]\naws_access_key_id = DECOY\n", aws / "config": "[default]\n"}
        for f, text in decoys.items():
            f.write_text(text)
        p, q = self.port(), self.port()
        self.folder(p, files=1)
        self.folder(q, files=1)
        before = {f: (f.read_bytes(), f.stat().st_mtime_ns) for f in decoys}
        entries = sorted(os.listdir(aws))
        self.assertExit(self.run_script("rm", "--port", p), 0)
        self.assertExit(self.run_script("orphans", "--remove"), 0)
        self.assertFalse(os.path.lexists(self.emu / str(q)))
        self.assertEqual({f: (f.read_bytes(), f.stat().st_mtime_ns) for f in decoys}, before)
        self.assertEqual(sorted(os.listdir(aws)), entries)

    def marked(self):
        marker = "mk" + uuid.uuid4().hex
        self.assertNotIn(marker, str(self.co))
        return marker

    def assertNoMarker(self, r, marker, stderr=True):
        self.assertNotIn(marker, r.stdout)
        if stderr:
            self.assertNotIn(marker, r.stderr)
        self.assertNotIn(marker, self.events.read_text() if self.events.exists() else "")

    def test_nothing_from_inside_on_removal(self):
        """R5"""
        marker = self.marked()
        p = self.port()
        self.folder(p, files=3, marker=marker)
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 0)
        self.assertNoMarker(r, marker)

    def test_nothing_from_inside_on_refusal(self):
        """R5"""
        marker = self.marked()
        p = self.listener()
        self.folder(p, files=3, marker=marker)
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 1)
        self.assertOneLine(r, f"refused port {p}: ")
        self.assertNoMarker(r, marker)

    def test_nothing_from_inside_when_a_removal_fails(self):
        """R5, design 1.4"""
        marker = self.marked()
        p = self.port()
        f = self.folder(p, files=2, marker=marker)
        self.locked(f, marker=marker)
        r = self.run_script("rm", "--port", p)
        self.assertExit(r, 1)
        self.assertOneLine(r, f"failed {f}: EACCES")
        self.assertEqual(r.stderr, "")
        self.assertNoMarker(r, marker, stderr=False)

    def logged(self):
        """The lines of the fixture's events.log written by pm-emulator-dir, without their timestamp."""
        text = self.events.read_text() if self.events.exists() else ""
        rest = [ln.split(" ", 1)[1] if " " in ln else "" for ln in text.splitlines()]
        return [ln for ln in rest if ln.startswith("emulator-dir ")]

    def test_rm_logs_a_removal_and_a_refusal(self):
        """R10"""
        self.events.unlink(missing_ok=True)
        p = self.port()
        w = self.register(p)
        self.folder(p, files=1)
        self.folder(OWNER, files=1)
        self.assertExit(self.run_script("rm", "--worktree", w), 0)
        self.assertExit(self.run_script("rm", "--port", OWNER), 1)
        lines = self.logged()
        self.assertEqual(len(lines), 2, lines)
        removed, refused = lines
        self.assertTrue(removed.startswith("emulator-dir rm"), removed)
        self.assertRegex(removed, rf"\b{p}\b")
        self.assertTrue(removed.endswith("removed"), removed)
        self.assertTrue(refused.startswith("emulator-dir rm"), refused)
        self.assertRegex(refused, rf"\b{OWNER}\b")
        self.assertIn("refused:", refused)

    def test_orphans_remove_logs_with_its_mode(self):
        """R10, the caller's mode"""
        self.events.unlink(missing_ok=True)
        p = self.port()
        self.folder(p)
        self.assertExit(self.run_script("orphans", "--remove"), 0)
        lines = self.logged()
        self.assertEqual(len(lines), 1, lines)
        self.assertTrue(lines[0].startswith("emulator-dir orphans"), lines[0])
        self.assertRegex(lines[0], rf"\b{p}\b")
        self.assertTrue(lines[0].endswith("removed"), lines[0])

    def test_absent_folder_is_not_logged(self):
        """design 1.4"""
        self.events.write_text("")
        r = self.run_script("rm", "--port", self.port())
        self.assertExit(r, 0)
        self.assertEqual(self.events.read_text(), "")


# --------------------------------------------------------------------------------------------------- orphans

class Orphans(Case):
    def setUp(self):
        super().setUp()
        self.folder(OWNER, files=2)
        self.w_port = self.port()
        self.register(self.w_port)
        self.w_folder = self.folder(self.w_port, files=1)
        self.L = self.folder(self.listener(), files=1)
        c_port = self.port()
        self.C = self.folder(c_port, files=1)
        self.docker([container("i49-fixture-bound", "running", binding(c_port))])
        self.F = self.emu / str(self.port())
        self.F.write_text("a file named as a port\n")
        self.S = self.emu / str(self.port())
        os.symlink(self.outside_dir(), self.S)
        self.E = self.folder(self.port())
        self.N = self.folder(self.port(), files=2)
        for n in ("telemetry", "0", "09302", "70000"):
            self.folder(n, files=1)
        self.ignored = [self.emu / str(OWNER), self.w_folder] + [self.emu / n for n in ("telemetry", "0", "09302", "70000")]

    def test_list(self):
        """R9"""
        before = self.state()
        r = self.run_script("orphans")
        self.assertExit(r, 0)
        lines = self.lines(r)
        self.assertEqual([ln for ln in lines if ln.startswith(PREFIX + "orphan ")],
                         [f"{PREFIX}orphan {self.E} (empty)", f"{PREFIX}orphan {self.N} (not empty)"]
                         if int(self.E.name) < int(self.N.name) else
                         [f"{PREFIX}orphan {self.N} (not empty)", f"{PREFIX}orphan {self.E} (empty)"])
        for path in (self.L, self.C, self.F, self.S):
            skipped = [ln for ln in lines if ln.startswith(f"{PREFIX}skipped {path}: ")]
            self.assertEqual(len(skipped), 1, (path, lines))
            self.assertTrue(skipped[0].split(f"skipped {path}: ", 1)[1].strip(), skipped[0])
        for path in self.ignored:
            self.assertEqual([ln for ln in lines if names(ln, path)], [], path)
        self.assertKept(before)

    def test_remove(self):
        """R9"""
        entries, outside = self.state()
        r = self.run_script("orphans", "--remove")
        self.assertExit(r, 0)
        lines = self.lines(r)
        for path in (self.E, self.N):
            self.assertFalse(os.path.lexists(path))
            self.assertEqual(len([ln for ln in lines if ln.startswith(f"{PREFIX}removed {path}")]), 1, lines)
        self.assertEqual(self.state(), ({n: v for n, v in entries.items() if n not in (self.E.name, self.N.name)},
                                        outside))

    def test_remove_with_a_failure(self):
        """R9"""
        self.locked(self.N)
        entries, outside = self.state()
        r = self.run_script("orphans", "--remove")
        self.assertExit(r, 1)
        self.assertEqual(len([ln for ln in self.lines(r) if ln.startswith(f"{PREFIX}failed {self.N}")]), 1, r.stdout)
        self.assertFalse(os.path.lexists(self.E))
        after, outside_after = self.state()
        self.assertEqual({n: v for n, v in after.items() if n != self.N.name},
                         {n: v for n, v in entries.items() if n not in (self.E.name, self.N.name)})
        self.assertEqual(outside_after, outside)

    def test_docker_does_not_answer(self):
        """R9"""
        self.docker(fail=True)
        before = self.state()
        for args in (("orphans",), ("orphans", "--remove")):
            with self.subTest(args):
                r = self.run_script(*args)
                self.assertExit(r, 1)
                lines = self.lines(r)
                self.assertTrue(any(ln.startswith(PREFIX + "refused orphans: docker does not answer") for ln in lines),
                                lines)
                self.assertEqual([ln for ln in lines if ln.startswith(PREFIX + "orphan ")], [])
                self.assertKept(before)

    def test_registry_that_is_not_a_list(self):
        """D 1.1"""
        self.registry_path.write_text(json.dumps(dict(name="w")))
        before = self.state()
        r = self.run_script("orphans", "--remove")
        self.assertExit(r, 1)
        self.assertTrue(any(ln.startswith(PREFIX + "refused orphans: registry unreadable") for ln in self.lines(r)),
                        r.stdout)
        self.assertKept(before)


class NoOrphans(Case):
    """Orphans, given no emulator directory and separately one that holds only 9297 and telemetry."""

    def test_no_candidate_needs_no_docker(self):
        """R9, design 1.2 steps 1 and 3"""
        shutil.rmtree(self.home / ".aws")
        self.docker(fail=True)
        for label in ("no emulator directory", "only 9297 and telemetry"):
            with self.subTest(label):
                if label != "no emulator directory":
                    self.folder(OWNER, files=1)
                    self.folder("telemetry", files=1)
                self.docker(fail=True)
                r = self.run_script("orphans")
                self.assertExit(r, 0)
                self.assertOneLine(r, "no orphan folder")
                self.assertEqual(self.calls(), [])


# ------------------------------------------------------------------------------------------------ command line

class Usage(Case):
    def test_command_lines_it_cannot_parse(self):
        """requirement section 4, exit codes"""
        p = self.port()
        self.folder(p, files=1)
        self.folder(self.port())
        w = self.register(p)
        before = self.state()
        for args in ((), ("rm",), ("rm", "--worktree", w, "--port", p), ("frobnicate",)):
            with self.subTest(args):
                r = self.run_script(*args)
                self.assertExit(r, 2)
                self.assertKept(before)


# ---------------------------------------------------------------------------------------------------- pm-merge

class Merge(Case):
    scripts = (SCRIPT, "_pmlib.py", "pm-merge")

    def setUp(self):
        super().setUp()
        self.units = {}
        self.unit("3", "t1", "main")
        self.unit("3", "h1", "feat/3-t1", review=True)
        self.unit("3", "h2", "main", review=True)
        self.unit("4", "e1", "main", review=True)
        self.main = git(self.co, "rev-parse", "main")

    def unit(self, issue, name, base, review=False, port=None):
        """A registered git worktree on feat/<issue>-<name> from `base`, one commit, a passing pm-check record, its
        port's folder with a file, and (review) a passing review-impl file."""
        wt_name = f"{self.co.name}-{issue}-{name}"
        path = self.co.parent / wt_name
        branch = f"feat/{issue}-{name}"
        git(self.co, "worktree", "add", "-q", "-b", branch, str(path), base)
        (path / f"{name}.txt").write_text(f"{name}\n")
        git(path, "add", "-A")
        git(path, "commit", "-q", "-m", name)
        port = port or self.port()
        (path / "output" / "checks").mkdir(parents=True)
        (path / "output" / "checks" / "last.json").write_text(json.dumps(
            dict(commit=git(path, "rev-parse", "HEAD"), passed=True, failed=[], flaky=[])))
        (path / "output" / "ports.json").write_text(json.dumps(dict(studio=8100, engine=8300, emulator=port)))
        wts = json.loads(self.registry_path.read_text()) if self.registry_path.exists() else []
        wts.append(dict(name=wt_name, path=str(path), issue=issue, unit=name, branch=branch, base=base,
                        ports=dict(studio=8100, engine=8300, emulator=port)))
        self.registry_path.write_text(json.dumps(wts))
        if review:
            d = self.co / ".pm" / f"issue-{issue}"
            d.mkdir(exist_ok=True)
            (d / f"review-impl-{name}-r1.md").write_text("verdict: pass\np1: 0\np2: 0\np3: 0\n---\n")
        self.units[(issue, name)] = self.folder(port, files=1)

    def merge(self, *args):
        return run(self.co, "pm-merge", *args, env=self.env())

    def folders(self):
        return {k: snapshot(f) for k, f in self.units.items()}

    def assertMerged(self, r):
        self.assertExit(r, 0)
        self.assertEqual(git(self.co, "log", "-1", "--format=%s", "main").split(" (")[0], "merge: #3 h1")
        self.assertNotEqual(git(self.co, "rev-parse", "main"), self.main)

    def test_merge_removes_the_unit_and_the_test_unit_below_it(self):
        """regression, R6"""
        kept = {k: snapshot(self.units[k]) for k in (("3", "h2"), ("4", "e1"))}
        r = self.merge(3, "h1")
        self.assertMerged(r)
        out = r.stdout.splitlines()
        merged_at = next(i for i, ln in enumerate(out) if ln.startswith("merged "))
        for k in (("3", "h1"), ("3", "t1")):
            self.assertFalse(os.path.lexists(self.units[k]), k)
            at = [i for i, ln in enumerate(out) if ln.startswith(f"{PREFIX}removed {self.units[k]}")]
            self.assertEqual(len(at), 1, (k, out))
            self.assertGreater(at[0], merged_at, out)
        self.assertEqual({k: snapshot(self.units[k]) for k in kept}, kept)

    def test_dry_run_removes_nothing(self):
        """R6"""
        before = self.folders()
        r = self.merge(3, "h1", "--dry-run")
        self.assertExit(r, 0)
        self.assertEqual(git(self.co, "rev-parse", "main"), self.main)
        self.assertEqual(self.folders(), before)

    def test_refused_merge_removes_nothing(self):
        """R6"""
        (self.co / ".pm" / "issue-3" / "review-impl-h1-r1.md").unlink()
        before = self.folders()
        r = self.merge(3, "h1")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(git(self.co, "rev-parse", "main"), self.main)
        self.assertEqual(self.folders(), before)

    def test_conflict_removes_nothing(self):
        """R6"""
        (self.co / "h1.txt").write_text("main moved\n")
        git(self.co, "add", "-A")
        git(self.co, "commit", "-q", "-m", "main moved")
        self.main = git(self.co, "rev-parse", "main")
        before = self.folders()
        r = self.merge(3, "h1")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(git(self.co, "rev-parse", "main"), self.main)
        self.assertEqual(git(self.co, "status", "--porcelain"), "")
        self.assertEqual(self.folders(), before)

    def test_refusal_does_not_change_the_merge(self):
        """R6"""
        h1 = self.units[("3", "h1")]
        listen = self.listener()
        # h1's port becomes the port the case listens on, in both places
        wts = json.loads(self.registry_path.read_text())
        for w in wts:
            if w["unit"] == "h1":
                w["ports"]["emulator"] = listen
                ports = pathlib.Path(w["path"]) / "output" / "ports.json"
                ports.write_text(json.dumps(dict(studio=8100, engine=8300, emulator=listen)))
        self.registry_path.write_text(json.dumps(wts))
        shutil.rmtree(h1)
        h1 = self.units[("3", "h1")] = self.folder(listen, files=1)
        before = snapshot(h1)
        r = self.merge(3, "h1")
        self.assertMerged(r)
        lines = self.lines(r)
        self.assertEqual(len([ln for ln in lines if ln.startswith(f"{PREFIX}refused port {listen}")]), 1, lines)
        self.assertEqual(len([ln for ln in lines if ln.startswith(f"{PREFIX}removed {self.units[('3', 't1')]}")]), 1,
                         lines)
        self.assertEqual(snapshot(h1), before)
        self.assertFalse(os.path.lexists(self.units[("3", "t1")]))

    def test_absent_folders(self):
        """R6"""
        for k in (("3", "h1"), ("3", "t1")):
            shutil.rmtree(self.units[k])
        r = self.merge(3, "h1")
        self.assertMerged(r)
        self.assertEqual(len([ln for ln in self.lines(r) if ln.startswith(PREFIX + "nothing to remove")]), 2, r.stdout)

    def test_script_that_cannot_run(self):
        """design section 3"""
        (self.co / ".pm" / "bin" / SCRIPT).chmod(0o644)
        git(self.co, "add", "-A")
        git(self.co, "commit", "-q", "-m", "pm-emulator-dir not executable")
        self.main = git(self.co, "rev-parse", "main")
        before = self.folders()
        r = self.merge(3, "h1")
        self.assertMerged(r)
        self.assertEqual(len([ln for ln in r.stdout.splitlines() if ln.startswith(PREFIX + "did not run for")]), 2,
                         r.stdout)
        self.assertEqual(self.folders(), before)


# ------------------------------------------------------------------------------------ pm-worktree rm, pm-archive

class WorktreeCase(Case):
    """A worktree made by the fixture's pm-worktree, moved to a drawn port."""

    def worktree(self):
        """`pm-worktree new 3 h1`, then a drawn port in its output/ports.json and the registry, and that port's
        folder with a file."""
        r = run(self.co, "pm-worktree", "new", 3, "h1", env=self.env())
        self.assertExit(r, 0)
        wts = json.loads(self.registry_path.read_text())
        self.assertEqual(len(wts), 1, wts)
        wt = wts[0]
        port = self.port()
        wt["ports"]["emulator"] = port
        self.registry_path.write_text(json.dumps(wts))
        ports = pathlib.Path(wt["path"]) / "output" / "ports.json"
        ports.write_text(json.dumps({**json.loads(ports.read_text()), "emulator": port}))
        return wt, self.folder(port, files=1)

    def commit_in(self, wt):
        p = pathlib.Path(wt["path"])
        (p / "h1.txt").write_text("h1\n")
        git(p, "add", "-A")
        git(p, "commit", "-q", "-m", "h1")

    def assertWorktreeGone(self, wt):
        self.assertFalse(os.path.exists(wt["path"]))
        self.assertEqual(json.loads(self.registry_path.read_text()), [])
        slots = json.loads((self.co / ".pm" / "run" / "ports.json").read_text())
        self.assertNotIn(str(wt["slot"]), slots)


class Removal(WorktreeCase):
    scripts = (SCRIPT, "_pmlib.py", "pm-worktree")

    def test_rm_of_an_unmerged_worktree_removes_its_folder(self):
        """regression, R7"""
        wt, f = self.worktree()
        self.commit_in(wt)
        r = run(self.co, "pm-worktree", "rm", wt["name"], env=self.env())
        self.assertExit(r, 0)
        self.assertEqual(len([ln for ln in self.lines(r) if ln.startswith(f"{PREFIX}removed {f}")]), 1, r.stdout)
        self.assertFalse(os.path.lexists(f))
        self.assertWorktreeGone(wt)

    def test_refusal_does_not_stop_the_removal(self):
        """R7"""
        wt, f = self.worktree()
        self.commit_in(wt)
        listen = self.listener()
        wts = json.loads(self.registry_path.read_text())
        wts[0]["ports"]["emulator"] = listen
        self.registry_path.write_text(json.dumps(wts))
        ports = pathlib.Path(wt["path"]) / "output" / "ports.json"
        ports.write_text(json.dumps({**json.loads(ports.read_text()), "emulator": listen}))
        shutil.rmtree(f)
        f = self.folder(listen, files=1)
        before = snapshot(f)
        r = run(self.co, "pm-worktree", "rm", wt["name"], env=self.env())
        self.assertExit(r, 0)
        self.assertEqual(len([ln for ln in self.lines(r) if ln.startswith(f"{PREFIX}refused port {listen}")]), 1,
                         r.stdout)
        self.assertEqual(snapshot(f), before)
        self.assertWorktreeGone(wt)


class Archive(WorktreeCase):
    scripts = tuple(sorted(f.name for f in BIN.iterdir() if f.is_file()))

    def test_archive_passes_on_the_line(self):
        """R7"""
        wt, f = self.worktree()
        self.commit_in(wt)
        git(self.co, "merge", "-q", "--no-ff", "-m", "merge h1", wt["branch"])
        calls = self.co / "output" / "herdr-calls.log"
        (self.stub / "herdr").write_text(f'#!/bin/sh\necho "$*" >> "{calls}"\n'
                                         'echo \'{"result": {"agents": [], "panes": [], "tabs": []}}\'\n')
        (self.stub / "herdr").chmod(0o755)
        r = run(self.co, "pm-archive", 3, "--yes", env=self.env(), timeout=180)
        self.assertExit(r, 0)
        self.assertEqual(len([ln for ln in self.lines(r) if ln.startswith(f"{PREFIX}removed {f}")]), 1, r.stdout)
        self.assertFalse(os.path.lexists(f))


if __name__ == "__main__":
    unittest.main()
