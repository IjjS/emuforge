"""The orphaned processes of a worktree: finding them, stopping them, the sweep (issue 472). Not a command.

A process of worktree W is a process of the current user whose working directory is W's path or a folder under it,
compared by path components after resolving symbolic links. It is orphaned when its parent is a reaper (PID 1; a
test may add its own PID as a subreaper). An orphan of W is an orphaned process of W that is not this process or
one of its ancestors and is not left out, together with every process below it that is itself a process of W.

Left out (issue 477), and never listed, signalled or told, are the orphaned processes of W that are:
- the live pm-check recorded in W's output/checks/running.json, or a member of the step group that record names;
- while that pm-check is live, a process whose working directory is under W/output/tests/ (where the harness tests
  work) and that started at or after the recorded pm-check (by ps's start time): a stand-in a test of the running
  check started in a session of its own. One that started before the pm-check, or outside output/tests/, is found;
- impeccable's live-server (a process named `impeccable` with the word `live-server`) while a live registered pane
  of role crit of W's registered issue exists: the critique of that issue serves the worktree with it.
Each sweep's line names what it left running, and why.

find(root) lists them from one `ps` run and one `lsof` run (or /proc on Linux); stop(procs, root) sends SIGTERM to
each by PID, then SIGKILL to what is left after GRACE seconds, checking before each signal that the PID is still
the same process (same start time, still orphaned, still in the worktree). Nothing is signalled by name or pattern,
no process group is signalled (an orphan keeps the group of the shell that started it, which may hold a live
agent's shell), and no container is touched. sweep(roots) looks, stops what is new and looks again for up to SETTLE
seconds; line(name, result) is the sentence the commands print. When the process table cannot be read the answer
is CannotTell, never "none".
"""
import collections
import json
import os
import pathlib
import re
import signal
import subprocess
import time

from _pmlib import PANES, ROOT, WORKTREES

PS = "/bin/ps"
LSOF = "/usr/sbin/lsof"
ENV = {"PATH": "/usr/bin:/bin:/usr/sbin", "LC_ALL": "C"}
REAPERS = frozenset({1})  # every command passes this; a test may pass {1, its own PID}
BOUND = 10       # seconds for one ps or lsof run
GRACE = 5        # seconds between SIGTERM and SIGKILL
KILL_WAIT = 2    # seconds to wait for a SIGKILL to take
SETTLE = 5       # seconds a sweep may keep looking
POLL = 0.25      # seconds between two looks of a sweep, and between two checks of a stop
NAME = re.compile(r"\S+")
FIELDS = "pid=,ppid=,pgid=,uid=,pcpu=,stat=,etime=,lstart=,command="
# options of node that take the next argument as their value
VALUE_OPTIONS = frozenset({"-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions",
                           "-e", "--eval", "-p", "--print"})
BUN_VERBS = frozenset({"run", "x", "test", "exec"})

Proc = collections.namedtuple("Proc", "pid ppid pgid uid start cpu state age command cwd name")


class CannotTell(Exception):
    """The process table or a working directory cannot be read; the text is the reason."""


class Swept(tuple):
    """(stopped, left) of a sweep, with `reason` set when a later look could not tell and `kept` the left-out
    orphans of the last look, [(Proc, why)]."""

    def __new__(cls, stopped, left, reason=None, kept=()):
        t = super().__new__(cls, (stopped, left))
        t.reason = reason
        t.kept = list(kept)
        return t


def table():
    """{pid: Proc} of every process, from one ps run; `cwd` and `name` are None. Raises CannotTell."""
    try:
        p = subprocess.run([PS, "-A", "-o", FIELDS], capture_output=True, text=True, env=ENV, timeout=BOUND,
                           stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        raise CannotTell("ps timed out") from None
    except OSError as e:
        raise CannotTell(f"ps failed: {e.strerror or type(e).__name__}") from None
    if p.returncode != 0:
        raise CannotTell(f"ps failed: exit {p.returncode}")
    out = {}
    for row in p.stdout.splitlines():
        if not row.strip():
            continue
        words = row.split(None, 12)
        try:
            if len(words) < 12:
                raise ValueError
            pid, ppid, pgid, uid = (int(w) for w in words[:4])
            cpu = float(words[4])
        except ValueError:
            raise CannotTell(f"ps line not understood: {row.strip()[:80]}") from None
        out[pid] = Proc(pid, ppid, pgid, uid, " ".join(words[7:12]), cpu, words[5], words[6],
                        words[12] if len(words) > 12 else "", None, None)
    if not out:
        raise CannotTell("ps printed no process")
    return out


def cwds(pids):
    """{pid: real path of its working directory} for the PIDs whose directory can be read. Raises CannotTell."""
    pids = sorted(set(pids))
    if not pids:
        return {}
    out = {}
    if os.path.exists("/proc/self/cwd"):
        for pid in pids:
            try:
                path = os.readlink(f"/proc/{pid}/cwd")
            except OSError:
                continue
            if os.path.isabs(path):
                out[pid] = os.path.realpath(path)
        return out
    try:
        p = subprocess.run([LSOF, "-a", "-d", "cwd", "-Fn", "-p", ",".join(map(str, pids))], capture_output=True,
                           text=True, env=ENV, timeout=BOUND, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        raise CannotTell("lsof timed out") from None
    except OSError as e:
        raise CannotTell(f"lsof failed: {e.strerror or type(e).__name__}") from None
    if p.returncode not in (0, 1):  # 1: some or all of the PIDs are gone
        raise CannotTell(f"lsof failed: exit {p.returncode}")
    pid = None
    for row in p.stdout.splitlines():
        if row.startswith("p"):
            pid = int(row[1:]) if row[1:].isdigit() else None
        elif row.startswith("n") and pid is not None:
            if os.path.isabs(row[1:]):
                out[pid] = os.path.realpath(row[1:])
            pid = None
    return {k: v for k, v in out.items() if k in pids}


def inside(path, root):
    """True when `path` is `root` or a folder under it, by path components (never a string prefix)."""
    if not path or not root:
        return False
    p, r = pathlib.PurePosixPath(path), pathlib.PurePosixPath(root)
    return p == r or r in p.parents


def worktree_paths():
    """[(name, real path)] of the registered worktrees in registry order. An entry is kept only when its name is one
    word and not `main`, and its path is an absolute existing folder that is not the main checkout, not one of its
    ancestors and not under it. A registry that cannot be read gives []."""
    try:
        reg = json.loads(WORKTREES.read_text())
    except (OSError, ValueError):
        return []
    root = os.path.realpath(ROOT)
    out = []
    for w in reg if isinstance(reg, list) else []:
        if not isinstance(w, dict):
            continue
        name, path = w.get("name"), w.get("path")
        if not (isinstance(name, str) and NAME.fullmatch(name) and name != "main"):
            continue
        if not (isinstance(path, str) and os.path.isabs(path) and os.path.isdir(path)):
            continue
        real = os.path.realpath(path)
        if inside(real, root) or inside(root, real):
            continue
        out.append((name, real))
    return out


def name_of(command):
    """The name of a process: the basename of its executable; for node and bun, of the script they run."""
    words = command.split()
    if not words:
        return "?"
    exe = os.path.basename(words[0])
    if not (exe == "bun" or exe.startswith("node")):
        return exe
    rest, i = words[1:], 0
    while i < len(rest) and rest[i].startswith("-"):
        i += 2 if rest[i] in VALUE_OPTIONS else 1
    rest = rest[i:]
    if exe == "bun" and rest and rest[0] in BUN_VERBS:
        rest = rest[1:]
    return os.path.basename(rest[0]) if rest else exe


def is_pm_check(command):
    """A pm-check run that is not a `--stop` (`pm-check` runs as `python3 -I …/pm-check …`)."""
    words = command.split()
    return any(os.path.basename(w) == "pm-check" for w in words) and "--stop" not in words


def live_record(root, tab):
    """(pm_check_pid, pgid) of the live pm-check recorded in <root>/output/checks/running.json, or None."""
    try:
        with open(os.path.join(root, "output", "checks", "running.json"), encoding="utf-8") as f:
            rec = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(rec, dict):
        return None
    pid, pgid = rec.get("pm_check_pid"), rec.get("pgid")
    if type(pid) is not int or type(pgid) is not int:
        return None
    p = tab.get(pid)
    if p is None or not is_pm_check(p.command):
        return None
    return pid, pgid


def started_at(start):
    """Seconds since the epoch of a ps `lstart` (LC_ALL=C), or None when it cannot be read."""
    try:
        return time.mktime(time.strptime(start, "%a %b %d %H:%M:%S %Y"))
    except (ValueError, OverflowError):
        return None


def is_live_server(command):
    """impeccable's live-server: a process named `impeccable` with the word `live-server` in its command."""
    return name_of(command) == "impeccable" and "live-server" in command.split()


def registered_issues():
    """{real path: issue} of the registered worktrees that name an issue."""
    try:
        reg = json.loads(WORKTREES.read_text())
    except (OSError, ValueError):
        return {}
    out = {}
    for w in reg if isinstance(reg, list) else []:
        if isinstance(w, dict) and isinstance(w.get("path"), str) and isinstance(w.get("issue"), (str, int)) \
                and not isinstance(w.get("issue"), bool):
            out[os.path.realpath(w["path"])] = str(w["issue"])
    return out


def live_crits():
    """{issue: name} of the live (not gone) registered panes of role crit, the first of each issue."""
    try:
        reg = json.loads(PANES.read_text())
    except (OSError, ValueError):
        return {}
    out = {}
    for r in reg if isinstance(reg, list) else []:
        if isinstance(r, dict) and r.get("role") == "crit" and not r.get("gone") and isinstance(r.get("name"), str) \
                and isinstance(r.get("issue"), (str, int)) and not isinstance(r.get("issue"), bool):
            out.setdefault(str(r["issue"]), r["name"])
    return out


def left_out(root, tab, tops, dirs, crit=None):
    """{pid: why} of what the sweep of `root` leaves alone (the module docstring): the recorded live pm-check and its
    step group, the stand-ins of its tests among `tops` (orphaned processes, with `dirs` their working directories),
    and impeccable's live-server among `tops` while `crit` (a live crit pane of root's issue) is given."""
    out = {}
    rec = live_record(root, tab)
    if rec is not None:
        pid, pgid = rec
        why = f"the running pm-check {pid}"
        out[pid] = why
        out.update({q.pid: why for q in tab.values() if q.pgid == pgid})
        since = started_at(tab[pid].start)
        tests = os.path.join(root, "output", "tests")
        if since is not None:
            for p in tops:
                at = started_at(p.start)
                if p.pid not in out and at is not None and at >= since and inside(dirs.get(p.pid), tests):
                    out[p.pid] = why
    if crit:
        for p in tops:
            if p.pid not in out and is_live_server(p.command) and inside(dirs.get(p.pid), root):
                out[p.pid] = f"live pane {crit}"
    return out


def ancestors(tab):
    """This process and its ancestors."""
    out, pid = set(), os.getpid()
    while pid in tab and pid not in out:
        out.add(pid)
        pid = tab[pid].ppid
    return out | {os.getpid()}


def scan_left(roots, reapers=REAPERS, tab=None):
    """({root: [Proc]} of the orphans of each real path in `roots`, {root: [(Proc, why)]} of its left-out orphaned
    processes), both sorted by PID, from one table and one cwds run."""
    tab = table() if tab is None else tab
    uid, mine = os.getuid(), ancestors(tab)
    children = collections.defaultdict(list)
    for p in tab.values():
        children[p.ppid].append(p.pid)

    def ours(p):
        return p.uid == uid and p.pid not in mine and p.pid not in reapers and not p.state.startswith("Z")

    tops = [p for p in tab.values() if p.ppid in reapers and ours(p)]
    candidates, todo = set(), [p.pid for p in tops]
    while todo:
        pid = todo.pop()
        if pid in candidates:
            continue
        candidates.add(pid)
        todo += [c for c in children.get(pid, ()) if ours(tab[c])]
    dirs = cwds(candidates) if candidates else {}
    issues, crits = (registered_issues(), live_crits()) if any(is_live_server(p.command) for p in tops) else ({}, {})
    out, kept_out = {}, {}
    for r in roots:
        why = left_out(r, tab, tops, dirs, crits.get(issues.get(r)))
        kept = mine | set(why)
        kept_out[r] = sorted(((p._replace(cwd=dirs[p.pid], name=name_of(p.command)), why[p.pid]) for p in tops
                              if p.pid in why and inside(dirs.get(p.pid), r)), key=lambda x: x[0].pid)
        found, seen = [], set()
        todo = [p.pid for p in tops if p.pid not in kept and inside(dirs.get(p.pid), r)]
        while todo:
            pid = todo.pop()
            if pid in seen:
                continue
            seen.add(pid)
            p = tab[pid]
            found.append(p._replace(cwd=dirs[pid], name=name_of(p.command)))
            todo += [c for c in children.get(pid, ()) if c in candidates and c not in kept
                     and inside(dirs.get(c), r)]
        out[r] = sorted(found, key=lambda p: p.pid)
    return out, kept_out


def scan(roots, reapers=REAPERS, tab=None):
    """{root: [Proc]} of the orphans of each real path in `roots`, sorted by PID, from one table and one cwds run."""
    return scan_left(roots, reapers, tab)[0]


def find(root, reapers=REAPERS, tab=None):
    """[Proc] of the orphans of `root`, sorted by PID. Raises CannotTell."""
    root = os.path.realpath(root)
    return scan([root], reapers, tab)[root]


def same(p, root, reapers, tab, dirs):
    """True when `tab` holds p.pid as the same process, still the current user's, still orphaned (or under the same
    parent), and `dirs` puts it inside `root`."""
    q = tab.get(p.pid)
    return (q is not None and q.start == p.start and q.uid == os.getuid() and not q.state.startswith("Z")
            and (q.ppid in reapers or q.ppid == p.ppid) and inside(dirs.get(p.pid), root))


def gone(p, tab):
    q = tab.get(p.pid)
    return q is None or q.start != p.start or q.state.startswith("Z")


def wait_gone(procs, bound):
    """The procs still there after up to `bound` seconds, one table per POLL. A table that cannot be read counts as
    nothing gone."""
    end = time.monotonic() + bound
    left = list(procs)
    while left:
        try:
            tab = table()
            left = [p for p in left if not gone(p, tab)]
        except CannotTell:
            pass
        if not left or time.monotonic() >= end:
            break
        time.sleep(POLL)
    return left


def signal_each(procs, sig):
    """(signalled, already gone, refused) of os.kill by PID."""
    sent, ended, refused = [], [], []
    for p in procs:
        try:
            os.kill(p.pid, sig)
            sent.append(p)
        except ProcessLookupError:
            ended.append(p)
        except PermissionError:
            refused.append(p)
    return sent, ended, refused


def stop(procs, root, reapers=REAPERS):
    """(stopped, left): SIGTERM to each proc that is still the same process, SIGKILL after GRACE seconds to each that
    is still there and still the same. A proc that is not the same at the first check is in neither list. Raises
    CannotTell only before anything is signalled."""
    root = os.path.realpath(root)
    procs = list(procs)
    if not procs:
        return [], []
    tab, dirs = table(), cwds([p.pid for p in procs])
    sent, stopped, left = signal_each([p for p in procs if same(p, root, reapers, tab, dirs)], signal.SIGTERM)
    survivors = wait_gone(sent, GRACE)
    stopped += [p for p in sent if p not in survivors]
    if survivors:
        try:
            tab, dirs = table(), cwds([p.pid for p in survivors])
        except CannotTell:
            return by_pid(stopped), by_pid(left + survivors)
        stopped += [p for p in survivors if gone(p, tab)]
        target = [p for p in survivors if not gone(p, tab)]
        left += [p for p in target if not same(p, root, reapers, tab, dirs)]
        killed, ended, refused = signal_each([p for p in target if same(p, root, reapers, tab, dirs)],
                                             signal.SIGKILL)
        stopped += ended
        left += refused
        still = wait_gone(killed, KILL_WAIT)
        stopped += [p for p in killed if p not in still]
        left += still
    return by_pid(stopped), by_pid(left)


def by_pid(procs):
    return sorted(procs, key=lambda p: p.pid)


def sweep(roots, reapers=REAPERS, settle_min=0):
    """{name: Swept(stopped, left)} or {name: CannotTell} for roots [(name, path)], in one window for all: look,
    stop what is new, look again. The window ends at the first look after `settle_min` seconds that finds nothing
    new, or at SETTLE seconds; a stop is always followed by one more look, whose own stop ends the sweep. A Swept's
    `kept` is what the last look that could tell left out."""
    paths = {name: os.path.realpath(path) for name, path in roots}
    done = {name: (set(), [], []) for name in paths}  # handled (pid, start), stopped, left
    kept = {name: [] for name in paths}
    result = {}
    t0 = time.monotonic()
    while True:
        active = [n for n in paths if n not in result]
        if not active:
            break
        t = time.monotonic() - t0
        try:
            found, left_alone = scan_left(sorted({paths[n] for n in active}), reapers)
        except CannotTell as e:
            for n in active:
                handled, stopped, left = done[n]
                result[n] = Swept(by_pid(stopped), by_pid(left), str(e), kept[n]) if stopped or left or kept[n] \
                    else e
            break
        new_any = False
        for n in active:
            kept[n] = left_alone[paths[n]]
            handled, stopped, left = done[n]
            new = [p for p in found[paths[n]] if (p.pid, p.start) not in handled]
            if not new:
                continue
            new_any = True
            handled |= {(p.pid, p.start) for p in new}
            try:
                s, l = stop(new, paths[n], reapers)
            except CannotTell as e:
                result[n] = Swept(by_pid(stopped), by_pid(left), str(e), kept[n]) if stopped or left or kept[n] \
                    else e
                continue
            stopped += s
            left += l
        if new_any:
            if t >= SETTLE:
                break
        elif t >= settle_min or t >= SETTLE:
            break
        time.sleep(POLL)
    for n in paths:
        if n not in result:
            _, stopped, left = done[n]
            result[n] = Swept(by_pid(stopped), by_pid(left), kept=kept[n])
    return result


def kept_text(kept):
    """`<pid> <name>, … (<why>)` for each reason of [(Proc, why)], in order of their first PID; '' for none."""
    groups = {}
    for p, why in sorted(kept, key=lambda x: x[0].pid):
        groups.setdefault(why, []).append(f"{p.pid} {p.name}")
    return "; ".join(f"{', '.join(names)} ({why})" for why, names in groups.items())


def line(name, result):
    """The sentence of a sweep's result for one worktree."""
    if isinstance(result, CannotTell):
        return f"cannot tell the orphaned processes of {name}: {result}"
    stopped, left = result
    reason = getattr(result, "reason", None)
    kept = getattr(result, "kept", [])

    def names(procs):
        return ", ".join(f"{p.pid} {p.name}" for p in sorted(procs, key=lambda p: p.pid))

    if not stopped and not left:
        text = f"no orphaned processes in {name}"
    else:
        text = f"stopped {len(stopped)} orphaned processes of {name}" + (f": {names(stopped)}" if stopped else "")
        if left:
            text += f"; not stopped: {names(left)}"
    if kept:
        text += f"; left running: {kept_text(kept)}"
    if reason:
        text += f"; then cannot tell: {reason}"
    return text
