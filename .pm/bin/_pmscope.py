"""Which modules a checkout's changes call for: the rules and the decision. Not a command.

pm-scope prints the decision, pm-check runs the steps it calls for, and pm-merge decides a branch's paths again
with it at the merge. None of them holds a rule of its own. This file imports nothing from _pmlib.py and takes
every path as an argument, so it never reads .pm/run.

The target of a checkout is the branch its work merges into, read from git alone: a checkout on a branch
<feat|refactor|fix>/<id>-<rest> has the target feat/<id> (the issue branch) when that local branch exists; every
other checkout, an issue branch itself included, has the target main. A unit's changes are measured against its
target, so the paths other units brought into the issue branch are never its own, and the integration checks its
paths call for are left to the issue branch (deferred) instead of run.

A changed path is only ever compared as text with the patterns below: it is never opened, joined to a directory
or put on a command line. git is started as an argument list, without the caller's GIT_* and AWS_* variables and
with a timeout; whatever it cannot answer means every module.

The harness step runs every harness guard (.pm/bin/tests/, issue 523) whenever a path of .pm/bin/ changed; no
other path calls it.
"""
import fnmatch
import json
import os
import re
import subprocess

MODULES = ("engine", "studio", "integration", "harness")  # pm-check's four, in its order
PRODUCT = ("engine", "studio", "integration")
HARNESS = ("harness",)
GIT_TIMEOUT = 30  # seconds; a git that does not answer in time is a change that cannot be read
UNIT_BRANCH = re.compile(r"(feat|refactor|fix)/(\d+)-.+")  # a unit's branch: its issue branch is feat/<id>
DEFERRED = ("integration",)  # what a unit leaves to its issue branch

# The selection of the touched services (select below). A service name is the name of a service's folder; it is
# only ever written into JSON and compared with manifest values, never joined to a path or put on a command line.
SERVICE = re.compile(r"[a-z][a-z0-9]*(-[a-z0-9]+)*")  # matched with fullmatch
# A service's folder of checks (issue 402): its support, its seed script and its manifest. A path under it is its
# service's, as a path under a folder of its screens is.
SERVICE_CHECKS = "tests/integration/studio/services/"
SERVICE_FOLDERS = ("studio/src/providers/aws/area/services/", SERVICE_CHECKS)
# The manifest (issue 402, R3.2) is the rows of the main manifest, in its order, then the rows of each service's
# manifest, SERVICE_CHECKS + <s> + "/" + SERVICE_MANIFEST, the services in name order. A folder under
# SERVICE_CHECKS whose name is not of the form SERVICE, or that holds no manifest, adds no row; a checkout without
# SERVICE_CHECKS reads the main manifest alone.
MANIFEST = "tests/integration/manifest.jsonl"
SERVICE_MANIFEST = "manifest.jsonl"
UNIT_TESTS = ("studio/src/*.test.ts", "studio/src/*.test.tsx")  # "*" crosses "/": not part of the built Studio
TOOLS = (".github/", ".pm/bin/")  # the workflow, the selection and its rules: every service where integration runs
COMMIT = re.compile(r"[0-9a-f]{40}")  # the only form of a push's commit id that reaches git

# The first rule a path matches decides it; a checkout's answer is the union over its paths. A pattern that ends
# in "/" matches every path under that folder; one that holds "*" is matched with fnmatch against the whole path
# ("*" also crosses "/"), except under the folders of `outside`; any other matches that exact path. `nocase`
# lower-cases the path before matching.
RULES = [
    dict(paths=["studio/AGENTS.md"], calls=("studio",),
         why="a guide that Studio unit tests read (request-module.test.ts, brand-files.test.ts)"),
    dict(paths=["AGENTS.md", "CLAUDE.md", "PRODUCT.md", "engine/AGENTS.md", "tests/integration/AGENTS.md",
                "engine/references/*.md", "tests/integration/references/*.md", "studio/references/*.md",
                "studio/references/*.yaml", ".agents/", ".claude/", ".github/", "issues/README.md",
                "issues/things-that-do-not-work/*.md", "issues/things-that-now-work/*.md"],
         calls=(),
         why="guides, issue files and the workflow: no pm-check step on this machine reads them (Prettier leaves "
             "AGENTS.md and references/ out, Cargo and the integration run read no Markdown there)"),
    dict(paths=["tests/integration/run", "infra/", "docker-compose.yml", "*compose*.yml", "*compose*.yaml"],
         outside=[".pm/bin/"], calls=PRODUCT,
         why="the integration run builds from infra/ and the root file; a compose file elsewhere is not known to be "
             "outside the integration run"),
    dict(paths=["engine/", "studio/", "tests/integration/", "README.md"], calls=PRODUCT,
         why="the engine and Studio steps and the integration checks read them"),
    dict(paths=["*.png", "*.gif", "*.jpg", "*.jpeg"], nocase=True, calls=PRODUCT,
         why="a Studio unit test measures every tracked image; where it lies is not known to be a product path"),
    dict(paths=[".pm/bin/"], calls=HARNESS,
         why="the harness scripts and their guards"),
]


class Unreadable(Exception):
    """The changes cannot be read; the message says what failed."""


def _matches(pattern, path, outside):
    if pattern.endswith("/"):
        return path.startswith(pattern)
    if "*" in pattern:
        return not any(path.startswith(o) for o in outside) and fnmatch.fnmatchcase(path, pattern)
    return path == pattern


def rule_of(path):
    """The index in RULES of the first rule `path` matches, or None."""
    for i, rule in enumerate(RULES):
        p = path.lower() if rule.get("nocase") else path
        if any(_matches(pat, p, rule.get("outside", ())) for pat in rule["paths"]):
            return i
    return None


def _count(n):
    return f"{n} path" if n == 1 else f"{n} paths"


def decide(paths):
    """{module: [why, ...]} for the modules `paths` call for, in MODULES order: one line per rule that called for
    the module, with its number of paths and the first of them; paths no rule knows call for every module."""
    by_rule, unknown = {}, []
    for path in sorted(set(paths)):
        i = rule_of(path)
        if i is None:
            unknown.append(path)
        else:
            by_rule.setdefault(i, []).append(path)
    answer = {}
    for i in sorted(by_rule):
        found = by_rule[i]
        for m in RULES[i]["calls"]:
            answer.setdefault(m, []).append(f"{RULES[i]['why']} ({_count(len(found))}, e.g. {found[0]})")
    if unknown:
        for m in MODULES:
            answer.setdefault(m, []).append(f"the rules do not know {unknown[0]} ({_count(len(unknown))})")
    return {m: answer[m] for m in MODULES if m in answer}


def _rows(text):
    """The rows of a manifest's text, one JSON object per non-empty line; ValueError on any other line."""
    out = []
    for ln in text.splitlines():
        if not ln.strip():
            continue
        row = json.loads(ln)
        if not isinstance(row, dict):
            raise ValueError("a manifest line is not a JSON object")
        out.append(row)
    return out


def _service(row):
    """The service of a manifest row: its `service` when that is a string of the form of a service name, else None
    (a check of no service)."""
    s = row.get("service")
    return s if isinstance(s, str) and SERVICE.fullmatch(s) else None


def _by_id(rows):
    """{check id: (services of its rows, paths of its rows)}; a row whose id is not a string is not counted."""
    out = {}
    for row in rows:
        cid = row.get("check_id")
        if isinstance(cid, str):
            services, paths = out.setdefault(cid, (set(), set()))
            services.add(_service(row))
            paths.add(row.get("path"))
    return out


def _manifest_change(paths, head_rows, base):
    """Line 3 of the selection: the reason a change of the manifest gives every service, or None (it gives
    nothing)."""
    try:
        base_rows = [] if base == "" else _rows(base) if base is not None else None
    except (ValueError, RecursionError):
        base_rows = None
    if base_rows is None:
        return "the base's manifest cannot be read"
    old, new, changed_paths = _by_id(base_rows), _by_id(head_rows), set(paths)
    for cid in sorted(new):
        services, files = new[cid]
        if cid in old:
            if old[cid][0] != services:
                return f"the manifest's service of {cid} changed"
        elif services - {None} and not files & changed_paths:
            return f"{cid} is new and its file did not change"
    return None


def select(paths, head, base):
    """The selection of the touched services (issue 327, requirement R2): which services' checks a run must hold
    for these changed paths. Pure: no git, no file. `head` is the text of the head's manifest (the one `run` will
    read), None when it cannot be read; `base` the text of the manifest the paths are measured from, "" when that
    commit has none, None when it exists and cannot be read. Returns the services object {all, names, why}:
    `all` true (every service, `names` []) or a sorted list of names, which may be empty.

    `head` and `base` are each the manifest of R3.2 as one text (manifest_of, manifest_at): the main manifest's
    rows, then each service's manifest's.

    Each path is compared as text, never opened, and decided by the first line it matches:
      1 under one of SERVICE_FOLDERS (studio/src/providers/aws/area/services/ and
        tests/integration/studio/services/, the service's folder of checks), a folder segment <s> followed by "/":
        the service <s>, or every service when <s> is not of the form SERVICE (a file directly under the folder
        falls to line 6); a service's manifest, tests/integration/studio/services/<s>/manifest.jsonl, also asks
        line 3
      2 the `path` of one or more rows of `head` (a file of checks): the services those rows name, none for
        rows of no service
      3 the main manifest: every service when a check id both manifests hold has another service in the two, an
        id only `head` holds has a service and its path is not among the changed paths, or `base` cannot be read;
        else nothing. It is asked once, over the whole of `head` and `base`, when the main manifest or a
        service's manifest is among the paths
      4 studio/src/*.test.ts or *.test.tsx (unit tests, not part of the built Studio): nothing
      5 a path whose rule in RULES calls for no product module, outside .github/ and .pm/bin/: nothing
      6 any other path (the engine, shared Studio code, the checks' support, the workflow, the harness, a path
        no rule knows): every service
    A head manifest that cannot be read, or a line of it that is not a JSON object, gives every service."""
    def every(why):
        return dict(all=True, names=[], why=why)

    try:
        head_rows = _rows(head) if head is not None else None
    except (ValueError, RecursionError):
        head_rows = None
    if head_rows is None:
        return every("the manifest cannot be read")
    of_file = {}
    for row in head_rows:
        if isinstance(row.get("path"), str):
            of_file.setdefault(row["path"], set()).add(_service(row))
    names, touching, shared, reasons = set(), 0, [], []
    asked = []  # line 3's answer, asked once per call

    def manifest_changed(path):
        if not asked:
            asked.append(_manifest_change(paths, head_rows, base))
        if asked[0]:
            reasons.append((path, asked[0]))

    for path in sorted(set(paths)):
        folder = next((f for f in SERVICE_FOLDERS if path.startswith(f) and "/" in path[len(f):]), None)
        if folder is not None:
            s = path[len(folder):].split("/", 1)[0]
            if SERVICE.fullmatch(s):
                names.add(s)
                touching += 1
            else:
                reasons.append((path, f"{path} is under a folder that is not a service name"))
            if service_of_manifest(path) is not None:
                manifest_changed(path)
            continue
        if path in of_file:
            given = of_file[path] - {None}
            names |= given
            touching += bool(given)
            continue
        if path == MANIFEST:
            manifest_changed(path)
            continue
        if any(fnmatch.fnmatchcase(path, p) for p in UNIT_TESTS):
            continue
        i = rule_of(path)
        if i is not None and not set(RULES[i]["calls"]) & set(PRODUCT) and not path.startswith(TOOLS):
            continue
        shared.append(path)
        reasons.append((path, None))
    if reasons:
        path, why = min(reasons, key=lambda r: r[0])
        return every(why or f"{path} is shared by the services ({_count(len(shared))})")
    if touching:
        why = f"{_count(touching)} touch a service" if touching != 1 else "1 path touches a service"
    else:
        why = "no path touches a service"
    return dict(all=False, names=sorted(names), why=why)


def run_git(top, *args):
    """git -C <top> <args> as a CompletedProcess, whatever its exit code, for a caller to whom an exit code is an
    answer. Raises Unreadable only on a timeout or a git that cannot start."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "AWS_"))}
    what = f"git {' '.join(args[:2])}"
    try:
        return subprocess.run(["git", "-C", str(top), *args], capture_output=True, text=True, env=env,
                              stdin=subprocess.DEVNULL, timeout=GIT_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise Unreadable(f"{what} did not answer in {GIT_TIMEOUT} s") from None
    except OSError as e:
        raise Unreadable(f"{what} could not start ({type(e).__name__})") from None


def git(top, *args):
    """git -C <top> <args>: its stdout. Raises Unreadable on a non-zero exit, a timeout or a missing git."""
    r = run_git(top, *args)
    if r.returncode != 0:
        raise Unreadable(f"git {' '.join(args[:2])} exited {r.returncode}")
    return r.stdout


def _names(out):
    return [p for p in out.split("\0") if p]


def between(top, old, new):
    """The paths that differ between two commits of the repository at `top`."""
    return _names(git(top, "diff", "--name-only", "--no-renames", "-z", old, new, "--"))


def _rev(top, ref, missing):
    try:
        return git(top, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}").strip()
    except Unreadable:
        raise Unreadable(missing) from None


def merge_base(top, a, b, other="main"):
    try:
        return git(top, "merge-base", a, b).strip()
    except Unreadable as e:
        raise Unreadable(f"the branch and {other} share no commit ({e})") from None


def target_of(top, branch=None):
    """The branch the work of a checkout merges into: "feat/<id>" for a branch <feat|refactor|fix>/<id>-<rest>
    when the local branch feat/<id> exists, else "main". `branch` defaults to the checkout's own (a detached head
    has the target main). Raises Unreadable only when git cannot start or does not answer in time."""
    if branch is None:
        r = run_git(top, "symbolic-ref", "--quiet", "--short", "HEAD")
        branch = r.stdout.strip() if r.returncode == 0 else ""
    m = UNIT_BRANCH.fullmatch(branch)
    if not m:
        return "main"
    issue = f"feat/{m.group(2)}"
    r = run_git(top, "rev-parse", "--verify", "--quiet", f"refs/heads/{issue}^{{commit}}")
    return issue if r.returncode == 0 else "main"


def changed(checkout, target="main"):
    """What counts as changed in a work tree: every path that differs between its commit and the merge base with
    its target (main unless given), and every path with an uncommitted change, untracked files included; a renamed
    file under both names. Returns (paths, head, main, base); `main` is None when the target is an issue branch and
    the checkout has no branch main."""
    top = os.path.realpath(str(checkout))
    shown = git(top, "rev-parse", "--show-toplevel").strip()
    if not shown or os.path.realpath(shown) != top:
        raise Unreadable(f"{checkout} is not the top of a git work tree")
    head = _rev(top, "HEAD", "the checkout has no commit")
    if target == "main":
        main = _rev(top, "refs/heads/main", "the checkout has no branch main")
        base = merge_base(top, head, main)
    else:
        try:
            main = _rev(top, "refs/heads/main", "the checkout has no branch main")
        except Unreadable:
            main = None
        tip = _rev(top, f"refs/heads/{target}", f"the checkout has no branch {target}")
        base = merge_base(top, head, tip, target)
    paths = set(between(top, base, head))
    out = git(top, "status", "--porcelain", "--no-renames", "--untracked-files=all", "-z")
    paths.update(entry[3:] for entry in _names(out))
    return sorted(paths), head, main, base


def service_of_manifest(path):
    """The service <s> when `path` is exactly SERVICE_CHECKS + <s> + "/" + SERVICE_MANIFEST with <s> of the form
    SERVICE, else None. Text only."""
    if not (path.startswith(SERVICE_CHECKS) and path.endswith("/" + SERVICE_MANIFEST)):
        return None
    s = path[len(SERVICE_CHECKS):-len("/" + SERVICE_MANIFEST)]
    return s if SERVICE.fullmatch(s) else None


def _joined(parts):
    """The manifest's text from its parts' texts: the main manifest's alone, word for word, when it is the only
    part; else each part that another follows ended with a newline when it has none."""
    return "".join(t if not t or t.endswith("\n") or i == len(parts) - 1 else t + "\n" for i, t in enumerate(parts))


def manifest_at(top, commit):
    """The text of the manifest (R3.2) at `commit` of the repository at `top`: the main manifest's ("" when the
    commit has none), then each service's manifest the commit holds, in name order; "" when it holds none of them.
    Raises Unreadable when git fails or does not answer, and when the commit holds a service's manifest as anything
    but a regular file reached through real folders: the folder tests/integration/studio/services or a folder <s>
    of it a symbolic link or a submodule, the manifest one or a folder. A regular file in the place of the folder
    services or of a folder <s> adds no row, as in the work tree. A caller that catches Unreadable passes None to
    select()."""
    parts = [git(top, "show", f"{commit}:{MANIFEST}") if git(top, "ls-tree", commit, "--", MANIFEST).strip() else ""]
    folder = SERVICE_CHECKS.rstrip("/")
    found = {}
    for entry in _names(git(top, "ls-tree", "-r", "-z", commit, "--", folder)):
        meta, _, path = entry.partition("\t")
        mode = meta.split(" ", 1)[0]
        s = service_of_manifest(path)
        rest = path[len(SERVICE_CHECKS):].split("/") if path.startswith(SERVICE_CHECKS) else []
        if path == folder or (len(rest) == 1 and SERVICE.fullmatch(rest[0])):
            if mode not in ("100644", "100755"):
                raise Unreadable(f"{path} is not a folder at {commit}")
            continue
        if len(rest) > 2 and SERVICE.fullmatch(rest[0]) and rest[1] == SERVICE_MANIFEST:
            raise Unreadable(f"{SERVICE_CHECKS}{rest[0]}/{SERVICE_MANIFEST} is a folder at {commit}")
        if s is not None:
            if mode not in ("100644", "100755"):
                raise Unreadable(f"{path} is not a regular file at {commit}")
            found[s] = path
    parts += [git(top, "show", f"{commit}:{found[s]}") for s in sorted(found)]
    return _joined(parts)


def manifest_parts(checkout):
    """The files of the work tree's manifest (R3.2), uncommitted changes included, as [(path, text, why)]: the
    main manifest, then for each folder <s> of tests/integration/studio/services/ of the form SERVICE, in name
    order, its manifest when it holds one. `text` is None, and `why` says why, for a part that cannot be read: the
    main manifest missing or unreadable, and a service's that is there and is not a regular file reached through
    real folders (the folder services, the folder <s> or the file a symbolic link, the file a folder). A folder
    services that is a symbolic link is one part, the folder itself, that cannot be read; so is a folder <s> that
    is one. `path` is joined to `checkout`; a name from the folder reaches a path only once it is of the form."""
    def read(path):
        try:
            with open(path, encoding="utf-8") as f:
                return f.read(), None
        except (OSError, UnicodeDecodeError) as e:
            return None, type(e).__name__

    co = str(checkout)
    parts = [(os.path.join(co, MANIFEST), *read(os.path.join(co, MANIFEST)))]
    folder = os.path.join(co, SERVICE_CHECKS.rstrip("/"))
    if os.path.islink(folder):
        return parts + [(folder, None, "a symbolic link")]
    if not os.path.isdir(folder):
        return parts
    try:
        listed = sorted(n for n in os.listdir(folder) if SERVICE.fullmatch(n))
    except OSError as e:
        return parts + [(folder, None, type(e).__name__)]
    for s in listed:
        d = os.path.join(folder, s)
        m = os.path.join(d, SERVICE_MANIFEST)
        if os.path.islink(d):
            parts.append((d, None, "a symbolic link"))
        elif not os.path.isdir(d) or not os.path.lexists(m):
            continue
        elif os.path.islink(m):
            parts.append((m, None, "a symbolic link"))
        elif not os.path.isfile(m):
            parts.append((m, None, "not a regular file"))
        else:
            parts.append((m, *read(m)))
    return parts


def manifest_paths(checkout):
    """The paths manifest_of reads, in its order, for a caller that names a file in a refusal (pm-check)."""
    return [p for p, _, _ in manifest_parts(checkout)]


def manifest_of(checkout):
    """The text of the work tree's manifest (R3.2), what `run` reads, uncommitted changes included: the main
    manifest's, then each service's; exactly the main manifest's text in a checkout without
    tests/integration/studio/services/. None when a part cannot be read (manifest_parts; the main manifest missing
    too)."""
    parts = manifest_parts(checkout)
    if any(t is None for _, t, _ in parts):
        return None
    return _joined([t for _, t, _ in parts])


def push(top, before, after):
    """The selection of a push of main, for `pm-scope --push`: {"services": <services object>, "paths": n}, where n
    is the number of paths that differ between `before` (the commit main had before the push) and `after` (the
    pushed commit). Every service, with the reason, when either id is not 40 hexadecimal digits, `before` is all
    zeros (a first push), is not a commit of the clone or not an ancestor of `after` (a forced history), or git
    cannot answer. Both ids are held to their form before git sees them, so neither can be read as an option."""
    def every(why, n=0):
        return {"services": dict(all=True, names=[], why=why), "paths": n}

    if not (COMMIT.fullmatch(before) and COMMIT.fullmatch(after)):
        return every("the commit before the push is not a commit id" if not COMMIT.fullmatch(before)
                     else "the pushed commit is not a commit id")
    if before == "0" * 40:
        return every("the push has no commit before it")
    try:
        if run_git(top, "rev-parse", "--verify", "--quiet", f"{before}^{{commit}}").returncode != 0:
            return every("the commit before the push is not in the clone")
        if run_git(top, "merge-base", "--is-ancestor", before, after).returncode != 0:
            return every("the commit before the push is not an ancestor of the pushed commit")
        paths = between(top, before, after)
        head, base = manifest_at(top, after), manifest_at(top, before)
    except Unreadable as e:
        return every(str(e))
    return {"services": select(paths, head, base), "paths": len(set(paths))}


def scope(checkout, full=False, only=None, checks=None):
    """The `scope` object of a pm-check record: kind (checks, only, full, main, diff or unit) and reason, main's
    commit and the merge base when they could be read, the number of changed paths, the target, and per module
    whether it was called for and why. On a unit of an issue branch (kind unit) the integration module its paths
    call for is not called but `deferred`, with the same reasons; the key `deferred` exists on no other module and
    in no other kind. Never raises."""
    target, failed = "main", None
    try:
        target = target_of(os.path.realpath(str(checkout)))
        paths, head, main, base = changed(checkout, target)
    except Unreadable as e:
        paths, head, main, base, failed = [], None, None, None, str(e)
    held = {}
    if checks:
        kind, reason = "checks", f"--checks {' '.join(checks)}"
        calls = {"integration": ["--checks"]}
    elif only:
        kind, reason = "only", f"--only {' '.join(only)}"
        calls = {m: ["--only"] for m in MODULES if m in only}
    elif full:
        kind, reason = "full", "--full"
        calls = {m: [reason] for m in MODULES}
    elif failed:
        kind, reason = "full", f"cannot read the changes: {failed}"
        calls = {m: [reason] for m in MODULES}
    elif target != "main":
        kind = "unit"
        reason = f"{_count(len(paths))} changed against {target}" if paths else f"no change of its own against {target}"
        calls = decide(paths)
        held = {m: calls.pop(m) for m in DEFERRED if m in calls}
    elif base == head:
        kind, reason = "main", "the head has no commit of its own against main; the harness tests are left out"
        calls = {m: [reason] for m in PRODUCT}
    else:
        kind, reason = "diff", f"{_count(len(paths))} changed against main"
        calls = decide(paths)
    modules = {m: dict(called=False, deferred=True, why=held[m]) if m in held else
               dict(called=m in calls, why=calls.get(m, [])) for m in MODULES}
    sc = dict(kind=kind, reason=reason, main=main, base=base, paths=len(paths), target=target, modules=modules)
    if kind in ("diff", "unit"):
        try:
            at_base = manifest_at(os.path.realpath(str(checkout)), base)
        except Unreadable:
            at_base = None
        sc["services"] = select(paths, manifest_of(checkout), at_base)
    else:
        why = "main: the head has no commit of its own against main" if kind == "main" else reason
        sc["services"] = dict(all=True, names=[], why=why)
    return sc


def called(sc):
    """The called-for modules of a scope object, in MODULES order."""
    return [m for m in MODULES if sc["modules"][m]["called"]]


def deferred(sc):
    """The modules of a scope object that are left to the issue branch, in MODULES order."""
    return [m for m in MODULES if sc["modules"][m].get("deferred")]


def services_line(sv):
    """The services line of a services object: `  services     every service: <why>` or
    `  services     <names joined by ", ", or "none"> (<why>)`."""
    if sv["all"]:
        return f"  {'services':12} every service: {sv['why']}"
    return f"  {'services':12} {', '.join(sv['names']) or 'none'} ({sv['why']})"


def services_file(sc):
    """What pm-check writes as the services file of `run --services`: None when the scope's selection is every
    service (the run is then started without the option), else {"services": [names], "why": why}."""
    sv = sc["services"]
    return None if sv["all"] else {"services": list(sv["names"]), "why": sv["why"]}


def lines(sc):
    """The scope as text: `scope: <kind>, <reason> (base <sha>): <modules>`, then one line per called-for module.
    A unit's first line ends `; <modules> left to <target>` when something is deferred, with one line per deferred
    module after the called-for ones. Last, when integration is called for or deferred, the
    services line (services_line) of the scope's `services`."""
    base = f" (base {sc['base'][:9]})" if sc.get("base") and sc["kind"] in ("diff", "unit") else ""
    held = deferred(sc)
    left = f"; {', '.join(held)} left to {sc['target']}" if held else ""
    out = [f"scope: {sc['kind']}, {sc['reason']}{base}: {', '.join(called(sc)) or 'nothing'}{left}"]
    for m in called(sc):
        out.append(f"  {m:12} {'; '.join(sc['modules'][m]['why'])}")
    for m in held:
        out.append(f"  {m:12} left to {sc['target']}: {'; '.join(sc['modules'][m]['why'])}")
    integration = sc["modules"]["integration"]
    if sc.get("services") and (integration["called"] or integration.get("deferred")):
        out.append(services_line(sc["services"]))
    return out
