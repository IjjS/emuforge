"""Shared helpers for the .pm/bin scripts. Not a command."""
import datetime as dt
import json
import os
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]  # the main checkout; worktrees are its siblings
PM = ROOT / ".pm"
RUN = PM / "run"
BIN = PM / "bin"
RUN.mkdir(parents=True, exist_ok=True)

PANES = RUN / "panes.json"            # live registry: list of pane dicts
PANES_HISTORY = RUN / "panes-history.jsonl"  # every pane ever started (for pm-cost)
WORKTREES = RUN / "worktrees.json"    # list of worktree dicts
PORTS = RUN / "ports.json"            # {port: worktree path}
PMINFO = RUN / "pm.json"              # {"pm_pane":..., "pm_name":..., "workspace":...}
EVENTS = RUN / "events.log"

MODEL_IDS = {"opus": "claude-opus-5-5", "fable": "claude-fable-5-2", "sonnet": "claude-sonnet-5-5", "haiku": "claude-haiku-5-5"}
# worker panes per side (a unit's first letter), the same for every side, and live panes in all (plan, rev and crit
# included), set so that every side can reach its limit; memory, swap, CPU and the token rate still gate every new pane.
LIMITS = {"studio_worker": 8, "engine_worker": 8, "tests_worker": 8, "harness_worker": 8, "total": 24,
          "mem_gb": 22.5, "cpu_pct": 90}
SIDES = {"s": "studio", "e": "engine", "t": "tests", "h": "harness"}  # first letter of a unit name: s1, e2, t1, h1


def now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def load(path, default):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save(path, obj):
    path = pathlib.Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1))
    tmp.replace(path)


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


def machine_room(readings=None):
    """Why the machine has no room now (memory, swap, CPU as measured, against LIMITS), or None. An unknown reading
    is room. The one measurement a new pane (room) and a heavy check (check_room) share. `readings`, a dict, gets
    what was read: mem_gb, and cpu when memory left room to read it."""
    readings = {} if readings is None else readings
    used, su, st = mem_gb()
    readings["mem_gb"] = round(used, 1)
    if used > LIMITS["mem_gb"]:
        return f"memory {used:.1f}GB > {LIMITS['mem_gb']}GB"
    if st and st - su < 0.25:
        return f"swap free {(st - su) * 1024:.0f}MB < 256MB"
    cpu = readings["cpu"] = cpu_pct()
    if cpu is not None and cpu > LIMITS["cpu_pct"]:
        return f"cpu {cpu:.0f}% > {LIMITS['cpu_pct']}%"
    return None


def room(role, side, issue, alive=None, tokens=True):
    """Why a new pane of this role and side may not start now, or None when there is room. The one judgement of the
    machine's limits that pm-pane (its QUEUE answer) and pm-watchd (EVENT room) share."""
    from _pmquota import start_allowed
    why = start_allowed(issue)
    if why:
        return why
    why = machine_room()
    if why:
        return why
    if tokens:
        from _pmtokens import fmt, status as token_status
        rate, tgt, over = token_status()
        if over:
            return f"token rate {fmt(tgt, rate)} is over today's target {fmt(tgt, tgt['per_hour'])}"
    alive = [r for r in load(PANES, []) if not r.get("gone")] if alive is None else alive
    if len(alive) >= LIMITS["total"]:
        return f"{len(alive)} live panes >= {LIMITS['total']}"
    if role == "worker":
        n = sum(1 for r in alive if r.get("role") == "worker" and r.get("side") == side)
        cap = LIMITS.get(f"{side}_worker", LIMITS["engine_worker"])
        if n >= cap:
            return f"{n} {side} worker panes >= {cap}"
    return None


def wait_for_room(asker, role, side, issue, reason):
    """Remember that a pane was told QUEUE; pm-watchd sends it `EVENT room <asker> pane <role> <side>` once there is room."""
    rows = [w for w in load(WAITING, []) if not (w.get("asker") == asker and w.get("role") == role and w.get("side") == side)]
    rows.append(dict(asker=asker, role=role, side=side, issue=str(issue), reason=reason, at=now()))
    save(WAITING, rows)


# --- asking for room to run a check (issue 478, part 2) ------------------------------------------------------------
# A pm-check that calls for a heavy module asks for room before its first step: it starts when check_room finds the
# machine under its limits, however many checks already run, and is otherwise answered WAIT with an expected wait.
CHECKS = RUN / "checks"                      # <pid>.json of each heavy pm-check that runs now; .start.lock
DURATIONS = RUN / "check-durations.jsonl"    # one line per step that ran: {at, step, seconds, status}
SETTLE = 60          # seconds: a heavy run that started more recently has not shown its load yet; it is no room
UNKNOWN_STEP = 300   # seconds counted for a step with no recorded duration
STEP_FLOOR = 30      # seconds: the least a running step is counted as still needing
IDLE_WAIT = 60       # seconds of wait when no check runs (the load is the machine's other work)
RECENT = 20          # recorded durations a step's estimate is the median of


def _is_pm_check(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True).stdout
    return "pm-check" in cmd


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
    (CHECKS / f"{pid}.json").unlink(missing_ok=True)


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


def check_room(running=None, at=None, readings=None):
    """(why, wait seconds, [(checkout, step, seconds left)]) for a heavy check that asks now; why is None when there
    is room. The machine's limits (machine_room) first, then a heavy run started under SETTLE seconds ago. The wait
    is the least any running check still needs (remaining), or the rest of SETTLE, or IDLE_WAIT when none runs."""
    running = running_checks() if running is None else running
    why = machine_room(readings)
    at = time.time() if at is None else at
    est = step_estimates()
    left = [(r.get("checkout"), r.get("step"), round(remaining(r, est, at))) for r in running]
    young = [r for r in running if at - float(r.get("started") or 0) < SETTLE]
    if why is None and young:
        newest = max(float(r.get("started") or 0) for r in young)
        return (f"a check started {at - newest:.0f}s ago has not shown its load yet",
                max(1, round(SETTLE - (at - newest))), left)
    if why is None:
        return None, 0, left
    wait = min((s for _, _, s in left), default=IDLE_WAIT)
    return why, max(STEP_FLOOR, wait), left


def wait_for_check_room(asker, checkout, issue, reason, expected):
    """Remember that a pane was answered WAIT; pm-watchd sends it `EVENT room <asker> check <checkout>` once there is
    room. One row per asker and checkout; an asker answered WAIT again keeps its place and its first `at`, so the
    longest waiting is told first."""
    rows = load(WAITING, [])
    row = next((w for w in rows if w.get("asker") == asker and w.get("check") == checkout), None)
    if row is None:
        rows.append(dict(asker=asker, check=checkout, issue=str(issue), reason=reason, at=now(), expected=expected))
    else:
        row.update(reason=reason, expected=expected)
    save(WAITING, rows)
