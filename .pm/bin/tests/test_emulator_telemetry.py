"""harness.emulator-telemetry: every aws-emulator this repository starts as a server runs with `-t off` (issue #5).

Three parts:

- render: infra/aws-emulator/docker-compose.yml rendered with `docker compose config --format json`, with and
  without EMULATOR_PORT.
- start: the Compose service started as the repository ships it, with an override that takes away the network,
  the ports, the mounts and the environment, under its own project and container name, so an emulator whose
  telemetry is still on reaches nothing. Nothing is built or pulled.
- child environment: every docker and git call is an argument list with a bound and an allowlisted environment;
  no AWS_* variable reaches a child.

Docker, the Compose plugin and the aws-emulator image are required. Without them a case raises CheckError, which
unittest reports as an error with the reason: never a pass, a failure or a skip.
"""
import contextlib
import dataclasses
import json
import os
import pathlib
import subprocess
import time
import unittest

from _emulator_telemetry import TIMEOUT, CheckError, child_env, has_pair, render, run

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
COMPOSE = CHECKOUT / "infra" / "aws-emulator" / "docker-compose.yml"
FIXTURES = HERE / "fixtures" / "emulator-telemetry"
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


# ---------------------------------------------------------------------------------------------- child processes


def option_value(args, option):
    for a, b in zip(args, args[1:]):
        if a == option:
            return b
    return None


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


if __name__ == "__main__":
    unittest.main()
