"""Reference specs for pm-structure: the YAML subset reader, validation and the items to score. Not a command.

  spec = load(path)        a Spec, or SpecError with the message pm-structure prints

The YAML subset (design 2.1): block mappings and sequences, a mapping inside a sequence entry, flow sequences of
scalars on one line, plain, 'single' and "double" quoted scalars, comments, one leading `---`. Every accepted file
reads the same under YAML 1.2 (core schema) and YAML 1.1 readers, so a plain scalar that any of them would read
as something other than a string must be quoted. Everything else is refused with `spec <path>:<line>: <what>`.

The items (requirement 5.1) come out in spec order with their kind (the matching rule of 5.2), expected name,
list, critical flag (5.5) and the states they apply to (5.3); `omitted` entries (5.4) carry the item ids they
cover.
"""
import dataclasses
import hashlib
import os
import re
import stat

MAX_BYTES = 1024 * 1024
STATES = ("seeded", "empty")
SCREEN = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*")
KINDS = ("table", "detail", "form")
UNSUPPORTED_KINDS = ("wizard", "dashboard")
TOP_KEYS = ("screen", "service", "kind", "route", "breadcrumbs", "header", "table", "tabs", "sections", "omitted")
HEADER_KEYS = ("title", "counter", "actions", "primary_action")
TABLE_KEYS = ("selection", "filter", "pagination", "columns", "empty")
EMPTY_KEYS = ("title", "action")
SECTION_KEYS = ("title", "fields")
FIELD_KEYS = ("label", "control", "required", "constraint")
OMITTED_KEYS = ("item", "reason")
SELECTIONS = ("single", "multi", "none")
FILTERS = ("text", "property")


class SpecError(Exception):
    """A spec that cannot be scored. `screen` is the spec's screen once it is known, else None."""

    def __init__(self, message, screen=None):
        super().__init__(message)
        self.screen = screen


@dataclasses.dataclass
class Item:
    id: str
    kind: str                  # breadcrumb title counter action column selection filter pagination
                               # empty_title empty_action tab section_title field order
    name: object = None        # expected accessible name; the mode for selection and filter; None otherwise
    list: object = None        # id of the list the item is an entry of
    critical: bool = False
    states: tuple = STATES
    entries: tuple = ()        # order items: the ids of the list's entries, in spec order
    counter: bool = False      # header.title: the heading may carry a counter


@dataclasses.dataclass
class Omitted:
    path: str
    reason: str
    items: tuple


@dataclasses.dataclass
class Spec:
    path: str
    sha256: str
    screen: str
    service: object
    kind: str
    route: str
    items: list
    omitted: list
    not_scored: list           # (field item id, key, value)
    needs_states: tuple

    def omitted_reason(self, item_id):
        for e in self.omitted:
            if item_id in e.items:
                return e.reason
        return None


def norm(s):
    return s.strip().casefold()


# ---------------------------------------------------------------------------------------------------- YAML subset

class _YamlError(Exception):
    def __init__(self, line, what):
        super().__init__(what)
        self.line, self.what = line, what


@dataclasses.dataclass
class _Line:
    no: int
    indent: int
    text: str


INDICATORS = set("-?:,[]{}#&*!|>'\"%@`")
RESERVED = {"null", "~", "true", "false", "yes", "no", "on", "off", "y", "n", "<<", "="}
NUMBER = re.compile(r"""[-+]?(
      0b[01_]+ | 0o[0-7_]+ | 0x[0-9a-fA-F_]+
    | [0-9][0-9_]*(:[0-5]?[0-9])+(\.[0-9_]*)?
    | [0-9][0-9_]*(\.[0-9_]*)?([eE][-+]?[0-9]+)?
    | \.[0-9][0-9_]*([eE][-+]?[0-9]+)?
    | \.(inf|Inf|INF)
  ) | \.(nan|NaN|NAN)""", re.X)
TIMESTAMP = re.compile(r"[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt ].*)?")
KEY = re.compile(r"([A-Za-z_][A-Za-z0-9_]*):(?=[ ]|$)")
SEQ = re.compile(r"-(?=[ ]|$)")
INDENT = re.compile(r"[ \t]*")
DOC_START = re.compile(r"---(?=[ \t]|$)")
DOC_END = re.compile(r"\.\.\.(?=[ \t]|$)")
NOTHING = object()  # `key:` with nothing after it on the line


def _rest_is_comment(s):
    return s.strip(" ") == "" or bool(re.match(r"[ ]+#", s))


def _check_plain(v, line, in_flow):
    """Refuse a plain scalar that a YAML 1.1 or 1.2 reader would not read as this string; return its value."""
    if v in ("true", "false"):
        return v == "true"
    c = v[0]
    named = {"&": "anchors are not supported", "*": "aliases are not supported", "!": "tags are not supported",
             "|": "block scalars are not supported", ">": "block scalars are not supported",
             "{": "flow mappings are not supported"}
    if c in named:
        raise _YamlError(line, named[c])
    if c in INDICATORS:
        raise _YamlError(line, f"plain scalar {v!r} starts with {c!r}; quote it")
    if "\t" in v:
        raise _YamlError(line, f"tab in plain scalar {v!r}; quote it")
    if ": " in v or v.endswith(":"):
        raise _YamlError(line, f"plain scalar {v!r} holds ': ' or ends with ':'; quote it")
    if in_flow and any(ch in v for ch in "[]{}"):
        raise _YamlError(line, f"plain scalar {v!r} in a flow sequence holds a bracket; quote it")
    if v.lower() in RESERVED or NUMBER.fullmatch(v) or TIMESTAMP.fullmatch(v):
        raise _YamlError(line, f"plain scalar {v!r} is not read as a string by every YAML reader; quote it")
    return v


def _quoted(s, pos, line):
    """The quoted scalar starting at s[pos]; returns (value, position after the closing quote)."""
    q = s[pos]
    out, i = [], pos + 1
    while i < len(s):
        ch = s[i]
        if q == "'" and ch == "'":
            if s[i + 1:i + 2] == "'":
                out.append("'")
                i += 2
                continue
            return "".join(out), i + 1
        if q == '"' and ch == "\\":
            nxt = s[i + 1:i + 2]
            if nxt not in ('"', "\\"):
                raise _YamlError(line, f"escape \\{nxt} is not supported; only \\\" and \\\\ are")
            out.append(nxt)
            i += 2
            continue
        if q == '"' and ch == '"':
            return "".join(out), i + 1
        out.append(ch)
        i += 1
    raise _YamlError(line, "unterminated quoted scalar")


def _flow(s, line):
    """The flow sequence s[0] == '['; returns (list, position after ']')."""
    items, i = [], 1

    def skip(i):
        while i < len(s) and s[i] == " ":
            i += 1
        return i

    i = skip(i)
    if s[i:i + 1] == "]":
        return items, i + 1
    while True:
        i = skip(i)
        if i >= len(s):
            raise _YamlError(line, "unterminated flow sequence")
        c = s[i]
        if c in "'\"":
            v, i = _quoted(s, i, line)
        elif c == "[":
            raise _YamlError(line, "nested flow sequences are not supported")
        elif c == "{":
            raise _YamlError(line, "flow mappings are not supported")
        elif c in ",]":
            raise _YamlError(line, "empty entry in flow sequence")
        elif c == "#":
            raise _YamlError(line, "unterminated flow sequence")
        else:
            j = i
            while j < len(s) and s[j] not in ",]" and not (s[j] == "#" and s[j - 1] == " "):
                j += 1
            v = _check_plain(s[i:j].rstrip(" "), line, True)
            i = j
        items.append(v)
        i = skip(i)
        if i >= len(s) or s[i] == "#":
            raise _YamlError(line, "unterminated flow sequence")
        if s[i] == ",":
            i += 1
        elif s[i] == "]":
            return items, i + 1
        else:
            raise _YamlError(line, f"unexpected {s[i]!r} in flow sequence")


def _value(s, line):
    """An inline value (the text after `key: ` or `- `); returns (value, kind) with kind plain|quoted|flow|empty."""
    s = s.lstrip(" ")
    if s == "" or s.startswith("#"):
        return NOTHING, "empty"
    c = s[0]
    if c == "[":
        v, end = _flow(s, line)
        kind = "flow"
    elif c in "'\"":
        v, end = _quoted(s, 0, line)
        kind = "quoted"
    else:
        m = re.search(r"[ \t]#", s)
        plain = (s[:m.start()] if m else s).rstrip(" \t")
        return _check_plain(plain, line, False), "plain"
    if not _rest_is_comment(s[end:]):
        raise _YamlError(line, f"unexpected text after the value: {s[end:].strip()!r}")
    return v, kind


def _lines(text):
    out, started, marker = [], False, False
    for no, raw in enumerate(text.split("\n"), 1):
        if raw.endswith("\r"):
            raw = raw[:-1]
        lead = INDENT.match(raw).group(0)
        body = raw[len(lead):]
        if body == "" or body.startswith("#"):
            continue
        if "\t" in lead:
            raise _YamlError(no, "tab in indentation")
        if not lead and DOC_END.match(body):
            raise _YamlError(no, "document end marker ... is not supported")
        if not lead and DOC_START.match(body):
            if started or marker:
                raise _YamlError(no, "a second document is not supported")
            if not _rest_is_comment(body[3:]):
                raise _YamlError(no, "content after --- is not supported")
            marker = True
            continue
        started = True
        out.append(_Line(no, len(lead), body))
    return out


class _Parser:
    def __init__(self, lines):
        self.lines, self.i = lines, 0

    def peek(self):
        return self.lines[self.i] if self.i < len(self.lines) else None

    def document(self):
        first = self.peek()
        if first is None:
            return None
        v = self.block(first.indent)
        left = self.peek()
        if left is not None:
            raise _YamlError(left.no, "inconsistent indentation")
        return v

    def block(self, indent):
        return self.sequence(indent) if SEQ.match(self.peek().text) else self.mapping(indent)

    def nested(self, indent, line, allow_same_indent_sequence):
        """The value of `key:` or `-` with nothing after it: the block below it, or None."""
        nxt = self.peek()
        if nxt is not None and nxt.indent > indent:
            return self.block(nxt.indent)
        if allow_same_indent_sequence and nxt is not None and nxt.indent == indent and SEQ.match(nxt.text):
            return self.sequence(indent)
        return None

    def deeper(self, ln, last):
        what = "a plain scalar continued on the next line" if last == "plain" else "inconsistent indentation"
        raise _YamlError(ln.no, what)

    def mapping(self, indent):
        result, last = {}, None
        while True:
            ln = self.peek()
            if ln is None or ln.indent < indent:
                return result
            if ln.indent > indent:
                self.deeper(ln, last)
            if SEQ.match(ln.text):
                raise _YamlError(ln.no, "a sequence entry where a key was expected")
            if ln.text.startswith("?") and (len(ln.text) == 1 or ln.text[1] == " "):
                raise _YamlError(ln.no, "complex keys are not supported")
            m = KEY.match(ln.text)
            if not m:
                raise _YamlError(ln.no, "expected `key: value` with a plain word as key")
            key = m.group(1)
            if key in result:
                raise _YamlError(ln.no, f"duplicate key {key}")
            self.i += 1
            v, last = _value(ln.text[m.end():], ln.no)
            if v is NOTHING:
                v = self.nested(indent, ln.no, True)
            result[key] = v

    def sequence(self, indent):
        items, last = [], None
        while True:
            ln = self.peek()
            if ln is None or ln.indent < indent:
                return items
            if ln.indent > indent:
                self.deeper(ln, last)
            if not SEQ.match(ln.text):
                return items
            rest = ln.text[1:]
            body = rest.lstrip(" ")
            col = indent + 1 + len(rest) - len(body)
            last = None
            if body == "" or body.startswith("#"):
                self.i += 1
                items.append(self.nested(indent, ln.no, False))
            elif SEQ.match(body):
                raise _YamlError(ln.no, "a sequence inside a sequence entry is not supported")
            elif KEY.match(body):
                self.lines[self.i] = _Line(ln.no, col, body)
                items.append(self.mapping(col))
            else:
                self.i += 1
                v, last = _value(body, ln.no)
                items.append(v)


def parse(text):
    """The value of a spec text in the YAML subset; raises _YamlError(line, what)."""
    return _Parser(_lines(text)).document()


# ---------------------------------------------------------------------------------------------------- validation

class _Builder:
    def __init__(self, path, doc):
        self.path, self.doc = path, doc
        self.items, self.not_scored, self.screen = [], [], None

    def fail(self, what):
        raise SpecError(f"spec {self.path}: {what}", self.screen)

    def mapping(self, v, where):
        if not isinstance(v, dict):
            self.fail(f"{where} must be a mapping")
        return v

    def keys(self, m, allowed, where):
        for k in m:
            if k not in allowed:
                self.fail(f"unknown key {where + '.' if where else ''}{k}")

    def string(self, v, where):
        if not isinstance(v, str):
            self.fail(f"{where} must be a string")
        if not v.strip():
            self.fail(f"{where} is empty")
        return v

    def boolean(self, v, where):
        if not isinstance(v, bool):
            self.fail(f"{where} must be true or false")
        return v

    def enum(self, v, allowed, where):
        if not isinstance(v, str) or v not in allowed:
            self.fail(f"{where} must be one of {', '.join(allowed)}")
        return v

    def names(self, v, where):
        if not isinstance(v, list):
            self.fail(f"{where} must be a list")
        if not v:
            self.fail(f"{where} is empty")
        seen = set()
        for n in v:
            self.string(n, f"an entry of {where}")
            if norm(n) in seen:
                self.fail(f"{where} has {n} twice")
            seen.add(norm(n))
        return v

    def add(self, item):
        self.items.append(item)
        return item

    def name_list(self, list_id, names, kind, critical=False):
        for n in names:
            self.add(Item(f"{list_id}[{n}]", kind, n, list_id, critical))
        self.add(Item(f"{list_id}.order", "order", None, None, critical, entries=tuple(f"{list_id}[{n}]" for n in names)))

    def build(self):
        doc = self.doc
        if not isinstance(doc, dict):
            self.fail("the spec must be a mapping")
        if "screen" not in doc:
            self.fail("missing screen")
        screen = self.string(doc["screen"], "screen")
        if not SCREEN.fullmatch(screen):
            self.fail(f"screen {screen!r} is not <service>.<screen> in lower-case letters, digits and hyphens")
        self.screen = screen
        if "steps" in doc:
            self.fail("steps is not supported")
        if "kind" not in doc:
            self.fail("missing kind")
        kind = self.string(doc["kind"], "kind")
        if kind in UNSUPPORTED_KINDS:
            self.fail(f"kind {kind} is not supported")
        self.enum(kind, KINDS, "kind")
        self.keys(doc, TOP_KEYS, "")
        if "route" not in doc:
            self.fail("missing route")
        route = self.string(doc["route"], "route")
        if not route.startswith("/"):
            self.fail("route must start with /")
        service = self.string(doc["service"], "service") if "service" in doc else None
        header = self.mapping(doc.get("header", {}), "header")
        if "title" not in header:
            self.fail("missing header.title")
        table = self.mapping(doc["table"], "table") if "table" in doc else None
        if kind == "table" and (table is None or "columns" not in table):
            self.fail("kind table needs table.columns")
        for key, value in doc.items():
            if key == "breadcrumbs":
                self.name_list("breadcrumbs", self.names(value, "breadcrumbs"), "breadcrumb")
            elif key == "header":
                self.header(header)
            elif key == "table":
                self.table(table)
            elif key == "tabs":
                self.name_list("tabs", self.names(value, "tabs"), "tab")
            elif key == "sections":
                self.sections(value)
        omitted = self.omitted(doc.get("omitted", []))
        needs = STATES if table is not None and ("empty" in table or table.get("selection") in ("single", "multi")) \
            else ("seeded",)
        return screen, service, kind, route, omitted, needs

    def header(self, h):
        self.keys(h, HEADER_KEYS, "header")
        counter = self.boolean(h["counter"], "header.counter") if "counter" in h else False
        actions = self.names(h["actions"], "header.actions") if "actions" in h else []
        for key, value in h.items():
            if key == "title":
                self.add(Item("header.title", "title", self.string(value, "header.title"), critical=True,
                              counter=counter))
            elif key == "counter" and counter:
                self.add(Item("header.counter", "counter"))
            elif key == "actions":
                self.name_list("header.actions", actions, "action")
            elif key == "primary_action":
                name = self.string(value, "header.primary_action")
                if norm(name) not in {norm(a) for a in actions}:
                    self.fail(f"header.primary_action {name} is not in header.actions")
                self.add(Item("header.primary_action", "action", name, critical=True))

    def table(self, t):
        self.keys(t, TABLE_KEYS, "table")
        for key, value in t.items():
            if key == "selection":
                mode = self.enum(value, SELECTIONS, "table.selection")
                self.add(Item("table.selection", "selection", mode,
                              states=("seeded",) if mode in ("single", "multi") else STATES))
            elif key == "filter":
                self.add(Item("table.filter", "filter", self.enum(value, FILTERS, "table.filter")))
            elif key == "pagination":
                if self.boolean(value, "table.pagination"):
                    self.add(Item("table.pagination", "pagination"))
            elif key == "columns":
                self.name_list("table.columns", self.names(value, "table.columns"), "column", critical=True)
            elif key == "empty":
                e = self.mapping(value, "table.empty")
                self.keys(e, EMPTY_KEYS, "table.empty")
                if not e:
                    self.fail("table.empty is empty")
                if "action" in e and "title" not in e:
                    self.fail("table.empty.action needs table.empty.title")
                for k, v in e.items():
                    self.add(Item(f"table.empty.{k}", f"empty_{k}", self.string(v, f"table.empty.{k}"),
                                  states=("empty",)))

    def sections(self, value):
        if not isinstance(value, list):
            self.fail("sections must be a list")
        if not value:
            self.fail("sections is empty")
        titles, seen = [], set()
        for n, s in enumerate(value, 1):
            s = self.mapping(s, f"sections entry {n}")
            if "title" not in s:
                self.fail(f"sections entry {n} has no title")
            title = self.string(s["title"], f"sections entry {n} title")
            where = f"sections[{title}]"
            self.keys(s, SECTION_KEYS, where)
            if norm(title) in seen:
                self.fail(f"sections has {title} twice")
            seen.add(norm(title))
            titles.append(f"{where}.title")
            self.add(Item(f"{where}.title", "section_title", title, "sections"))
            if "fields" in s:
                self.name_list(f"{where}.fields", self.fields(s["fields"], f"{where}.fields"), "field")
        self.add(Item("sections.order", "order", entries=tuple(titles)))

    def fields(self, value, where):
        if not isinstance(value, list):
            self.fail(f"{where} must be a list")
        if not value:
            self.fail(f"{where} is empty")
        labels, seen = [], set()
        for n, f in enumerate(value, 1):
            if isinstance(f, dict):
                if "label" not in f:
                    self.fail(f"{where} entry {n} has no label")
                label = self.string(f["label"], f"{where} entry {n} label")
                fid = f"{where}[{label}]"
                self.keys(f, FIELD_KEYS, fid)
                for k, v in f.items():
                    if k != "label":
                        if isinstance(v, str):
                            self.string(v, f"{fid}.{k}")
                        elif not isinstance(v, bool):
                            self.fail(f"{fid}.{k} must be a scalar")
                        self.not_scored.append((fid, k, v))
            else:
                label = self.string(f, f"{where} entry {n}")
            if norm(label) in seen:
                self.fail(f"{where} has {label} twice")
            seen.add(norm(label))
            labels.append(label)
        return labels

    def omitted(self, value):
        if value is None or not isinstance(value, list):
            self.fail("omitted must be a list")
        out = []
        for n, e in enumerate(value, 1):
            if not isinstance(e, dict):
                self.fail(f"omitted entry {n} must be a mapping with item and reason")
            if "item" not in e:
                self.fail(f"omitted entry {n} has no item")
            path = self.string(e["item"], f"omitted entry {n} item")
            for k in e:
                if k not in OMITTED_KEYS:
                    self.fail(f"omitted {path}: unknown key {k}")
            if "reason" not in e:
                self.fail(f"omitted {path}: no reason")
            reason = e["reason"]
            if not isinstance(reason, str) or not reason.strip():
                self.fail(f"omitted {path}: the reason is empty")
            covered = tuple(i.id for i in self.items
                            if i.id == path or i.id.startswith(path + ".") or i.id.startswith(path + "["))
            if not covered:
                self.fail(f"omitted {path}: names nothing in the spec")
            out.append(Omitted(path, reason, covered))
        return out


def load(path):
    """Read, parse and validate the spec at `path` (a regular file of at most 1 MiB)."""
    try:
        st = os.stat(path)
        if not stat.S_ISREG(st.st_mode):
            raise SpecError(f"cannot read spec {path}: not a regular file")
        if st.st_size > MAX_BYTES:
            raise SpecError(f"cannot read spec {path}: larger than {MAX_BYTES} bytes")
        with open(path, "rb") as f:
            data = f.read(MAX_BYTES + 1)
    except OSError as e:
        raise SpecError(f"cannot read spec {path}: {e.strerror or e}") from None
    if len(data) > MAX_BYTES:
        raise SpecError(f"cannot read spec {path}: larger than {MAX_BYTES} bytes")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise SpecError(f"cannot read spec {path}: not UTF-8 text") from None
    if text.startswith("\ufeff"):
        text = text[1:]
    try:
        doc = parse(text)
    except _YamlError as e:
        raise SpecError(f"spec {path}:{e.line}: {e.what}") from None
    b = _Builder(path, doc)
    screen, service, kind, route, omitted, needs = b.build()
    return Spec(path=path, sha256=hashlib.sha256(data).hexdigest(), screen=screen, service=service, kind=kind,
                route=route, items=b.items, omitted=omitted, not_scored=b.not_scored, needs_states=needs)
