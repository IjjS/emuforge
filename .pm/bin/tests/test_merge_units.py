"""pm-merge: which review lets a unit merge, and what it says about a flaky check run."""
import json
import shutil
import unittest

from _fixture import git, make, run


def unit(co, issue, name, review=None, verdict="pass", flaky=()):
    """A worktree with one commit on feat/<issue>-<name>, a passing pm-check record on it and maybe a review file."""
    path = co.parent / f"{co.name}-{issue}-{name}"
    git(co, "worktree", "add", "-q", "-b", f"feat/{issue}-{name}", str(path), "main")
    (path / f"{name}.txt").write_text("x\n")
    git(path, "add", "-A")
    git(path, "commit", "-q", "-m", name)
    (path / "output" / "checks").mkdir(parents=True)
    (path / "output" / "checks" / "last.json").write_text(json.dumps(
        dict(commit=git(path, "rev-parse", "HEAD"), passed=True, failed=[], flaky=list(flaky))))
    run_dir = co / ".pm" / "run"
    run_dir.mkdir(parents=True, exist_ok=True)
    reg = run_dir / "worktrees.json"
    wts = json.loads(reg.read_text()) if reg.exists() else []
    wts.append(dict(issue=str(issue), unit=name, branch=f"feat/{issue}-{name}", path=str(path), base="main"))
    reg.write_text(json.dumps(wts))
    if review:
        d = co / ".pm" / f"issue-{issue}"
        d.mkdir(exist_ok=True)
        (d / f"review-{review}-{name}-r1.md").write_text(f"verdict: {verdict}\np1: 0\np2: 0\np3: 0\n---\n")
    return path


def checkout(case):
    co = make("merge-units", case, ("pm-merge", "_pmlib.py"))
    for wt in co.parent.glob(f"{co.name}-*"):  # worktrees of an earlier run of this case
        shutil.rmtree(wt)
    return co


class MergeUnits(unittest.TestCase):
    def test_test_unit_merges_on_its_checks_review(self):
        co = checkout("t-alone")
        unit(co, 3, "t1", review="checks")
        p = run(co, "pm-merge", 3, "t1")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("review-checks-t1-r1.md", p.stdout)
        self.assertIn("merge: #3 t1", git(co, "log", "-1", "--format=%s"))

    def test_test_unit_without_any_review_is_refused(self):
        co = checkout("t-none")
        unit(co, 3, "t1")
        p = run(co, "pm-merge", 3, "t1", "--dry-run")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("review-checks-t1", p.stderr)

    def test_failed_checks_review_is_refused(self):
        co = checkout("t-revise")
        unit(co, 3, "t1", review="checks", verdict="revise")
        self.assertIn("not verdict: pass", run(co, "pm-merge", 3, "t1", "--dry-run").stderr)

    def test_implementation_unit_still_needs_its_impl_review(self):
        co = checkout("e-checks-only")
        unit(co, 3, "e1", review="checks")
        p = run(co, "pm-merge", 3, "e1", "--dry-run")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("review-impl-e1", p.stderr)
        self.assertNotIn("review-checks", p.stderr)

    def test_flaky_run_merges_and_is_named(self):
        co = checkout("flaky")
        unit(co, 3, "e1", review="impl", flaky=["engine-test"])
        p = run(co, "pm-merge", 3, "e1")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("flaky in its check run: engine-test", p.stdout)
