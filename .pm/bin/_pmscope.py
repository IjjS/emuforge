"""Which modules a checkout's changes call for: the rules and the decision. Not a command.

pm-scope prints the decision, pm-check runs the steps it calls for, and pm-merge decides a branch's paths again
with it at the merge. None of them holds a rule of its own. This file imports nothing from _pmlib.py and takes
every path as an argument, so it never reads .pm/run.

A changed path is only ever compared as text with the patterns below: it is never opened, joined to a directory
or put on a command line. git is started as an argument list, without the caller's GIT_* and AWS_* variables and
with a timeout; whatever it cannot answer means every module.
"""
import fnmatch
import os
import subprocess

MODULES = ("engine", "studio", "integration", "harness")  # pm-check's four, in its order
PRODUCT = ("engine", "studio", "integration")
HARNESS = ("harness",)
GIT_TIMEOUT = 30  # seconds; a git that does not answer in time is a change that cannot be read

# The first rule a path matches decides it; a checkout's answer is the union over its paths. A pattern that ends
# in "/" matches every path under that folder; one that holds "*" is matched with fnmatch against the whole path
# ("*" also crosses "/"), except under the folders of `outside`; any other matches that exact path. `nocase`
# lower-cases the path before matching.
RULES = [
    dict(paths=["studio/src/providers/aws/area/styles/root-class.ts"], calls=PRODUCT + HARNESS,
         why="Studio code that a harness test also reads"),
    dict(paths=["studio/package.json", "studio/bun.lock"], calls=PRODUCT + HARNESS,
         why="they install the Playwright and Cloudscape the harness tests run"),
    dict(paths=["studio/references/*.md"], calls=HARNESS,
         why="guides a harness test reads; Prettier leaves the folder out and no product step reads Markdown there"),
    dict(paths=["tests/integration/run", "tests/integration/engine/support/emulator.rs",
                "tests/integration/studio/support/emulator.ts"], calls=PRODUCT + HARNESS,
         why="places that start an emulator, which a harness test asserts on by name"),
    dict(paths=["infra/", "docker-compose.yml", "*compose*.yml", "*compose*.yaml"], outside=[".pm/bin/"],
         calls=PRODUCT + HARNESS,
         why="the integration run builds from infra/ and the root file, and harness tests render and scan them; "
             "a compose file elsewhere is not known to be outside the integration run"),
    dict(paths=["engine/", "studio/", "tests/integration/", "README.md"], calls=PRODUCT,
         why="the engine and Studio steps and the integration checks read them"),
    dict(paths=["*.png", "*.gif", "*.jpg", "*.jpeg"], nocase=True, calls=PRODUCT + HARNESS,
         why="a Studio unit test measures every tracked image; where it lies is not known to be a product path"),
    dict(paths=[".pm/bin/", ".agents/"], calls=HARNESS,
         why="the harness scripts, their tests and the guides those tests read"),
    dict(paths=["issues/things-that-do-not-work/*.md", "issues/things-that-now-work/*.md"], calls=(),
         why="no step reads an issue file; every unit that files or closes an issue changes one"),
    dict(paths=[".github/"], calls=HARNESS,
         why="the workflow, its not-run list and its runner helper under .github/, which a harness test reads; "
             "no pm-check step on this machine reads the folder"),
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


def git(top, *args):
    """git -C <top> <args>: its stdout. Raises Unreadable on a non-zero exit, a timeout or a missing git."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "AWS_"))}
    what = f"git {' '.join(args[:2])}"
    try:
        r = subprocess.run(["git", "-C", str(top), *args], capture_output=True, text=True, env=env,
                           stdin=subprocess.DEVNULL, timeout=GIT_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise Unreadable(f"{what} did not answer in {GIT_TIMEOUT} s") from None
    except OSError as e:
        raise Unreadable(f"{what} could not start ({type(e).__name__})") from None
    if r.returncode != 0:
        raise Unreadable(f"{what} exited {r.returncode}")
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


def merge_base(top, a, b):
    try:
        return git(top, "merge-base", a, b).strip()
    except Unreadable as e:
        raise Unreadable(f"the branch and main share no commit ({e})") from None


def changed(checkout):
    """What counts as changed in a work tree: every path that differs between its commit and the merge base with
    main, and every path with an uncommitted change, untracked files included; a renamed file under both names.
    Returns (paths, head, main, base)."""
    top = os.path.realpath(str(checkout))
    shown = git(top, "rev-parse", "--show-toplevel").strip()
    if not shown or os.path.realpath(shown) != top:
        raise Unreadable(f"{checkout} is not the top of a git work tree")
    head = _rev(top, "HEAD", "the checkout has no commit")
    main = _rev(top, "refs/heads/main", "the checkout has no branch main")
    base = merge_base(top, head, main)
    paths = set(between(top, base, head))
    out = git(top, "status", "--porcelain", "--no-renames", "--untracked-files=all", "-z")
    paths.update(entry[3:] for entry in _names(out))
    return sorted(paths), head, main, base


def scope(checkout, full=False, only=None):
    """The `scope` object of a pm-check record: kind (full, main, diff or only) and reason, main's commit and the
    merge base when they could be read, the number of changed paths, and per module whether it was called for and
    why. Never raises."""
    try:
        paths, head, main, base = changed(checkout)
        failed = None
    except Unreadable as e:
        paths, head, main, base, failed = [], None, None, None, str(e)
    if only:
        kind, reason = "only", f"--only {' '.join(only)}"
        calls = {m: ["--only"] for m in MODULES if m in only}
    elif full:
        kind, reason = "full", "--full"
        calls = {m: [reason] for m in MODULES}
    elif failed:
        kind, reason = "full", f"cannot read the changes: {failed}"
        calls = {m: [reason] for m in MODULES}
    elif base == head:
        kind, reason = "main", "the head has no commit of its own against main; the harness tests are left out"
        calls = {m: [reason] for m in PRODUCT}
    else:
        kind, reason = "diff", f"{_count(len(paths))} changed against main"
        calls = decide(paths)
    return dict(kind=kind, reason=reason, main=main, base=base, paths=len(paths),
                modules={m: dict(called=m in calls, why=calls.get(m, [])) for m in MODULES})


def called(sc):
    """The called-for modules of a scope object, in MODULES order."""
    return [m for m in MODULES if sc["modules"][m]["called"]]


def lines(sc):
    """The scope as text: `scope: <kind>, <reason> (base <sha>): <modules>`, then one line per called-for module."""
    base = f" (base {sc['base'][:9]})" if sc.get("base") and sc["kind"] == "diff" else ""
    out = [f"scope: {sc['kind']}, {sc['reason']}{base}: {', '.join(called(sc)) or 'nothing'}"]
    for m in called(sc):
        out.append(f"  {m:12} {'; '.join(sc['modules'][m]['why'])}")
    return out
