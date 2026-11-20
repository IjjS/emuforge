"""Claude token use of this project's sessions, read from the local transcripts. Shared by pm-tokens, pm-pane, pm-watchd."""
import datetime as dt
import glob
import json
import os
import re
import time

from _pmlib import PANES, PANES_HISTORY, PMINFO, ROOT, RUN, load, save

PROJ = os.path.expanduser("~/.claude/projects")
CONFIG = RUN / "tokens.json"   # {"target": {"unit": "tok"|"usd", "per_hour": float, "day": "YYYY-MM-DD"}}
# $/MTok: input, output, cache read, cache write. Estimates for comparing runs, not a bill.
PRICE = {"claude-opus-5-5": (4, 20, 0.20, 5.0), "claude-fable-5-2": (10, 50, 0.25, 12.5), "claude-fable-5-1": (10, 50, 0.25, 12.5),
         "claude-sonnet-5-5": (2, 10, 0.20, 2.5), "claude-haiku-5-5": (1, 5, 0.10, 1.25)}


def names():
    """session id -> pane name, for the panes and the PM of this project: the registry's, and of the panes it no longer
    holds (a closed rev of an earlier review round, issue 557) the name panes-history.jsonl gives the session."""
    out = {}
    try:
        with open(PANES_HISTORY) as f:
            for ln in f:
                try:
                    r = json.loads(ln)
                except json.JSONDecodeError:
                    continue
                if isinstance(r, dict) and r.get("session") and r.get("name"):
                    out[r["session"]] = r["name"]
    except OSError:
        pass
    out.update({r.get("session"): r.get("name") for r in load(PANES, []) if r.get("session")})
    info = load(PMINFO, {})
    for s in info.get("pm_sessions") or [info.get("pm_session")]:
        if s:
            out[s] = "pm"
    return out


def usage(hours):
    """Per-session token use in the last `hours`: [{session, name, calls, inp, out, cr, cw, usd}] (cr = cache read)."""
    cutoff_ts = time.time() - hours * 3600
    cutoff = dt.datetime.fromtimestamp(cutoff_ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    known = names()
    rows = []
    for f in glob.glob(os.path.join(PROJ, f"*{ROOT.name}*", "*.jsonl")):
        if os.path.getmtime(f) < cutoff_ts:
            continue
        session = os.path.basename(f)[:-6]
        r = dict(session=session, name=known.get(session, session[:8]), calls=0, inp=0, out=0, cr=0, cw=0, usd=0.0)
        seen = set()
        for line in open(f, errors="replace"):
            if '"usage"' not in line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            if o.get("type") != "assistant" or o.get("timestamp", "") < cutoff:
                continue
            m = o.get("message") or {}
            if m.get("id") in seen:  # one API response is written once per content block
                continue
            seen.add(m.get("id"))
            u = m.get("usage") or {}
            p = PRICE.get(m.get("model"), PRICE["claude-opus-5-5"])
            inp, out, cr, cw = u.get("input_tokens", 0), u.get("output_tokens", 0), u.get("cache_read_input_tokens", 0), u.get("cache_creation_input_tokens", 0)
            r["calls"] += 1; r["inp"] += inp; r["out"] += out; r["cr"] += cr; r["cw"] += cw
            r["usd"] += (inp * p[0] + out * p[1] + cr * p[2] + cw * p[3]) / 1e6
        if r["calls"]:
            rows.append(r)
    return sorted(rows, key=lambda r: -r["usd"])


def total(rows):
    t = dict(calls=0, inp=0, out=0, cr=0, cw=0, usd=0.0)
    for r in rows:
        for k in t:
            t[k] += r[k]
    t["tok"] = t["inp"] + t["out"] + t["cw"]  # tokens processed fresh; cache reads are reported apart
    return t


def parse_target(text):
    """'3M', '2.5M/h', '800k', '$40', '$40/h' -> {'unit', 'per_hour'}."""
    m = re.fullmatch(r"(\$?)([0-9]*\.?[0-9]+)([kKmM]?)(?:/h)?", text.strip())
    if not m or (m.group(1) and m.group(3)):
        raise ValueError(f"cannot read target {text!r}: use tokens per hour (3M, 800k) or dollars per hour ($40)")
    value = float(m.group(2)) * {"": 1, "k": 1e3, "m": 1e6}[m.group(3).lower()]
    return {"unit": "usd" if m.group(1) else "tok", "per_hour": value}


def today():
    return dt.date.today().isoformat()


def target():
    """Today's target, or None. A target set on another day is ignored: the owner names it per session."""
    t = load(CONFIG, {}).get("target")
    return t if t and t.get("day") == today() else None


def set_target(t):
    cfg = load(CONFIG, {})
    if t is None:
        cfg.pop("target", None)
    else:
        cfg["target"] = {**t, "day": today()}
    save(CONFIG, cfg)


def fmt(t, value):
    return f"${value:,.2f}/h" if t["unit"] == "usd" else f"{value / 1e6:.2f}M tok/h"


def status():
    """(rate over the last hour in the target's unit, target, over?) ; (None, None, False) without a target."""
    t = target()
    if not t:
        return None, None, False
    tot = total(usage(1))
    rate = tot["usd"] if t["unit"] == "usd" else tot["tok"]
    return rate, t, rate > t["per_hour"]
