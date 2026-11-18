"""Orphaned processes of a worktree, for the event daemon (issue 472). Not a command.

tick(st, now) looks at most once per LOOK seconds: one process table, then the orphans of every registered worktree
(_pmorphans). A worktree whose orphans include a PID seen for HOLD seconds or more that was not told gives one line

  EVENT orphans <worktree> <n> <cpu>% <name>×<k>,… pids=<pid>,…[ pane=<pane>]

for every orphan seen that long (cpu: their summed CPU percent; names grouped, most first, then by name; pane: the
first live registered pane whose cwd is the worktree). AGAIN seconds after a line with pane=, when one of its PIDs
is still an orphan of that worktree, one line `EVENT orphans again <worktree> …` with the same fields, once. A
later line for a new PID keeps the first time of `again`. st["orphans"] (the daemon's saved state) holds what was
seen and told, by `<pid>:<start>`, so a restarted daemon does not tell it again. A look that cannot read the process
table gives no line and changes nothing. The line is a notice: nothing is stopped.
"""
import collections
import json
import os
import time

import _pmorphans
from _pmlib import PANES

LOOK = 30      # seconds between two looks (the daemon may wake more often)
HOLD = 60      # seconds a PID must have been seen before it is told
AGAIN = 300    # seconds after a told line with pane= before `again`


def pane_of(path):
    """The name of the first live registered pane whose real cwd is `path`, or None."""
    try:
        reg = json.loads(PANES.read_text())
    except (OSError, ValueError):
        return None
    for r in reg if isinstance(reg, list) else []:
        if isinstance(r, dict) and not r.get("gone") and isinstance(r.get("cwd"), str) \
                and isinstance(r.get("name"), str) and os.path.realpath(r["cwd"]) == path:
            return r["name"]
    return None


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def event(name, procs, keys, again, pane):
    chosen = sorted((p for p in procs if key(p) in keys), key=lambda p: p.pid)
    counts = collections.Counter(p.name for p in chosen)
    groups = ",".join(f"{n}×{k}" for n, k in sorted(counts.items(), key=lambda x: (-x[1], x[0])))
    cpu = round(sum(p.cpu for p in chosen))
    pids = ",".join(str(p.pid) for p in chosen)
    return (f"EVENT orphans {'again ' if again else ''}{name} {len(chosen)} {cpu}% {groups} pids={pids}"
            + (f" pane={pane}" if pane else ""))


def key(p):
    return f"{p.pid}:{p.start}"


def tick(st, now=None, reapers=_pmorphans.REAPERS):
    """The event lines of one call; keeps its state in st["orphans"] and st["orphans_checked"]."""
    now = time.time() if now is None else now
    last = st.get("orphans_checked")
    if number(last) and last <= now < last + LOOK:
        return []
    worktrees = _pmorphans.worktree_paths()
    try:
        tab = _pmorphans.table()
        found = _pmorphans.scan(sorted({path for _, path in worktrees}), reapers, tab) if worktrees else {}
    except _pmorphans.CannotTell:
        return []
    before = st.get("orphans") if isinstance(st.get("orphans"), dict) else {}
    after, lines = {}, []
    for name, path in worktrees:
        procs = found.get(path, [])
        if not procs or name in after:
            continue
        prev = before.get(name) if isinstance(before.get(name), dict) else {}
        prev_seen = prev.get("seen") if isinstance(prev.get("seen"), dict) else {}
        seen = {key(p): prev_seen[key(p)] if number(prev_seen.get(key(p))) else now for p in procs}
        told = [k for k in prev.get("told") or [] if isinstance(k, str) and k in seen] \
            if isinstance(prev.get("told"), list) else []
        again_at = prev.get("again_at") if number(prev.get("again_at")) else None
        held = {k for k, t in seen.items() if now - t >= HOLD}
        if held - set(told):
            pane = pane_of(path)
            lines.append(event(name, procs, held, False, pane))
            told = sorted(held)
            if pane and again_at is None:
                again_at = now + AGAIN
        elif again_at is not None and now >= again_at and held & set(told):
            lines.append(event(name, procs, held, True, pane_of(path)))
            again_at = None
        after[name] = {"seen": seen, "told": told, "again_at": again_at}
    st["orphans"] = after
    st["orphans_checked"] = now
    return lines
