"""Child processes of pm-structure: the environment allowlist and the one way a child is started. Not a command.

Every child of the tool (git, node with Playwright, the browser it launches) is started by `run`: an argument
list, never a shell, the environment from `child_env` and a timeout. On timeout, on a recorded stop or on any
exception while the child runs, the child's whole tree is killed: its process group and every process that descends
from it, also one in a group or session of its own, such as the browser Playwright starts (issue 25, design D1).
No process outside the child's tree is signalled. No AWS_* variable of the caller can pass (requirement 7, design
2.4).

The tree is killed in three steps. The child's group is frozen with SIGSTOP. The tree is then walked level by
level with `PS`: a descendant whose parent is frozen is frozen too, through its group when a frozen-parent
descendant leads that group, else alone. A frozen process can neither start nor reap a process, so a PID found this
way stays its own until the kill. Then every frozen group and process gets SIGKILL, the child's group last. The walk
ends when a level freezes nothing new, when `PS` fails, or at `WALK_TIMEOUT`; what is frozen by then is killed.

The stop record (issue 12, design D2): a signal handler calls `stop(exc)`, which only records `exc` (the first call
wins) and returns. `stop_on(stops)` installs such a handler for each signal of `stops` (pm-structure calls it once, from
its main thread); once it has recorded the first stop, it sets every one of those signals to SIG_IGN, so a later signal
interrupts no thread and runs no handler until the process exits, and a child started after that inherits the ignored
signals (issue 50, design D1 to D3). A signal Python had already caught when its handler became SIG_IGN is dropped by
CPython with an unraisable `OSError: Signal <n> ignored due to race condition`; once a stop is recorded, `stop_on`'s
unraisable hook drops exactly that report for its signals, so nothing reaches stderr for a signal that was meant to be
ignored, and passes every other report to the hook it replaced. The stop is delivered by `check()`, which raises it
once: at the start of `run`, while `run` waits for its child (within one polling slice, after the child's tree is killed
and the child reaped), and at the caller's own checkpoints. Code that runs after the delivery is not interrupted again.
`stop_requested()` returns the recorded exception or None.
"""
import os
import signal
import subprocess
import sys
import time

# the only variables copied from the caller's environment
ALLOW = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER", "PLAYWRIGHT_BROWSERS_PATH", "NODE_PATH")
SLICE = 0.1  # seconds between two looks at the stop record while a child runs
REAP_TIMEOUT = 2  # seconds to wait for a killed child to be reaped
WALK_TIMEOUT = 2  # seconds the walk of a killed child's tree may take, all PS runs together
PS = "/bin/ps"  # the program that lists the processes; an absolute path, so PATH cannot choose another

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


def stop_on(stops):
    """Install one handler for every signal of `stops` ({signal: exception}); call it from the main thread.

    The handler records `stops[signum]` with `stop`, then sets the signal it was called for to SIG_IGN, then every
    signal of `stops`: a storm of any of them ends there (issue 50, design D2). It writes nothing, raises nothing
    and allocates nothing that lasts (issue 25, C3). Never the default action: a late signal must not kill the run
    after its report (issue 25, C2).

    It also replaces sys.unraisablehook: after a stop, CPython's report of a signal of `stops` that it had caught
    before the handler became SIG_IGN (two kinds caught in one pass, or one caught while `signal.signal` changes
    the handler) is dropped; every other report goes to the hook that was installed before.
    """
    stops = dict(stops)
    sigs = tuple(stops)
    dropped = frozenset(f"Signal {int(sig)} ignored due to race condition" for sig in sigs)
    previous = sys.unraisablehook

    def unraisable(report):
        if _stop is not None and report.exc_type is OSError and str(report.exc_value) in dropped:
            return
        previous(report)

    sys.unraisablehook = unraisable

    def on_signal(signum, _frame):
        stop(stops[signum])
        signal.signal(signum, signal.SIG_IGN)
        for sig in sigs:
            signal.signal(sig, signal.SIG_IGN)

    for sig in sigs:
        signal.signal(sig, on_signal)


def stop_requested():
    """The recorded stop, also after it was raised; None when there is none."""
    return _stop


def check():
    """Raise the recorded stop if it has not been raised yet; each stop is raised once."""
    global _delivered
    if _stop is not None and not _delivered:
        _delivered = True
        raise _stop


def _signal(send, target, sig):
    """Send `sig` with `send` (os.kill or os.killpg); False when the target is gone or refused."""
    try:
        send(target, sig)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:  # macOS refuses a group of zombies; nothing is left to signal there
        return False


def _table(deadline):
    """{pid: (ppid, pgid)} of every process from one PS run, or None when PS fails or the deadline has passed."""
    left = deadline - time.monotonic()
    if left <= 0:
        return None
    try:
        out = subprocess.run([PS, "-A", "-o", "pid=,ppid=,pgid="], env=child_env(), stdin=subprocess.DEVNULL,
                             capture_output=True, text=True, errors="replace", timeout=left,
                             start_new_session=True)
    except (OSError, subprocess.SubprocessError):  # missing, not runnable, or killed at its timeout
        return None
    if out.returncode != 0:
        return None
    table = {}
    for line in out.stdout.splitlines():
        fields = line.split()
        if not fields:
            continue
        if len(fields) != 3 or not all(f.isdigit() for f in fields):
            return None
        pid, ppid, pgid = map(int, fields)
        table[pid] = (ppid, pgid)
    return table


def _freeze_tree(root, groups, singles):
    """Walk `root`'s tree below its frozen group; SIGSTOP each held descendant's group or the descendant alone,
    adding it to `groups` or `singles`. Ends when a level freezes nothing new, PS fails or WALK_TIMEOUT passes."""
    deadline = time.monotonic() + WALK_TIMEOUT
    while True:
        table = _table(deadline)
        if table is None:
            return
        frozen = {q for q, (_, g) in table.items() if g in groups or q in singles}
        held = {q for q, (parent, _) in table.items() if parent in frozen and q != root}
        new = False
        for q in sorted(held - frozen):
            group = table[q][1]
            if group in groups or q in singles:
                continue  # frozen earlier at this level, through its group
            if group in held:  # its group's leader is held: that PID, and so the group id, stays its own
                if _signal(os.killpg, group, signal.SIGSTOP):
                    groups.append(group)
                    new = True
            elif _signal(os.kill, q, signal.SIGSTOP):  # a leader outside the tree, gone, or not held yet
                singles.append(q)
                new = True
        if not new:
            return


def _kill(p):
    """Kill the child's tree while the child is unreaped (its PID is then still its group id): freeze the child's
    group, freeze the tree below it, then SIGKILL every frozen single and group and the child's group last."""
    if p.returncode is not None:
        return
    groups, singles = [], []
    try:
        os.killpg(p.pid, signal.SIGSTOP)
        groups.append(p.pid)
    except ProcessLookupError:
        pass
    except PermissionError:
        # macOS refuses a group whose members are all zombies: nothing is left to kill once the leader has exited
        if p.poll() is None:
            raise
        return
    try:
        if groups:
            _freeze_tree(p.pid, groups, singles)
    finally:  # nothing that was sent SIGSTOP is left stopped: a stopped process dies of SIGKILL
        for q in singles:
            _signal(os.kill, q, signal.SIGKILL)
        for group in groups[1:]:
            _signal(os.killpg, group, signal.SIGKILL)
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
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
    tree (`_kill`), reaps the child and is raised; any other exception that leaves the wait (SystemExit,
    KeyboardInterrupt, …) kills and reaps the same way and propagates unchanged. On timeout the child's tree is
    killed and subprocess.TimeoutExpired is raised. A child that ends by itself is reaped and nothing is killed.
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
