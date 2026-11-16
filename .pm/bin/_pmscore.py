"""Scoring for pm-structure: snapshots, matching, order items, extras, the pass line, reports and records. Not a
command.

  snap = load_snapshot(path[, look])       the accessibility snapshot of design 2.2 (a Snapshot), or a wizard's
                                           steps snapshot (Steps, issue 8 D2.2); SnapshotError otherwise
  result = score(spec, snap, state[, look])
                                           requirement 5.2 to 5.6, and whether an omitted item is shown (issue 46,
                                           R3); SpecError("... nothing to score");
                                           SnapshotError when the snapshot does not fit the spec's kind
  render_text(result[, result_path])       the standard output of requirement 3
  result_json(result, extra)               the result file's content
  table(rows)                              the --table text of structure-scores.json rows

Names are compared trimmed and case-folded (`norm`); the snapshot keeps the browser's own roles and names, and
the report prints them as found.

`look` (issue 31, design D2) is None or a function of no argument that `load_snapshot` and `score` call while they
work: once after the file is read, once after it is decoded, at least once per EVERY JSON objects parsed, before
each spec item and at least once per EVERY nodes of every walk over a tree's nodes. What it returns is ignored;
what it raises leaves the function as it is, with no later call of `look` and no value returned. It must raise
nothing or an exception that is not an `Exception` (pm-structure passes `_pmproc.check`, which raises its
`Terminated`): `load_snapshot` takes a `ValueError` or `OSError` of its own work for the file's fault. With `look`
None nothing is called. This module knows nothing of signals or processes; it only calls what it is given.
"""
import dataclasses
import json
import os
import re
import stat

from _pmspec import SpecError, norm

FORMAT = "pm-structure-snapshot/1"
FORMAT_STEPS = "pm-structure-steps/1"
MAX_SNAPSHOT = 64 * 1024 * 1024
EXTRA_ROLES = ("button", "columnheader", "tab", "LabelText", "term")
COUNTER = r" \(([0-9]+\+?|[0-9]+/[0-9]+)\)"
EVERY = 1024                   # nodes or JSON objects between two looks at most (issue 31, requirement R3)


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
    text: str = ""                 # a LabelText with an empty name: the joined names of its StaticText descendants


@dataclasses.dataclass
class Snapshot:
    path: str
    url: str
    viewport: dict
    browser: str
    blocked: list
    nodes: list


@dataclasses.dataclass
class Steps:
    """A wizard's steps snapshot: one Snapshot per shown step, in step order (issue 8, requirement 4)."""
    path: str
    steps: list


def _look(look):
    if look is not None:
        look()


def _walk(nodes, look, start=0):
    """`nodes[start:]`, with a look before the first node and before every EVERY-th after it; `nodes` itself when
    `look` is None and `start` is 0. The list is not copied, only one stretch of EVERY nodes at a time."""
    if look is None and start == 0:
        return nodes
    return _walking(nodes, look, start)


def _walking(nodes, look, start):
    for i in range(start, len(nodes), EVERY):
        if look is not None:
            look()
        yield from nodes[i:i + EVERY]


def _counting_hook(look):
    """A json `object_hook` that returns each object unchanged and looks at every EVERY-th one built."""
    built = 0

    def hook(obj):
        nonlocal built
        built += 1
        if not built % EVERY:
            look()
        return obj
    return hook


def load_snapshot(path, look=None):
    """Read a snapshot file pm-structure wrote, of either format; SnapshotError `cannot read snapshot <path>:
    <why>` otherwise, `<why>` starting with `step <k>: ` for an entry of a steps file. `look` as in the module
    docstring."""
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
    _look(look)  # after the read
    try:
        text = data.decode("utf-8")
        _look(look)  # after the decode
        d = json.loads(text) if look is None else json.loads(text, object_hook=_counting_hook(look))
    except (UnicodeDecodeError, ValueError):
        bad("not JSON")
    del text  # as before, the text is not held while the nodes are parsed
    if isinstance(d, dict) and d.get("format") == FORMAT_STEPS:
        if "steps" not in d:
            bad("steps is missing")
        if not isinstance(d["steps"], list):
            bad("steps is not a list")
        if not d["steps"]:
            bad("steps is empty")

        def entry_bad(k):
            return lambda why: bad(f"step {k}: {why}")
        return Steps(path=path, steps=[_parse(path, e, entry_bad(k), look) for k, e in enumerate(d["steps"], 1)])
    return _parse(path, d, bad, look)


def _parse(path, d, bad, look=None):
    """The Snapshot of one pm-structure-snapshot/1 object `d`; `bad(why)` raises."""
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
    for i, n in enumerate(_walk(raw, look)):
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
    _label_texts(nodes, look)
    return Snapshot(path=path, url=d["url"], viewport={"width": vp["width"], "height": vp["height"]},
                    browser=d["browser"], blocked=list(blocked), nodes=nodes)


def _label_texts(nodes, look=None):
    """Requirement 5.2 as corrected (decisions.md, "Requirement correction R5.2"): Chromium gives a form label an
    empty-name LabelText whose text sits in its StaticText children. For each such node, `text` is the names of
    its StaticText descendants joined in document order. Descendants follow their ancestor without a gap (the
    nodes are a pre-order walk), so the scan stops at the first node outside the subtree."""
    for node in _walk(nodes, look):
        if node.role != "LabelText" or node.name.strip():
            continue
        inside, parts = {node.index}, []
        for n in _walking(nodes, look, node.index + 1):
            if n.parent not in inside:
                break
            inside.add(n.index)
            if n.role == "StaticText":
                parts.append(n.name)
        node.text = "".join(parts)


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
    if k in ("section_title", "step_title"):
        return _named(("heading",), item.name)
    if k == "submit":
        return _named(("button",), item.name)
    if k == "field":
        want = norm(item.name)
        return lambda n: (n.role in ("LabelText", "term") and norm(n.name) == want) or (
            n.role == "LabelText" and not n.name.strip() and norm(n.text) == want)
    return None


def _claims(item):
    """(role, normalized name) pairs an item of any status carries, for the extras rule (requirement 5.6)."""
    roles = {"breadcrumb": ("link", "StaticText"), "title": ("heading",), "action": ("button", "link"),
             "column": ("columnheader",), "empty_title": ("heading", "StaticText"), "empty_action": ("button", "link"),
             "tab": ("tab",), "section_title": ("heading",), "field": ("LabelText", "term"),
             "step_title": ("heading",), "submit": ("button",)}.get(item.kind)
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
             "section_title": "heading", "field": "LabelText|term", "step_title": "heading", "submit": "button"}[k]
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
    step: object = None        # kind wizard: the shown step the item is scored on (a shown omitted item: the step
                               # its node is on); None for the other kinds
    shown: bool = False        # omitted: the screen shows the item (issue 46, R3); `node` is then the node found


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
    extras: list               # (role, name, step) as found; step is the first step found on, None but for a wizard
    omitted_shown: list = dataclasses.field(default_factory=list)   # ids of the shown omitted items, spec order

    @property
    def omitted(self):
        """The number of items with status omitted in this run (issue 46, R4.1)."""
        return sum(1 for r in self.items if r.status == "omitted")

    @property
    def spec_items(self):
        return len(self.spec.items)

    @property
    def score(self):
        return (self.matched * 1000 // self.total) / 10

    @property
    def requires(self):
        return list(self.spec.needs_states)


def _fit(spec, snap):
    """The trees of `snap` in step order (one for a kind other than wizard); SnapshotError when the snapshot does
    not fit the spec (issue 8, design 2.2)."""
    def bad(why):
        raise SnapshotError(f"cannot read snapshot {snap.path}: {why}")

    wizard = spec.kind == "wizard"
    if isinstance(snap, Steps):
        if not wizard:
            bad(f"a steps snapshot for a spec of kind {spec.kind}")
        if len(snap.steps) != len(spec.steps):
            bad(f"it holds {len(snap.steps)} steps, the spec shows {len(spec.steps)}")
        return list(snap.steps)
    if wizard:
        bad("a wizard needs a steps snapshot")
    return [snap]


def _nav_entry(title):
    """A step navigation entry of a wizard (requirement 5.2): a button or link in a navigation that is not the
    breadcrumbs, named the title or `<anything>: <title>`."""
    want = norm(title)
    return lambda n: (n.role in ("button", "link") and n.in_navigation and not n.in_breadcrumbs
                      and (norm(n.name) == want or norm(n.name).endswith(": " + want)))


def score(spec, snap, state, look=None):
    """Score `snap` against `spec` in `state` (requirement 5.2 to 5.6; for a wizard issue 8, requirement 5). Each
    item is matched on the tree of its own step only; a spec of another kind has one tree. `look` as in the module
    docstring."""
    trees = _fit(spec, snap)
    wizard = spec.kind == "wizard"

    def tree(item):
        """The nodes an item is matched on; an omitted step's items (step None) have none."""
        if not wizard:
            return trees[0].nodes
        return trees[item.step - 1].nodes if item.step is not None else []

    cands = {}
    for item in spec.items:
        _look(look)
        pred = _predicate(item)
        cands[item.id] = [n.index for n in _walk(tree(item), look) if pred(n)] if pred else []
    first = {i: (c[0] if c else None) for i, c in cands.items()}
    by_id = {i.id: i for i in spec.items}
    omitted = {}
    for e in spec.omitted:
        for i in e.items:
            omitted.setdefault(i, e.reason)
    scored = {i.id for i in spec.items if i.id not in omitted and state in i.states}

    def found(item):
        """(matched, index of the node shown or None, detail of an unmatched item or None) of one item, whatever
        its status; a None detail is the item's expected role and name."""
        k = item.kind
        nodes = tree(item)
        if k == "counter":
            t = by_id.get("header.title")
            n = first.get("header.title")
            ok = n is not None and re.fullmatch(re.escape(norm(t.name)) + COUNTER, norm(nodes[n].name)) is not None
            return ok, (n if ok else None), None
        if k == "empty_action":
            t = first.get("table.empty.title")
            later = [c for c in cands[item.id] if t is not None and c > t]
            return bool(later), (later[0] if later else None), None
        if k == "selection" and item.name == "none":
            hit = any(n.in_table and n.role in ("radio", "checkbox") for n in _walk(nodes, look))
            return not hit, None, None
        if k == "pagination":
            nxt = [n.index for n in _walk(nodes, look) if n.role == "button" and norm(n.name) == "next page"]
            prev = [n.index for n in _walk(nodes, look) if n.role == "button" and norm(n.name) == "previous page"]
            ok = bool(nxt and prev)
            return ok, (min(nxt[0], prev[0]) if ok else None), None
        if k == "order":
            at = -1
            live = [e for e in item.entries if e in scored and cands[e]]
            for e in live:
                nxt = next((c for c in cands[e] if c > at), None)
                if nxt is None:
                    return False, None, None
                at = nxt
            return True, None, None
        if k == "steps_order":
            # unlike the other lists a missing entry makes the item unmatched: the entries are not items. Every
            # shown step's entry is looked up first; the order is judged only when all are found (requirement 5.2)
            entries = []
            for e, title in zip(item.entries, item.names):
                if e in omitted:
                    continue
                pred = _nav_entry(title)
                hits = [n.index for n in _walk(nodes, look) if pred(n)]
                if not hits:
                    return False, None, f"no navigation entry for {json.dumps(title, ensure_ascii=False)}"
                entries.append(hits)
            at = -1
            for hits in entries:
                nxt = next((c for c in hits if c > at), None)
                if nxt is None:
                    return False, None, "out of order"
                at = nxt
            return True, None, None
        return first[item.id] is not None, first[item.id], None

    # issue 46, R3: an omitted item is shown when the rule that would match it finds it, passing over a node that an
    # item that is not omitted claims, whatever that item's states
    kept = set().union(*(_claims(i) for i in spec.items if i.id not in omitted))

    def key(n):
        if n.role == "LabelText" and not n.name.strip():
            return n.role, norm(n.text)
        return n.role, norm(n.name)

    def shown(item):
        """(node, step) of an omitted item the screen shows, or None (R3.1 to R3.3)."""
        k = item.kind
        if state not in item.states or k in ("order", "steps_order") or (k == "selection" and item.name == "none"):
            return None
        if wizard and item.step is None:  # an item of an omitted step: only its title is looked for
            if k != "step_title":
                return None
            pred = _nav_entry(item.name)
            for n in _walk(trees[0].nodes, look):
                if pred(n) and key(n) not in kept:
                    return n, 1
            pred = _named(("heading",), item.name)
            for s, t in enumerate(trees, 1):
                for n in _walk(t.nodes, look):
                    if pred(n) and key(n) not in kept:
                        return n, s
            return None
        step = item.step if wizard else None
        if k in ("counter", "pagination"):
            ok, idx, _ = found(item)
            return (tree(item)[idx], step) if ok else None
        nodes = tree(item)
        for idx in cands[item.id]:
            if key(nodes[idx]) not in kept:
                return nodes[idx], step
        return None

    results, omitted_shown = [], []
    for item in spec.items:
        _look(look)
        step = item.step if wizard else None
        if item.id in omitted:
            hit = shown(item)
            if hit is None:
                results.append(ItemResult(item, "omitted", reason=omitted[item.id], step=step))
            else:
                omitted_shown.append(item.id)
                results.append(ItemResult(item, "omitted", hit[0], reason=omitted[item.id], step=hit[1], shown=True))
            continue
        if state not in item.states:
            results.append(ItemResult(item, "not-applicable", step=step))
            continue
        ok, idx, why = found(item)
        node = tree(item)[idx] if idx is not None else None
        if ok:
            detail = "in order" if item.kind in ("order", "steps_order") else _node_text(node) if node else "none"
            results.append(ItemResult(item, "matched", node, detail, step=step))
        else:
            results.append(ItemResult(item, "unmatched", None, why or _expected(item, spec), step=step))
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
    if omitted_shown:
        reasons.append("omitted item shown: " + ", ".join(omitted_shown))
    # what an item claims is taken over the whole spec and excludes a node on every step's tree (requirement 5.6,
    # issue 8 R5.4); an extra found on several steps is listed once, at the first
    claimed = set().union(*(_claims(i) for i in spec.items)) if spec.items else set()
    extras, seen = [], set()
    for k, t in enumerate(trees, 1):
        has_main = any(n.role == "main" for n in _walk(t.nodes, look))
        for n in _walk(t.nodes, look):
            name = n.name.strip()
            key = (n.role, norm(n.name))
            if (n.role in EXTRA_ROLES and name and not re.fullmatch(r"[0-9]+", name) and (n.in_main or not has_main)
                    and not n.in_navigation and key not in claimed and key not in seen):
                seen.add(key)
                extras.append((n.role, n.name, k if wizard else None))
    return Result(spec=spec, snapshot=snap, state=state, items=results, matched=matched, total=total,
                  verdict="fail" if reasons else "pass", reasons=reasons, critical_unmatched=critical,
                  extras=extras, omitted_shown=omitted_shown)


# ---------------------------------------------------------------------------------------------------- output

def _scalar(v):
    return ("true" if v else "false") if isinstance(v, bool) else str(v)


def score_text(result):
    return f"{result.score:.1f}"


def _trees(result):
    snap = result.snapshot
    return list(snap.steps) if isinstance(snap, Steps) else [snap]


def _blocked(result):
    """The blocked URLs: a page's own list; for a wizard every step's, each once, sorted (issue 8, R5.5)."""
    if isinstance(result.snapshot, Steps):
        return sorted({b for t in result.snapshot.steps for b in t.blocked})
    return list(result.snapshot.blocked)


def _at(step):
    return "" if step is None else f"step {step}: "


def render_text(result, result_path=None):
    """The standard output of a scored run (requirement 3); the `result:` line when `result_path` is given."""
    spec = result.spec
    out = [f"structure {spec.screen} state={result.state} score={score_text(result)} "
           f"({result.matched}/{result.total}) omitted={result.omitted}/{result.spec_items} verdict={result.verdict}"]
    others = [s for s in spec.needs_states if s != result.state]
    if len(spec.needs_states) > 1 and others:
        out.append("requires also: " + " ".join(f"state={s}" for s in others))
    out += [f"reason: {r}" for r in result.reasons]

    def group(title, rows):
        out.append(f"{title} ({len(rows)})")
        out.extend(f"  {r}" for r in rows)

    by = lambda status: [r for r in result.items if r.status == status]
    group("unmatched", [f"{r.item.id}    {_at(r.step)}{r.detail}" for r in by("unmatched")])
    group("matched", [f"{r.item.id}    {_at(r.step)}{r.detail}" for r in by("matched")])
    group("omitted", [f"{r.item.id}    shown: {_at(r.step)}{_node_text(r.node)}    {r.reason}" if r.shown
                      else f"{r.item.id}    {r.reason}" for r in by("omitted")])
    group("not applicable", [f"{r.item.id}    state={result.state}" for r in by("not-applicable")])
    group("not scored", [f"{p}    {k}: {_scalar(v)}" for p, k, v in spec.not_scored])
    group("extra", [f"{_at(step)}{role} {json.dumps(name, ensure_ascii=False)}" for role, name, step in result.extras])
    group("blocked requests", _blocked(result))
    if result_path is not None:
        out.append(f"result: {result_path}")
    return "\n".join(out) + "\n"


def result_json(result, extra):
    """The result file's content (design 2.5): the report's content plus `extra` (spec, commit, dirty, at, ...).
    A wizard's (issue 8, R5.5) takes `url`, `viewport` and `browser` from step 1, adds `step_urls`, and gives each
    matched item's `node` and each extra its `step`."""
    trees = _trees(result)
    wizard = isinstance(result.snapshot, Steps)
    items = []
    for r in result.items:
        d = {"id": r.item.id, "status": r.status, "critical": r.item.critical, "detail": r.detail}
        if r.status == "omitted":
            d["reason"] = r.reason
            d["shown"] = r.shown
        if r.status == "not-applicable":
            d["state"] = result.state
        d["node"] = None if r.node is None else {"index": r.node.index, "role": r.node.role, "name": r.node.name}
        if wizard and r.node is not None:
            d["node"]["step"] = r.step
        items.append(d)
    extras = []
    for role, name, step in result.extras:
        e = {"role": role, "name": name}
        if wizard:
            e["step"] = step
        extras.append(e)
    body = {"screen": result.spec.screen, "state": result.state, "verdict": result.verdict, "score": result.score,
            "matched": result.matched, "total": result.total, "reasons": result.reasons,
            "critical_unmatched": result.critical_unmatched, "requires": result.requires, "items": items,
            "omitted": result.omitted, "spec_items": result.spec_items, "omitted_shown": list(result.omitted_shown),
            "not_scored": [{"path": p, "key": k, "value": v} for p, k, v in result.spec.not_scored],
            "extras": extras, "blocked": _blocked(result), "url": trees[0].url, "viewport": trees[0].viewport,
            "browser": trees[0].browser, "spec": os.path.abspath(result.spec.path), "spec_sha256": result.spec.sha256}
    if wizard:
        body["step_urls"] = [t.url for t in trees]
    body.update(extra)
    return body


def dumps(obj):
    """Keys sorted, lists in their order: equal inputs give equal bytes (requirement 5.7)."""
    return json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


# ---------------------------------------------------------------------------------------------------- records

def _cell(v):
    return str(v).replace("|", "\\|").replace("\n", " ")


def _omitted_cell(r):
    """`<o>/<n>`, `<o>/<n>, <k> shown`, or `-` for a row without the counts (an error row, an older row; R4.4)."""
    o, n = r.get("omitted"), r.get("spec_items")
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in (o, n)):
        return "-"
    k = len(r.get("omitted_shown") or [])
    return f"{o}/{n}, {k} shown" if k else f"{o}/{n}"


def table(rows):
    """The --table text: one markdown row per recorded run, then one line per point and screen (requirement 5.3)."""
    out = ["| point | screen | state | score | omitted | verdict | critical unmatched | commit |",
           "|---|---|---|---|---|---|---|---|"]
    groups = {}
    for r in rows:
        score = "-" if r.get("score") is None else f"{float(r['score']):.1f}"
        commit = (r.get("commit") or "-")[:12] + (" (dirty)" if r.get("dirty") else "")
        crit = ", ".join(r.get("critical_unmatched") or []) or "-"
        out.append("| " + " | ".join(_cell(c) for c in (r.get("point"), r.get("screen"), r.get("state"), score,
                                                        _omitted_cell(r), r.get("verdict"), crit, commit)) + " |")
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
