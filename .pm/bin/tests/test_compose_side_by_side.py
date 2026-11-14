"""harness.compose-side-by-side: the Compose file runs one emulator per port side by side (issue #6).

Parts:

- render: infra/aws-emulator/docker-compose.yml rendered with `docker compose config --format json` with
  EMULATOR_PORT unset, empty, one port and two ports. Needs the Docker CLI with Compose, not the daemon.
- side by side: two emulators started from the shipped file on ports A and B, each healthy on its own port
  against its own ca.pem; the second start, a repeated start and the second stop leave the first as it was.
- port already published: a start on port C while a holder container publishes C fails and replaces nothing.
- helpers on their own: the identity guard, the leftover step, the port choice, the bounded waits, the cases
  that cannot run and the child environment.

Safety: before any `up`, the identity guard asserts that every rendered project and container name is neither the
owner's (`emuforge`, `emuforge-aws-emulator`) nor another port's, and that every rendered command has `-t off`;
the leftover step refuses (CheckError) a container, project, network, directory or listener the run did not
create, and only what the run created is removed. Ports are loopback only, never 9297 or a pm-worktree slot's.
Every `up` passes `--no-build --pull never`. Only `~/.aws/emulator/<port>/ca.pem` is read, never printed.

Docker, the Compose plugin and the image the file names are required. Without them a case raises CheckError,
which unittest reports as an error with the reason: never a pass, a failure or a skip.
"""
import contextlib
import dataclasses
import functools
import hashlib
import http.client
import itertools
import json
import os
import pathlib
import shutil
import socket
import ssl
import subprocess
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
COMPOSE = CHECKOUT / "infra" / "aws-emulator" / "docker-compose.yml"
FIXTURES = HERE / "fixtures" / "compose-side-by-side"
MISSING_IMAGE_COMPOSE = FIXTURES / "missing-image" / "docker-compose.yml"
FIXED_NAMES_COMPOSE = FIXTURES / "fixed-names" / "docker-compose.yml"
WORK = CHECKOUT / "output" / "tests" / "compose-side-by-side"
PORTS = CHECKOUT / "output" / "ports.json"
PM_MEM = CHECKOUT / ".pm" / "bin" / "pm-mem"

SERVICE = "aws-emulator"
OWNER_PROJECT = "emuforge"
OWNER_CONTAINER = "emuforge-aws-emulator"
DEFAULT_PORT = 9297
RENDER_PORTS = (9412, 9413)  # rendering starts nothing, so these need not be free
RESERVED = (range(8100, 8200), range(8300, 8400), range(9300, 9400))  # pm-worktree's slot ranges
PORT_DRAWS = 20
PROJECT_LABEL = "com.docker.compose.project"
ALLOCATED = "port is already allocated"
WAIT_BOUND = 30.0
POLL_INTERVAL = 0.25
TIMEOUT = {"render": 30, "up": 60, "down": 60, "inspect": 10, "ps": 10, "holder": 30, "pm-mem": 10}

ENV_ALLOWLIST = ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "TMPDIR")


class CheckError(Exception):
    """The check could not run (Docker, Compose, the image, memory, a leftover). unittest reports it as an error."""


# ---------------------------------------------------------------------------------------------- child processes


def child_env(parent=None, port=None):
    """The environment of every child process: the allowlist taken from `parent` (default: this process), plus
    EMULATOR_PORT only when the call sets `port`."""
    parent = os.environ if parent is None else parent
    env = {k: parent[k] for k in ENV_ALLOWLIST if k in parent}
    if port is not None:
        env["EMULATOR_PORT"] = str(port)
    return env


def run(args, timeout, env):
    """One child process: an argument list, never a shell, with a bound and the given environment."""
    args = [str(a) for a in args]
    try:
        return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env,
                              timeout=timeout)
    except FileNotFoundError as e:
        raise CheckError(f"{args[0]} is not installed or not on PATH: {e}") from e
    except PermissionError as e:
        raise CheckError(f"{args[0]} cannot be run: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise CheckError(f"`{' '.join(args[:4])} …` did not finish within {timeout} s") from e


def tail(p, n=800):
    return (p.stdout + p.stderr).strip()[-n:]


def ensure(condition, message):
    """A failed observation of the sequence: an assertion, recorded for the cases."""
    if not condition:
        raise AssertionError(message)


def has_pair(args, first, second):
    return any(a == first and b == second for a, b in zip(args, args[1:]))


# ---------------------------------------------------------------------------------------------- render


@dataclasses.dataclass(frozen=True)
class Rendered:
    port: object  # the EMULATOR_PORT of the render (None: unset)
    project: str
    container: str
    command: tuple
    ports: tuple
    image: str


def published_ports(service):
    """The service's published ports as `<host ip>:<published>:<target>`."""
    out = []
    for port in service.get("ports") or []:
        if isinstance(port, dict):
            out.append(f"{port.get('host_ip', '')}:{port.get('published', '')}:{port.get('target', '')}")
        else:
            out.append(str(port))
    return tuple(out)


def observe(compose_file, port, parent=None):
    """`docker compose -f <file> config --format json` with EMULATOR_PORT=<port> (unset for None), reduced to what
    the check observes."""
    env = child_env(parent, port)
    p = run(["docker", "compose", "-f", compose_file, "config", "--format", "json"], TIMEOUT["render"], env)
    if p.returncode != 0:
        raise CheckError(f"docker compose config of {compose_file} failed (exit {p.returncode}): {p.stderr.strip()}")
    doc = json.loads(p.stdout)
    service = doc["services"][SERVICE]
    return Rendered(port=port, project=doc.get("name", ""), container=service.get("container_name", ""),
                    command=tuple(service.get("command") or ()), ports=published_ports(service),
                    image=service.get("image", ""))


def describe(r):
    return f"port {r.port}: project {r.project!r}, container {r.container!r}"


def guard(*renders):
    """The identity guard: for each render, the project is not the owner's, the container name is not the
    owner's and the command has `-t off`; two renders never share a project or a container name. Runs nothing;
    raises an assertion naming the rendered names."""
    problems = []
    for r in renders:
        if r.project == OWNER_PROJECT:
            problems.append(f"port {r.port} renders the owner's project {OWNER_PROJECT!r}")
        if r.container == OWNER_CONTAINER:
            problems.append(f"port {r.port} renders the owner's container name {OWNER_CONTAINER!r}")
        if not has_pair(r.command, "-t", "off"):
            problems.append(f"port {r.port} renders command {list(r.command)} without -t off")
    for r1, r2 in itertools.combinations(renders, 2):
        if r1.project == r2.project:
            problems.append(f"ports {r1.port} and {r2.port} render the same project {r1.project!r}")
        if r1.container == r2.container:
            problems.append(f"ports {r1.port} and {r2.port} render the same container name {r1.container!r}")
    if problems:
        raise AssertionError("identity guard: nothing was started; " + "; ".join(problems) + " (rendered: "
                             + "; ".join(describe(r) for r in renders) + ")")


# ---------------------------------------------------------------------------------------------- ports


@dataclasses.dataclass(frozen=True)
class PortSet:
    a: int
    b: int
    c: int
    d: int


def allowed(port):
    return port != DEFAULT_PORT and not any(port in r for r in RESERVED)


def free_port(exclude=()):
    """A free loopback port: bind 127.0.0.1:0 and read the port. A port that is 9297, inside a pm-worktree range or
    in `exclude` is discarded and another is drawn, at most PORT_DRAWS times."""
    for _ in range(PORT_DRAWS):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        if allowed(port) and port not in exclude:
            return port
    raise CheckError(f"no free loopback port outside 9297 and the pm-worktree ranges in {PORT_DRAWS} draws")


def choose_ports(ports_file=PORTS):
    """A: the `emulator` port of `ports_file` when it exists, otherwise a free loopback port. B, C, D: free
    loopback ports, different from A and from each other."""
    ports_file = pathlib.Path(ports_file)
    if ports_file.exists():
        try:
            a = int(json.loads(ports_file.read_text())["emulator"])
        except (OSError, ValueError, KeyError, TypeError) as e:
            raise CheckError(f"{ports_file} has no usable emulator port: {e}") from e
        if a == DEFAULT_PORT:
            raise CheckError(f"{ports_file} names emulator port {DEFAULT_PORT}, the owner's default port; "
                             f"this check never uses it")
    else:
        a = free_port()
    chosen = [a]
    for _ in range(3):
        chosen.append(free_port(exclude=chosen))
    return PortSet(*chosen)


@functools.cache
def run_ports():
    """The ports of this run, chosen once."""
    return choose_ports(PORTS)


# ---------------------------------------------------------------------------------------------- docker state


def docker_reachable(env):
    p = run(["docker", "info", "--format", "{{.ServerVersion}}"], TIMEOUT["inspect"], env)
    if p.returncode != 0 or not p.stdout.strip():
        raise CheckError(f"Docker is not reachable (docker info exit {p.returncode}): {p.stderr.strip()[-600:]}")


def image_present(image, env):
    p = run(["docker", "image", "inspect", "--format", "{{.Id}}", image], TIMEOUT["inspect"], env)
    return p.returncode == 0


def missing(p):
    text = p.stderr.lower()
    return "no such" in text or "not found" in text


def container_id(name, env):
    """The container's Id, or None when no container has that name."""
    p = run(["docker", "container", "inspect", "--format", "{{.Id}}", name], TIMEOUT["inspect"], env)
    if p.returncode == 0:
        return p.stdout.strip()
    if missing(p):
        return None
    raise CheckError(f"docker container inspect {name} failed (exit {p.returncode}): {p.stderr.strip()}")


def container_state(name, env):
    """(Id, State.StartedAt, State.Running) of the container; CheckError when it does not exist."""
    p = run(["docker", "container", "inspect", "--format", "{{.Id}} {{.State.StartedAt}} {{.State.Running}}", name],
            TIMEOUT["inspect"], env)
    if p.returncode != 0:
        raise CheckError(f"docker container inspect {name} failed (exit {p.returncode}): {p.stderr.strip()}")
    cid, started_at, running = p.stdout.split()
    return cid, started_at, running == "true"


def owner_state(env):
    """`<Id> <State.StartedAt>` of the owner's container, or None when no such container exists."""
    p = run(["docker", "container", "inspect", "--format", "{{.Id}} {{.State.StartedAt}}", OWNER_CONTAINER],
            TIMEOUT["inspect"], env)
    if p.returncode == 0:
        return p.stdout.strip()
    if missing(p):
        return None
    raise CheckError(f"docker container inspect {OWNER_CONTAINER} failed (exit {p.returncode}): {p.stderr.strip()}")


def project_containers(project, env, running_only=False):
    """[(Id, state)] of the containers labelled with the project, sorted."""
    args = ["docker", "ps", "--no-trunc", "--filter", f"label={PROJECT_LABEL}={project}", "--format",
            "{{.ID}} {{.State}}"]
    if not running_only:
        args.insert(2, "-a")
    p = run(args, TIMEOUT["ps"], env)
    if p.returncode != 0:
        raise CheckError(f"docker ps failed (exit {p.returncode}): {p.stderr.strip()}")
    return sorted(tuple(line.split()) for line in p.stdout.splitlines() if line.strip())


def network_id(name, env):
    """The network's Id, or None when no network has that name."""
    p = run(["docker", "network", "inspect", "--format", "{{.Id}}", name], TIMEOUT["inspect"], env)
    if p.returncode == 0:
        return p.stdout.strip()
    if missing(p):
        return None
    raise CheckError(f"docker network inspect {name} failed (exit {p.returncode}): {p.stderr.strip()}")


def default_network(project):
    return f"{project}_default"


def snapshot(renders, env, containers=()):
    """What exists of the rendered projects: containers by project label, the default network, the container by
    its rendered name, the emulator directory; and the containers named in `containers`."""
    out = {}
    for r in renders:
        out[f"containers of project {r.project}"] = [cid for cid, _ in project_containers(r.project, env)]
        out[f"network {default_network(r.project)}"] = network_id(default_network(r.project), env)
        out[f"container {r.container}"] = container_id(r.container, env)
        out[f"directory {emulator_dir(r.port)}"] = os.path.lexists(emulator_dir(r.port))
    for name in containers:
        out[f"container {name}"] = container_id(name, env)
    return out


def left(snap):
    return {k: v for k, v in snap.items() if v}


# ---------------------------------------------------------------------------------------------- emulator files


def emulator_root():
    return pathlib.Path(os.environ["HOME"]) / ".aws" / "emulator"


def emulator_dir(port):
    return emulator_root() / str(int(port))


def ca_file(port):
    return emulator_dir(port) / "ca.pem"


def ca_digest(port):
    """SHA-256 of the port's ca.pem, kept in memory and never printed."""
    return hashlib.sha256(ca_file(port).read_bytes()).hexdigest()


def remove_dir(port):
    """Removes ~/.aws/emulator/<port>: the path is built from the integer port, must be a direct child of
    ~/.aws/emulator and a real directory, not a symlink; otherwise CheckError and nothing is removed. A path
    that does not exist is left as it is."""
    root = emulator_root()
    path = root / str(int(port))
    if path.is_symlink():
        raise CheckError(f"{path} is a symlink; it is not removed")
    if not os.path.lexists(path):
        return
    if path.resolve().parent != root.resolve() or not path.is_dir():
        raise CheckError(f"{path} is not a directory directly under {root}; it is not removed")
    shutil.rmtree(path)


# ---------------------------------------------------------------------------------------------- probes and waits


@dataclasses.dataclass
class Probe:
    status: object = None  # HTTP status, or None
    body: str = ""
    error: str = ""
    cert_failure: bool = False

    @property
    def ok(self):
        return self.status == 200 and self.body.strip() == "ok"

    def __str__(self):
        if self.error:
            return self.error
        return f"status {self.status}, body {self.body.strip()[:200]!r}"


def health(port, cafile):
    """GET https://127.0.0.1:<port>/__admin/health, certificate and host verified against `cafile`. A missing CA
    file, a refused connection or a TLS error is a result, not an exception."""
    cafile = pathlib.Path(cafile)
    if not cafile.is_file():
        return Probe(error=f"no CA file at {cafile}")
    try:
        context = ssl.create_default_context(cafile=str(cafile))
    except (ssl.SSLError, OSError) as e:
        return Probe(error=f"CA file {cafile} could not be loaded: {type(e).__name__}")
    conn = http.client.HTTPSConnection("127.0.0.1", int(port), timeout=5, context=context)
    try:
        conn.request("GET", "/__admin/health")
        response = conn.getresponse()
        return Probe(status=response.status, body=response.read(256).decode("utf-8", "replace"))
    except ssl.SSLCertVerificationError as e:
        return Probe(error=f"certificate verification failed: {e.verify_message}", cert_failure=True)
    except (OSError, http.client.HTTPException) as e:
        return Probe(error=f"{type(e).__name__}: {e}")
    finally:
        conn.close()


def wait_for_health(probe, bound=WAIT_BOUND):
    """Calls `probe()` again until it answers ok with 200. Past `bound` seconds: a failure naming the bound and
    the last probe's result."""
    deadline = time.monotonic() + bound
    while True:
        last = probe()
        if last.ok:
            return last
        now = time.monotonic()
        if now >= deadline:
            raise AssertionError(f"the health route did not answer ok with 200 within {bound:g} s; last probe: {last}")
        time.sleep(min(POLL_INTERVAL, deadline - now))


def assert_stopped(port):
    """One TCP connect to 127.0.0.1:<port>; passes when it is refused or reset."""
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=2):
            pass
    except (ConnectionRefusedError, ConnectionResetError):
        return
    except OSError as e:
        raise AssertionError(f"a TCP connect to 127.0.0.1:{port} was not refused: {type(e).__name__}: {e}")
    raise AssertionError(f"a TCP connect to 127.0.0.1:{port} was accepted; something still listens on port {port}")


def port_held(port):
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=2):
            return True
    except (ConnectionRefusedError, ConnectionResetError):
        return False
    except OSError:
        return True


# ---------------------------------------------------------------------------------------------- the sequence


def preflight(rendered, env, pm_mem=PM_MEM):
    """`pm-mem --check` exits 0, Docker is reachable and the image the render names is present locally. Never
    builds or pulls; CheckError on any."""
    p = run([pm_mem, "--check"], TIMEOUT["pm-mem"], env)
    if p.returncode != 0:
        raise CheckError(f"memory: {pm_mem} --check exited {p.returncode}, no emulator is started: {tail(p, 300)}")
    docker_reachable(env)
    if not rendered.image or not image_present(rendered.image, env):
        raise CheckError(f"image {rendered.image} is not present locally; this check never builds or pulls an image "
                         f"(build it with the usage line of {COMPOSE.relative_to(CHECKOUT)})")


def leftovers(port, rendered, env):
    """The leftover step for one port: no container with the rendered container name, none labelled with the
    rendered project, no network <project>_default, no ~/.aws/emulator/<port>, and nothing accepting on
    127.0.0.1:<port>. CheckError naming the leftover; nothing is removed."""
    cid = container_id(rendered.container, env)
    if cid:
        raise CheckError(f"leftover: container {rendered.container} exists ({cid[:12]}); this check never removes "
                         f"what it did not create")
    labelled = project_containers(rendered.project, env)
    if labelled:
        raise CheckError(f"leftover: project {rendered.project} has containers "
                         f"{[c[:12] for c, _ in labelled]}; this check never removes what it did not create")
    network = default_network(rendered.project)
    if network_id(network, env):
        raise CheckError(f"leftover: network {network} exists; this check never removes what it did not create")
    path = emulator_dir(port)
    if os.path.lexists(path):
        raise CheckError(f"leftover: {path} exists; this check never removes what it did not create")
    if port_held(port):
        raise CheckError(f"leftover: port {port} on 127.0.0.1 is held by another listener or container")


class Session:
    """The ports of one side_by_side block, after its preflight, identity guard and leftover step passed."""

    def __init__(self, compose_file, renders, parent):
        self.compose_file = compose_file
        self.renders = renders  # {port: Rendered}
        self.parent = parent
        self.started = []  # ports `up` was run on, in order

    def env(self, port=None):
        return child_env(self.parent, port)

    def compose(self, port, *args, timeout):
        return run(["docker", "compose", "-f", self.compose_file, *args], timeout, self.env(port))

    def up(self, port):
        if port not in self.started:
            self.started.append(port)
        return self.compose(port, "up", "-d", "--no-build", "--pull", "never", timeout=TIMEOUT["up"])

    def down(self, port):
        return self.compose(port, "down", "--timeout", "10", timeout=TIMEOUT["down"])

    def state(self, port):
        """(Id, State.StartedAt) of the port's rendered container."""
        cid, started_at, _ = container_state(self.renders[port].container, self.env())
        return cid, started_at

    def health(self, port, ca_port=None):
        return health(port, ca_file(port if ca_port is None else ca_port))

    def wait_healthy(self, port):
        return wait_for_health(lambda: self.health(port))

    def cleanup(self):
        """`down` on every port of the block, then removal of the directories of the ports it started. Returns
        the errors met; every step is tried."""
        errors = []
        for port in reversed(list(self.renders)):
            try:
                p = self.down(port)
                if p.returncode != 0:
                    errors.append(f"down on port {port} exited {p.returncode}: {tail(p, 300)}")
            except CheckError as e:
                errors.append(str(e))
        for port in self.started:
            try:
                remove_dir(port)
            except (CheckError, OSError) as e:
                errors.append(str(e))
        return errors


@contextlib.contextmanager
def side_by_side(ports, compose_file=COMPOSE, parent=None, pm_mem=PM_MEM):
    """Renders `compose_file` for each port, runs the preflight, the identity guard and the leftover step (in that
    order, before anything is started) and yields a Session. When the block ends, passed or failed, every port
    is brought `down` and the directories of the ports started are removed. Nothing is cleaned up when the
    leftover step did not pass, so a leftover the check did not create is never touched."""
    renders = {port: observe(compose_file, port, parent) for port in ports}
    env = child_env(parent)
    preflight(next(iter(renders.values())), env, pm_mem)
    guard(*renders.values())
    for port, rendered in renders.items():
        leftovers(port, rendered, env)
    session = Session(compose_file, renders, parent)
    try:
        yield session
    except BaseException as e:
        for error in session.cleanup():
            e.add_note(f"cleanup: {error}")
        raise
    else:
        errors = session.cleanup()
        if errors:
            raise CheckError("cleanup failed: " + "; ".join(errors))


# ---------------------------------------------------------------------------------------------- recording


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


class Sequence:
    """Steps run in order with their outcome recorded. A failed gate step stops the steps after it: each of them
    records the gate's exception, so a case that depends on it reports it."""

    def __init__(self):
        self.outcomes = {}
        self.stopped = None

    def step(self, name, fn, gate=True):
        if self.stopped is not None:
            self.outcomes[name] = (None, self.stopped)
            return
        self.outcomes[name] = outcome(fn)
        if gate and self.outcomes[name][1] is not None:
            self.stopped = self.outcomes[name][1]

    @property
    def passed(self):
        return all(error is None for _, error in self.outcomes.values())


class Recorded(unittest.TestCase):
    """A class whose setUpClass runs one sequence and records it; `entry` is the exception that stopped the block
    from opening (preflight, identity guard, leftovers), `cleanup` the one its exit raised."""

    entry = None
    cleanup_error = None
    seq = None

    def entered(self):
        if self.entry is not None:
            raise self.entry

    def observed(self, name):
        self.entered()
        return result(self.seq.outcomes[name])

    def raise_check_errors(self):
        if isinstance(self.entry, CheckError):
            raise self.entry
        if self.cleanup_error is not None:
            raise self.cleanup_error


# ---------------------------------------------------------------------------------------------- tests: render


class Render(unittest.TestCase):
    def test_two_ports_render_different_names(self):
        r1, r2 = (observe(COMPOSE, p) for p in RENDER_PORTS)
        names = f"{describe(r1)}; {describe(r2)}"
        self.assertNotEqual(r1.project, r2.project, f"two ports render the same project: {names}")
        self.assertNotEqual(r1.container, r2.container, f"two ports render the same container name: {names}")
        for r in (r1, r2):
            self.assertNotEqual(r.project, OWNER_PROJECT, f"a set port renders the owner's project: {names}")
            self.assertNotEqual(r.container, OWNER_CONTAINER, f"a set port renders the owner's container: {names}")

    def test_set_port_renders_its_own_names(self):
        p = RENDER_PORTS[0]
        r = observe(COMPOSE, p)
        self.assertEqual(r.project, f"{OWNER_PROJECT}-{p}", describe(r))
        self.assertEqual(r.container, f"{OWNER_CONTAINER}-{p}", describe(r))
        self.assertTrue(has_pair(r.command, "-p", str(p)), f"command {list(r.command)} has no -p {p}")
        self.assertTrue(has_pair(r.command, "-t", "off"), f"command {list(r.command)} has no -t off")
        self.assertEqual(r.ports, (f"127.0.0.1:{p}:{p}",))

    def assert_default(self, r):
        self.assertEqual(r.project, OWNER_PROJECT, describe(r))
        self.assertEqual(r.container, OWNER_CONTAINER, describe(r))
        self.assertTrue(has_pair(r.command, "-p", str(DEFAULT_PORT)), f"command {list(r.command)} has no -p 9297")
        self.assertTrue(has_pair(r.command, "-t", "off"), f"command {list(r.command)} has no -t off")
        self.assertEqual(r.ports, (f"127.0.0.1:{DEFAULT_PORT}:{DEFAULT_PORT}",))

    def test_unset_port_renders_the_default(self):
        self.assert_default(observe(COMPOSE, None))

    def test_empty_port_renders_the_default(self):
        self.assert_default(observe(COMPOSE, ""))


# ---------------------------------------------------------------------------------------------- tests: side by side


class SideBySide(Recorded):
    """Ports A and B: the sequence runs once in setUpClass; each case asserts one recorded observation."""

    @classmethod
    def setUpClass(cls):
        ports = run_ports()
        a, b = cls.a, cls.b = ports.a, ports.b
        env = child_env()
        cls.owner_before = outcome(lambda: owner_state(env))
        cls.renders = outcome(lambda: [observe(COMPOSE, a), observe(COMPOSE, b)])
        cls.before = outcome(lambda: snapshot(result(cls.renders), env))
        cls.seq = Sequence()
        stack = contextlib.ExitStack()
        try:
            s = stack.enter_context(side_by_side([a, b]))
        except Exception as e:
            cls.entry = e
        else:
            seen = {}

            def up_a():
                p = s.up(a)
                ensure(p.returncode == 0, f"up on port {a} exited {p.returncode}: {tail(p)}")
                s.wait_healthy(a)
                seen["a"] = s.state(a)
                seen["a_ca"] = ca_digest(a)

            def up_b():
                p = s.up(b)
                ensure(p.returncode == 0, f"up on port {b} exited {p.returncode}: {tail(p)}")
                s.wait_healthy(b)

            def a_unchanged():
                probe = s.health(a)
                ensure(probe.ok, f"port {a}'s health after the other start: {probe}")
                ensure(s.state(a) == seen["a"], f"port {a}'s container changed: {seen['a']} -> {s.state(a)}")

            def own_directories():
                ensure(ca_file(b).is_file(), f"{ca_file(b)} does not exist")
                ensure(ca_digest(a) == seen["a_ca"], f"{ca_file(a)} changed when port {b} started")

            def wrong_ca():
                probe = s.health(a, ca_port=b)
                ensure(probe.cert_failure,
                       f"port {a} probed with port {b}'s ca.pem: {probe}, not a verification failure")

            def up_a_again():
                p = s.up(a)
                ensure(p.returncode == 0, f"repeated up on port {a} exited {p.returncode}: {tail(p)}")
                ensure(s.state(a) == seen["a"], f"repeated up recreated port {a}'s container")
                probe = s.health(a)
                ensure(probe.ok, f"port {a}'s health after the repeated up: {probe}")

            def down_b():
                p = s.down(b)
                ensure(p.returncode == 0, f"down on port {b} exited {p.returncode}: {tail(p)}")
                project = s.renders[b].project
                ensure(project_containers(project, s.env()) == [], f"project {project} left containers")
                ensure(network_id(default_network(project), s.env()) is None, f"{default_network(project)} is left")
                assert_stopped(b)

            def a_after_down_b():
                probe = s.health(a)
                ensure(probe.ok, f"port {a}'s health after the other's down: {probe}")
                ensure(s.state(a) == seen["a"], f"port {a}'s container changed with the other's down")

            def down_a():
                p = s.down(a)
                ensure(p.returncode == 0, f"down on port {a} exited {p.returncode}: {tail(p)}")
                for r in s.renders.values():
                    ensure(project_containers(r.project, s.env()) == [], f"project {r.project} left containers")
                    ensure(network_id(default_network(r.project), s.env()) is None,
                           f"{default_network(r.project)} is left")

            cls.seq.step("up A", up_a)
            cls.seq.step("up B", up_b)
            cls.seq.step("up B leaves A", a_unchanged, gate=False)
            cls.seq.step("up B directories", own_directories, gate=False)
            cls.seq.step("wrong CA", wrong_ca, gate=False)
            cls.seq.step("up A again", up_a_again)
            cls.seq.step("down B", down_b)
            cls.seq.step("down B leaves A", a_after_down_b, gate=False)
            cls.seq.step("down A", down_a)
            try:
                stack.close()
            except Exception as e:
                cls.cleanup_error = e
        cls.owner_after = outcome(lambda: owner_state(env))
        cls.after = outcome(lambda: snapshot(result(cls.renders), env))

    def test_identity_guard_before_any_start(self):
        self.entered()

    def test_up_a_is_healthy(self):
        self.observed("up A")

    def test_up_b_is_healthy_beside_a(self):
        self.observed("up B")

    def test_up_b_leaves_a_running_as_the_same_container(self):
        self.observed("up B leaves A")

    def test_up_b_has_its_own_directory_and_leaves_a_ca(self):
        self.observed("up B directories")

    def test_health_with_the_other_ca_fails_verification(self):
        self.observed("wrong CA")

    def test_up_a_again_keeps_the_container(self):
        self.observed("up A again")

    def test_down_b_removes_only_b(self):
        self.observed("down B")

    def test_down_b_leaves_a_running_as_the_same_container(self):
        self.observed("down B leaves A")

    def test_down_a_leaves_nothing_of_either_project(self):
        self.observed("down A")

    def test_owner_container_untouched(self):
        # Exists: the same Id and StartedAt before and after. None: still none afterwards.
        self.raise_check_errors()
        self.assertEqual(result(self.owner_after), result(self.owner_before))

    def test_cleanup_leaves_nothing(self):
        self.raise_check_errors()
        before, after = result(self.before), result(self.after)
        if self.entry is None:  # the leftover step passed, so everything of both projects was the run's
            self.assertEqual(left(after), {}, "left after the class")
        self.assertEqual(after, before)


class CleanupAfterFailure(unittest.TestCase):
    def test_cleanup_after_a_failure_inside_the_block(self):
        d = run_ports().d
        env = child_env()
        injected = AssertionError(f"a failure injected inside the side_by_side block on port {d}")
        with self.assertRaises(AssertionError) as cm:
            with side_by_side([d]) as s:
                p = s.up(d)
                self.assertEqual(p.returncode, 0, f"up on port {d}: {tail(p)}")
                s.wait_healthy(d)
                raise injected
        self.assertIs(cm.exception, injected, f"the block raised another assertion: {cm.exception}")
        r = observe(COMPOSE, d)
        self.assertEqual(project_containers(r.project, env), [], f"project {r.project} left containers")
        self.assertIsNone(network_id(default_network(r.project), env), f"{default_network(r.project)} is left")
        self.assertFalse(os.path.lexists(emulator_dir(d)), f"{emulator_dir(d)} is left")


# ---------------------------------------------------------------------------------------------- tests: port published


class PortPublished(Recorded):
    """Port C held by a holder container: the start fails on the port and replaces nothing."""

    @classmethod
    def setUpClass(cls):
        c = cls.c = run_ports().c
        env = child_env()
        cls.holder = f"emuforge-test-sbs-hold-{os.getpid()}-{time.monotonic_ns()}"
        cls.renders = outcome(lambda: [observe(COMPOSE, c)])
        cls.before = outcome(lambda: snapshot(result(cls.renders), env, [cls.holder]))
        cls.seq = Sequence()
        stack = contextlib.ExitStack()
        try:
            s = stack.enter_context(side_by_side([c]))
        except Exception as e:
            cls.entry = e
        else:
            seen = {}
            rendered = s.renders[c]

            def holder():
                if container_id(cls.holder, env):
                    raise CheckError(f"leftover: container {cls.holder} exists")
                stack.callback(run, ["docker", "rm", "-f", cls.holder], TIMEOUT["inspect"], env)
                image = rendered.image
                p = run(["docker", "run", "-d", "--name", cls.holder, "-p", f"127.0.0.1:{c}:{c}", "--memory", "64m",
                         "--pull", "never", "--entrypoint", "sleep", image, "120"], TIMEOUT["holder"], env)
                if p.returncode != 0:
                    raise CheckError(f"the holder container did not start (exit {p.returncode}): {tail(p)}")
                seen["holder"] = container_state(cls.holder, env)

            def up_c():
                p = s.up(c)
                output = p.stdout + p.stderr
                ensure(p.returncode != 0, f"up on port {c} exited 0 while the holder publishes it: {tail(p)}")
                ensure(ALLOCATED in output, f"up on port {c} failed without {ALLOCATED!r}: {tail(p)}")

            def after_up_c():
                state = container_state(cls.holder, env)
                ensure(state == seen["holder"] and state[2], f"the holder changed: {seen['holder']} -> {state}")
                running = project_containers(rendered.project, env, running_only=True)
                ensure(running == [], f"project {rendered.project} has running containers {running}")
                labelled = project_containers(rendered.project, env)
                ensure([st for _, st in labelled] == ["created"],
                       f"project {rendered.project} containers: {labelled}, not exactly one created")
                network = default_network(rendered.project)
                ensure(network_id(network, env), f"network {network} does not exist")

            def down_c():
                p = s.down(c)
                ensure(p.returncode == 0, f"down on port {c} exited {p.returncode}: {tail(p)}")
                ensure(project_containers(rendered.project, env) == [], f"project {rendered.project} left containers")
                network = default_network(rendered.project)
                ensure(network_id(network, env) is None, f"network {network} is left")

            cls.seq.step("holder", holder)
            cls.seq.step("up C", up_c)
            cls.seq.step("up C leaves the holder", after_up_c, gate=False)
            cls.seq.step("down C", down_c)
            try:
                stack.close()
            except Exception as e:
                cls.cleanup_error = e
        cls.after = outcome(lambda: snapshot(result(cls.renders), env, [cls.holder]))

    def test_up_fails_on_the_published_port(self):
        self.observed("up C")

    def test_failed_up_leaves_the_holder_and_a_created_container(self):
        self.observed("up C leaves the holder")

    def test_down_removes_the_failed_project(self):
        self.observed("down C")

    def test_cleanup_leaves_nothing(self):
        self.raise_check_errors()
        before, after = result(self.before), result(self.after)
        if self.entry is None:
            self.assertEqual(left(after), {}, "left after the class")
        self.assertEqual(after, before)


# ---------------------------------------------------------------------------------------------- tests: guard


class Guard(unittest.TestCase):
    def test_guard_refuses_fixed_names(self):
        env = child_env()
        renders = [observe(FIXED_NAMES_COMPOSE, p) for p in RENDER_PORTS]
        before = project_containers(OWNER_PROJECT, env)
        with self.assertRaises(AssertionError) as cm:
            guard(*renders)
        message = str(cm.exception)
        self.assertIn(f"'{OWNER_PROJECT}'", message)
        self.assertIn(f"'{OWNER_CONTAINER}'", message)
        self.assertEqual(project_containers(OWNER_PROJECT, env), before)


# ---------------------------------------------------------------------------------------------- tests: leftovers


class Leftovers(unittest.TestCase):
    def port_and_render(self):
        """A free port and the shipped file's render for it, after the one-port guard."""
        port = free_port(exclude=dataclasses.astuple(run_ports()))
        rendered = observe(COMPOSE, port)
        guard(rendered)
        return port, rendered

    def assert_refused(self, port, rendered, *names):
        with self.assertRaises(CheckError) as cm:
            leftovers(port, rendered, child_env())
        for name in names:
            self.assertIn(str(name), str(cm.exception))

    def create_container(self, name, rendered, *extra):
        env = child_env()
        if container_id(name, env):
            raise CheckError(f"container {name} exists before the case")
        p = run(["docker", "create", "--pull", "never", "--name", name, *extra, "--entrypoint", "sleep",
                 rendered.image, "1"], TIMEOUT["holder"], env)
        if p.returncode != 0:
            raise CheckError(f"docker create {name} failed (exit {p.returncode}): {tail(p)}")
        self.addCleanup(run, ["docker", "rm", "-f", name], TIMEOUT["inspect"], env)
        return container_id(name, env)

    def test_directory(self):
        port, rendered = self.port_and_render()
        path = emulator_dir(port)
        path.mkdir(parents=True)
        self.addCleanup(path.rmdir)
        self.assert_refused(port, rendered, path)
        self.assertTrue(path.is_dir(), f"{path} was removed")

    def test_listener(self):
        port, rendered = self.port_and_render()
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.addCleanup(listener.close)
        listener.bind(("127.0.0.1", port))
        listener.listen(1)
        self.assert_refused(port, rendered, port)

    def test_container_name(self):
        port, rendered = self.port_and_render()
        cid = self.create_container(rendered.container, rendered)
        self.assert_refused(port, rendered, rendered.container)
        self.assertEqual(container_id(rendered.container, child_env()), cid)

    def test_project_label(self):
        port, rendered = self.port_and_render()
        name = f"emuforge-test-sbs-label-{os.getpid()}-{time.monotonic_ns()}"
        cid = self.create_container(name, rendered, "--label", f"{PROJECT_LABEL}={rendered.project}")
        self.assert_refused(port, rendered, rendered.project)
        self.assertEqual(container_id(name, child_env()), cid)

    def test_network(self):
        port, rendered = self.port_and_render()
        env = child_env()
        network = default_network(rendered.project)
        if network_id(network, env):
            raise CheckError(f"network {network} exists before the case")
        p = run(["docker", "network", "create", network], TIMEOUT["inspect"], env)
        if p.returncode != 0:
            raise CheckError(f"docker network create {network} failed (exit {p.returncode}): {tail(p)}")
        self.addCleanup(run, ["docker", "network", "rm", network], TIMEOUT["inspect"], env)
        nid = network_id(network, env)
        self.assert_refused(port, rendered, network)
        self.assertEqual(network_id(network, env), nid)

    def test_remove_dir_refuses_a_symlink(self):
        port = free_port(exclude=dataclasses.astuple(run_ports()))
        path = emulator_dir(port)
        if os.path.lexists(path):
            raise CheckError(f"{path} exists before the case")
        target = WORK / f"symlink-target-{os.getpid()}-{time.monotonic_ns()}"
        target.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, target, True)
        (target / "kept").write_text("kept\n")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(target, target_is_directory=True)
        self.addCleanup(path.unlink)
        with self.assertRaises(CheckError):
            remove_dir(port)
        self.assertTrue(path.is_symlink(), f"{path} was removed")
        self.assertEqual((target / "kept").read_text(), "kept\n")


# ---------------------------------------------------------------------------------------------- tests: ports


class Ports(unittest.TestCase):
    def ports_file(self, emulator):
        WORK.mkdir(parents=True, exist_ok=True)
        path = WORK / f"ports-{os.getpid()}-{time.monotonic_ns()}.json"
        path.write_text(json.dumps({"studio": 8199, "engine": 8399, "emulator": emulator}))
        self.addCleanup(path.unlink, True)
        return path

    def assert_free_and_allowed(self, port):
        self.assertTrue(allowed(port), f"port {port} is 9297 or inside a pm-worktree range")
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", port))  # raises when the port is not free

    def test_a_is_the_ports_json_emulator_port(self):
        self.assertEqual(choose_ports(self.ports_file(9399)).a, 9399)

    def test_a_without_ports_json_is_free(self):
        absent = WORK / f"absent-{os.getpid()}-{time.monotonic_ns()}.json"
        self.assertFalse(absent.exists())
        self.assert_free_and_allowed(choose_ports(absent).a)

    def test_b_c_d_are_free_and_distinct(self):
        ports = choose_ports(self.ports_file(9399))
        chosen = dataclasses.astuple(ports)
        self.assertEqual(len(set(chosen)), 4, chosen)
        for port in chosen[1:]:
            self.assert_free_and_allowed(port)

    def test_9297_in_ports_json_is_an_error(self):
        with self.assertRaises(CheckError) as cm:
            choose_ports(self.ports_file(DEFAULT_PORT))
        self.assertIn(str(DEFAULT_PORT), str(cm.exception))


# ---------------------------------------------------------------------------------------------- tests: waits


class BoundedWaits(unittest.TestCase):
    def test_wait_for_health_bound(self):
        text = "ConnectionRefusedError: [Errno 61] Connection refused (fixture)"
        t0 = time.monotonic()
        with self.assertRaises(AssertionError) as cm:
            wait_for_health(lambda: Probe(error=text), bound=1)
        self.assertGreaterEqual(time.monotonic() - t0, 1)
        message = str(cm.exception)
        self.assertIn("within 1 s", message)
        self.assertIn(text, message)

    def test_stopped_probe_fails_on_a_listener(self):
        port = free_port()
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.addCleanup(listener.close)
        listener.bind(("127.0.0.1", port))
        listener.listen(1)
        with self.assertRaises(AssertionError) as cm:
            assert_stopped(port)
        self.assertIn(str(port), str(cm.exception))


# ---------------------------------------------------------------------------------------------- tests: cannot run


class CannotRun(unittest.TestCase):
    def test_missing_image_is_an_error_and_nothing_is_built_or_pulled(self):
        env = child_env()
        docker_reachable(env)
        port = free_port(exclude=dataclasses.astuple(run_ports()))
        image = observe(MISSING_IMAGE_COMPOSE, port).image
        self.assertFalse(image_present(image, env), f"{image} exists before the case")
        with self.assertRaises(CheckError) as cm:
            with side_by_side([port], MISSING_IMAGE_COMPOSE):
                pass
        self.assertIn(image, str(cm.exception))
        self.assertFalse(image_present(image, env), f"{image} was built or pulled")

    def test_unreachable_docker_is_an_error_naming_docker(self):
        WORK.mkdir(parents=True, exist_ok=True)
        sock = WORK / "no-such-docker.sock"
        self.assertFalse(sock.exists())
        parent = {k: v for k, v in os.environ.items() if k != "DOCKER_CONTEXT"}
        parent["DOCKER_HOST"] = f"unix://{sock}"
        port = free_port(exclude=dataclasses.astuple(run_ports()))
        with self.assertRaises(CheckError) as cm:
            with side_by_side([port], parent=parent):
                pass
        self.assertNotIsInstance(cm.exception, AssertionError)
        self.assertIn("Docker", str(cm.exception))

    def test_memory_over_the_limit_is_an_error_and_nothing_starts(self):
        WORK.mkdir(parents=True, exist_ok=True)
        script = WORK / f"pm-mem-over-{os.getpid()}-{time.monotonic_ns()}"
        script.write_text("#!/bin/sh\necho 'used 99.9GB swap 0.0/0.0GB'\necho 'OVER limit 22.5GB (fixture)'\nexit 1\n")
        script.chmod(0o755)
        self.addCleanup(script.unlink, True)
        env = child_env()
        port = free_port(exclude=dataclasses.astuple(run_ports()))
        rendered = observe(COMPOSE, port)
        before = snapshot([rendered], env)
        with self.assertRaises(CheckError) as cm:
            with side_by_side([port], pm_mem=script):
                pass
        self.assertIn("memory", str(cm.exception))
        self.assertEqual(snapshot([rendered], env), before)


# ---------------------------------------------------------------------------------------------- tests: child env


LISTED = ("AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_CONFIG_FILE",
          "AWS_SHARED_CREDENTIALS_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_FILE", "EMULATOR_PORT")
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
        env = child_env(PARENT, port=9412)
        self.assertEqual(env.get("EMULATOR_PORT"), "9412")
        for name in LISTED[:-1]:
            self.assertNotIn(name, env)


if __name__ == "__main__":
    unittest.main()
