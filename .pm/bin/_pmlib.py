"""Shared helpers for the .pm/bin scripts. Not a command."""
import datetime as dt
import json
import os
import pathlib
import subprocess
import sys

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
LIMITS = {"studio_worker": 2, "engine_worker": 3, "total": 16, "mem_gb": 22.5}
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
    vm = subprocess.run(["vm_stat"], capture_output=True, text=True).stdout
    vals = {}
    for line in vm.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            vals[k.strip()] = int(v.strip().rstrip(".") or 0) if v.strip().rstrip(".").isdigit() else 0
    pages = vals.get("Pages active", 0) + vals.get("Pages wired down", 0) + vals.get("Pages occupied by compressor", 0)
    used = pages * 16384 / 1073741824
    sw = subprocess.run(["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True).stdout
    import re
    m = re.search(r"total = ([0-9.]+)M\s+used = ([0-9.]+)M", sw)
    st, su = (float(m.group(1)) / 1024, float(m.group(2)) / 1024) if m else (0.0, 0.0)
    return used, su, st


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
