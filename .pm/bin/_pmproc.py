"""Child processes of pm-structure: the environment allowlist and the one way a child is started. Not a command.

Every child of the tool (git, node with Playwright, the browser it launches) is started by `run`: an argument
list, never a shell, the environment from `child_env` and a timeout. On timeout, on a recorded stop or on any
exception while the child runs, the child's whole process group is killed. No AWS_* variable of the caller can
pass (requirement 7, design 2.4).

The stop record (issue 12, design D2): a signal handler calls `stop(exc)`, which only records `exc` (the first
call wins) and returns. The stop is delivered by `check()`, which raises it once: at the start of `run`, while
`run` waits for its child (within one polling slice, after the child's group is killed and reaped), and at the
caller's own checkpoints. Code that runs after the delivery is not interrupted again. `stop_requested()` returns
the recorded exception or None.
"""
import os
import signal
import subprocess
import time

# the only variables copied from the caller's environment
ALLOW = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER", "PLAYWRIGHT_BROWSERS_PATH", "NODE_PATH")
SLICE = 0.1  # seconds between two looks at the stop record while a child runs
REAP_TIMEOUT = 2  # seconds to wait for a killed child to be reaped

_stop = None  # the recorded stop: an exception, or None
_delivered = False  # whether check() has raised it


def child_env():
    """The environment of every child: the allowlist, plus AWS_EC2_METADATA_DISABLED=true."""
    env = {k: os.environ[k] for k in ALLOW if k in os.environ}
    env["AWS_EC2_METADATA_DISABLED"] = "true"
    return env


def stop(exc):
    """Record `exc` as the stop, unless one is recorded already. Safe in a signal handler: no lock, no I/O."""
    global _stop
    if _stop is None:
        _stop = exc


def stop_requested():
    """The recorded stop, also after it was raised; None when there is none."""
    return _stop


def check():
    """Raise the recorded stop if it has not been raised yet; each stop is raised once."""
    global _delivered
    if _stop is not None and not _delivered:
        _delivered = True
        raise _stop


def _kill(p):
    """SIGKILL the child's process group while its leader is unreaped (its PID is then still the group id)."""
    if p.returncode is not None:
        return
    try:
        os.killpg(p.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError:
        # macOS refuses a group whose members are all zombies: nothing is left to kill once the leader has exited
        if p.poll() is None:
            raise


def _kill_and_reap(p):
    _kill(p)
    try:
        p.wait(timeout=REAP_TIMEOUT)
    except subprocess.TimeoutExpired:
        pass  # a process that ignores SIGKILL (uninterruptible sleep); nothing more can be done


def run(cmd, timeout, cwd=None):
    """Run `cmd` (a list of strings) without a shell; return a CompletedProcess with text stdout and stderr.

    A stop recorded before the call starts no child. While the child runs, a recorded stop kills the child's
    process group, reaps it and is raised; any other exception that leaves the wait (SystemExit,
    KeyboardInterrupt, …) kills and reaps the same way and propagates unchanged. On timeout the child's process
    group is killed and subprocess.TimeoutExpired is raised.
    """
    if not isinstance(cmd, (list, tuple)) or not cmd or not all(isinstance(c, str) for c in cmd):
        raise TypeError("cmd must be a non-empty list of strings")
    check()
    with subprocess.Popen(list(cmd), cwd=cwd, env=child_env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True, errors="replace", start_new_session=True) as p:
        deadline = time.monotonic() + timeout
        try:
            while True:
                try:  # a retried communicate loses no output (subprocess documentation)
                    out, err = p.communicate(timeout=max(0.0, min(SLICE, deadline - time.monotonic())))
                    break
                except subprocess.TimeoutExpired:
                    pass
                check()  # a recorded stop: the except below kills and reaps, then it propagates
                if time.monotonic() >= deadline:
                    _kill(p)
                    out, err = p.communicate()
                    raise subprocess.TimeoutExpired(p.args, timeout, output=out, stderr=err)
        except BaseException:
            _kill_and_reap(p)
            raise
        return subprocess.CompletedProcess(p.args, p.returncode, out, err)
