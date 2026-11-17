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

Which harness test files a run leaves out. The harness step runs every test file under .pm/bin/tests/ but the
on-touch files: the slow ones that have an entry in ON_TOUCH below. An on-touch file runs only when a changed path
matches one of its sources and is left out otherwise; every other test file (an always file, a new one included)
runs whenever the harness is called for. A source of an on-touch file is a tracked file that its cases run or read:
the test file itself and the modules under .pm/bin/tests/ it imports, in turn; the fixture folders its cases read;
every script of .pm/bin/ its cases start, from this checkout or from a copy in a fixture checkout, the scripts
those start and the helpers _pm* any of them imports, directly or through another helper; and any other tracked
file its cases read or execute. A stand-in the test writes itself and a program outside the repository are not
sources. Every entry is asked about every path; no entry hides a path from another. A change of one of EVERY_FILE
(this file, which holds the map and its rules, or the runner .pm/bin/tests/run) or a path no rule of RULES knows
runs every file. A test (test_on_touch.Map) fails when the map is behind what a program can see: a test module or
helper an on-touch file reaches that is not among its sources, a script a source script starts that is not
among them, a name that does not exist. What a program cannot see (which scripts the cases start, which fixtures
and files they read) is written into the entry by the unit that changes the test file and read by rev. Adding a
source needs no decision; adding an entry or taking a source away changes what a run checks and is only done on
the `pm`'s decision, recorded in the issue's decisions.md.
"""
import fnmatch
import os
import re
import subprocess

MODULES = ("engine", "studio", "integration", "harness")  # pm-check's four, in its order
PRODUCT = ("engine", "studio", "integration")
HARNESS = ("harness",)
GIT_TIMEOUT = 30  # seconds; a git that does not answer in time is a change that cannot be read
UNIT_BRANCH = re.compile(r"(feat|refactor|fix)/(\d+)-.+")  # a unit's branch: its issue branch is feat/<id>
DEFERRED = ("integration",)  # what a unit leaves to its issue branch

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


# The paths whose change runs every harness test file: the map and the rules above, and the runner.
EVERY_FILE = (".pm/bin/_pmscope.py", ".pm/bin/tests/run")

# The on-touch files: one entry per slow test file, with its sources in the pattern forms of RULES (and `outside` as
# there) and why it runs when one of them changes. A test file without an entry is an always file. Adding an entry
# or taking a source away is the `pm`'s decision, recorded in the issue's decisions.md; adding a source is not.
_T, _B = ".pm/bin/tests/", ".pm/bin/"
_SCORE = [_B + "_pmbrowse.py", _B + "_pmproc.py", _B + "_pmscore.py", _B + "_pmspec.py"]
_ARCHIVE = [_B + "pm-archive", _B + "pm-cost", _B + "pm-pane", _B + "pm-critique", _B + "pm-structure",
            _B + "_pmlib.py", _B + "_pmquota.py", _B + "_pmtokens.py", *_SCORE]
ON_TOUCH = [
    dict(test="test_capture.py",
         why="pm-structure captures its fixture pages with the Playwright, Vite and Cloudscape Studio installs",
         sources=[_T + "test_capture.py", _T + "fixtures/structure/", _B + "pm-structure",
                  _B + "_pmstructure_capture.mjs", *_SCORE, _B + "_pmlib.py", "studio/package.json",
                  "studio/bun.lock"]),
    dict(test="test_hang.py",
         why="the stand-ins of a capture that hangs and the ending of their process groups",
         sources=[_T + "test_hang.py", _T + "_hang.py", _T + "test_terminate.py", _T + "fixtures/hang/"]),
    dict(test="test_emulator_dir.py",
         why="pm-emulator-dir and the scripts that remove an emulator's port folder, on fixture checkouts",
         sources=[_T + "test_emulator_dir.py", _T + "_fixture.py", _B + "pm-emulator-dir", _B + "pm-merge",
                  _B + "pm-worktree", *_ARCHIVE]),
    dict(test="test_check_issue.py",
         why="pm-check and pm-merge on the issue branch of a fixture checkout",
         sources=[_T + "test_check_issue.py", _T + "test_issue_branch.py", _T + "_fixture.py", _B + "pm-check",
                  _B + "pm-merge", _B + "pm-worktree", _B + "pm-emulator-dir", _B + "_pmlib.py"]),
    dict(test="test_emulator_telemetry.py",
         why="an emulator started from the compose files, and their telemetry setting",
         sources=[_T + "test_emulator_telemetry.py", _T + "_emulator_telemetry.py", _T + "fixtures/emulator-telemetry/",
                  "infra/", "docker-compose.yml", "*compose*.yml", "*compose*.yaml"],
         outside=[".pm/bin/"]),
    dict(test="test_issue_branch.py",
         why="the issue branch and its units through the scripts of a fixture checkout, and the briefs",
         sources=[_T + "test_issue_branch.py", _T + "_fixture.py", _B + "pm-worktree", _B + "pm-scope",
                  _B + "pm-check", _B + "pm-merge", _B + "pm-emulator-dir", _B + "pm-brief", *_ARCHIVE,
                  ".agents/skills/pm/references/briefs/"]),
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


def _of(entry, path):
    return any(_matches(pat, path, entry.get("outside", ())) for pat in entry["sources"])


def harness_tests(paths):
    """{all, why, called: {test: [why]}, left_out: [tests]} for a set of changed paths, from the map alone. `all` is
    true (with `why`, `called` and `left_out` empty) when a path is one of EVERY_FILE or no rule of RULES knows it;
    else each on-touch file is called for, with its entry's sentence, the number of its changed sources and the
    first of them, or left out, in name order. Opens nothing and starts nothing."""
    paths = sorted(set(paths))
    every = next((p for p in paths if p in EVERY_FILE), None)
    if every is not None:
        return dict(all=True, why=f"{every} changed: the map or the runner", called={}, left_out=[])
    unknown = next((p for p in paths if rule_of(p) is None), None)
    if unknown is not None:
        return dict(all=True, why=f"the rules do not know {unknown}", called={}, left_out=[])
    called_for, left_out = {}, []
    for e in ON_TOUCH:
        found = [p for p in paths if _of(e, p)]
        if found:
            called_for[e["test"]] = [f"{e['why']} ({_count(len(found))}, e.g. {found[0]})"]
        else:
            left_out.append(e["test"])
    return dict(all=False, why="", called=called_for, left_out=sorted(left_out))


def _held(checkout, ht):
    """`ht` held to the on-touch files the checkout holds, with their number as `on_touch`. The names come from the
    map, never from a changed path; a file that cannot be seen counts as missing."""
    tests = os.path.join(str(checkout), ".pm", "bin", "tests")
    have = {e["test"] for e in ON_TOUCH if os.path.isfile(os.path.join(tests, e["test"]))}
    return dict(all=ht["all"], why=ht["why"], called={t: w for t, w in ht["called"].items() if t in have},
                left_out=[t for t in ht["left_out"] if t in have], on_touch=len(have))


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


def scope(checkout, full=False, only=None, checks=None):
    """The `scope` object of a pm-check record: kind (checks, only, full, main, diff or unit) and reason, main's
    commit and the merge base when they could be read, the number of changed paths, the target, and per module
    whether it was called for and why. On a unit of an issue branch (kind unit) the integration module its paths
    call for is not called but `deferred`, with the same reasons; the key `deferred` exists on no other module and
    in no other kind. When harness is called for, `harness_tests` holds the selection of its test files:
    harness_tests() of the paths for kinds diff and unit, every file for full and only, held to the on-touch files
    the checkout holds, with their number as `on_touch`. Never raises."""
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
    if modules["harness"]["called"]:
        if kind in ("diff", "unit"):
            ht = harness_tests(paths)
        else:
            why = "--only harness" if kind == "only" else reason
            ht = dict(all=True, why=why, called={}, left_out=[])
        sc["harness_tests"] = _held(checkout, ht)
    return sc


def called(sc):
    """The called-for modules of a scope object, in MODULES order."""
    return [m for m in MODULES if sc["modules"][m]["called"]]


def deferred(sc):
    """The modules of a scope object that are left to the issue branch, in MODULES order."""
    return [m for m in MODULES if sc["modules"][m].get("deferred")]


def lines(sc):
    """The scope as text: `scope: <kind>, <reason> (base <sha>): <modules>`, then one line per called-for module.
    A unit's first line ends `; <modules> left to <target>` when something is deferred, with one line per deferred
    module after the called-for ones. When the scope holds `harness_tests` and the checkout holds an on-touch file,
    one line `  harness tests every file: <why>` or `  harness tests left out: <names or "none">` follows, then one
    line per called-for on-touch file with its reason."""
    base = f" (base {sc['base'][:9]})" if sc.get("base") and sc["kind"] in ("diff", "unit") else ""
    held = deferred(sc)
    left = f"; {', '.join(held)} left to {sc['target']}" if held else ""
    out = [f"scope: {sc['kind']}, {sc['reason']}{base}: {', '.join(called(sc)) or 'nothing'}{left}"]
    for m in called(sc):
        out.append(f"  {m:12} {'; '.join(sc['modules'][m]['why'])}")
    for m in held:
        out.append(f"  {m:12} left to {sc['target']}: {'; '.join(sc['modules'][m]['why'])}")
    ht = sc.get("harness_tests")
    if ht and ht.get("on_touch"):
        if ht["all"]:
            out.append(f"  harness tests every file: {ht['why']}")
        else:
            out.append(f"  harness tests left out: {', '.join(ht['left_out']) or 'none'}")
            for t, why in ht["called"].items():
                out.append(f"    {t}  {'; '.join(why)}")
    return out
