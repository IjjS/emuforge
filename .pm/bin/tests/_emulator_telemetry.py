"""What test_emulator_telemetry.py and test_emulator_scan.py both use: the child processes, their environment
and the render of a Compose file. Not a test; moved, text unchanged, from test_emulator_telemetry.py (issue 328).
"""
import json
import os
import subprocess

TIMEOUT = {"render": 30, "up": 60, "exec": 10, "down": 60, "git": 30, "inspect": 10}

ENV_ALLOWLIST = ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "TMPDIR")


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


def render(compose_file, env):
    """`docker compose -f <file> config --format json`, parsed. Needs the Docker CLI with Compose, not the daemon."""
    p = run(["docker", "compose", "-f", str(compose_file), "config", "--format", "json"], TIMEOUT["render"], env)
    if p.returncode != 0:
        raise CheckError(f"docker compose config of {compose_file} failed (exit {p.returncode}): {p.stderr.strip()}")
    return json.loads(p.stdout)
