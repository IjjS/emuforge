"""A pm-check step that stands still, for the event daemon (issue 293). Not a command.

tick(st, now) reads output/checks/running.json of the main checkout and of every worktree in .pm/run/worktrees.json.
A record of a live pm-check whose step started THRESHOLD seconds or more ago gives one line
`EVENT check still <worktree> <step> <minutes>m`, and one more for every further THRESHOLD seconds of the same step
run. st["still"] (the daemon's saved state) holds what was told, so a restarted daemon does not tell it again. A
record that cannot be read, lacks a field, or belongs to a process that is not a live pm-check gives no line. The
line is a notice: nothing is stopped.
"""
import datetime as dt
import json
import os
import re
import subprocess
import time

from _pmlib import ROOT, WORKTREES

THRESHOLD = 3600   # seconds a step may run before the pm is told, and between two lines
PS = "/bin/ps"
PS_BOUND = 10      # seconds
PS_ENV = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
STEP = re.compile(r"[a-z][a-z-]{0,39}")
NAME = re.compile(r"\S+")


def checkouts():
    """[(name, path)]: the main checkout, then each registered worktree with a string name and path. The name comes
    from the registry, never from a file in the worktree."""
    out = [("main", str(ROOT))]
    try:
        reg = json.loads(WORKTREES.read_text())
    except (OSError, ValueError):
        reg = []
    for w in reg if isinstance(reg, list) else []:
        if isinstance(w, dict) and isinstance(w.get("name"), str) and isinstance(w.get("path"), str) \
                and NAME.fullmatch(w["name"]) and w["name"] != "main":
            out.append((w["name"], w["path"]))
    return out


def record(path):
    """(pid, step, started as written, started in seconds) of `path`/output/checks/running.json, or None when it is
    absent or not that shape."""
    try:
        with open(os.path.join(path, "output", "checks", "running.json"), encoding="utf-8") as f:
            rec = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(rec, dict) or rec.get("waiting"):
        return None
    pid, step, started = rec.get("pm_check_pid"), rec.get("step"), rec.get("started")
    if type(pid) is not int or pid <= 1:
        return None
    if not isinstance(step, str) or not STEP.fullmatch(step):
        return None
    if not isinstance(started, str):
        return None
    try:
        t = dt.datetime.fromisoformat(started)
    except ValueError:
        return None
    if t.tzinfo is None:
        return None
    return pid, step, started, t.timestamp()


def live_pm_check(pid):
    """True when `pid` is a pm-check that is not a `--stop`; False when it is another program or ps exits non-zero
    (no such process: ps -p exits 1); None when ps could not say (it cannot be started or passed its bound)."""
    try:
        p = subprocess.run([PS, "-o", "command=", "-p", str(pid)], capture_output=True, text=True, env=PS_ENV,
                           timeout=PS_BOUND, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return False
    words = p.stdout.split()
    return any(os.path.basename(w) == "pm-check" for w in words) and "--stop" not in words


def tick(st, now=None):
    """The event lines of one look; updates st["still"]. Raises nothing for a bad file."""
    now = time.time() if now is None else now
    told = st.get("still")
    if not isinstance(told, dict):
        told = st["still"] = {}
    lines = []
    names = set()
    for name, path in checkouts():
        names.add(name)
        rec = record(path)
        if rec is None:
            told.pop(name, None)
            continue
        pid, step, started, t = rec
        age = now - t
        if age < THRESHOLD:
            continue
        live = live_pm_check(pid)
        if live is None:
            continue
        if not live:
            told.pop(name, None)
            continue
        run = f"{pid} {step} {started}"
        entry = told.get(name)
        if not isinstance(entry, dict) or entry.get("run") != run or type(entry.get("told")) is not int:
            entry = told[name] = {"run": run, "told": 0}
        n = int(age // THRESHOLD)
        if n > entry["told"]:
            lines.append(f"EVENT check still {name} {step} {int(age // 60)}m")
            entry["told"] = n
    for name in [k for k in told if k not in names]:
        del told[name]
    return lines
