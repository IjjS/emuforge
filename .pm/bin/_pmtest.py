"""Shared local test admission for pm-check and pm-test."""
import contextlib
import fcntl
import os
import signal
import time

from _pmlib import RUN, load, locked, machine_room, running_checks, save

CAPACITY = {"vitest": 3, "integration": 1}
STEP_SUITE = {"studio-unit": "vitest", "integration": "integration", "integration-checks": "integration"}
TICKETS = RUN / "test-tickets.json"


def reserve(suite, tickets):
    """Return a locked fd, or None. The caller holds the ticket/admission lock."""
    used = sum(row["suite"] == suite for row in tickets.values())
    # Checks already running at rollout still launch steps without a slot. Count their pending
    # suite too, until they advance beyond it. Focused integration uses the integration-checks step.
    for row in running_checks():
        if row.get("suite_slots"):
            continue
        steps, step = row.get("steps") or [], row.get("step")
        first = steps.index(step) if step in steps else 0
        used += any(STEP_SUITE.get(step) == suite for step in steps[first:])

    with contextlib.ExitStack() as free:
        fds = []
        for i in range(CAPACITY[suite]):
            fd = os.open(RUN / f"test-{suite}-{i}.lock", os.O_CREAT | os.O_RDWR, 0o600)
            free.callback(os.close, fd)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                used += 1
            else:
                fds.append(fd)
        if used < CAPACITY[suite]:
            return os.dup(fds[0])
    return None


def full(suite):
    return f"all {CAPACITY[suite]} local {suite} slots are occupied"


@contextlib.contextmanager
def try_slot(suite):
    """Yield (fd, reason). Keep the fd through cleanup and pass it to the runner at spawn."""
    with locked(TICKETS):
        why = machine_room()
        fd = reserve(suite, load(TICKETS, {})) if not why else None
    try:
        yield fd, why or (full(suite) if fd is None else None)
    finally:
        if fd is not None:
            os.close(fd)


def acquire(suite, ticket, owner):
    with locked(TICKETS):
        tickets = load(TICKETS, {})
        if ticket in tickets:
            raise ValueError(f"ticket {ticket} is already held")
        why = machine_room()
        if why:
            return why
        fd = reserve(suite, tickets)
        if fd is None:
            return full(suite)
        try:
            tickets[ticket] = dict(suite=suite, owner=owner)
            save(TICKETS, tickets)
        finally:
            os.close(fd)
    return None


def release(ticket):
    with locked(TICKETS):
        tickets = load(TICKETS, {})
        if ticket not in tickets:
            raise ValueError(f"no ticket named {ticket}")
        del tickets[ticket]
        save(TICKETS, tickets)


def end_group(pgid, grace=10, reap=None):
    """SIGTERM a runner's process group, then SIGKILL what is left after grace."""
    for sig, wait in ((signal.SIGTERM, grace), (signal.SIGKILL, 2)):
        try:
            os.killpg(pgid, sig)
        except (ProcessLookupError, PermissionError):
            return True
        end = time.monotonic() + wait
        while time.monotonic() < end:
            if reap is not None:
                reap()
            try:
                os.killpg(pgid, 0)
            except (ProcessLookupError, PermissionError):
                return True
            time.sleep(0.1)
    return False
