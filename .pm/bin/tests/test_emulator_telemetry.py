"""harness.emulator-telemetry: every aws-emulator this repository starts as a server runs with `-t off` (issue #5).

Five parts:

- render: infra/aws-emulator/docker-compose.yml rendered with `docker compose config --format json`, with and
  without EMULATOR_PORT.
- start: the Compose service started as the repository ships it, with an override that takes away the network,
  the ports, the mounts and the environment, under its own project and container name, so an emulator whose
  telemetry is still on reaches nothing. Nothing is built or pulled.
- child environment: every docker and git call is an argument list with a bound and an allowlisted environment;
  no AWS_* variable reaches a child.
- scan of the repository: the checkout's tracked non-Markdown files are searched for starts of the aws-emulator
  image as a server; each one must pass `-t off`.
- scan rules: the same scan on the fixture tree fixtures/emulator-telemetry/scan/, one fixture per rule.

Docker, the Compose plugin and the aws-emulator image are required. Without them a case raises CheckError, which
unittest reports as an error with the reason: never a pass, a failure or a skip.
"""
import contextlib
import dataclasses
import json
import os
import pathlib
import re
import shlex
import subprocess
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
COMPOSE = CHECKOUT / "infra" / "aws-emulator" / "docker-compose.yml"
FIXTURES = HERE / "fixtures" / "emulator-telemetry"
SCAN_FIXTURES = FIXTURES / "scan"
MISSING_IMAGE_COMPOSE = FIXTURES / "missing-image" / "docker-compose.yml"
WORK = CHECKOUT / "output" / "tests" / "emulator-telemetry"
PORTS = CHECKOUT / "output" / "ports.json"

SERVICE = "aws-emulator"
OWNER_CONTAINER = "emuforge-aws-emulator"
DEFAULT_PORT = "9297"
RENDER_PORT = "9411"  # any port other than the default
EMULATOR_HOME = "/home/emulator"  # the image's HOME, in force because the override resets the environment
TELEMETRY_MARKER = "usage and error telemetry:"
WAIT_BOUND = 30.0
POLL_INTERVAL = 0.25
TIMEOUT = {"render": 30, "up": 60, "exec": 10, "down": 60, "git": 30, "inspect": 10}

ENV_ALLOWLIST = ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "TMPDIR")
REPO_SCAN_EXCLUDED = (".pm/bin/tests/test_emulator_telemetry.py", ".pm/bin/tests/fixtures/emulator-telemetry/")
FINDING = "{path}:{line}: starts aws-emulator without -t off"

# The override of the start case. The command is not overridden: it is what the case tests.
OVERRIDE = """\
# Written by .pm/bin/tests/test_emulator_telemetry.py and removed when its case ends.
services:
  aws-emulator:
    container_name: {name}
    network_mode: none
    ports: !reset []
    volumes: !reset []
    environment: !reset {{}}
"""


class CheckError(Exception):
    """The check could not run (Docker, Compose, git or the image missing). unittest reports it as an error."""


# ---------------------------------------------------------------------------------------------- child processes


def child_env(parent=None, port=None):
    """The environment of every child process: the allowlist taken from `parent` (default: this process), plus
    EMULATOR_PORT only when the case sets `port`."""
    parent = os.environ if parent is None else parent
    env = {k: parent[k] for k in ENV_ALLOWLIST if k in parent}
    if port is not None:
        env["EMULATOR_PORT"] = str(port)
    return env


def run(args, timeout, env):
    """One child process: an argument list, never a shell, with a bound and the given environment."""
    try:
        return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env,
                              timeout=timeout)
    except FileNotFoundError as e:
        raise CheckError(f"{args[0]} is not installed or not on PATH: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise CheckError(f"`{' '.join(args[:3])} …` did not finish within {timeout} s") from e


def has_pair(args, first, second):
    return any(a == first and b == second for a, b in zip(args, args[1:]))


def telemetry_off(args):
    return has_pair(args, "-t", "off") or has_pair(args, "--telemetry", "off") or "--telemetry=off" in args


def option_value(args, option):
    for a, b in zip(args, args[1:]):
        if a == option:
            return b
    return None


def render(compose_file, env):
    """`docker compose -f <file> config --format json`, parsed. Needs the Docker CLI with Compose, not the daemon."""
    p = run(["docker", "compose", "-f", str(compose_file), "config", "--format", "json"], TIMEOUT["render"], env)
    if p.returncode != 0:
        raise CheckError(f"docker compose config of {compose_file} failed (exit {p.returncode}): {p.stderr.strip()}")
    return json.loads(p.stdout)


def published_ports(service):
    """The service's published ports as `<host ip>:<published>:<target>`."""
    out = []
    for port in service.get("ports") or []:
        if isinstance(port, dict):
            out.append(f"{port.get('host_ip', '')}:{port.get('published', '')}:{port.get('target', '')}")
        else:
            out.append(str(port))
    return out


# ---------------------------------------------------------------------------------------------- start


def docker_reachable(env):
    p = run(["docker", "info", "--format", "{{.ServerVersion}}"], TIMEOUT["inspect"], env)
    if p.returncode != 0 or not p.stdout.strip():
        raise CheckError(f"Docker is not reachable (docker info exit {p.returncode}): {p.stderr.strip()[-600:]}")


def image_present(image, env):
    p = run(["docker", "image", "inspect", "--format", "{{.Id}}", image], TIMEOUT["inspect"], env)
    return p.returncode == 0


def worktree_port():
    """The emulator port of this checkout's output/ports.json, or None (the Compose default) without one. The
    started container has no network, so the port is only the emulator's own -p."""
    try:
        return str(json.loads(PORTS.read_text())["emulator"])
    except (OSError, ValueError, KeyError):
        return None


@dataclasses.dataclass
class Started:
    project: str
    container: str
    port: str
    override: pathlib.Path
    env: dict


@contextlib.contextmanager
def started(compose_file=None, env=None):
    """Starts service aws-emulator of `compose_file` (default: the repository's) with the override above under a project of its own, and
    removes the project and the override file when the block ends, passed or failed. Raises CheckError when
    Docker is not reachable or the image is not present locally; it never builds or pulls one."""
    compose_file = COMPOSE if compose_file is None else compose_file
    env = child_env(port=worktree_port()) if env is None else env
    docker_reachable(env)
    service = render(compose_file, env)["services"][SERVICE]
    image = service.get("image")
    if not image or not image_present(image, env):
        raise CheckError(f"image {image} is not present locally; this check never builds or pulls an image "
                         f"(build it with the usage line of {COMPOSE.relative_to(CHECKOUT)})")
    port = option_value(service.get("command") or [], "-p")
    project = f"emuforge-test-telemetry-{os.getpid()}-{time.monotonic_ns()}"
    WORK.mkdir(parents=True, exist_ok=True)
    override = WORK / f"{project}.override.yml"
    compose = ["docker", "compose", "-p", project, "-f", str(compose_file), "-f", str(override)]
    try:
        override.write_text(OVERRIDE.format(name=project))
        up = run([*compose, "up", "-d", "--no-build", "--pull", "never"], TIMEOUT["up"], env)
        if up.returncode != 0:
            raise CheckError(f"docker compose up failed (exit {up.returncode}): {up.stderr.strip()[-800:]}")
        yield Started(project=project, container=project, port=port, override=override, env=env)
    finally:
        try:
            run([*compose, "down", "--remove-orphans", "--timeout", "10"], TIMEOUT["down"], env)
        finally:
            override.unlink(missing_ok=True)


def inspect(container, env, fmt=None):
    args = ["docker", "inspect", *(["--format", fmt] if fmt else []), container]
    p = run(args, TIMEOUT["inspect"], env)
    if p.returncode != 0:
        raise CheckError(f"docker inspect {container} failed (exit {p.returncode}): {p.stderr.strip()}")
    return json.loads(p.stdout)


def owner_state(env):
    """`<Id> <State.StartedAt>` of the owner's container, or None when no such container exists."""
    p = run(["docker", "inspect", "--format", "{{.Id}} {{.State.StartedAt}}", OWNER_CONTAINER],
            TIMEOUT["inspect"], env)
    if p.returncode == 0:
        return p.stdout.strip()
    if "no such" in p.stderr.lower():
        return None
    raise CheckError(f"docker inspect {OWNER_CONTAINER} failed (exit {p.returncode}): {p.stderr.strip()}")


def project_containers(project, env):
    p = run(["docker", "ps", "-a", "-q", "--filter", f"label=com.docker.compose.project={project}"],
            TIMEOUT["inspect"], env)
    if p.returncode != 0:
        raise CheckError(f"docker ps failed (exit {p.returncode}): {p.stderr.strip()}")
    return p.stdout.split()


def log_lines(svc):
    """The container's log so far, both streams."""
    p = run(["docker", "logs", svc.container], TIMEOUT["exec"], svc.env)
    return (p.stdout + p.stderr).splitlines()


def health_probe(svc):
    """The health route, called from inside the container's own network namespace and verified against the run's
    ca.pem. Returns (exit status or None, output); a refused connection or a missing ca.pem is just a status."""
    ca = f"{EMULATOR_HOME}/.aws/emulator/{svc.port}/ca.pem"
    url = f"https://127.0.0.1:{svc.port}/__admin/health"
    args = ["docker", "exec", svc.container, "curl", "-q", "-sS", "--max-time", "5", "--cacert", ca,
            "-w", "\n%{http_code}", url]
    try:
        p = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", env=svc.env,
                           timeout=TIMEOUT["exec"])
    except subprocess.TimeoutExpired:
        return None, f"docker exec did not finish within {TIMEOUT['exec']} s"
    except FileNotFoundError as e:
        raise CheckError(f"docker is not installed or not on PATH: {e}") from e
    return p.returncode, p.stdout + p.stderr


def wait_for_telemetry_line(source, bound=WAIT_BOUND):
    """Reads `source()` (a list of log lines) again until a line holds the telemetry marker; returns that line.
    Past `bound` seconds: a failure naming the bound and the last lines the source gave."""
    deadline = time.monotonic() + bound
    while True:
        lines = source()
        for line in lines:
            if TELEMETRY_MARKER in line:
                return line
        now = time.monotonic()
        if now >= deadline:
            last = "\n".join(lines[-10:]) or "(none)"
            raise AssertionError(f"no log line containing {TELEMETRY_MARKER!r} within {bound:g} s; "
                                 f"last log lines:\n{last}")
        time.sleep(min(POLL_INTERVAL, deadline - now))


def wait_for_health(probe, bound=WAIT_BOUND):
    """Calls `probe()` (exit status, output) again until it exits 0 with body `ok` and status 200. Past `bound`
    seconds: a failure naming the bound and the last probe's exit status and output."""
    deadline = time.monotonic() + bound
    while True:
        status, output = probe()
        if status == 0 and output.strip().splitlines() == ["ok", "200"]:
            return
        now = time.monotonic()
        if now >= deadline:
            raise AssertionError(f"the health route did not answer ok with 200 within {bound:g} s; last probe "
                                 f"exit status {status}, output: {output.strip()[-600:]}")
        time.sleep(min(POLL_INTERVAL, deadline - now))


# ---------------------------------------------------------------------------------------------- scan

QUOTES = "\"'`"
DELIMITERS = set(QUOTES) | set("$,;()[]{}&|<>")
BRACKET_SUFFIXES = (".rs", ".ts", ".tsx", ".js", ".mjs", ".cjs")  # an argument list ends at `]`
ONE_SHOT = ("--version", "-v", "--help", "-h")
END = object()  # end of an argument list in a Rust or TypeScript file
IMAGE_LINE = re.compile(r"^(\s*)image:\s*(\S+)\s*(#.*)?$")
KEY_LINE = re.compile(r"^(\s*)([A-Za-z0-9._-]+):\s*(#.*)?$")


@dataclasses.dataclass
class Site:
    path: str
    line: int
    kind: str  # "start" or "compose"
    passed: bool


def runs(text):
    """Runs of characters other than whitespace, the three quotes, `$` and `,;()[]{}&|<>`."""
    out, buf = [], []
    for c in text:
        if c.isspace() or c in DELIMITERS:
            if buf:
                out.append("".join(buf))
                buf = []
        else:
            buf.append(c)
    if buf:
        out.append("".join(buf))
    return out


def line_tokens(line, brackets):
    """A quoted string without whitespace is one token without its quotes; the inside of one with whitespace and
    everything else splits into runs. In bracket mode an unquoted `]` yields END."""
    out, buf = [], []

    def flush():
        if buf:
            out.append("".join(buf))
            buf.clear()

    i = 0
    while i < len(line):
        c = line[i]
        if c in QUOTES:
            j = line.find(c, i + 1)
            if j != -1:
                flush()
                inner = line[i + 1:j]
                if inner and not any(ch.isspace() for ch in inner):
                    out.append(inner)
                else:
                    out.extend(runs(inner))
                i = j + 1
                continue
        if c.isspace() or c in DELIMITERS:
            flush()
            if brackets and c == "]":
                out.append(END)
        else:
            buf.append(c)
        i += 1
    flush()
    return out


def statements(text, brackets):
    """The file's statements as lists of (token, line number). A shell statement ends with a line that has no
    trailing backslash; a Rust or TypeScript argument list ends at `]`."""
    out, cur = [], []
    for number, line in enumerate(text.split("\n"), 1):
        continued = not brackets and line.rstrip().endswith("\\")
        if continued:
            line = line.rstrip()[:-1]
        for tok in line_tokens(line, brackets):
            if tok is END:
                if cur:
                    out.append(cur)
                cur = []
            else:
                cur.append((tok, number))
        if not brackets and not continued:
            if cur:
                out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def is_image(token):
    """`aws-emulator`, with an optional `:<tag>` or `@<digest>` and a leading path whose first part is a registry
    host (contains `.` or `:`, or is `localhost`)."""
    name = token.split("@", 1)[0]
    if name.rfind(":") > name.rfind("/"):
        name = name[:name.rfind(":")]
    if "/" in name:
        first = name.split("/", 1)[0]
        if not ("." in first or ":" in first or first == "localhost"):
            return False
        name = name.rsplit("/", 1)[1]
    return name == "aws-emulator"


def is_build(tokens):
    return any(t == "docker" and "build" in tokens[i + 1:] for i, t in enumerate(tokens))


def start_sites(rel, text):
    dockerfile = pathlib.PurePosixPath(rel).name == "Dockerfile"
    sites = []
    for stmt in statements(text, rel.endswith(BRACKET_SUFFIXES)):
        tokens = [t for t, _ in stmt]
        for k, (tok, number) in enumerate(stmt):
            if not is_image(tok):
                continue
            prev = tokens[k - 1] if k else None
            nxt = tokens[k + 1] if k + 1 < len(tokens) else None
            if dockerfile and prev in ("ENTRYPOINT", "CMD"):
                continue  # the image's program; its arguments join each start site's own
            if prev == "--entrypoint":
                continue
            if prev in ("-t", "--tag") and is_build(tokens[:k]):
                continue  # a build tag; in `docker run -t aws-emulator`, -t is the TTY flag
            if nxt is None or nxt in ONE_SHOT or not nxt.startswith("-"):
                continue
            sites.append(Site(rel, number, "start", telemetry_off(tokens[k + 1:])))
    return sites


def is_compose_file(rel):
    name = pathlib.PurePosixPath(rel).name
    return "compose" in name and name.endswith((".yml", ".yaml"))


def compose_sites(root, rel, text):
    """A Compose service whose `image:` is the aws-emulator image passes when the file's render shows `-t off`
    in that service's command."""
    lines = text.split("\n")
    sites, rendered = [], None
    for number, line in enumerate(lines, 1):
        m = IMAGE_LINE.match(line)
        if not m or not is_image(m.group(2).strip("\"'")):
            continue
        indent = len(m.group(1))
        service = None
        for above in reversed(lines[:number - 1]):
            key = KEY_LINE.match(above)
            if key and len(key.group(1)) < indent:
                service = key.group(2)
                break
        if rendered is None:
            rendered = render(root / rel, child_env())
        command = (rendered.get("services", {}).get(service) or {}).get("command") or []
        if isinstance(command, str):
            command = shlex.split(command)
        sites.append(Site(rel, number, "compose", telemetry_off(command)))
    return sites


def tracked_files(root):
    p = run(["git", "-C", str(root), "ls-files", "-z", "--", "."], TIMEOUT["git"], child_env())
    if p.returncode != 0:
        raise CheckError(f"git ls-files in {root} failed (exit {p.returncode}): {p.stderr.strip()}")
    return [f for f in p.stdout.split("\0") if f]


def excluded(rel, extra):
    if rel.lower().endswith(".md") or rel.startswith(("issues/", ".pm/archive/")):
        return True
    return any(rel == e or (e.endswith("/") and rel.startswith(e)) for e in extra)


def scan(root, paths, extra_excluded=()):
    """Start sites in `paths` (relative to `root`), skipping symlinks, files that are not UTF-8, `*.md`, `issues/`,
    `.pm/archive/` and `extra_excluded`. Returns (sites, the paths scanned)."""
    sites, scanned = [], []
    for rel in paths:
        full = root / rel
        if excluded(rel, extra_excluded) or full.is_symlink() or not full.is_file():
            continue
        try:
            text = full.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            continue
        scanned.append(rel)
        found = start_sites(rel, text)
        if is_compose_file(rel):
            found += compose_sites(root, rel, text)
        sites.extend(sorted(found, key=lambda s: s.line))
    return sites, scanned


def findings(sites):
    return [FINDING.format(path=s.path, line=s.line) for s in sites if not s.passed]


# ---------------------------------------------------------------------------------------------- tests: render


class Render(unittest.TestCase):
    def service(self, port):
        return render(COMPOSE, child_env(port=port))["services"][SERVICE]

    def test_default_port_command_has_t_off(self):
        command = self.service(None).get("command") or []
        self.assertTrue(has_pair(command, "-p", DEFAULT_PORT), f"command {command} has no -p {DEFAULT_PORT}")
        self.assertTrue(has_pair(command, "-t", "off"), f"command {command} has no -t off")

    def test_set_port_command_has_t_off_and_one_loopback_port(self):
        service = self.service(RENDER_PORT)
        command = service.get("command") or []
        self.assertTrue(has_pair(command, "-p", RENDER_PORT), f"command {command} has no -p {RENDER_PORT}")
        self.assertTrue(has_pair(command, "-t", "off"), f"command {command} has no -t off")
        self.assertEqual(published_ports(service), [f"127.0.0.1:{RENDER_PORT}:{RENDER_PORT}"])


# ---------------------------------------------------------------------------------------------- tests: start


def outcome(fn):
    try:
        return fn(), None
    except Exception as e:  # kept and raised again by the case that observes it
        return None, e


def result(pair):
    value, error = pair
    if error is not None:
        raise error
    return value


class Start(unittest.TestCase):
    """One container for the observations, in the design's order: Args, telemetry line, health, directory."""

    @classmethod
    def setUpClass(cls):
        cls.stack = contextlib.ExitStack()
        cls.svc = cls.stack.enter_context(started())
        try:
            cls.telemetry = outcome(lambda: wait_for_telemetry_line(lambda: log_lines(cls.svc)))
            cls.health = outcome(lambda: wait_for_health(lambda: health_probe(cls.svc)))
        except BaseException:
            cls.stack.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.stack.close()

    def test_container_has_no_network_port_or_mount(self):
        info = inspect(self.svc.container, self.svc.env)[0]
        self.assertEqual(info["HostConfig"]["NetworkMode"], "none")
        self.assertFalse(info["HostConfig"].get("PortBindings"), info["HostConfig"].get("PortBindings"))
        self.assertFalse(info["NetworkSettings"].get("Ports"), info["NetworkSettings"].get("Ports"))
        self.assertEqual(info.get("Mounts") or [], [])

    def test_args_have_t_off(self):
        args = inspect(self.svc.container, self.svc.env, "{{json .Args}}")
        self.assertTrue(has_pair(args, "-t", "off"), f"container Args {args} have no -t off")

    def test_telemetry_line_says_disabled(self):
        line = result(self.telemetry)
        self.assertIn("telemetry: disabled", line)

    def test_health_answers_ok_200(self):
        result(self.health)

    def test_no_telemetry_directory_once_ready(self):
        result(self.health)
        path = f"{EMULATOR_HOME}/.aws/emulator/telemetry"
        p = run(["docker", "exec", self.svc.container, "test", "!", "-e", path], TIMEOUT["exec"], self.svc.env)
        self.assertEqual(p.returncode, 0, f"{path} exists in the container (exit {p.returncode}) {p.stderr.strip()}")


class StartCleanup(unittest.TestCase):
    def assert_running(self, svc):
        self.assertTrue(project_containers(svc.project, svc.env), f"no container of project {svc.project}")
        self.assertTrue(svc.override.exists(), svc.override)

    def assert_gone(self, svc):
        self.assertEqual(project_containers(svc.project, svc.env), [], f"project {svc.project} left containers")
        self.assertFalse(svc.override.exists(), f"{svc.override} is left behind")

    def test_cleanup_after_a_pass(self):
        with started() as svc:
            self.assert_running(svc)
        self.assert_gone(svc)

    def test_cleanup_after_a_failure(self):
        with self.assertRaises(AssertionError):
            with started() as svc:
                self.assert_running(svc)
                raise AssertionError("a failure inside the started block")
        self.assert_gone(svc)


class OwnerContainer(unittest.TestCase):
    def test_owner_container_untouched(self):
        # Exists: the same Id and StartedAt before and after. None: still none afterwards.
        env = child_env()
        before = owner_state(env)
        with started():
            pass
        self.assertEqual(owner_state(env), before)


class BoundedWaits(unittest.TestCase):
    def test_telemetry_line_bound(self):
        lines = ["emulator starting (fixture line 1)", "still starting (fixture line 2)"]
        t0 = time.monotonic()
        with self.assertRaises(AssertionError) as cm:
            wait_for_telemetry_line(lambda: list(lines), bound=1)
        self.assertGreaterEqual(time.monotonic() - t0, 1)
        message = str(cm.exception)
        self.assertIn("within 1 s", message)
        for line in lines:
            self.assertIn(line, message)

    def test_health_bound(self):
        text = "curl: (7) Failed to connect to 127.0.0.1 port 9399: Connection refused (fixture)"
        t0 = time.monotonic()
        with self.assertRaises(AssertionError) as cm:
            wait_for_health(lambda: (7, text), bound=1)
        self.assertGreaterEqual(time.monotonic() - t0, 1)
        message = str(cm.exception)
        self.assertIn("within 1 s", message)
        self.assertIn("exit status 7", message)
        self.assertIn(text, message)


class StartCannotHappen(unittest.TestCase):
    def test_missing_image_is_an_error_and_nothing_is_built_or_pulled(self):
        env = child_env()
        docker_reachable(env)
        image = render(MISSING_IMAGE_COMPOSE, env)["services"][SERVICE]["image"]
        self.assertFalse(image_present(image, env), f"{image} exists before the case")
        with self.assertRaises(CheckError) as cm:
            with started(MISSING_IMAGE_COMPOSE, env):
                pass
        self.assertIn(image, str(cm.exception))
        self.assertFalse(image_present(image, env), f"{image} was built or pulled")

    def test_unreachable_docker_is_an_error_naming_docker(self):
        WORK.mkdir(parents=True, exist_ok=True)
        socket = WORK / "no-such-docker.sock"
        self.assertFalse(socket.exists())
        parent = {k: v for k, v in os.environ.items() if k != "DOCKER_CONTEXT"}
        parent["DOCKER_HOST"] = f"unix://{socket}"
        with self.assertRaises(CheckError) as cm:
            with started(COMPOSE, child_env(parent)):
                pass
        self.assertNotIsInstance(cm.exception, AssertionError)
        self.assertIn("Docker", str(cm.exception))


# ---------------------------------------------------------------------------------------------- tests: child env


LISTED = ("AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_CONFIG_FILE",
          "AWS_SHARED_CREDENTIALS_FILE", "EMULATOR_PORT")
PARENT = {"PATH": "/usr/bin:/bin", "HOME": "/home/fixture", **{k: f"fixture-{k.lower()}" for k in LISTED},
          "EMULATOR_PORT": "9399", "EMUFORGE_FIXTURE_UNRELATED": "fixture"}


class ChildEnvironment(unittest.TestCase):
    def test_without_port(self):
        env = child_env(PARENT)
        self.assertEqual(env.get("PATH"), PARENT["PATH"])
        self.assertEqual(env.get("HOME"), PARENT["HOME"])
        for name in (*LISTED, "EMUFORGE_FIXTURE_UNRELATED"):
            self.assertNotIn(name, env)

    def test_with_port(self):
        env = child_env(PARENT, port="9412")
        self.assertEqual(env.get("EMULATOR_PORT"), "9412")
        for name in LISTED[:-1]:
            self.assertNotIn(name, env)


# ---------------------------------------------------------------------------------------------- tests: scan


class RepositoryScan(unittest.TestCase):
    def test_every_start_site_passes_t_off(self):
        sites, _ = scan(CHECKOUT, tracked_files(CHECKOUT), REPO_SCAN_EXCLUDED)
        found = {(s.path, s.kind) for s in sites}
        for expected in (("infra/aws-emulator/docker-compose.yml", "compose"), ("tests/integration/run", "start"),
                         ("tests/integration/engine/support/emulator.rs", "start"),
                         ("tests/integration/studio/support/emulator.ts", "start")):
            self.assertIn(expected, found, f"start site not found: {expected}")
        failing = findings(sites)
        self.assertEqual(failing, [], "\n".join(failing))


class ScanRules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tracked = tracked_files(SCAN_FIXTURES)

    def scan_case(self, name):
        paths = [p for p in self.tracked if p == name or p.startswith(name + "/")]
        self.assertTrue(paths, f"fixture {name} is not tracked under {SCAN_FIXTURES}")
        return scan(SCAN_FIXTURES, paths)

    def assert_reported(self, name, lines):
        sites, scanned = self.scan_case(name)
        self.assertEqual(scanned, [name])
        self.assertEqual(findings(sites), [FINDING.format(path=name, line=n) for n in lines])

    def assert_passing_start(self, name):
        """One start site, which passes: nothing is reported."""
        sites, scanned = self.scan_case(name)
        self.assertEqual(scanned, [name])
        self.assertEqual([s.passed for s in sites], [True], sites)
        self.assertEqual(findings(sites), [])

    def assert_no_start(self, name):
        """Scanned, and no start site found."""
        sites, scanned = self.scan_case(name)
        self.assertEqual(scanned, [name])
        self.assertEqual(sites, [])

    def assert_not_scanned(self, name):
        sites, scanned = self.scan_case(name)
        self.assertEqual(scanned, [])
        self.assertEqual(findings(sites), [])

    def test_shell_without_flag(self):
        self.assert_reported("shell-unflagged.sh", [1])

    def test_shell_flag_t_off(self):
        self.assert_passing_start("shell-flag-t-off.sh")

    def test_shell_flag_telemetry_off(self):
        self.assert_passing_start("shell-flag-telemetry-off.sh")

    def test_shell_flag_telemetry_equals_off(self):
        self.assert_passing_start("shell-flag-telemetry-equals-off.sh")

    def test_flag_on_continuation_line(self):
        self.assert_passing_start("continuation-flag-on-next-line.sh")

    def test_flag_after_the_statement_ended(self):
        self.assert_reported("flag-after-statement.sh", [1])

    def test_rust_array_without_flag(self):
        self.assert_reported("rust-unflagged.rs", [3])

    def test_rust_array_with_flag(self):
        self.assert_passing_start("rust-flagged.rs")

    def test_typescript_array_without_flag(self):
        self.assert_reported("typescript-unflagged.ts", [4])

    def test_typescript_array_with_flag(self):
        self.assert_passing_start("typescript-flagged.ts")

    def test_inside_command_substitution(self):
        self.assert_reported("subshell-unflagged.sh", [1])

    def test_image_with_tag(self):
        self.assert_reported("image-tag.sh", [1])

    def test_image_with_registry_path(self):
        self.assert_reported("image-registry-path.sh", [1])

    def test_run_with_tty_flag(self):
        self.assert_reported("run-tty-flag.sh", [1])

    def test_compose_without_flag(self):
        self.assert_reported("compose-unflagged.compose.yml", [4])

    def test_compose_with_flag(self):
        self.assert_passing_start("compose-flagged.compose.yml")

    def test_two_starts_in_file_order(self):
        self.assert_reported("two-unflagged.sh", [2, 4])

    def test_ignored_entrypoint_option(self):
        self.assert_no_start("ignored-entrypoint-option.sh")

    def test_ignored_one_shot_version(self):
        self.assert_no_start("ignored-one-shot-version.sh")

    def test_ignored_one_shot_help(self):
        self.assert_no_start("ignored-one-shot-help.sh")

    def test_ignored_dockerfile_entrypoint(self):
        self.assert_no_start("dockerfile-entrypoint/Dockerfile")

    def test_ignored_build_tag(self):
        self.assert_no_start("ignored-build-tag.sh")

    def test_ignored_image_inspect(self):
        self.assert_no_start("ignored-image-inspect.sh")

    def test_ignored_prose_comment(self):
        self.assert_no_start("ignored-prose-comment.sh")

    def test_ignored_path(self):
        self.assert_no_start("ignored-path.sh")

    def test_not_scanned_markdown(self):
        self.assert_not_scanned("not-scanned-markdown.md")

    def test_not_scanned_under_issues(self):
        self.assert_not_scanned("issues/not-scanned-start.sh")

    def test_not_scanned_symlink(self):
        self.assert_not_scanned("not-scanned-symlink.sh")

    def test_not_scanned_not_utf8(self):
        self.assert_not_scanned("not-scanned-not-utf8.sh")


if __name__ == "__main__":
    unittest.main()
