"""Shared helpers for the .pm/bin scripts. Not a command."""
import contextlib
import datetime as dt
import fcntl
import json
import os
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]  # the main checkout; worktrees are its siblings
PM = ROOT / ".pm"
RUN = PM / "run"
REPORTS = RUN / "reports.jsonl"  # pm-report's file channel (pm-report, pm-watchd)
BIN = PM / "bin"
RUN.mkdir(parents=True, exist_ok=True)

PANES = RUN / "panes.json"            # live registry: list of pane dicts
PANE_ADMISSION = RUN / "pane-admission"  # lock shared by pane starts and closes
PANES_HISTORY = RUN / "panes-history.jsonl"  # every pane ever started (for pm-cost)
WORKTREES = RUN / "worktrees.json"    # list of worktree dicts
PORTS = RUN / "ports.json"            # {port: worktree path}
PMINFO = RUN / "pm.json"              # {"pm_pane":..., "pm_name":..., "workspace":...}
EVENTS = RUN / "events.log"

MODEL_IDS = {"opus": "claude-opus-5-5", "fable": "claude-fable-5-2", "sonnet": "claude-sonnet-5-5", "haiku": "claude-haiku-5-5"}
# Worker panes share one limit across all sides. All roles count toward the total.
LIMITS = {"worker": 16, "total": 24, "mem_gb": 22.5}
SIDES = {"s": "studio", "e": "engine", "t": "tests", "h": "harness"}  # first letter of a unit name: s1, e2, t1, h1


def now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def load(path, default):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save(path, obj):
    """Write obj as JSON through a temp file of this writer's own in the same folder, then move it over the file, so a
    reader sees the old file or the new one and two writers never share a temp file (issue 504). A file several
    processes change is changed with `update`, never with a load and a save of its own."""
    import tempfile
    path = pathlib.Path(path)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(json.dumps(obj, ensure_ascii=False, indent=1))
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


@contextlib.contextmanager
def locked(path):
    """Hold the lock of a shared file: flock on `<file>.lock` beside it (the file itself cannot carry the lock, since
    save moves a new file over it). Blocks until the holder lets go."""
    path = pathlib.Path(path)
    with open(path.with_name(path.name + ".lock"), "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


@contextlib.contextmanager
def update(path, default):
    """One read-change-write of a shared file under its lock (issue 504): yields the loaded value (`default` when the
    file is missing or broken) to change in place, and saves it when the block ends without an exception. Whatever
    changed the file before the lock was taken is in the value, so writers at the same moment lose nothing. The block
    is short: no herdr call, no sleep, no subprocess."""
    with locked(path):
        obj = load(path, default)
        yield obj
        save(path, obj)


def log(line):
    with EVENTS.open("a") as f:
        f.write(f"{now()} {line}\n")


def herdr(*args, check=True):
    """Run a herdr command, return its .result (dict) or None on failure when check=False."""
    p = subprocess.run(["herdr", *args], capture_output=True, text=True)
    out = p.stdout.strip()
    if p.returncode != 0:
        if check:
            sys.exit(f"herdr {' '.join(args)} failed: {p.stderr.strip() or out}")
        return None
    try:
        d = json.loads(out)
        return d.get("result", d)
    except json.JSONDecodeError:
        return {"raw": out}


def herdr_text(*args):
    """Run a herdr command whose output is text (`pane read`); its stdout as is, or None on failure."""
    try:
        p = subprocess.run(["herdr", *args], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return p.stdout if p.returncode == 0 else None


def find_key(obj, key):
    """Depth-first search for a key in nested dict/list JSON."""
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            r = find_key(v, key)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_key(v, key)
            if r is not None:
                return r
    return None


def agents():
    """Agent list, or None when herdr did not answer (callers must not treat None as 'no agents')."""
    r = herdr("agent", "list", check=False)
    return None if r is None else r.get("agents", [])


def agent_by_name(name):
    for a in agents() or []:
        if a.get("name") == name:
            return a
    return None


def agent_by_pane(pane_id):
    for a in agents() or []:
        if a.get("pane_id") == pane_id:
            return a
    return None


def tabs():
    r = herdr("tab", "list", check=False) or {}
    return r.get("tabs", [])


def panes():
    """Pane list, or None when herdr did not answer."""
    r = herdr("pane", "list", check=False)
    return None if r is None else r.get("panes", [])


def mem_gb():
    """Return (used_gb, swap_used_gb, swap_total_gb) like the PM rules define: active+wired+compressed, 16 KB pages."""
    try:
        vm = subprocess.run(["vm_stat"], capture_output=True, text=True).stdout
    except OSError:  # no vm_stat (Linux): nothing is known, and an unknown reading is room
        vm = ""
    vals = {}
    for line in vm.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            vals[k.strip()] = int(v.strip().rstrip(".") or 0) if v.strip().rstrip(".").isdigit() else 0
    pages = vals.get("Pages active", 0) + vals.get("Pages wired down", 0) + vals.get("Pages occupied by compressor", 0)
    used = pages * 16384 / 1073741824
    try:
        sw = subprocess.run(["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True).stdout
    except OSError:
        sw = ""
    import re
    m = re.search(r"total = ([0-9.]+)M\s+used = ([0-9.]+)M", sw)
    st, su = (float(m.group(1)) / 1024, float(m.group(2)) / 1024) if m else (0.0, 0.0)
    return used, su, st


def cpu_pct(seconds=1):
    """CPU in use across all cores over `seconds`, in percent (100 - idle), or None when top gave no answer.
    The first sample of top is since boot, so two are taken and the second is read."""
    import re
    try:
        out = subprocess.run(["top", "-l", "2", "-n", "0", "-s", str(seconds)], capture_output=True, text=True,
                             timeout=seconds + 10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    idle = re.findall(r"CPU usage:.*?([0-9.]+)% idle", out)
    return round(100 - float(idle[-1]), 1) if idle else None


def thermal_state():
    """macOS Foundation's processInfo.thermalState, or None when unavailable."""
    if sys.platform != "darwin":
        return None
    import ctypes as c
    try:
        c.CDLL("/System/Library/Frameworks/Foundation.framework/Foundation")
        objc = c.CDLL("/usr/lib/libobjc.A.dylib")
        objc.objc_getClass.argtypes = objc.sel_registerName.argtypes = [c.c_char_p]
        objc.objc_getClass.restype = objc.sel_registerName.restype = c.c_void_p
        send_object = c.CFUNCTYPE(c.c_void_p, c.c_void_p, c.c_void_p)(("objc_msgSend", objc))
        send_integer = c.CFUNCTYPE(c.c_long, c.c_void_p, c.c_void_p)(("objc_msgSend", objc))
        info = send_object(objc.objc_getClass(b"NSProcessInfo"), objc.sel_registerName(b"processInfo"))
        value = send_integer(info, objc.sel_registerName(b"thermalState"))
        return {0: "nominal", 1: "fair", 2: "serious", 3: "critical"}.get(value)
    except (OSError, AttributeError):
        return None


def wake_watchd():
    """Tell a running pm-watchd to look now instead of at its next tick (SIGUSR1). Silent when none runs."""
    import signal
    try:
        # watchd.wake exists only while a daemon that handles the signal runs; an older one would die of it
        pid = int((RUN / "watchd.wake").read_text())
        cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True).stdout
        if "pm-watchd" in cmd:  # a stale file whose pid now belongs to something else is left alone
            os.kill(pid, signal.SIGUSR1)
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        pass


# --- a pane that pm-pane opens or closes now (issue 504) ----------------------------------------------------------
# While `pm-pane new` starts an agent and until its entry is in the registry, and while `pm-pane close` takes an entry
# out and closes the pane, herdr and the registry differ on purpose. pm-pane marks the pane's name for that time with
# a file .pm/run/pane-ops/<name> holding its pid; pm-watchd tells no `EVENT unregistered` of a marked name. A close
# keeps its mark until herdr lists no agent in the closed pane (at most 5 s), and pm-watchd reads the marks before
# herdr's agent list and again after the registry, so a pane mid-open or mid-close is marked at one of them (issue 510).
PANE_OPS = RUN / "pane-ops"
_OP_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


def _runs(pid, word):
    """True when pid is a live process whose command line holds `word`."""
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True).stdout
    return word in cmd


@contextlib.contextmanager
def pane_op(name):
    """Mark the pane `name` as being opened or closed by this process for the block; on the way out the mark goes and
    pm-watchd is woken, so a pane this process left unregistered is judged at once."""
    f = PANE_OPS / name if _OP_NAME.fullmatch(name or "") else None
    if f is not None:
        PANE_OPS.mkdir(parents=True, exist_ok=True)
        f.write_text(str(os.getpid()))
    try:
        yield
    finally:
        if f is not None:
            with contextlib.suppress(OSError):
                if f.read_text().strip() == str(os.getpid()):
                    f.unlink()
        wake_watchd()


def pane_ops():
    """The names a live pm-pane is opening or closing now. A mark whose pid is dead or no longer a pm-pane is removed."""
    out = set()
    try:
        files = list(PANE_OPS.iterdir())
    except OSError:
        return out
    for f in files:
        try:
            pid = int(f.read_text().strip())
        except (OSError, ValueError):
            pid = None
        if pid is not None and _runs(pid, "pm-pane"):
            out.add(f.name)
        else:
            with contextlib.suppress(OSError):
                f.unlink()
    return out


def pm_target():
    info = load(PMINFO, {})
    return info.get("pm_name") or info.get("pm_pane") or os.environ.get("HERDR_PANE_ID")


def notify(title, text, sound="request"):
    """In-terminal herdr notification; falls back to a macOS notification when herdr is not reachable."""
    p = subprocess.run(["herdr", "notification", "show", title, "--body", text[:200], "--sound", sound], capture_output=True, text=True)
    if p.returncode != 0:
        subprocess.run(["osascript", "-e", f'display notification "{text[:200]}" with title "{title}"'], capture_output=True)


PROJECTS = pathlib.Path.home() / ".claude" / "projects"


def transcript_path(session):
    """The Claude Code transcript of a session id, or None (Codex panes have none here)."""
    if not session:
        return None
    hits = list(PROJECTS.glob(f"*{ROOT.name}*/{session}.jsonl"))
    return hits[0] if hits else None


def transcript_ctx(session, tail_bytes=400_000):
    """(context tokens of the last assistant call, mtime) from the transcript tail; (None, None) when unknown."""
    path = transcript_path(session)
    if not path:
        return None, None
    try:
        size = path.stat().st_size
        with path.open("rb") as fh:
            fh.seek(max(0, size - tail_bytes))
            tail = fh.read().decode(errors="replace")
    except OSError:
        return None, None
    ctx = None
    for line in tail.splitlines():
        if '"usage"' not in line:
            continue
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        if o.get("type") == "assistant":
            u = (o.get("message") or {}).get("usage") or {}
            ctx = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
    return ctx, path.stat().st_mtime


def pane_rss_gb(pane_id):
    """Resident memory of everything running inside a pane (the shell's whole process subtree), in GB."""
    r = herdr("pane", "process-info", "--pane", pane_id, check=False) or {}
    info = find_key(r, "process_info") or r
    shell = info.get("shell_pid") if isinstance(info, dict) else None
    if not shell:
        return 0.0
    ps = subprocess.run(["ps", "-axo", "pid=,ppid=,rss="], capture_output=True, text=True).stdout
    children, rss = {}, {}
    for line in ps.splitlines():
        parts = line.split()
        if len(parts) != 3:
            continue
        pid, ppid, kb = int(parts[0]), int(parts[1]), int(parts[2])
        children.setdefault(ppid, []).append(pid)
        rss[pid] = kb
    total, stack, seen = 0, [shell], set()
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        total += rss.get(pid, 0)
        stack.extend(children.get(pid, []))
    return total / 1048576


def issue_dir(n):
    d = PM / f"issue-{n}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def side_of(unit):
    """studio | engine | tests | harness from a unit name (s1, e2, t1, h1); 'other' for a pane without a unit."""
    return SIDES.get((unit or "")[:1], "other")


# --- who calls, and what a pane may run (issue 478) ------------------------------------------------------------
# A plan leads one issue: it may open, reset and close that issue's worker, rev and crit panes, make its worktrees,
# write its worker and crit briefs and merge its units into feat/<issue>. Everything else these scripts do is the pm's.
# panes told to wait for room: a QUEUE answer of pm-pane [{asker, role, side, issue, reason, at}], a WAIT answer of
# pm-check [{asker, check, issue, reason, at, expected}]
WAITING = RUN / "waiting.json"
PANE_ROLES = ("plan", "worker", "rev", "crit", "harness-engineer")
PLAN_OPENS = ("worker", "rev", "crit")  # the roles a plan opens for its own issue


def _ancestors():
    pids, pid = set(), os.getpid()
    for _ in range(40):
        try:
            out = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        except OSError:
            break
        if not out.isdigit() or int(out) <= 1:
            break
        pid = int(out)
        pids.add(pid)
    return pids


def _shell_pid(pane_id):
    try:
        info = herdr("pane", "process-info", "--pane", pane_id, check=False) or {}
    except OSError:  # no herdr on this machine
        return None
    pi = find_key(info, "process_info")
    return pi.get("shell_pid") if isinstance(pi, dict) else None


def caller():
    """The live registered pane this command runs in, or None for the pm.

    None also stands for a caller no script can tie to a registered pane (the owner's own terminal, a test
    fixture): it has the pm's rights (decisions.md, issue 478, review decision 3a). HERDR_PANE_ID is tried first,
    with no herdr call; when it names neither the pm's pane nor a registered pane (Codex freezes it, see pm-watchd),
    the pane whose shell is an ancestor of this process decides."""
    reg = [r for r in load(PANES, []) if not r.get("gone")]
    if not reg:
        return None
    env = os.environ.get("HERDR_PANE_ID")
    if env and env == load(PMINFO, {}).get("pm_pane"):
        return None
    hit = next((r for r in reg if r.get("pane_id") == env), None)
    if hit:
        return hit
    anc = _ancestors()
    return next((r for r in reg if _shell_pid(r["pane_id"]) in anc), None)


def guard(what, issue=None, plan_may=False):
    """Refuse (exit 1, one line) when a pane runs what is the pm's. With plan_may, a plan may run it for its own issue.
    Returns the calling pane's entry, or None for the pm."""
    c = caller()
    if c is None:
        return None
    who = f"{c['name']} ({c.get('role')} of #{c.get('issue')})"
    if plan_may and c.get("role") == "plan":
        if issue is not None and str(issue) == str(c.get("issue")):
            return c
        sys.exit(f"refused: {who} acts only on its own issue #{c.get('issue')}; {what} names #{issue}")
    sys.exit(f"refused: {what} is the pm's" + ("; a plan may run it for its own issue" if plan_may else "")
             + f"; {who} may not")


# --- pm-pane reset (issues 495, 497, 509) ---------------------------------------------------------------------------
# A pane lays its reply out at its own width, so in a narrow pane the reset marker reaches the terminal over two rows
# (`⏺ RESET READY` / `  i486-worker-s2 102730`); unwrapping soft wraps does not join them. The prompt echo (`❯ …`,
# Codex `› …`) holds the marker too and wraps the same way. A pane often writes a sentence or two before the marker.
# herdr's `pane wait-output --regex` matches a snapshot row by row and never across a line break (herdr 0.9.5, issue
# 509), so pm-pane reads the snapshot (`pane read`) and matches the pattern in Python on the whole of it.
REPLY_BULLET = "⏺•"           # a reply row of Claude Code, Codex
NOT_REPLY = "❯›⎿└"            # a prompt echo, a tool's result (Claude Code, Codex)
RESETTING_FOR = 900           # seconds a reset in progress is believed (a reset ends in under 10 minutes)


def reset_marker_pattern(marker):
    """The Python regex `pm-pane reset` waits for on the pane's snapshot: the marker's words with any whitespace, line breaks
    included, between them, at the start of a row (after non-letters), and inside a reply: after a reply bullet with no
    prompt echo or tool result between the bullet and the marker. So the echo of the reset prompt, however it wraps,
    and a tool's row or result that holds the marker never match."""
    words = r"\s+".join(re.escape(w) for w in marker.split())
    return (rf"[{REPLY_BULLET}](?:[^{NOT_REPLY}]*\n)?[^A-Za-z{NOT_REPLY}\n]*{words}[ \t]*(?:\n|$)")


def reset_marker_seen(screen, marker):
    """True when the snapshot text of a pane holds the marker in a reply (reset_marker_pattern)."""
    return re.search(reset_marker_pattern(marker), screen or "") is not None


def reports_size():
    """The byte length of reports.jsonl now: where pm-report's next record starts."""
    try:
        return REPORTS.stat().st_size
    except OSError:
        return 0


def reported_after(pos, pane, line):
    """True when pm-report recorded `line` (its words) for `pane` past byte offset `pos` of reports.jsonl."""
    try:
        with REPORTS.open("rb") as f:
            f.seek(pos)
            chunk = f.read()
    except OSError:
        return False
    for row in chunk.decode(errors="replace").splitlines():
        try:
            o = json.loads(row)
        except ValueError:
            continue
        if isinstance(o, dict) and o.get("pane") == pane and str(o.get("line", "")).split() == line.split():
            return True
    return False


def state_note(entry):
    """Where a pane writes its resume note: a worker's and a harness-engineer's `output/state.md` in its worktree,
    every other role's `.pm/issue-<id>/state-<role>.md` (pane-mode.md, Context budget)."""
    if entry.get("role") in ("worker", "harness-engineer"):
        return "output/state.md"
    return f"{ROOT}/.pm/issue-{entry.get('issue')}/state-{entry.get('role')}.md"


def mark_resetting(name, on, at=None):
    """Set (on) or clear the registry entry's `resetting` (epoch s): a reset of the pane is in progress, so pm-watchd
    takes a turn end of it for the reset's own, not a silent turn."""
    with update(PANES, []) as reg:
        for r in reg:
            if r.get("name") == name and not r.get("gone"):
                if on:
                    r["resetting"] = time.time() if at is None else at
                else:
                    r.pop("resetting", None)


def resetting(entry, at=None):
    """True while the entry says a reset of the pane began under RESETTING_FOR seconds ago."""
    t = entry.get("resetting") if isinstance(entry, dict) else None
    at = time.time() if at is None else at
    return isinstance(t, (int, float)) and not isinstance(t, bool) and 0 <= at - t < RESETTING_FOR


def memory_room(mem, limit=LIMITS["mem_gb"]):
    """Why memory or swap leaves no room, or None."""
    used, su, st = mem
    if used > limit:
        return f"memory {used:.1f}GB > {limit}GB"
    if st and st - su < 0.25:
        return f"swap free {(st - su) * 1024:.0f}MB < 256MB"
    return None


def thermal_room(state):
    if state in ("serious", "critical"):
        return f"thermal state {state}"
    return None


def machine_room(given=None):
    """Why heavy work must wait. Reuse the daemon's measurements when supplied."""
    mem = given["mem"] if given else mem_gb()
    why = memory_room(mem)
    if why:
        return why
    return thermal_room(given["thermal"] if given else thermal_state())


def room(role, issue, alive, tokens=True, given=None):
    """Why a new pane of this role may not start now, or None when there is room. The one judgement of the
    machine's limits that pm-pane (its QUEUE answer) and pm-watchd (EVENT room) share."""
    from _pmquota import start_allowed
    why = start_allowed(issue)
    if why:
        return why
    why = memory_room(given["mem"] if given else mem_gb())
    if why:
        return why
    if tokens:
        from _pmtokens import fmt, status as token_status
        rate, tgt, over = token_status()
        if over:
            return f"token rate {fmt(tgt, rate)} is over today's target {fmt(tgt, tgt['per_hour'])}"
    if len(alive) >= LIMITS["total"]:
        return f"{len(alive)} live panes >= {LIMITS['total']}"
    if role == "worker":
        n = sum(1 for r in alive if r.get("role") == "worker")
        cap = LIMITS["worker"]
        if n >= cap:
            return f"{n} worker panes >= {cap}"
    return None


def wait_for_room(asker, role, side, issue, reason):
    """Remember that a pane was told QUEUE; pm-watchd sends it `EVENT room <asker> pane <role> <side>` once there is room."""
    with update(WAITING, []) as rows:
        rows[:] = [w for w in rows if not (w.get("asker") == asker and w.get("role") == role and w.get("side") == side)]
        rows.append(dict(asker=asker, role=role, side=side, issue=str(issue), reason=reason, at=now()))


# --- asking for room to run a check (issue 478, part 2) ------------------------------------------------------------
# A pm-check that calls for a heavy module asks for room before its first step: it starts when check_room finds the
# machine under its limits, however many checks already run, and is otherwise answered WAIT with an expected wait.
CHECKS = RUN / "checks"                      # <pid>.json of each heavy pm-check that runs now; .start.lock
DURATIONS = RUN / "check-durations.jsonl"    # one line per step that ran: {at, step, seconds, status}
UNKNOWN_STEP = 300   # seconds counted for a step with no recorded duration
STEP_FLOOR = 30      # seconds: the least a running step is counted as still needing
IDLE_WAIT = 60       # seconds of wait when no check runs (the load is the machine's other work)
RECENT = 20          # recorded durations a step's estimate is the median of


def _is_pm_check(pid):
    return _runs(pid, "pm-check")


def running_checks():
    """The heavy pm-check runs recorded in CHECKS whose process is still a live pm-check; a file of a dead one is
    removed. Each: {pid, checkout, started (epoch s), steps, step, step_started}."""
    out = []
    for f in sorted(CHECKS.glob("*.json")) if CHECKS.exists() else ():
        r = load(f, None)
        pid = r.get("pid") if isinstance(r, dict) else None
        if not isinstance(pid, int) or not _is_pm_check(pid):
            f.unlink(missing_ok=True)
            continue
        out.append(r)
    return out


def note_check(entry):
    """Write (or rewrite) this run's entry in CHECKS."""
    CHECKS.mkdir(parents=True, exist_ok=True)
    save(CHECKS / f"{entry['pid']}.json", entry)


def end_check(pid):
    """This run has ended: its entry goes, and pm-watchd is woken, since a check that ends frees room (issue 497)."""
    (CHECKS / f"{pid}.json").unlink(missing_ok=True)
    wake_watchd()


def record_duration(step, seconds, status):
    with DURATIONS.open("a") as f:
        f.write(json.dumps(dict(at=now(), step=step, seconds=seconds, status=status)) + "\n")


def step_estimates():
    """{step: seconds}, the median of each step's last RECENT recorded durations."""
    seen = {}
    try:
        text = DURATIONS.read_text()
    except OSError:
        return {}
    for ln in text.splitlines():
        try:
            d = json.loads(ln)
            if isinstance(d.get("step"), str) and isinstance(d.get("seconds"), (int, float)):
                seen.setdefault(d["step"], []).append(float(d["seconds"]))
        except (ValueError, AttributeError):
            continue
    est = {}
    for step, xs in seen.items():
        xs = sorted(xs[-RECENT:])
        n = len(xs)
        est[step] = xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2
    return est


def remaining(entry, est, at):
    """Seconds a running check still needs: the rest of its current step (at least STEP_FLOOR), then its later steps."""
    steps = entry.get("steps") or []
    cur = entry.get("step")
    i = steps.index(cur) if cur in steps else 0
    later = steps[i + 1:] if cur in steps else steps[1:]
    first = steps[i] if steps else None
    left = 0.0
    if first is not None:
        elapsed = at - float(entry.get("step_started") or entry.get("started") or at)
        left = max(STEP_FLOOR, est.get(first, UNKNOWN_STEP) - elapsed)
    return left + sum(est.get(s, UNKNOWN_STEP) for s in later)


def check_room(running=None, at=None, given=None):
    """(why, wait seconds, [(checkout, step, seconds left)]) for a heavy check that asks now; why is None when there
    is room. The wait is the least any running check still needs (remaining), or IDLE_WAIT when none runs."""
    running = running_checks() if running is None else running
    why = machine_room(given)
    at = time.time() if at is None else at
    est = step_estimates()
    left = [(r.get("checkout"), r.get("step"), round(remaining(r, est, at))) for r in running]
    if why is None:
        return None, 0, left
    wait = min((s for _, _, s in left), default=IDLE_WAIT)
    return why, max(STEP_FLOOR, wait), left


def wait_for_check_room(asker, checkout, issue, reason, expected):
    """Remember that a pane was answered WAIT; pm-watchd sends it `EVENT room <asker> check <checkout>` once there is
    room. One row per asker and checkout; an asker answered WAIT again keeps its place and its first `at`, so the
    longest waiting is told first."""
    with update(WAITING, []) as rows:
        row = next((w for w in rows if w.get("asker") == asker and w.get("check") == checkout), None)
        if row is None:
            rows.append(dict(asker=asker, check=checkout, issue=str(issue), reason=reason, at=now(), expected=expected))
        else:
            row.update(reason=reason, expected=expected)
