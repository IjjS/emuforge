"""Codex five-hour quota guard shared by PM commands and the event daemon."""
import datetime as dt
import json
import pathlib
import time

from _pmlib import RUN, PMINFO, PANES, load, save, herdr, log

CONFIG = RUN / "codex-quota.json"
SESSIONS = pathlib.Path.home() / ".codex" / "sessions"


def five_hour(limits):
    if not isinstance(limits, dict):
        return None
    if limits.get("limit_id", "codex") != "codex":
        return None
    for key in ("primary", "secondary"):
        window = limits.get(key) or {}
        if window.get("window_minutes") == 300:
            used = window.get("used_percent")
            reset = window.get("resets_at")
            if isinstance(used, (int, float)) and 0 <= used <= 100 and isinstance(reset, (int, float)):
                return {"used_percent": used, "remaining_percent": 100 - used, "resets_at": reset}
    return None


def observation(agents_now=None):
    info = load(PMINFO, {})
    registry = load(PANES, [])
    sessions = {info.get("pm_session")}
    sessions.update(r.get("session") for r in registry if r.get("kind") == "codex")
    sessions.update((a.get("agent_session") or {}).get("value") for a in (agents_now or [])
                    if a.get("agent") == "codex" and a.get("pane_id") in
                    {info.get("pm_pane"), *(r.get("pane_id") for r in registry)})
    paths = {path for session in sessions - {None} for path in SESSIONS.glob(f"*/*/*/*{session}.jsonl")}
    # Herdr can report a live Codex pane before exposing its session id. Match
    # only recent rollouts whose session metadata names one of our pane cwds.
    unknown = [r for r in registry if r.get("kind") == "codex" and not r.get("gone") and not r.get("session")]
    if unknown:
        cwds = {str(pathlib.Path(r["cwd"]).resolve()) for r in unknown}
        for day in (dt.datetime.now(dt.timezone.utc), dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)):
            directory = SESSIONS / day.strftime("%Y/%m/%d")
            for path in directory.glob("*.jsonl"):
                try:
                    if path.stat().st_mtime < time.time() - 600:
                        continue
                    with path.open() as stream:
                        meta = json.loads(stream.readline())
                    if meta.get("type") == "session_meta" and str(pathlib.Path(meta.get("payload", {}).get("cwd", "/")).resolve()) in cwds:
                        paths.add(path)
                except (OSError, ValueError, TypeError):
                    continue
    latest = None
    for path in paths:
            try:
                with path.open("rb") as stream:
                    stream.seek(max(0, path.stat().st_size - 2_000_000))
                    lines = stream.read().decode(errors="replace").splitlines()
                for line in reversed(lines):
                    if '"rate_limits"' not in line:
                        continue
                    try:
                        item = json.loads(line)
                        value = five_hour(item.get("payload", {}).get("rate_limits"))
                        stamp = dt.datetime.fromisoformat(item["timestamp"].replace("Z", "+00:00")).timestamp()
                    except (ValueError, KeyError, TypeError):
                        continue
                    if value:
                        if latest is None or stamp > latest["observed_at"]:
                            latest = {**value, "observed_at": stamp}
                        break
            except OSError:
                continue
    return latest


def fresh(sample):
    return bool(sample and time.time() - sample["observed_at"] < 300 and sample["resets_at"] > time.time())


def start_allowed(issue):
    config = load(CONFIG, {})
    policy = config.get("issues", {}).get(str(issue))
    if not policy:
        return None
    if policy.get("paused"):
        return "Codex quota pause latched; user signal is required before pm-quota resume"
    sample = observation()
    if not fresh(sample):
        return "fresh Codex 300-minute quota observation unavailable; do not start unmonitored work"
    if sample["used_percent"] >= policy.get("stop_used_percent", 90):
        return f"Codex five-hour remaining {sample['remaining_percent']}%; quota threshold reached"
    return None


def tick(agents_now):
    config = load(CONFIG, {})
    if not config.get("issues"):
        return []
    sample = observation(agents_now)
    events = []
    changed = False
    registry = load(PANES, [])
    for issue, policy in config["issues"].items():
        targets = [r for r in registry if r.get("issue") == issue and not r.get("gone")]
        if not policy.get("paused"):
            reason = None
            if fresh(sample) and sample["used_percent"] >= policy.get("stop_used_percent", 90):
                reason = f"five-hour remaining={sample['remaining_percent']}%"
            elif not fresh(sample) and any(a.get("agent_status") == "working" and a.get("pane_id") in
                                           {r["pane_id"] for r in targets if r.get("kind") == "codex"}
                                           for a in agents_now):
                reason = "fresh five-hour quota observation unavailable"
            if reason:
                policy.update(paused=True, reason=reason, paused_at=time.time(), checkpoint_sent=[])
                events.append(f"EVENT quota {issue} PAUSED {reason}; save PM state and stop until user signal")
                changed = True
                # Persist the latch before interrupting agents; new pane creation must already be blocked.
                save(CONFIG, config)
        if policy.get("paused"):
            sent = policy.setdefault("checkpoint_sent", [])
            for row in targets:
                if row["name"] in sent:
                    continue
                agent = next((a for a in agents_now if a.get("pane_id") == row["pane_id"]), None)
                if not agent or agent.get("agent_status") == "blocked":
                    continue
                if agent.get("agent_status") == "working":
                    herdr("agent", "send-keys", row["pane_id"], "esc", check=False)
                state = "output/state.md" if row["role"] == "build" else f".pm/issue-{issue}/state-{row['role']}.md"
                result = herdr("agent", "prompt", row["pane_id"],
                               f"QUOTA PAUSE: {policy.get('reason')}. Stop implementation, tests and review now. "
                               f"Only save a short resume note to {state} with completed work, next step and paths. "
                               f"Do not commit, push, open PRs or contact other panes. Print BLOCKED {row['name']} quota and stop. "
                               "Resume only after an explicit PM prompt following the user's signal.", check=False)
                if result is not None:
                    sent.append(row["name"])
                    log(f"quota checkpoint requested {row['name']}")
                    changed = True
    if sample:
        config["last_observation"] = sample
        changed = True
    if changed:
        save(CONFIG, config)
    return events
