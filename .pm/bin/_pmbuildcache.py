"""Idle-time maintenance of the machine Docker builder's cache."""
import contextlib
from dataclasses import dataclass
from decimal import Decimal
import fcntl
import json
import os
import re
import signal
import subprocess

from _pmlib import RUN

LOCK = RUN / "build-cache.lock"
KEEP_BYTES = 20_000_000_000
READ_BOUND = 20
PRUNE_BOUND = 300
DOCKER_ENV = ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "TMPDIR")
SIZE = re.compile(r"([0-9]+(?:\.[0-9]+)?)([kKMGTP]?)B")
UNITS = {"": 1, "K": 10**3, "M": 10**6, "G": 10**9, "T": 10**12, "P": 10**15}


@contextlib.contextmanager
def cache_activity():
    """Let checks and refreshes share the builder, excluding maintenance."""
    with LOCK.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_SH)
        yield lock.fileno()


class CacheError(Exception):
    """A Docker call or cache measurement failed."""


@dataclass
class Usage:
    private: int = 0
    shared: int = 0
    active: bool = False

    @property
    def total(self):
        return self.private + self.shared


def docker(args, env, lock_fd, *, timeout=READ_BOUND):
    label = "docker " + " ".join(args[:2])
    with subprocess.Popen(["docker", *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, text=True, errors="replace", env=env, start_new_session=True,
                          pass_fds=(lock_fd,)) as proc:
        try:
            stdout, _ = proc.communicate(timeout=timeout)
        except BaseException as e:
            # The CLI may have started a Buildx plugin in the same process group.
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            if isinstance(e, subprocess.TimeoutExpired):
                raise CacheError(f"{label} timed out after {timeout} s") from e
            raise
    if proc.returncode != 0:
        raise CacheError(f"{label} exited {proc.returncode}")
    return stdout


def size_bytes(value):
    """Buildx has printed both byte strings and human-readable decimal sizes."""
    if type(value) is int and value >= 0:
        return value
    if isinstance(value, str):
        if value.isascii() and value.isdecimal():
            return int(value)
        if match := SIZE.fullmatch(value):
            return int(Decimal(match[1]) * UNITS[match[2].upper()])
    raise ValueError("invalid cache size")


def cache_usage(env, lock_fd):
    raw = docker(("buildx", "du", "--format", "json"), env, lock_fd)
    usage = Usage()
    try:
        for line in raw.splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            size = size_bytes(row["Size"])
            shared, reclaimable = row["Shared"], row["Reclaimable"]
            if type(shared) is not bool or type(reclaimable) is not bool:
                raise ValueError("invalid cache flags")
            if shared:
                usage.shared += size
            else:
                usage.private += size
            usage.active |= not reclaimable
    except (KeyError, TypeError, ValueError) as e:
        raise CacheError("unreadable Docker build cache usage") from e
    return usage


def prune_if_idle():
    """Return a log clause and a record without changing the check or refresh verdict."""
    record = dict(outcome=None, keep_bytes=KEEP_BYTES, before=None, after_bounded=None, after=None)

    def result(outcome, detail):
        record["outcome"] = outcome
        before, after = (record[key] for key in ("before", "after"))
        prior = f"{before['total_bytes']} bytes" if before else "unknown"
        left = f"{after['total_bytes']} bytes" if after else "unknown"
        return f"build cache {detail} (before {prior}, after {left})", record

    def measure(key):
        usage = cache_usage(env, lock_fd)
        record[key] = dict(private_bytes=usage.private, shared_bytes=usage.shared, total_bytes=usage.total)
        return usage

    try:
        with LOCK.open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return result("deferred", "deferred while a check, refresh or prune is active")
            lock_fd = lock.fileno()
            env = {key: os.environ[key] for key in DOCKER_ENV if key in os.environ}
            # Buildx du can otherwise use a selected builder different from docker builder prune.
            context = docker(("context", "show"), env, lock_fd).strip()
            if not re.fullmatch(r"[A-Za-z0-9_.-]+", context):
                raise CacheError("unreadable Docker context")
            env["BUILDX_BUILDER"] = context
            before = measure("before")
            record["after"] = record["before"]
            if before.total <= KEEP_BYTES:
                return result("within bound", "within 20 GB")
            if before.active:
                return result("deferred", "deferred while Docker has cache records in use")

            record["after"] = None
            docker(("builder", "prune", "--all", "--max-used-space", str(KEEP_BYTES), "--force"),
                   env, lock_fd, timeout=PRUNE_BOUND)
            after = measure("after")
            record["after_bounded"] = record["after"]
            if after.total <= KEEP_BYTES:
                return result("pruned", "pruned to 20 GB")
            if after.active:
                return result("deferred", "still above 20 GB while Docker has cache records in use")

            record["after"] = None
            docker(("builder", "prune", "--all", "--force"), env, lock_fd, timeout=PRUNE_BOUND)
            if measure("after").total <= KEEP_BYTES:
                return result("pruned", "pruned to 20 GB after the fallback")
            return result("above bound", "still above 20 GB after the fallback")
    except (CacheError, OSError) as e:
        detail = str(e) if isinstance(e, CacheError) else type(e).__name__
        return result("failed", f"maintenance failed ({detail})")
