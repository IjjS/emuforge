"""Orphaned processes of a worktree, for the event daemon (issues 472, 497). Not a command.

A worktree is looked at only when it is due (issue 497: no look on every wake-up). `due(st, names, at)` makes the
named worktrees due at `at`; the daemon calls it when a registered pane whose cwd is the worktree ends a turn, and
when such a pane is closed or gone (`due_for(st, cwds, at)` maps the panes' cwds to the worktrees). tick(st, now)
looks once at every worktree due by `now`: one process table, then their orphans (_pmorphans). A worktree whose
orphans include a PID seen for HOLD seconds or more that was not told gives one line

  EVENT orphans <worktree> <n> <cpu>% <name>×<k>,… pids=<pid>,…[ pane=<pane>]

for every orphan seen that long (cpu: their summed CPU percent; names grouped, most first, then by name; pane: the
first live registered pane whose cwd is the worktree). A look that sees an orphan not yet held makes the worktree
due again when it will be (its first sight + HOLD), so a PID is told on a second look 60 s after the first. AGAIN
seconds after a line with pane=, the worktree is due again, and when one of its PIDs is still an orphan there, one
line `EVENT orphans again <worktree> …` with the same fields, once. A later line for a new PID keeps the first time of
`again`. A look that finds no orphan leaves the worktree not due. `next_look(st)` is the earliest time a worktree is
due, for the daemon's wait. st["orphans"] (the daemon's saved state) holds what was seen and told, by
`<pid>:<start>`, and st["orphan_looks"] when each worktree is due, so a restarted daemon does not tell it again. A
look that cannot read the process table gives no line and changes nothing. The line is a notice: nothing is
stopped. What every sweep leaves out (_pmorphans, issue 477: a worktree's running pm-check, its step group and the
stand-ins its tests start under <worktree>/output/tests/, and impeccable's live-server while a live crit pane of the
worktree's issue is registered) is not an orphan here either, so it is never told.
"""
import collections
import json
import os
import time

import _pmorphans
from _pmlib import PANES

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


def looks_of(st):
    v = st.get("orphan_looks")
    return {k: t for k, t in v.items() if isinstance(k, str) and number(t)} if isinstance(v, dict) else {}


def due(st, names, at):
    """Make the named worktrees due at `at` (an earlier due time is kept)."""
    looks = looks_of(st)
    for n in names:
        looks[n] = min(looks.get(n, at), at)
    st["orphan_looks"] = looks


def due_for(st, cwds, at):
    """Make due the registered worktrees whose real path is one of `cwds` (a pane's cwd); returns their names."""
    real = {os.path.realpath(c) for c in cwds if isinstance(c, str)}
    names = [name for name, path in _pmorphans.worktree_paths() if path in real]
    if names:
        due(st, names, at)
    return names


def next_look(st):
    """The earliest time a worktree is due, or None."""
    return min(looks_of(st).values(), default=None)


def tick(st, now=None, reapers=_pmorphans.REAPERS):
    """The event lines of one call; looks only at the worktrees due by `now`. Keeps its state in st["orphans"] and
    st["orphan_looks"]."""
    now = time.time() if now is None else now
    looks = looks_of(st)
    wanted = {n for n, t in looks.items() if t <= now}
    if not wanted:
        return []
    worktrees = [(n, p) for n, p in _pmorphans.worktree_paths() if n in wanted]
    try:
        tab = _pmorphans.table()
        found = _pmorphans.scan(sorted({path for _, path in worktrees}), reapers, tab) if worktrees else {}
    except _pmorphans.CannotTell:
        return []
    before = st.get("orphans") if isinstance(st.get("orphans"), dict) else {}
    after, lines, done = dict(before), [], set()
    for n in wanted:
        looks.pop(n, None)  # due again below only when a look calls for it; a worktree no longer registered is dropped
    for name, path in worktrees:
        if name in done:
            continue
        done.add(name)
        procs = found.get(path, [])
        if not procs:
            after.pop(name, None)
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
        if again_at is not None and again_at <= now:
            again_at = None  # its time came with nothing told left to tell
        after[name] = {"seen": seen, "told": told, "again_at": again_at}
        nxt = [t + HOLD for k, t in seen.items() if k not in told] + ([again_at] if again_at is not None else [])
        if nxt:
            looks[name] = max(min(nxt), now)
    st["orphans"] = after
    st["orphan_looks"] = looks
    return lines
