"""pm-emulator-image: the machine's image `aws-emulator` follows the latest package, one refresh at a time, and says
what it did (issue 68, requirement R1; test criteria `test_emulator_image`).

Check id `harness.emulator-image`. One class per heading of the test criteria.

Every case runs on a fixture checkout (`_fixture.make`) under <checkout>/output/tests/emulator-image/<case>/ that
holds copies of the script, of pm-watchd and of the helpers, so `_pmlib.ROOT` is the fixture: its `.pm/run` is the
script's and its committed `infra/aws-emulator/` is the folder built. Every script runs with HOME=<fixture>/home and
a stand-in `docker` first on PATH. No case calls the real Docker, builds a real image or uses the network.

The stand-in keeps its images in `docker.json` beside it (it finds the file beside itself, since the script passes
docker only an allowlist of variables): `images` (id -> version, commit, labels; labels null is an image whose
inspect answer has no `Labels` key at all, as Docker Desktop's containerd store answers), `names` (name:tag -> id),
`package` (the version and commit a build installs), and the case's behavior: `hang` (commands that do not return:
`info`, `inspect`, `build`, `run`, `tag`, `rm`, `builder prune`, or `all`), `fail` (command -> exit code),
`build_print` (lines a build prints) and `prune_print` (lines `builder prune` prints, `Total:\t0B` by default). It answers `info`; `image inspect` with `-f '{{.Id}}'` (one id per line) and without `-f` (Docker's
JSON array); `build`, which makes a new id with the package's version and commit and the labels of its `--label`
arguments, names it by its `--tag` and adds the id to `built`; `run … <image> --version` (`Version:`, `Release
date:`, `Commit:`; no `Version:` line for an image whose version is null); `tag`; and `image rm`, which removes a
name and, with its last name, the image; and `builder prune` (also as `buildx prune`), which prints `prune_print`
and changes nothing (issue 507). A name without a tag is `<name>:latest`. Every call is appended to
`calls.jsonl` with its arguments, its pid and the names of its environment variables; a build appends its pid and
the pid of the child it starts (when it does not return) to `builds.jsonl`. A build that does not return waits for
the file `release` beside the stand-in, which only the case about `status` during a refresh writes. The stand-in's
own interpreter adds LC_CTYPE (locale coercion) and, on macOS, __CF_USER_TEXT_ENCODING to its environment; those
two names are not counted as passed by the script.

The bounds are named constants of the script (BOUNDS below, a name chosen for the script, see decisions-needed.md);
a case about a bound lowers it in its fixture's copy, and Usage reads the shipped values. "The name" is
`aws-emulator`; "unchanged" means it names the same id as before the command. The Given of Failed holds the record
of the refresh that made the name 1.0.1, so a reason found before Docker is asked can name the version from it, as
the started line does. A refresh's pid is the pid of the process that does the work: the one the case started for
`--foreground` (the script runs as `/usr/bin/env -S python3 -I`, which keeps its pid), the started line's otherwise.

The script's output goes to files, never to a pipe a process it leaves could hold. Each case ends what it started:
first every recorded pid and the pids of the started lines, each waited for until it is gone, so no worker starts
another docker call after it; then, look after look until one finds none, any process whose command line names the
case's directory. A process still alive after that fails the case (issue 477: a `docker info` a worker started
between the look and its kill outlived the case).

On a checkout without .pm/bin/pm-emulator-image every case fails at once, saying so.
"""
import datetime as dt
import fcntl
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time
import unittest

from _fixture import BIN, clean_env, git, make

SCRIPT = "pm-emulator-image"
PREFIX = "pm-emulator-image: "
GROUP = "emulator-image"
NAME = "aws-emulator:latest"
REFRESH_NAME = re.compile(r"aws-emulator:refresh-\d+")
BOUNDS = {"READ_BOUND": 10, "IMAGE_BOUND": 30, "BUILD_BOUND": 600, "PRUNE_BOUND": 300}  # docker info, image
# inspect, git; run, tag, image rm; the build (requirement R1.3, design 1.1); builder prune (issue 507, Q3)
PRUNED = "; build cache pruned to 20GB (reclaimed 0B)"  # the clause of a refresh with the stand-in's default prune
OTHER_PRUNES = {"system prune", "image prune", "container prune", "volume prune", "network prune", "builder rm",
                "container rm", "rmi", "rm"}  # Docker calls no refresh makes (issue 507: nothing else is pruned)
LOWERED = 2       # seconds, a bound lowered in a fixture's copy
SLACK = 20        # seconds after a bound within which the command has ended
RETURNS_WITHIN = 5  # seconds, R1.1
WAIT = 60         # seconds a case waits for a background refresh to end
GONE_GRACE = 12   # seconds a signalled process gets to be gone (SIGTERM, SIGKILL after 10 s)
ALLOWED_ENV = {"PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "TMPDIR"}
INTERPRETER_ENV = {"LC_CTYPE", "__CF_USER_TEXT_ENCODING"}
PS = "/bin/ps"
CHILD_ENV = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
DOCKERFILE = "FROM standin/base:1\nRUN echo install the package\n"

STAND_IN = r'''#!@PYTHON@ -I
"""Stand-in docker for the tests of pm-emulator-image (see the docstring of test_emulator_image.py)."""
import fcntl, hashlib, json, os, pathlib, subprocess, sys, time
here = pathlib.Path(__file__).resolve().parent
args = sys.argv[1:]
with open(here / "calls.jsonl", "a") as f:
    f.write(json.dumps({"args": args, "pid": os.getpid(), "env": sorted(os.environ)}) + "\n")


class State:
    def __enter__(self):
        self.lock = open(here / "docker.lock", "a")
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        self.s = json.loads((here / "docker.json").read_text())
        return self.s

    def __exit__(self, *exc):
        if exc[0] is None:
            (here / "docker.json").write_text(json.dumps(self.s, indent=1))
        self.lock.close()


def peek():
    with State() as s:
        return s


def canon(ref):
    return ref if ref.startswith("sha256:") or ":" in ref.rsplit("/", 1)[-1] else ref + ":latest"


def resolve(s, ref):
    return ref if ref in s["images"] else s["names"].get(canon(ref))


def positional(rest, with_value):
    out, i = [], 0
    while i < len(rest):
        a = rest[i]
        if a.startswith("-"):
            if "=" not in a and a in with_value:
                i += 1
        else:
            out.append(a)
        i += 1
    return out


def values(rest, *names):
    out = []
    for i, a in enumerate(rest):
        for n in names:
            if a == n and i + 1 < len(rest):
                out.append(rest[i + 1])
            elif a.startswith(n + "="):
                out.append(a[len(n) + 1:])
    return out


def hang():
    while True:
        time.sleep(1)


s = peek()
cmd = args[0] if args else ""
if args[:1] == ["image"]:
    cmd = "inspect" if args[1:2] == ["inspect"] else "rm" if args[1:2] == ["rm"] else "image " + " ".join(args[1:2])
elif cmd == "rmi":
    cmd = "rm"
elif cmd in ("builder", "buildx"):
    cmd = "builder " + " ".join(args[1:2])
if "all" in s.get("hang", []) or (cmd in s.get("hang", []) and cmd != "build"):
    hang()
if cmd in s.get("fail", {}):
    if cmd == "build":
        for line in s.get("build_print", []):
            print(line, flush=True)
    print(f"standin: {cmd} fails", file=sys.stderr)
    sys.exit(s["fail"][cmd])

if cmd == "info":
    print("Server Version: standin")
elif cmd == "inspect":
    rest = args[2:]
    fmt = values(rest, "-f", "--format")
    refs = positional(rest, {"-f", "--format", "--type"})
    found = [resolve(s, r) for r in refs]
    if not refs or None in found:
        print("[]")
        print(f"Error: No such image: {refs}", file=sys.stderr)
        sys.exit(1)
    if fmt:
        if ".Id" not in fmt[0]:
            print(f"standin: format {fmt[0]!r} is not one the stand-in answers", file=sys.stderr)
            sys.exit(2)
        for i in found:
            print(i)
    else:
        out = []
        for i in found:
            img = s["images"][i]
            config = {"Env": ["PATH=/usr/local/bin:/usr/bin:/bin"], "Entrypoint": ["/entrypoint.sh"]}
            if img["labels"] is not None:
                config["Labels"] = img["labels"]
            out.append({"Id": i, "RepoTags": sorted(n for n, v in s["names"].items() if v == i), "Config": config})
        print(json.dumps(out, indent=4))
elif cmd == "build":
    rest = args[1:]
    for line in s.get("build_print", []):
        print(line, flush=True)
    child = None
    if "build" in s.get("hang", []) or "all" in s.get("hang", []):
        child = subprocess.Popen([sys.executable, "-I", "-c", "import time\nwhile True:\n    time.sleep(1)\n",
                                  str(here)])
    with open(here / "builds.jsonl", "a") as f:
        f.write(json.dumps({"pid": os.getpid(), "child": child and child.pid}) + "\n")
    if child:
        while not (here / "release").exists():
            time.sleep(0.05)
        child.kill()
    tags = values(rest, "-t", "--tag")
    labels = dict(v.split("=", 1) for v in values(rest, "--label") if "=" in v)
    with State() as st:
        i = "sha256:" + hashlib.sha256(f"{time.time()} {os.getpid()} {len(st['images'])}".encode()).hexdigest()
        st["images"][i] = {"version": st["package"]["version"], "commit": st["package"]["commit"],
                           "labels": labels or None}
        st["built"].append(i)
        for t in tags:
            st["names"][canon(t)] = i
    print(f"#9 writing image {i} done")
    for t in tags:
        print(f"#9 naming to docker.io/library/{t} done")
elif cmd == "run":
    image = args[-2] if args[-1:] == ["--version"] and len(args) >= 3 else None
    i = image and resolve(s, image)
    if not i:
        print(f"Unable to find image '{image}' locally", file=sys.stderr)
        sys.exit(125)
    img = s["images"][i]
    if img["version"] is not None:
        print(f"Version: {img['version']}")
    print("Release date: 2026.11.17")
    if img["commit"] is not None:
        print(f"Commit: {img['commit']}")
elif cmd == "builder prune":
    for line in s.get("prune_print", ["Total:\t0B"]):
        print(line, flush=True)
elif cmd == "tag":
    src, dst = positional(args[1:], set())[:2]
    with State() as st:
        i = resolve(st, src)
        if not i:
            print(f"Error: No such image: {src}", file=sys.stderr)
            sys.exit(1)
        st["names"][canon(dst)] = i
elif cmd == "rm":
    with State() as st:
        for t in positional(args[2:] if args[0] == "image" else args[1:], set()):
            if canon(t) in st["names"]:
                i = st["names"].pop(canon(t))
                if i not in st["names"].values():
                    st["images"].pop(i, None)
            elif t in st["images"]:
                st["images"].pop(t)
                st["names"] = {n: v for n, v in st["names"].items() if v != t}
            else:
                print(f"Error: No such image: {t}", file=sys.stderr)
                sys.exit(1)
'''

# a stand-in for a running pm-watchd: its command line holds pm-watchd; on SIGUSR1 it writes whether the inbox held
# the line it was given, then exits
WATCHD = r'''import json, pathlib, signal, sys, time
inbox, line, got, ready = sys.argv[1:5]


def on_usr1(*_):
    text = pathlib.Path(inbox).read_text() if pathlib.Path(inbox).exists() else ""
    seen = any(json.loads(x).get("line") == line for x in text.splitlines() if x.strip())
    pathlib.Path(got).write_text(json.dumps({"seen": seen}))
    sys.exit(0)


signal.signal(signal.SIGUSR1, on_usr1)
pathlib.Path(ready).write_text("ready")
while True:
    time.sleep(1)
'''


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
    except (ProcessLookupError, PermissionError):
        return False
    stat = ps("-o", "stat=", "-p", str(pid))
    return bool(stat) and not stat.startswith("Z")


def until(cond, seconds):
    """`cond()` once it is true, polled for up to `seconds`; else its last value."""
    end = time.time() + seconds
    while True:
        v = cond()
        if v or time.time() >= end:
            return v
        time.sleep(0.05)


def lowered(text, **bounds):
    """`text` with each named bound set to its new value, and the names that had no shipped setting to lower."""
    missing = []
    for name, value in bounds.items():
        text, n = re.subn(rf"(?m)^({name}\s*=\s*){BOUNDS[name]}\b", rf"\g<1>{value}", text)
        if n != 1:
            missing.append(name)
    return text, missing


def options(args, with_value):
    """The options of a `docker run` before its image, and what follows the image: (options, image, rest)."""
    i = 1
    opts = []
    while i < len(args) and args[i].startswith("-"):
        opts.append(args[i])
        if "=" not in args[i] and args[i] in with_value and i + 1 < len(args):
            opts.append(args[i + 1])
            i += 1
        i += 1
    return opts, (args[i] if i < len(args) else None), args[i + 1:]


RUN_VALUED = {"--pull", "--network", "--net", "--entrypoint", "--name", "-p", "--publish", "-v", "--volume", "--mount",
              "-e", "--env", "-u", "--user", "-w", "--workdir", "--platform", "-l", "--label"}


def option_set(opts, name, value):
    return any(o == f"{name}={value}" for o in opts) or any(
        o == name and i + 1 < len(opts) and opts[i + 1] == value for i, o in enumerate(opts))


def option_values(args, *names):
    out = []
    for i, a in enumerate(args):
        for n in names:
            if a == n and i + 1 < len(args):
                out.append(args[i + 1])
            elif a.startswith(n + "="):
                out.append(a[len(n) + 1:])
    return out


class Result:
    """What one command printed and how it ended."""

    def __init__(self, code, out, err, pid, seconds):
        self.code, self.out, self.err, self.pid, self.seconds = code, out, err, pid, seconds
        self.lines = out.splitlines()

    def __str__(self):
        return f"exit {self.code} after {self.seconds:.1f} s\nstdout:\n{self.out}\nstderr:\n{self.err}"


class Case(unittest.TestCase):
    """A fixture checkout with a made-up home, a stand-in docker, and helpers to drive pm-emulator-image."""

    infra = True

    def setUp(self):
        if not (BIN / SCRIPT).exists():
            self.fail(f"{BIN / SCRIPT} does not exist")
        case = f"{type(self).__name__}-{self._testMethodName[5:]}".lower().replace("_", "-")
        files = {}
        if self.infra:
            files = {"infra/aws-emulator/Dockerfile": DOCKERFILE,
                     "infra/aws-emulator/entrypoint.sh": "#!/bin/sh\nexec aws-emulator \"$@\"\n"}
        self.co = make(GROUP, case, (SCRIPT, "pm-watchd"), files)
        self.addCleanup(self.end)
        self.home = self.co / "home"
        self.home.mkdir()
        self.case = self.co / "output" / "case"
        self.stub = self.co / "output" / "stub-bin"
        for d in (self.case, self.stub):
            d.mkdir(parents=True)
        (self.stub / "docker").write_text(STAND_IN.replace("@PYTHON@", sys.executable))
        (self.stub / "docker").chmod(0o755)
        self.run_dir = self.co / ".pm" / "run"
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.record_path = self.run_dir / "emulator-image.json"
        self.log_path = self.run_dir / "emulator-image-refresh.log"
        self.events_path = self.run_dir / "events.log"
        self.inbox_path = self.run_dir / "inbox.jsonl"
        self.lock_path = self.run_dir / "emulator-image.lock"
        self.started_pids = []
        self.other_pids = []
        self.docker()

    def end(self):
        """End what the case started: the recorded pids and workers first, until each is gone; then what names the
        case's directory, look after look until one finds none. Fails the case when one is still alive."""
        pids = set(self.started_pids) | set(self.other_pids)
        pids |= {c["pid"] for c in self.calls()}
        pids |= {p for b in self.builds() for p in (b["pid"], b["child"]) if p}
        self.kill(pids)
        end = time.time() + GONE_GRACE
        named = self.naming()
        while named and time.time() < end:
            self.kill(named)
            named = self.naming()
        decoy = self.home / ".aws" / "credentials"
        if decoy.exists():
            decoy.chmod(0o600)
        if named:
            self.fail(f"still alive at the case's end, naming {self.co}: {sorted(named)}")

    def naming(self):
        """The live pids, other than this process, whose command line names the case's directory."""
        out = set()
        for line in ps("-axo", "pid=,command=").splitlines():
            pid, _, command = line.strip().partition(" ")
            if f"{self.co}/" in command and pid.isdigit() and int(pid) != os.getpid() and alive(int(pid)):
                out.add(int(pid))
        return out

    @staticmethod
    def kill(pids):
        """SIGKILL each live pid, then wait, bounded, until each is gone."""
        pids = {p for p in pids if p != os.getpid() and alive(p)}
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        until(lambda: not any(alive(p) for p in pids), GONE_GRACE)

    # ---- the stand-in

    def docker(self, package=("1.0.2", "bbb"), hang=(), fail=None, build_print=("#1 [internal] load build definition",),
               prune_print=("Total:\t0B",)):
        """A stand-in with no image yet; `package` is what a build installs (version null: no `Version:` line)."""
        self.state_write(dict(images={}, names={}, built=[], package=dict(version=package[0], commit=package[1]),
                              hang=list(hang), fail=dict(fail or {}), build_print=list(build_print),
                              prune_print=list(prune_print)))
        for f in ("calls.jsonl", "builds.jsonl", "release"):
            (self.stub / f).unlink(missing_ok=True)

    def behave(self, **change):
        s = self.state()
        if "package" in change:
            change["package"] = dict(version=change["package"][0], commit=change["package"][1])
        s.update(change)
        self.state_write(s)

    def state(self):
        return json.loads((self.stub / "docker.json").read_text())

    def state_write(self, s):
        (self.stub / "docker.json").write_text(json.dumps(s, indent=1))

    def image(self, version, commit, labels=None, name="aws-emulator"):
        """An image in the stand-in, named `name` (None: no name); its id."""
        s = self.state()
        i = "sha256:" + f"{len(s['images']) + 1:064x}"
        s["images"][i] = dict(version=version, commit=commit, labels=labels)
        if name:
            s["names"][name if ":" in name else name + ":latest"] = i
        self.state_write(s)
        return i

    def name_id(self, name=NAME):
        return self.state()["names"].get(name)

    def refresh_names(self):
        return [n for n in self.state()["names"] if n.startswith("aws-emulator:refresh-")]

    def calls(self, cmd=None):
        f = self.stub / "calls.jsonl"
        rows = [json.loads(x) for x in f.read_text().splitlines() if x.strip()] if f.exists() else []
        return [r for r in rows if cmd is None or self.kind(r["args"]) == cmd]

    @staticmethod
    def kind(args):
        if args[:1] == ["image"]:
            return "image " + " ".join(args[1:2])
        if args[:1] in (["builder"], ["buildx"]):
            return "builder " + " ".join(args[1:2])
        if args[:1] in (["system"], ["container"], ["volume"], ["network"]):
            return " ".join(args[:2])
        return args[0] if args else ""

    def builds(self):
        f = self.stub / "builds.jsonl"
        return [json.loads(x) for x in f.read_text().splitlines() if x.strip()] if f.exists() else []

    def release(self):
        (self.stub / "release").write_text("go\n")

    # ---- the fixture

    def tree(self):
        return git(self.co, "rev-parse", "HEAD:infra/aws-emulator")

    def lower(self, **bounds):
        p = self.co / ".pm" / "bin" / SCRIPT
        text, missing = lowered(p.read_text(), **bounds)
        if missing:
            self.fail(f"no shipped setting to lower in {p}: {', '.join(f'{n} = {BOUNDS[n]}' for n in missing)}")
        p.write_text(text)

    def record(self):
        return json.loads(self.record_path.read_text()) if self.record_path.is_file() else None

    def write_record(self, outcome, line, before, after, at="2026-11-18T09:00:00+09:00"):
        self.record_path.write_text(json.dumps(dict(at=at, outcome=outcome, line=line, before=before, after=after,
                                                    reason=None, source_tree=self.tree() if self.infra else None,
                                                    seconds=12)))

    def record_of_1_0_1(self, old):
        """The record of the refresh that made the name `old` at 1.0.1, commit aaa."""
        self.write_record("refreshed", PREFIX + "refreshed 1.0.0 -> 1.0.1",
                          dict(version="1.0.0", commit="zzz", id="sha256:" + "f" * 64),
                          dict(version="1.0.1", commit="aaa", id=old))

    def text(self, path):
        return path.read_text() if path.is_file() else ""

    def inbox(self):
        return [json.loads(x) for x in self.text(self.inbox_path).splitlines() if x.strip()]

    # ---- running the script

    def env(self, **extra):
        env = {k: v for k, v in clean_env().items() if not k.startswith(("AWS_", "EMUFORGE_"))}
        env.update(HOME=str(self.home), PATH=f"{self.stub}{os.pathsep}{env.get('PATH', '/usr/bin:/bin')}", **extra)
        return env

    def call(self, *args, env=None, timeout=60, pass_fds=()):
        """Run the fixture's script with `args`; its output goes to files."""
        out, err = self.case / "stdout", self.case / "stderr"
        t = time.time()
        with open(out, "w") as o, open(err, "w") as e:
            p = subprocess.Popen([str(self.co / ".pm" / "bin" / SCRIPT), *map(str, args)], stdout=o, stderr=e,
                                 stdin=subprocess.DEVNULL, env=env or self.env(), cwd=str(self.co),
                                 pass_fds=pass_fds)
            self.other_pids.append(p.pid)
            try:
                code = p.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
                code = None
        return Result(code, out.read_text(), err.read_text(), p.pid, time.time() - t)

    def started(self, r, last_known):
        """The pid of the started line `r` printed, which must be its one line of output, exit 0."""
        self.assertEqual(r.code, 0, r)
        self.assertEqual(len(r.lines), 1, r)
        m = re.fullmatch(r"pm-emulator-image: refresh started \(pid (\d+)\); last known image (\S+); log (.+)",
                         r.lines[0])
        self.assertIsNotNone(m, r)
        n = int(m.group(1))
        self.started_pids.append(n)
        self.assertEqual(r.lines[0], f"{PREFIX}refresh started (pid {n}); last known image {last_known}; "
                                     f"log {self.log_path}", r)
        return n

    def wait_build(self, count=1):
        self.assertTrue(until(lambda: len(self.builds()) >= count, WAIT), f"no build started; calls {self.calls()}")

    def wait_record(self, old=None):
        """The record once it exists and differs from `old`."""
        rec = until(lambda: (lambda r: r if r is not None and r != old else None)(self.record()), WAIT)
        self.assertIsNotNone(rec, f"no new record within {WAIT} s; log:\n{self.text(self.log_path)}")
        return rec

    def assertEnds(self, pid, seconds=WAIT):
        self.assertTrue(until(lambda: not alive(pid), seconds), f"process {pid} is still running")

    def assertOneLine(self, r, line, code):
        self.assertEqual(r.code, code, r)
        self.assertEqual(r.lines, [line], r)


# ---------------------------------------------------------------------------------------------------- R1.1, R1.6

class Started(Case):
    def given(self):
        old = self.image("1.0.1", "aaa")
        self.record_of_1_0_1(old)
        return old

    def test_returns_at_once_while_the_build_does_not_return(self):
        self.given()
        self.behave(hang=["build"])
        r = self.call("refresh")
        self.assertLess(r.seconds, RETURNS_WITHIN, r)
        n = self.started(r, "1.0.1")
        self.assertTrue(alive(n), f"the worker {n} is not running")

    def test_returns_at_once_when_docker_does_not_answer(self):
        self.given()
        self.behave(hang=["all"])
        r = self.call("refresh")
        self.assertLess(r.seconds, RETURNS_WITHIN, r)
        n = self.started(r, "1.0.1")
        self.assertTrue(alive(n), f"the worker {n} is not running")

    def test_the_case_s_end_leaves_nothing_a_worker_starts_late(self):
        """regression (issue 477): a recorded process that keeps starting processes in sessions of their own, as a
        refresh worker starts its docker calls; the case's end leaves none of them"""
        sleeper = self.case / "sleeper.py"
        sleeper.write_text("import time\ntime.sleep(120)\n")
        spawner = self.case / "spawner.py"
        spawner.write_text("import subprocess, sys, time\nend = time.time() + 60\nwhile time.time() < end:\n"
                           f"    subprocess.Popen([sys.executable, '-I', {str(sleeper)!r}], start_new_session=True)\n"
                           "    time.sleep(0.02)\n")
        p = subprocess.Popen([sys.executable, "-I", str(spawner)], stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.addCleanup(p.wait)
        self.started_pids.append(p.pid)
        self.assertTrue(until(lambda: len(self.naming()) > 3, WAIT), "the spawner started nothing")
        self.end()
        self.assertEqual(self.naming(), set())

    def test_without_a_record_the_last_known_image_is_unknown(self):
        self.image("1.0.1", "aaa")
        self.behave(hang=["build"])
        self.started(self.call("refresh"), "unknown")

    def test_the_work_ends_refreshed(self):
        self.given()
        old = self.record()
        n = self.started(self.call("refresh"), "1.0.1")
        rec = self.wait_record(old)
        self.assertEqual(rec["outcome"], "refreshed", rec)
        self.assertEqual(self.state()["images"][self.name_id()]["version"], "1.0.2")
        self.assertEnds(n)

    def test_a_second_refresh_while_one_runs_is_refused(self):
        self.given()
        self.behave(hang=["build"])
        n = self.started(self.call("refresh"), "1.0.1")
        self.wait_build()
        r = self.call("refresh")
        self.assertEqual(r.code, 1, r)
        self.assertIn(f"{PREFIX}a refresh is already running (pid {n})", (r.out + r.err).splitlines(), r)
        self.assertEqual(len(self.calls("build")), 1, self.calls("build"))

    def test_a_foreground_refresh_while_one_runs_is_refused_and_writes_no_record(self):
        self.image("1.0.1", "aaa")
        self.behave(hang=["build"])
        n = self.started(self.call("refresh"), "unknown")
        self.wait_build()
        r = self.call("refresh", "--foreground")
        self.assertEqual(r.code, 1, r)
        self.assertIn(f"{PREFIX}a refresh is already running (pid {n})", (r.out + r.err).splitlines(), r)
        self.assertEqual(len(self.calls("build")), 1, self.calls("build"))
        self.assertFalse(self.record_path.exists(), self.text(self.record_path))

    def test_after_a_killed_refresh_the_next_one_starts(self):
        old = self.given()
        self.behave(hang=["build"])
        n = self.started(self.call("refresh"), "1.0.1")
        self.wait_build()
        os.kill(n, signal.SIGKILL)
        self.assertEnds(n, 10)
        r = self.call("refresh")
        m = self.started(r, "1.0.1")
        self.assertNotEqual(m, n)
        self.assertEqual(self.name_id(), old)

    def test_a_worker_that_cannot_go_on_leaves_its_error_in_the_log(self):
        self.image("1.0.1", "aaa")
        self.record_path.mkdir()
        r = self.call("refresh")
        n = self.started(r, "unknown")
        self.assertEnds(n)
        log = self.text(self.log_path)
        self.assertIn("emulator-image.json", log, f"the refresh log does not hold the worker's error:\n{log}")


# ---------------------------------------------------------------------------------------------------- R1.2, R1.4

class Outcome(Case):
    def foreground(self):
        return self.call("refresh", "--foreground")

    def built(self):
        b = self.state()["built"]
        self.assertEqual(len(b), 1, b)
        return b[0]

    def test_a_new_version_is_refreshed(self):
        self.image("1.0.1", "aaa")
        r = self.foreground()
        self.assertOneLine(r, f"{PREFIX}refreshed 1.0.1 -> 1.0.2{PRUNED}", 0)
        self.assertEqual(self.name_id(), self.built())

    def test_the_same_version_with_another_commit_is_refreshed(self):
        self.image("1.0.1", "aaa")
        self.behave(package=("1.0.1", "bbb"))
        self.assertOneLine(self.foreground(), f"{PREFIX}refreshed 1.0.1 -> 1.0.1{PRUNED}", 0)

    def test_the_same_version_and_commit_is_unchanged(self):
        self.image("1.0.1", "aaa")
        self.behave(package=("1.0.1", "aaa"))
        self.assertOneLine(self.foreground(), f"{PREFIX}unchanged 1.0.1", 0)
        self.assertEqual(self.name_id(), self.built())

    def test_no_image_before_is_none(self):
        self.assertOneLine(self.foreground(), f"{PREFIX}refreshed none -> 1.0.2{PRUNED}", 0)

    def test_an_unreadable_version_before_is_unknown(self):
        self.image(None, "aaa")
        self.assertOneLine(self.foreground(), f"{PREFIX}refreshed unknown -> 1.0.2{PRUNED}", 0)

    def test_the_build_call(self):
        self.image("1.0.1", "aaa")
        r = self.foreground()
        self.assertEqual(r.code, 0, r)
        builds = self.calls("build")
        self.assertEqual(len(builds), 1, builds)
        args = builds[0]["args"]
        self.assertTrue("--pull" in args or "--pull=true" in args, args)
        self.assertIn("--no-cache", args)
        self.assertEqual(os.path.realpath(args[-1]), os.path.realpath(self.co / "infra" / "aws-emulator"), args)
        tags = option_values(args, "-t", "--tag")
        self.assertEqual(tags, [f"aws-emulator:refresh-{r.pid}"], args)
        self.assertIn(f"emuforge.source-tree={self.tree()}", option_values(args, "--label"), args)

    def test_the_name_carries_the_label_and_no_refresh_name_is_left(self):
        self.image("1.0.1", "aaa")
        self.assertEqual(self.foreground().code, 0)
        labels = self.state()["images"][self.name_id()]["labels"] or {}
        self.assertEqual(labels.get("emuforge.source-tree"), self.tree(), labels)
        self.assertEqual(self.refresh_names(), [])

    def test_the_record_holds_this_refresh(self):
        old = self.image("1.0.1", "aaa")
        t0 = dt.datetime.now().astimezone().replace(microsecond=0)
        r = self.foreground()
        t1 = dt.datetime.now().astimezone()
        self.assertEqual(r.code, 0, r)
        rec = self.record()
        self.assertIsNotNone(rec, "no record")
        self.assertEqual(rec["outcome"], "refreshed")
        self.assertEqual(rec["line"], f"{PREFIX}refreshed 1.0.1 -> 1.0.2{PRUNED}")
        at = dt.datetime.fromisoformat(rec["at"])
        self.assertTrue(t0 <= at <= t1, (t0, rec["at"], t1))
        self.assertEqual(rec["before"], dict(version="1.0.1", commit="aaa", id=old))
        self.assertEqual(rec["after"], dict(version="1.0.2", commit="bbb", id=self.built()))
        self.assertEqual(rec["source_tree"], self.tree())
        self.assertIsInstance(rec["seconds"], (int, float))
        self.assertTrue(0 <= rec["seconds"] <= r.seconds + 1, (rec["seconds"], r.seconds))

    def test_events_log_gained_the_outcome_line(self):
        self.image("1.0.1", "aaa")
        before = self.text(self.events_path).splitlines()
        self.assertEqual(self.foreground().code, 0)
        gained = self.text(self.events_path).splitlines()[len(before):]
        self.assertTrue(any(ln.endswith(f" {PREFIX}refreshed 1.0.1 -> 1.0.2{PRUNED}") for ln in gained), gained)

    def test_the_refresh_log_is_this_refreshs_build_output(self):
        self.image("1.0.1", "aaa")
        self.behave(build_print=["standin build output one"])
        self.assertEqual(self.foreground().code, 0)
        self.behave(build_print=["standin build output two"], package=("1.0.3", "ccc"))
        self.assertEqual(self.foreground().code, 0)
        log = self.text(self.log_path)
        self.assertIn("standin build output two", log)
        self.assertNotIn("standin build output one", log)


# ---------------------------------------------------------------------------------------------------- R1.3

class Failed(Case):
    def given(self):
        self.old = self.image("1.0.1", "aaa")
        self.record_of_1_0_1(self.old)

    def failed(self, reason, version="1.0.1", **lower):
        """Run `refresh --foreground` and hold what every failure holds; the Result."""
        if lower:
            self.lower(**lower)
        r = self.call("refresh", "--foreground")
        self.assertOneLine(r, f"{PREFIX}failed: {reason}; image left as it was ({version})", 1)
        self.assertEqual(self.name_id(), getattr(self, "old", None))
        self.assertEqual(self.refresh_names(), [])
        rec = self.record()
        self.assertIsNotNone(rec, "no record")
        self.assertEqual(rec["outcome"], "failed", rec)
        self.assertEqual(rec["after"], rec["before"], rec)
        return r

    def assertNoBuild(self):
        self.assertEqual(self.calls("build"), [])

    def test_docker_does_not_answer(self):
        self.given()
        self.behave(fail={"info": 1})
        self.failed("docker does not answer")
        self.assertNoBuild()

    def test_docker_info_does_not_return_within_its_bound(self):
        self.given()
        self.behave(hang=["info"])
        r = self.failed("docker does not answer", READ_BOUND=LOWERED)
        self.assertLess(r.seconds, LOWERED + SLACK, r)

    def test_uncommitted_change_of_the_folder(self):
        self.given()
        (self.co / "infra" / "aws-emulator" / "Dockerfile").write_text(DOCKERFILE + "RUN echo changed\n")
        self.failed("infra/aws-emulator of the main checkout has uncommitted changes")
        self.assertNoBuild()

    def test_the_build_exits_1(self):
        self.given()
        self.behave(fail={"build": 1})
        self.failed("the build failed (exit 1)")

    def test_the_build_does_not_end_within_its_bound(self):
        self.given()
        self.behave(hang=["build"])
        r = self.failed(f"the build did not end within {LOWERED} s", BUILD_BOUND=LOWERED)
        self.assertLess(r.seconds, LOWERED + SLACK, r)
        pids = [p for b in self.builds() for p in (b["pid"], b["child"]) if p]
        self.assertEqual(len(pids), 2, self.builds())
        left = [p for p in pids if not until(lambda p=p: not alive(p), GONE_GRACE)]
        self.assertFalse(left, f"the build or its child is still running: {left}")

    def test_the_new_version_cannot_be_read(self):
        self.given()
        self.behave(package=(None, "bbb"))
        self.failed("the new image's version cannot be read")
        built = self.state()["built"]
        self.assertEqual(len(built), 1, built)
        self.assertNotIn(built[0], self.state()["images"], "the image built under the refresh's name was not removed")

    def test_a_version_out_of_shape_is_not_read_and_not_repeated(self):
        self.given()
        bad = "1.0.2;standin-7f3a"
        self.behave(package=(bad, "bbb"))
        r = self.failed("the new image's version cannot be read")
        for where, text in (("output", r.out + r.err), ("record", self.text(self.record_path)),
                            ("events.log", self.text(self.events_path)), ("inbox.jsonl", self.text(self.inbox_path))):
            self.assertNotIn("standin-7f3a", text, where)

    def test_the_name_cannot_be_moved(self):
        self.given()
        self.behave(fail={"tag": 1})
        self.failed("the name aws-emulator could not be moved")

    def test_no_image_and_a_failed_build_leaves_none(self):
        self.behave(fail={"build": 1})
        self.failed("the build failed (exit 1)", version="none")
        self.assertIsNone(self.name_id())

    def test_the_build_output_is_only_in_the_refresh_log(self):
        self.given()
        line = "#7 ERROR standin-build-line-4242"
        self.behave(fail={"build": 1}, build_print=[line])
        r = self.failed("the build failed (exit 1)")
        self.assertIn(line, self.text(self.log_path))
        for where, text in (("outcome line", r.out), ("record", self.text(self.record_path)),
                            ("events.log", self.text(self.events_path)), ("inbox.jsonl", self.text(self.inbox_path))):
            self.assertNotIn("standin-build-line-4242", text, where)


class FailedWithoutTheFolder(Case):
    """Failed: the fixture has no infra/aws-emulator."""

    infra = False

    def test_the_folder_is_missing(self):
        old = self.image("1.0.1", "aaa")
        self.record_of_1_0_1(old)
        r = self.call("refresh", "--foreground")
        self.assertOneLine(r, f"{PREFIX}failed: infra/aws-emulator of the main checkout is missing; "
                              f"image left as it was (1.0.1)", 1)
        self.assertEqual(self.name_id(), old)
        self.assertEqual(self.refresh_names(), [])
        self.assertEqual(self.calls("build"), [])
        rec = self.record()
        self.assertEqual((rec["outcome"], rec["after"]), ("failed", rec["before"]), rec)


# ---------------------------------------------------------------------------------------------------- R1.5

class Told(Case):
    def foreground(self):
        return self.call("refresh", "--foreground")

    def test_refreshed_is_one_inbox_line(self):
        self.image("1.0.1", "aaa")
        self.assertEqual(self.foreground().code, 0)
        self.assertEqual([o.get("line") for o in self.inbox()], ["EVENT emulator-image refreshed 1.0.1 -> 1.0.2"])

    def test_failed_is_one_inbox_line(self):
        self.image("1.0.1", "aaa")
        self.behave(fail={"build": 1})
        self.assertEqual(self.foreground().code, 1)
        self.assertEqual([o.get("line") for o in self.inbox()],
                         ["EVENT emulator-image failed the build failed (exit 1)"])

    def test_unchanged_sends_nothing(self):
        self.image("1.0.1", "aaa")
        self.behave(package=("1.0.1", "aaa"))
        self.assertEqual(self.foreground().code, 0)
        self.assertEqual(self.inbox(), [])

    def test_a_running_daemon_is_signalled_after_the_line_is_written(self):
        self.image("1.0.1", "aaa")
        line = "EVENT emulator-image refreshed 1.0.1 -> 1.0.2"
        daemon = self.case / "pm-watchd"
        daemon.write_text(WATCHD)
        got, ready = self.case / "watchd-got", self.case / "watchd-ready"
        p = subprocess.Popen([sys.executable, "-I", str(daemon), str(self.inbox_path), line, str(got), str(ready)],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.other_pids.append(p.pid)
        self.assertTrue(until(ready.exists, 10), "the stand-in daemon did not start")
        (self.run_dir / "watchd.wake").write_text(str(p.pid))
        self.assertEqual(self.foreground().code, 0)
        self.assertTrue(until(got.exists, 10), "the stand-in daemon received no SIGUSR1")
        self.assertEqual(json.loads(got.read_text()), {"seen": True}, "the line was not in inbox.jsonl at the signal")

    def test_the_daemon_lists_the_two_events(self):
        p = subprocess.run([str(self.co / ".pm" / "bin" / "pm-watchd"), "--help"], capture_output=True, text=True,
                           env=self.env(), cwd=str(self.co), timeout=60, stdin=subprocess.DEVNULL)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("EVENT emulator-image refreshed", p.stdout)
        self.assertIn("EVENT emulator-image failed", p.stdout)


# ---------------------------------------------------------------------------------------------------- R1.7

class Containers(Case):
    ALLOWED = {"info", "image inspect", "build", "run", "tag", "image rm", "builder prune"}
    FORBIDDEN = {"start", "stop", "restart", "kill", "rm", "compose", "exec", "pull", "push", "image prune",
                 "system prune"}
    OUTCOMES = {"refreshed": dict(package=("1.0.2", "bbb")), "unchanged": dict(package=("1.0.1", "aaa")),
                "failed": dict(fail={"build": 1})}

    def each_outcome(self):
        """For each outcome: a fresh stand-in with the name at 1.0.1, one `refresh --foreground`; yields
        (outcome, Result, calls)."""
        for outcome, behavior in self.OUTCOMES.items():
            self.docker()
            self.image("1.0.1", "aaa")
            self.behave(**behavior)
            r = self.call("refresh", "--foreground")
            self.assertEqual(r.code, 1 if outcome == "failed" else 0, r)
            yield outcome, r, self.calls()

    def test_only_image_commands_are_called(self):
        for outcome, r, calls in self.each_outcome():
            with self.subTest(outcome):
                kinds = [self.kind(c["args"]) for c in calls]
                self.assertTrue(kinds, "no call of the stand-in")
                self.assertEqual([k for k in kinds if k not in self.ALLOWED], [], kinds)
                self.assertEqual([k for k in kinds if k in self.FORBIDDEN], [], kinds)

    def test_every_run_is_a_one_shot_version_read(self):
        for outcome, r, calls in self.each_outcome():
            with self.subTest(outcome):
                runs = [c["args"] for c in calls if self.kind(c["args"]) == "run"]
                self.assertTrue(runs, "no version read")
                for args in runs:
                    opts, image, rest = options(args, RUN_VALUED)
                    self.assertIn("--rm", opts, args)
                    self.assertTrue(option_set(opts, "--pull", "never"), args)
                    self.assertTrue(option_set(opts, "--network", "none"), args)
                    self.assertTrue(option_set(opts, "--entrypoint", "aws-emulator"), args)
                    self.assertIsNotNone(image, args)
                    self.assertEqual(rest, ["--version"], args)
                    for o in ("-d", "--detach", "-p", "--publish", "-v", "--volume", "--mount", "--name"):
                        self.assertFalse(any(x == o or x.startswith(o + "=") for x in opts), f"{o} in {args}")

    def test_every_image_rm_is_of_this_refreshs_name(self):
        for outcome, r, calls in self.each_outcome():
            with self.subTest(outcome):
                for c in calls:
                    if self.kind(c["args"]) == "image rm":
                        targets = [a for a in c["args"][2:] if not a.startswith("-")]
                        self.assertEqual(targets, [f"aws-emulator:refresh-{r.pid}"], c["args"])

    def test_no_variable_outside_the_allowlist_reaches_docker(self):
        self.image("1.0.1", "aaa")
        decoy = self.home / ".aws" / "credentials"
        decoy.parent.mkdir(parents=True)
        decoy.write_text("[default]\naws_access_key_id = decoy\n")
        decoy.chmod(0o000)
        env = self.env(AWS_PROFILE="decoy", AWS_ACCESS_KEY_ID="AKIADECOY", AWS_SECRET_ACCESS_KEY="decoy",
                       AWS_SESSION_TOKEN="decoy")
        r = self.call("refresh", "--foreground", env=env)
        self.assertOneLine(r, f"{PREFIX}refreshed 1.0.1 -> 1.0.2{PRUNED}", 0)
        calls = self.calls()
        self.assertTrue(calls)
        for c in calls:
            self.assertEqual(sorted(set(c["env"]) - ALLOWED_ENV - INTERPRETER_ENV), [], c["args"])


# ---------------------------------------------------------------------------------------------------- R1.8

class Status(Case):
    AT = "2026-11-18T09:00:00+09:00"

    def labelled(self):
        new = self.image("1.0.2", "bbb", labels={"emuforge.source-tree": self.tree()})
        self.write_record("refreshed", PREFIX + "refreshed 1.0.1 -> 1.0.2",
                          dict(version="1.0.1", commit="aaa", id="sha256:" + "e" * 64),
                          dict(version="1.0.2", commit="bbb", id=new), at=self.AT)
        return f"{PREFIX}image 1.0.2 source-tree {self.tree()}; last refresh refreshed 1.0.1 -> 1.0.2 at {self.AT}"

    def test_the_image_and_the_last_refresh(self):
        line = self.labelled()
        self.assertOneLine(self.call("status"), line, 0)

    def test_a_running_refresh_is_named_and_not_disturbed(self):
        line = self.labelled()
        old = self.record()
        self.behave(hang=["build"], package=("1.0.3", "ccc"))
        n = self.started(self.call("refresh"), "1.0.2")
        self.wait_build()
        r = self.call("status")
        self.assertOneLine(r, f"{line}; a refresh is running (pid {n})", 0)
        self.release()
        rec = self.wait_record(old)
        self.assertEqual(rec["outcome"], "refreshed", rec)

    def test_a_lock_file_without_a_live_refresh_is_no_running_refresh(self):
        line = self.labelled()
        ended = subprocess.Popen([sys.executable, "-I", "-c", "pass"])
        ended.wait()
        other = subprocess.Popen([sys.executable, "-I", "-c", "import time\ntime.sleep(300)\n", str(self.case)])
        self.other_pids.append(other.pid)
        for what, pid in (("ended", ended.pid), ("not the script", other.pid)):
            with self.subTest(what):
                self.lock_path.write_text(str(pid))
                r = self.call("status")
                self.assertOneLine(r, line, 0)
                self.assertNotIn("a refresh is running", r.out)

    def test_an_image_without_a_labels_key_and_no_record(self):
        self.image("1.0.1", "aaa", labels=None)
        self.assertOneLine(self.call("status"), f"{PREFIX}image 1.0.1 source-tree none; last refresh none", 0)

    def test_no_image(self):
        self.assertOneLine(self.call("status"), f"{PREFIX}image none source-tree none; last refresh none", 0)

    def test_docker_does_not_answer(self):
        self.image("1.0.1", "aaa")
        self.behave(hang=["all"])
        self.lower(READ_BOUND=LOWERED, IMAGE_BOUND=LOWERED)
        r = self.call("status")
        self.assertOneLine(r, f"{PREFIX}image unknown source-tree unknown; last refresh none", 0)
        self.assertLess(r.seconds, 2 * LOWERED + SLACK, r)

    def test_status_builds_tags_and_removes_nothing(self):
        self.labelled()
        self.assertEqual(self.call("status").code, 0)
        kinds = [self.kind(c["args"]) for c in self.calls()]
        self.assertEqual([k for k in kinds if k in ("build", "tag", "image rm", "rmi")], [], kinds)


# ---------------------------------------------------------------------------------------------------- R1.9

class Usage(Case):
    def assertUsage(self, r):
        self.assertEqual(r.code, 2, r)
        self.assertTrue([ln for ln in r.err.splitlines() if ln.lower().startswith("usage:")], r)

    def test_no_command_an_unknown_command_or_option_is_refused(self):
        for args in ((), ("frobnicate",), ("refresh", "--frobnicate"), ("status", "--frobnicate")):
            with self.subTest(args):
                self.docker()
                r = self.call(*args)
                self.assertUsage(r)
                self.assertEqual(self.calls(), [])

    def test_an_inherited_lock_that_is_not_the_held_lock_is_refused(self):
        self.image("1.0.1", "aaa")
        other = open(self.case / "not-the-lock", "w")
        self.addCleanup(other.close)
        holder = open(self.lock_path, "a")
        self.addCleanup(holder.close)
        cases = {"not open": (250, ()), "another file": (other.fileno(), (other.fileno(),))}
        for what, (fd, fds) in cases.items():
            with self.subTest(what):
                r = self.call("refresh", "--foreground", "--inherited-lock", fd, pass_fds=fds)
                self.assertUsage(r)
                self.assertEqual(self.calls("build"), [])
                self.assertFalse(self.record_path.exists())
        fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)  # another refresh holds the lock
        second = open(self.lock_path, "a")
        self.addCleanup(second.close)
        with self.subTest("the lock file, held elsewhere"):
            r = self.call("refresh", "--foreground", "--inherited-lock", second.fileno(), pass_fds=(second.fileno(),))
            self.assertUsage(r)
            self.assertEqual(self.calls("build"), [])
            self.assertFalse(self.record_path.exists())

    def test_the_shipped_bounds(self):
        text = (BIN / SCRIPT).read_text()
        for name, value in BOUNDS.items():
            with self.subTest(name):
                self.assertEqual(re.findall(rf"(?m)^{name}\s*=\s*(\S+)", text), [str(value)])


# ---------------------------------------------------------------------------------------------------- issue 507

class BuildCache(Case):
    """A refresh to a new version prunes Docker's build cache down to 20 GB once, and nothing else (issue 507)."""

    def refresh(self):
        self.image("1.0.1", "aaa")
        return self.call("refresh", "--foreground")

    def prunes(self):
        return [c["args"] for c in self.calls() if self.kind(c["args"]) == "builder prune"]

    def test_a_refresh_to_a_new_version_prunes_once_after_the_name_moved(self):
        r = self.refresh()
        self.assertEqual(r.code, 0, r)
        self.assertEqual(self.prunes(), [["builder", "prune", "--max-used-space", "20GB", "--force"]])
        kinds = [self.kind(c["args"]) for c in self.calls()]
        self.assertEqual(kinds[-3:], ["tag", "image rm", "builder prune"], kinds)
        self.assertEqual(self.name_id(), self.state()["built"][0])

    def test_the_reclaimed_space_is_in_the_line_the_record_the_events_and_the_log(self):
        self.behave(prune_print=["ID\tRECLAIMABLE\tSIZE\tLAST ACCESSED", "abc123*\ttrue\t1.53GB\t2 hours ago",
                                 "Total:\t1.53GB"])
        r = self.refresh()
        line = f"{PREFIX}refreshed 1.0.1 -> 1.0.2; build cache pruned to 20GB (reclaimed 1.53GB)"
        self.assertOneLine(r, line, 0)
        rec = self.record()
        self.assertEqual(rec["line"], line)
        self.assertEqual(rec["outcome"], "refreshed")
        self.assertEqual(rec["build_cache"], dict(outcome="pruned", reclaimed="1.53GB", keep="20GB"))
        self.assertTrue(any(ln.endswith(" " + line) for ln in self.text(self.events_path).splitlines()))
        log = self.text(self.log_path)
        self.assertIn("abc123*", log)
        self.assertIn("Total:\t1.53GB", log)

    def test_the_classic_total_line_is_read(self):
        self.behave(prune_print=["Deleted build cache objects:", "x1y2z3", "", "Total reclaimed space: 2.1GB"])
        self.assertOneLine(self.refresh(), f"{PREFIX}refreshed 1.0.1 -> 1.0.2; build cache pruned to 20GB "
                                           f"(reclaimed 2.1GB)", 0)

    def test_a_total_out_of_shape_is_unknown_and_not_repeated(self):
        self.behave(prune_print=["Total:\t$(touch-me)"])
        r = self.refresh()
        self.assertOneLine(r, f"{PREFIX}refreshed 1.0.1 -> 1.0.2; build cache pruned to 20GB (reclaimed unknown)", 0)
        self.assertEqual(self.record()["build_cache"]["reclaimed"], None)
        self.assertNotIn("touch-me", self.text(self.events_path))

    def test_unchanged_failed_and_status_do_not_prune(self):
        for what, behavior in (("unchanged", dict(package=("1.0.1", "aaa"))), ("failed", dict(fail={"build": 1}))):
            with self.subTest(what):
                self.docker()
                self.behave(**behavior)
                r = self.refresh()
                self.assertEqual(r.code, 1 if what == "failed" else 0, r)
                self.assertEqual(self.prunes(), [])
                self.assertIsNone(self.record()["build_cache"])
                self.assertNotIn("build cache", r.out)
        with self.subTest("status"):
            self.docker()
            self.image("1.0.1", "aaa")
            self.assertEqual(self.call("status").code, 0)
            self.assertEqual(self.prunes(), [])

    def test_a_failed_prune_changes_nothing_of_the_outcome(self):
        self.behave(fail={"builder prune": 1})
        r = self.refresh()
        self.assertOneLine(r, f"{PREFIX}refreshed 1.0.1 -> 1.0.2; build cache prune failed (exit 1)", 0)
        rec = self.record()
        self.assertEqual(rec["outcome"], "refreshed")
        self.assertEqual(rec["build_cache"], dict(outcome="failed", reclaimed=None, keep="20GB"))
        self.assertEqual(self.name_id(), self.state()["built"][0])
        self.assertEqual([o.get("line") for o in self.inbox()], ["EVENT emulator-image refreshed 1.0.1 -> 1.0.2"])
        self.assertIn("standin: builder prune fails", self.text(self.log_path))

    def test_a_prune_that_does_not_end_within_its_bound(self):
        self.behave(hang=["builder prune"])
        self.lower(PRUNE_BOUND=LOWERED)
        r = self.refresh()
        self.assertOneLine(r, f"{PREFIX}refreshed 1.0.1 -> 1.0.2; build cache prune did not end within {LOWERED} s",
                           0)
        self.assertLessEqual(r.seconds, LOWERED + SLACK, r)
        self.assertEqual(self.record()["build_cache"], dict(outcome="timed out", reclaimed=None, keep="20GB"))
        self.assertEqual(self.name_id(), self.state()["built"][0])
        pids = [c["pid"] for c in self.calls("builder prune")]
        self.assertEqual(len(pids), 1)
        self.assertTrue(until(lambda: not alive(pids[0]), GONE_GRACE), f"the prune {pids[0]} is still running")

    def test_nothing_else_of_docker_is_pruned(self):
        for outcome, behavior in Containers.OUTCOMES.items():
            with self.subTest(outcome):
                self.docker()
                self.behave(**behavior)
                self.refresh()
                kinds = [self.kind(c["args"]) for c in self.calls()]
                self.assertEqual([k for k in kinds if k in OTHER_PRUNES], [], kinds)
                for args in self.prunes():
                    for o in ("--all", "-a", "--filter", "--keep-storage", "--reserved-space", "--min-free-space"):
                        self.assertFalse(any(x == o or x.startswith(o + "=") for x in args), f"{o} in {args}")

    def test_the_prune_gets_only_the_allowlisted_environment(self):
        env = self.env(AWS_PROFILE="decoy", AWS_ACCESS_KEY_ID="AKIADECOY", DOCKER_BUILDKIT="1")
        self.image("1.0.1", "aaa")
        r = self.call("refresh", "--foreground", env=env)
        self.assertEqual(r.code, 0, r)
        prunes = self.calls("builder prune")
        self.assertEqual(len(prunes), 1)
        self.assertEqual(sorted(set(prunes[0]["env"]) - ALLOWED_ENV - INTERPRETER_ENV), [])

    def test_the_named_constant(self):
        text = (BIN / SCRIPT).read_text()
        self.assertEqual(re.findall(r'(?m)^BUILD_CACHE_KEEP\s*=\s*(\S+)', text), ['"20GB"'])


if __name__ == "__main__":
    unittest.main()
