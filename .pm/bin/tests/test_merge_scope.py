"""pm-merge asks that the check run covers what the branch's changes call for, and that it saw the `main` it
merges into (issue 52, requirement R7 and R8).

Interface used (design 3.3): the record's steps carry `module`; a module is covered when its entries are all
`absent`, or all `passed` or `flaky`; the coverage refusal says the record `does not cover` the modules. Each
case writes the record of W, a registered worktree of the fixture (see `_fixture.py`) on `feat/7-h1` with one
commit, with a passing `review-impl-h1-r1.md`, and runs the fixture's `pm-merge` with a made-up HOME inside the
fixture, as `test_merge_units.py` does. Every case of `MergeScope` fails on `main`, where `_pmscope.py` and
`pm-scope` do not exist and the fixture cannot be built; the two cases of `EarlierRecord` hold on `main` already.
"""
import json
import shutil
import subprocess
import unittest

from _fixture import BIN, clean_env, git, make, run

SCRIPTS = ("pm-scope", "pm-check", "pm-merge", "pm-emulator-dir", "_pmlib.py", "_pmscope.py")
STEPS = {
    "engine": ["engine-fmt", "engine-clippy", "engine-test"],
    "studio": ["studio-typecheck", "studio-lint", "studio-format", "studio-unit", "studio-build"],
    "integration": ["integration"],
    "harness": ["harness-test"],
}
ALL = tuple(STEPS)
PRODUCT = ("engine", "studio", "integration")
ISSUE = "issues/things-that-do-not-work/a.md"
BRANCH = "feat/7-h1"


def checkout(case, scripts=SCRIPTS):
    co = make("merge-scope", case, scripts)
    wt = co.parent / f"{co.name}-7-h1"
    if wt.exists():  # the worktree of an earlier run of this case
        shutil.rmtree(wt)
    (co / "home").mkdir()
    return co


def write(path, files):
    for rel, text in files.items():
        p = path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)


def as_files(paths):
    return paths if isinstance(paths, dict) else {rel: f"{rel}\n" for rel in paths}


def unit(co, paths, orphan=False):
    """W: a worktree on feat/7-h1 from main with one commit of `paths`, registered, with a passing impl review.
    An orphan W keeps main's files in its index, so its one commit has no parent and W's tree stays clean."""
    w = co.parent / f"{co.name}-7-h1"
    if orphan:
        git(co, "worktree", "add", "-q", "--detach", str(w), "main")
        git(w, "checkout", "-q", "--orphan", BRANCH)
    else:
        git(co, "worktree", "add", "-q", "-b", BRANCH, str(w), "main")
    write(w, as_files(paths))
    git(w, "add", "-A")
    git(w, "commit", "-q", "-m", "h1")
    reg = co / ".pm" / "run"
    reg.mkdir(parents=True, exist_ok=True)
    (reg / "worktrees.json").write_text(json.dumps(
        [dict(issue="7", unit="h1", branch=BRANCH, path=str(w), base="main")]))
    d = co / ".pm" / "issue-7"
    d.mkdir(exist_ok=True)
    (d / "review-impl-h1-r1.md").write_text("verdict: pass\np1: 0\np2: 0\np3: 0\n---\n")
    return w


def main_gains(co, paths):
    """One commit of `paths` on main in the main checkout of the fixture."""
    write(co, as_files(paths))
    git(co, "add", "-A")
    git(co, "commit", "-q", "-m", "main gains")


def record(w, covers=(), absent=(), omit=(), status=None, called=None, modules=True):
    """The pm-check record of W's head: `covers` passed, `absent` modules absent, `omit` modules without entries,
    every other step not-needed; `status` overrides single steps; `called` is what `scope` says was called for
    (default: `covers`); `modules=False` leaves `module` off every entry."""
    steps = []
    for m, names in STEPS.items():
        if m in omit:
            continue
        if m in absent:
            steps.append(dict(name=m, module=m, status="absent", seconds=0, log=None))
            continue
        for n in names:
            st = (status or {}).get(n, "passed" if m in covers else "not-needed")
            steps.append(dict(name=n, module=m, status=st, seconds=0 if st == "not-needed" else 1,
                              log=None if st == "not-needed" else f"output/logs/check-{n}.log"))
    if not modules:
        for s in steps:
            del s["module"]
    called = covers if called is None else called
    scope = dict(kind="diff", reason="changed against main", main=git(w, "rev-parse", "main"),
                 base=merge_base(w),
                 paths=1, modules={m: dict(called=m in called, why=[f"{m} test record"] if m in called else [])
                                   for m in ALL})
    rec = dict(commit=git(w, "rev-parse", "HEAD"), dirty=False, full=False, passed=True, failed=[],
               flaky=[s["name"] for s in steps if s["status"] == "flaky"], scope=scope, steps=steps)
    out = w / "output" / "checks"
    out.mkdir(parents=True, exist_ok=True)
    (out / "last.json").write_text(json.dumps(rec))


def merge_base(w):
    try:
        return git(w, "merge-base", "main", "HEAD")
    except subprocess.CalledProcessError:  # an orphan branch shares no commit with main
        return None


def merge(co, *args):
    """pm-merge in the fixture with HOME set to the fixture's made-up home."""
    return run(co, "pm-merge", *args, env={**clean_env(), "HOME": str(co / "home")})


def line(text, needle):
    found = [ln for ln in text.splitlines() if needle in ln]
    return found[0] if found else ""


class MergeScope(unittest.TestCase):
    def assertMerged(self, co, p):
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(git(co, "log", "-1", "--format=%s", "main"), f"merge: #7 h1 ({BRANCH})")

    def assertRefused(self, co, p, before):
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("cannot merge", p.stderr)
        self.assertEqual(git(co, "rev-parse", "main"), before)

    def assertNames(self, text, *words):
        for word in words:
            self.assertIn(word, text)

    # Given coverage (R7), with main not moved

    def test_covered_dry_run_is_ok(self):
        co = checkout("dry-run")
        record(unit(co, [".pm/bin/a"]), covers=["harness"])
        p = merge(co, 7, "h1", "--dry-run")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("ok to merge", p.stdout)

    def test_covered_merges(self):
        co = checkout("covered")
        record(unit(co, [".pm/bin/a"]), covers=["harness"])
        self.assertMerged(co, merge(co, 7, "h1"))

    def test_not_covered_is_refused(self):
        co = checkout("not-covered")
        record(unit(co, [".pm/bin/a"]))
        before = git(co, "rev-parse", "main")
        p = merge(co, 7, "h1")
        self.assertRefused(co, p, before)
        self.assertNames(line(p.stderr, "pm-check again"), "harness")

    def test_steps_are_trusted_not_scope(self):
        co = checkout("scope-says-nothing")
        record(unit(co, [".pm/bin/a"]), covers=["harness"], called=())
        self.assertMerged(co, merge(co, 7, "h1"))

    def test_flaky_step_covers_and_is_named(self):
        co = checkout("flaky")
        record(unit(co, [".pm/bin/a"]), status={"harness-test": "flaky"})
        p = merge(co, 7, "h1")
        self.assertMerged(co, p)
        self.assertIn("harness-test", p.stdout)

    def test_failed_step_does_not_cover(self):
        co = checkout("failed-step")
        record(unit(co, [".pm/bin/a"]), status={"harness-test": "failed"})
        before = git(co, "rev-parse", "main")
        p = merge(co, 7, "h1")
        self.assertRefused(co, p, before)
        self.assertNames(line(p.stderr, "pm-check again"), "harness")

    def test_absent_product_modules_cover(self):
        co = checkout("absent")
        record(unit(co, ["studio/src/a.tsx"]), absent=PRODUCT)
        self.assertMerged(co, merge(co, 7, "h1"))

    def test_missing_product_entries_are_refused(self):
        co = checkout("no-product-entries")
        record(unit(co, ["studio/src/a.tsx"]), covers=["harness"], omit=PRODUCT)
        before = git(co, "rev-parse", "main")
        p = merge(co, 7, "h1")
        self.assertRefused(co, p, before)
        self.assertNames(line(p.stderr, "pm-check again"), *PRODUCT)

    def test_unknown_path_needs_every_module(self):
        co = checkout("unknown")
        w = unit(co, ["LICENSE"])
        record(w, covers=["harness"])
        before = git(co, "rev-parse", "main")
        p = merge(co, 7, "h1")
        self.assertRefused(co, p, before)
        self.assertNames(line(p.stderr, "pm-check again"), *PRODUCT)
        record(w, covers=ALL)
        self.assertMerged(co, merge(co, 7, "h1"))

    def test_issue_file_needs_nothing(self):
        co = checkout("issue-file")
        record(unit(co, [ISSUE]))
        self.assertMerged(co, merge(co, 7, "h1"))

    def test_scope_without_module_on_steps_is_refused(self):
        co = checkout("no-module")
        record(unit(co, [".pm/bin/a"]), covers=["harness"], modules=False)
        before = git(co, "rev-parse", "main")
        p = merge(co, 7, "h1")
        self.assertRefused(co, p, before)
        self.assertNames(line(p.stderr, "does not cover"), "harness")

    def test_orphan_branch_needs_every_module(self):
        co = checkout("orphan")
        record(unit(co, [".pm/bin/a"], orphan=True), covers=["harness"])
        before = git(co, "rev-parse", "main")
        p = merge(co, 7, "h1", "--dry-run")
        self.assertRefused(co, p, before)
        self.assertNames(line(p.stderr, "does not cover"), *PRODUCT)

    def test_orphan_branch_covered_by_every_module(self):
        co = checkout("orphan-covered")
        record(unit(co, [".pm/bin/a"], orphan=True), covers=ALL)
        p = merge(co, 7, "h1", "--dry-run")
        self.assertEqual(line(p.stderr, "does not cover"), "", p.stdout + p.stderr)

    # Given the main it merges into (R8): main gains one commit of paths G after W left it

    def test_main_gained_an_issue_file(self):
        co = checkout("behind-issue")
        record(unit(co, [".pm/bin/a"]), covers=["harness"])
        main_gains(co, [ISSUE])
        p = merge(co, 7, "h1")
        self.assertMerged(co, p)
        self.assertIn("behind main by 1 path", p.stdout)

    def test_main_gained_product_paths_a_harness_branch_does_not_call_for(self):
        co = checkout("behind-product")
        record(unit(co, [".pm/bin/a"]), covers=["harness"])
        main_gains(co, ["studio/src/b.tsx"])
        p = merge(co, 7, "h1")
        self.assertMerged(co, p)
        self.assertNames(line(p.stdout, "behind main by"), *PRODUCT)

    def test_main_gained_an_unknown_path_and_the_branch_only_an_issue_file(self):
        co = checkout("behind-unknown-issue")
        record(unit(co, [ISSUE]))
        main_gains(co, ["LICENSE"])
        self.assertMerged(co, merge(co, 7, "h1"))

    def test_conflict_let_through_is_still_aborted(self):
        co = checkout("conflict")
        record(unit(co, {ISSUE: "branch\n"}))
        main_gains(co, {ISSUE: "main\n"})
        before = git(co, "rev-parse", "main")
        p = merge(co, 7, "h1")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("merge conflict", p.stderr)
        self.assertEqual(git(co, "rev-parse", "main"), before)
        self.assertEqual(git(co, "status", "--porcelain"), "")


def earlier_record(w):
    """A record of the pm-check before issue 52: no scope, no steps."""
    (w / "output" / "checks").mkdir(parents=True, exist_ok=True)
    (w / "output" / "checks" / "last.json").write_text(json.dumps(
        dict(commit=git(w, "rev-parse", "HEAD"), passed=True, failed=[], flaky=[])))


class EarlierRecord(unittest.TestCase):
    """Guards: hold on main already. The fixture is built without pm-scope and _pmscope.py by name."""

    def fixture(self, case):
        scripts = ("pm-merge", "_pmlib.py") + (("pm-emulator-dir",) if (BIN / "pm-emulator-dir").exists() else ())
        return checkout(case, scripts)

    def test_earlier_record_merges(self):
        co = self.fixture("earlier")
        earlier_record(unit(co, ["h1.txt"]))
        p = merge(co, 7, "h1")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(git(co, "log", "-1", "--format=%s", "main"), f"merge: #7 h1 ({BRANCH})")

    def test_earlier_record_merges_behind_main(self):
        co = self.fixture("earlier-behind")
        earlier_record(unit(co, ["h1.txt"]))
        main_gains(co, ["main.txt"])
        p = merge(co, 7, "h1")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(git(co, "log", "-1", "--format=%s", "main"), f"merge: #7 h1 ({BRANCH})")


if __name__ == "__main__":
    unittest.main()
