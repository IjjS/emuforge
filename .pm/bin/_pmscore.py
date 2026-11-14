"""Scoring for pm-structure: snapshots, matching, order items, extras, the pass line, reports and records. Not a
command.

  snap = load_snapshot(path)               the accessibility snapshot of design 2.2, or SnapshotError
  result = score(spec, snap, state)        requirement 5.2 to 5.6; SpecError("... nothing to score")
  render_text(result[, result_path])       the standard output of requirement 3
  result_json(result, extra)               the result file's content
  record_row(result, ...), table(rows)     the rows of structure-scores.json and the --table text

Names are compared trimmed and case-folded (`norm`); the snapshot keeps the browser's own roles and names, and
the report prints them as found.
"""
import dataclasses
import json
import os
import re
import stat

from _pmspec import SpecError, norm

FORMAT = "pm-structure-snapshot/1"
MAX_SNAPSHOT = 64 * 1024 * 1024
EXTRA_ROLES = ("button", "columnheader", "tab", "LabelText", "term")
COUNTER = r" \(([0-9]+\+?|[0-9]+/[0-9]+)\)"


class SnapshotError(Exception):
    pass


@dataclasses.dataclass
class Node:
    index: int
    role: str
    name: str
    parent: object
    in_breadcrumbs: bool = False   # inside a navigation whose name contains "breadcrumb"
    in_table: bool = False         # inside a table or grid
    in_main: bool = False
    in_navigation: bool = False


@dataclasses.dataclass
class Snapshot:
    path: str
    url: str
    viewport: dict
    browser: str
    blocked: list
    nodes: list


def load_snapshot(path):
    """Read a snapshot file pm-structure wrote; SnapshotError `cannot read snapshot <path>: <why>` otherwise."""
    def bad(why):
        raise SnapshotError(f"cannot read snapshot {path}: {why}")

    try:
        st = os.stat(path)
        if not stat.S_ISREG(st.st_mode):
            bad("not a regular file")
        if st.st_size > MAX_SNAPSHOT:
            bad(f"larger than {MAX_SNAPSHOT} bytes")
        with open(path, "rb") as f:
            data = f.read(MAX_SNAPSHOT + 1)
    except OSError as e:
        bad(e.strerror or str(e))
    if len(data) > MAX_SNAPSHOT:
        bad(f"larger than {MAX_SNAPSHOT} bytes")
    try:
        d = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        bad("not JSON")
    if not isinstance(d, dict) or d.get("format") != FORMAT:
        bad(f"format is not {FORMAT}")
    if not isinstance(d.get("url"), str) or not isinstance(d.get("browser"), str):
        bad("url or browser missing")
    vp = d.get("viewport")
    if not isinstance(vp, dict) or not all(isinstance(vp.get(k), int) for k in ("width", "height")):
        bad("viewport missing")
    blocked = d.get("blocked")
    if not isinstance(blocked, list) or not all(isinstance(b, str) for b in blocked):
        bad("blocked is not a list of URLs")
    raw = d.get("nodes")
    if not isinstance(raw, list):
        bad("nodes is not a list")
    nodes = []
    for i, n in enumerate(raw):
        if not isinstance(n, dict) or not isinstance(n.get("role"), str) or not isinstance(n.get("name"), str):
            bad(f"node {i} has no role or name")
        p = n.get("parent")
        if p is None:
            node = Node(i, n["role"], n["name"], None)
        elif isinstance(p, int) and not isinstance(p, bool) and 0 <= p < i:
            up = nodes[p]
            node = Node(i, n["role"], n["name"], p,
                        in_breadcrumbs=up.in_breadcrumbs or (up.role == "navigation" and "breadcrumb" in norm(up.name)),
                        in_table=up.in_table or up.role in ("table", "grid"),
                        in_main=up.in_main or up.role == "main",
                        in_navigation=up.in_navigation or up.role == "navigation")
        else:
            bad(f"node {i} has a parent that is not an earlier node")
        nodes.append(node)
    return Snapshot(path=path, url=d["url"], viewport={"width": vp["width"], "height": vp["height"]},
                    browser=d["browser"], blocked=list(blocked), nodes=nodes)


# ---------------------------------------------------------------------------------------------------- matching

def _named(roles, name):
    want = norm(name)
    return lambda n: n.role in roles and norm(n.name) == want


def _title(item):
    want = norm(item.name)
    counted = re.compile(re.escape(want) + COUNTER)

    def pred(n):
        if n.role != "heading":
            return False
        got = norm(n.name)
        return got == want or bool(item.counter and counted.fullmatch(got))
    return pred


def _predicate(item):
    """The node predicate of an item kind (requirement 5.2), or None for kinds decided otherwise."""
    k = item.kind
    if k == "breadcrumb":
        named = _named(("link", "StaticText"), item.name)
        return lambda n: n.in_breadcrumbs and named(n)
    if k == "title":
        return _title(item)
    if k == "action":
        return _named(("button", "link"), item.name)
    if k == "column":
        return _named(("columnheader",), item.name)
    if k == "selection":
        role = {"single": "radio", "multi": "checkbox"}.get(item.name)
        return (lambda n: n.in_table and n.role == role) if role else None
    if k == "filter":
        roles = ("searchbox", "textbox") if item.name == "text" else ("combobox",)
        return lambda n: n.role in roles
    if k == "empty_title":
        named = _named(("heading", "StaticText"), item.name)
        return lambda n: n.in_table and named(n)
    if k == "empty_action":
        return _named(("button", "link"), item.name)
    if k == "tab":
        return _named(("tab",), item.name)
    if k == "section_title":
        return _named(("heading",), item.name)
    if k == "field":
        return _named(("LabelText", "term"), item.name)
    return None


def _claims(item):
    """(role, normalized name) pairs an item of any status carries, for the extras rule (requirement 5.6)."""
    roles = {"breadcrumb": ("link", "StaticText"), "title": ("heading",), "action": ("button", "link"),
             "column": ("columnheader",), "empty_title": ("heading", "StaticText"), "empty_action": ("button", "link"),
             "tab": ("tab",), "section_title": ("heading",), "field": ("LabelText", "term")}.get(item.kind)
    if roles:
        return {(r, norm(item.name)) for r in roles}
    if item.kind == "pagination":
        return {("button", "next page"), ("button", "previous page")}
    return set()


def _expected(item, spec):
    """The detail of an unmatched item: its expected roles joined by | and its expected name."""
    k = item.kind
    q = lambda s: json.dumps(s, ensure_ascii=False)
    if k == "order":
        return "out of order"
    if k == "counter":
        title = next((i.name for i in spec.items if i.id == "header.title"), "")
        return f"heading {q(title + ' (<n>)')}"
    if k == "selection":
        return {"single": "radio in table|grid", "multi": "checkbox in table|grid"}.get(
            item.name, "no radio|checkbox in table|grid")
    if k == "filter":
        return "searchbox|textbox" if item.name == "text" else "combobox"
    if k == "pagination":
        return 'button "Next page" + button "Previous page"'
    roles = {"breadcrumb": "link|StaticText", "title": "heading", "action": "button|link", "column": "columnheader",
             "empty_title": "heading|StaticText", "empty_action": "button|link", "tab": "tab",
             "section_title": "heading", "field": "LabelText|term"}[k]
    return f"{roles} {q(item.name)}"


def _node_text(n):
    return f"{n.role} {json.dumps(n.name, ensure_ascii=False)}"


@dataclasses.dataclass
class ItemResult:
    item: object
    status: str                # matched | unmatched | omitted | not-applicable
    node: object = None        # the Node shown for a matched item
    detail: str = ""
    reason: str = ""           # omitted: the spec's reason


@dataclasses.dataclass
class Result:
    spec: object
    snapshot: object
    state: str
    items: list
    matched: int
    total: int
    verdict: str
    reasons: list
    critical_unmatched: list
    extras: list               # (role, name) as found

    @property
    def score(self):
        return (self.matched * 1000 // self.total) / 10

    @property
    def requires(self):
        return list(self.spec.needs_states)


def score(spec, snap, state):
    """Score `snap` against `spec` in `state` (requirement 5.2 to 5.6)."""
    nodes = snap.nodes
    cands = {}
    for item in spec.items:
        pred = _predicate(item)
        cands[item.id] = [n.index for n in nodes if pred(n)] if pred else []
    first = {i: (c[0] if c else None) for i, c in cands.items()}
    by_id = {i.id: i for i in spec.items}
    omitted = {}
    for e in spec.omitted:
        for i in e.items:
            omitted.setdefault(i, e.reason)
    scored = {i.id for i in spec.items if i.id not in omitted and state in i.states}

    def found(item):
        """(matched, index of the node shown or None) of one item, whatever its status."""
        k = item.kind
        if k == "counter":
            t = by_id.get("header.title")
            n = first.get("header.title")
            ok = n is not None and re.fullmatch(re.escape(norm(t.name)) + COUNTER, norm(nodes[n].name)) is not None
            return ok, (n if ok else None)
        if k == "empty_action":
            t = first.get("table.empty.title")
            later = [c for c in cands[item.id] if t is not None and c > t]
            return bool(later), (later[0] if later else None)
        if k == "selection" and item.name == "none":
            hit = any(n.in_table and n.role in ("radio", "checkbox") for n in nodes)
            return not hit, None
        if k == "pagination":
            nxt = [n.index for n in nodes if n.role == "button" and norm(n.name) == "next page"]
            prev = [n.index for n in nodes if n.role == "button" and norm(n.name) == "previous page"]
            ok = bool(nxt and prev)
            return ok, (min(nxt[0], prev[0]) if ok else None)
        if k == "order":
            at = -1
            live = [e for e in item.entries if e in scored and cands[e]]
            for e in live:
                nxt = next((c for c in cands[e] if c > at), None)
                if nxt is None:
                    return False, None
                at = nxt
            return True, None
        return first[item.id] is not None, first[item.id]

    results = []
    for item in spec.items:
        if item.id in omitted:
            results.append(ItemResult(item, "omitted", reason=omitted[item.id]))
            continue
        if state not in item.states:
            results.append(ItemResult(item, "not-applicable"))
            continue
        ok, idx = found(item)
        node = nodes[idx] if idx is not None else None
        if ok:
            detail = "in order" if item.kind == "order" else _node_text(node) if node else "none"
            results.append(ItemResult(item, "matched", node, detail))
        else:
            results.append(ItemResult(item, "unmatched", None, _expected(item, spec)))
    total = sum(1 for r in results if r.status in ("matched", "unmatched"))
    if total == 0:
        raise SpecError(f"spec {spec.path}: nothing to score", spec.screen)
    matched = sum(1 for r in results if r.status == "matched")
    critical = [r.item.id for r in results if r.status == "unmatched" and r.item.critical]
    reasons = []
    if critical:
        reasons.append("critical item unmatched: " + ", ".join(critical))
    if matched * 100 < 90 * total:
        reasons.append("score below 90")
    claimed = set().union(*(_claims(i) for i in spec.items)) if spec.items else set()
    has_main = any(n.role == "main" for n in nodes)
    extras, seen = [], set()
    for n in nodes:
        name = n.name.strip()
        key = (n.role, norm(n.name))
        if (n.role in EXTRA_ROLES and name and not re.fullmatch(r"[0-9]+", name) and (n.in_main or not has_main)
                and not n.in_navigation and key not in claimed and key not in seen):
            seen.add(key)
            extras.append((n.role, n.name))
    return Result(spec=spec, snapshot=snap, state=state, items=results, matched=matched, total=total,
                  verdict="fail" if reasons else "pass", reasons=reasons, critical_unmatched=critical,
                  extras=extras)


# ---------------------------------------------------------------------------------------------------- output

def _scalar(v):
    return ("true" if v else "false") if isinstance(v, bool) else str(v)


def score_text(result):
    return f"{result.score:.1f}"


def render_text(result, result_path=None):
    """The standard output of a scored run (requirement 3); the `result:` line when `result_path` is given."""
    spec = result.spec
    out = [f"structure {spec.screen} state={result.state} score={score_text(result)} "
           f"({result.matched}/{result.total}) verdict={result.verdict}"]
    others = [s for s in spec.needs_states if s != result.state]
    if len(spec.needs_states) > 1 and others:
        out.append("requires also: " + " ".join(f"state={s}" for s in others))
    out += [f"reason: {r}" for r in result.reasons]

    def group(title, rows):
        out.append(f"{title} ({len(rows)})")
        out.extend(f"  {r}" for r in rows)

    by = lambda status: [r for r in result.items if r.status == status]
    group("unmatched", [f"{r.item.id}    {r.detail}" for r in by("unmatched")])
    group("matched", [f"{r.item.id}    {r.detail}" for r in by("matched")])
    group("omitted", [f"{r.item.id}    {r.reason}" for r in by("omitted")])
    group("not applicable", [f"{r.item.id}    state={result.state}" for r in by("not-applicable")])
    group("not scored", [f"{p}    {k}: {_scalar(v)}" for p, k, v in spec.not_scored])
    group("extra", [f"{role} {json.dumps(name, ensure_ascii=False)}" for role, name in result.extras])
    group("blocked requests", list(result.snapshot.blocked))
    if result_path is not None:
        out.append(f"result: {result_path}")
    return "\n".join(out) + "\n"


def result_json(result, extra):
    """The result file's content (design 2.5): the report's content plus `extra` (spec, commit, dirty, at, ...)."""
    snap = result.snapshot
    items = []
    for r in result.items:
        d = {"id": r.item.id, "status": r.status, "critical": r.item.critical, "detail": r.detail}
        if r.status == "omitted":
            d["reason"] = r.reason
        if r.status == "not-applicable":
            d["state"] = result.state
        d["node"] = None if r.node is None else {"index": r.node.index, "role": r.node.role, "name": r.node.name}
        items.append(d)
    body = {"screen": result.spec.screen, "state": result.state, "verdict": result.verdict, "score": result.score,
            "matched": result.matched, "total": result.total, "reasons": result.reasons,
            "critical_unmatched": result.critical_unmatched, "requires": result.requires, "items": items,
            "not_scored": [{"path": p, "key": k, "value": v} for p, k, v in result.spec.not_scored],
            "extras": [{"role": role, "name": name} for role, name in result.extras],
            "blocked": list(snap.blocked), "url": snap.url, "viewport": snap.viewport, "browser": snap.browser,
            "spec": os.path.abspath(result.spec.path), "spec_sha256": result.spec.sha256}
    body.update(extra)
    return body


def dumps(obj):
    """Keys sorted, lists in their order: equal inputs give equal bytes (requirement 5.7)."""
    return json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


# ---------------------------------------------------------------------------------------------------- records

def _cell(v):
    return str(v).replace("|", "\\|").replace("\n", " ")


def table(rows):
    """The --table text: one markdown row per recorded run, then one line per point and screen (requirement 5.3)."""
    out = ["| point | screen | state | score | verdict | critical unmatched | commit |", "|---|---|---|---|---|---|---|"]
    groups = {}
    for r in rows:
        score = "-" if r.get("score") is None else f"{float(r['score']):.1f}"
        commit = (r.get("commit") or "-")[:12] + (" (dirty)" if r.get("dirty") else "")
        crit = ", ".join(r.get("critical_unmatched") or []) or "-"
        out.append("| " + " | ".join(_cell(c) for c in (r.get("point"), r.get("screen"), r.get("state"), score,
                                                        r.get("verdict"), crit, commit)) + " |")
        groups.setdefault((r.get("point"), r.get("screen")), []).append(r)
    out.append("")
    if not groups:
        out.append("no structure scores recorded")
    for (point, screen), rs in groups.items():
        requires = list(rs[-1].get("requires") or [])
        states = [s for s in ("seeded", "empty") if s in set(requires) | {"seeded"}]
        states += [s for s in requires if s not in states]
        latest = {}
        for r in rs:
            latest[r.get("state")] = r
        why = []
        for s in states:
            r = latest.get(s)
            if r is None:
                why.append(f"missing state={s}")
            elif r.get("verdict") != "pass":
                why.append(f"state={s} {r.get('verdict')}")
        out.append(f"point {point} {screen}: " + (f"not passed ({', '.join(why)})" if why else "passed"))
    return "\n".join(out) + "\n"
