"""pm-brief fills the brief templates of this checkout for a fixture issue and worktree."""
import json
import unittest

from _fixture import CHECKOUT, make, run

BRIEFS = CHECKOUT / ".agents" / "skills" / "pm" / "references" / "briefs"
ISSUE = """Issue-Id: {id}
Issue-Severity: LOW
Issue-Module: {module}
Issue-Kind: bug
Issue-Source: owner
Issue-Key: {module}|x|y
Issue-Check-Ids:
Issue-Commit: 0

# Make the thing work

## Description
"""


def checkout(case):
    files = {f".agents/skills/pm/references/briefs/{n}.md": (BRIEFS / f"{n}.md").read_text() for n in ("plan", "rev", "worker", "crit")}
    files["issues/things-that-do-not-work/1-engine.md"] = ISSUE.format(id=7, module="engine")
    files["issues/things-that-now-work/2-studio.md"] = ISSUE.format(id=8, module="studio")
    files["engine/AGENTS.md"] = files["engine/references/workflow.md"] = "x\n"
    files["studio/AGENTS.md"] = files["studio/references/critique.md"] = "x\n"
    co = make("brief", case, ("pm-brief", "_pmlib.py"), files)
    wts = [dict(issue=str(i), unit=u, path=f"{co}-{i}-{u}", branch=f"feat/{i}-{u}", base=b)
           for i, u, b in ((7, "e1", "main"), (7, "t1", "main"), (8, "s1", "feat/8-t1"), (8, "h1", "main"))]
    (co / ".pm" / "run").mkdir(parents=True, exist_ok=True)
    (co / ".pm" / "run" / "worktrees.json").write_text(json.dumps(wts))
    return co


def brief(co, issue, name):
    return (co / ".pm" / f"issue-{issue}" / f"brief-{name}.md").read_text()


class Brief(unittest.TestCase):
    def test_plan_writes_plan_and_rev(self):
        co = checkout("plan")
        p = run(co, "pm-brief", "plan", 7)
        self.assertEqual(p.returncode, 0, p.stderr)
        plan, rev = brief(co, 7, "plan"), brief(co, 7, "rev")
        for text in (plan, rev):
            self.assertNotIn("{{", text)
            self.assertIn("Make the thing work", text)
            self.assertIn("engine/references/workflow.md", text)
            self.assertIn("issues/things-that-do-not-work/1-engine.md", text)
        self.assertIn("design.md", plan)
        self.assertIn(str(co), plan)

    def test_studio_needs_a_grade_once(self):
        co = checkout("grade")
        p = run(co, "pm-brief", "plan", 8)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("--grade", p.stderr)
        self.assertFalse((co / ".pm" / "issue-8" / "brief-plan.md").exists())
        self.assertEqual(run(co, "pm-brief", "plan", 8, "--grade", "console").returncode, 0)
        self.assertIn("reference spec", brief(co, 8, "plan"))
        p = run(co, "pm-brief", "worker", 8, "s1", "--summary", "The list screen.")
        self.assertEqual(p.returncode, 0, p.stderr)
        text = brief(co, 8, "s1")
        self.assertIn("`specs/`", text)  # the remembered grade
        self.assertIn("based on `feat/8-t1`", text)
        self.assertIn("`studio/AGENTS.md`", text)

    def test_grade_on_an_engine_issue_is_refused(self):
        co = checkout("grade-engine")
        self.assertIn("studio issues", run(co, "pm-brief", "plan", 7, "--grade", "native").stderr)

    def test_worker_blocks_and_close_step(self):
        co = checkout("worker")
        self.assertEqual(run(co, "pm-brief", "worker", 7, "t1", "--summary", "Checks.").returncode, 0)
        self.assertEqual(run(co, "pm-brief", "worker", 7, "e1", "--summary", "Relay.", "--close", "it-relay-1 it-relay-2").returncode, 0)
        t1, e1 = brief(co, 7, "t1"), brief(co, 7, "e1")
        for text in (t1, e1):
            self.assertNotIn("{{", text)
            self.assertNotIn("<!-- block", text)
        self.assertIn("must fail now", t1)
        self.assertNotIn("until it prints `PASSED`", t1)
        self.assertIn("until it prints `PASSED`", e1)
        self.assertIn(f'pm-issue close 7 --checks "it-relay-1 it-relay-2" --in {co}-7-e1', e1)
        self.assertIn("`design.md`", e1)
        self.assertIn("engine/references/security-review.md", e1)
        self.assertIn("the files breakdown.md lists for `e1`", e1)

    def test_harness_unit_of_a_studio_issue_has_no_design_input(self):
        co = checkout("h-unit")
        run(co, "pm-brief", "plan", 8, "--grade", "none")
        self.assertEqual(run(co, "pm-brief", "worker", 8, "h1", "--summary", "Guides.").returncode, 0)
        text = brief(co, 8, "h1")
        self.assertNotIn("design.md", text)
        self.assertIn("does not close the issue", text)

    def test_refusals_write_nothing(self):
        co = checkout("refuse")
        for args, word in ((("worker", 7, "e9", "--summary", "x"), "pm-worktree new"),
                           (("worker", 7, "t1", "--summary", "x", "--close", "a"), "test unit"),
                           (("worker", 7, "x1", "--summary", "x"), "expected t<n>"),
                           (("plan", 99), "no issue file"),
                           (("plan", 7, "--precedent", "3"), "no archive")):
            p = run(co, "pm-brief", *args)
            self.assertNotEqual(p.returncode, 0, args)
            self.assertIn(word, p.stderr)
        self.assertEqual(list((co / ".pm").glob("issue-*/brief-*.md")), [])

    def test_crit(self):
        co = checkout("crit")
        run(co, "pm-brief", "plan", 8, "--grade", "native")
        p = run(co, "pm-brief", "crit", 8, "--targets", "/ and /settings", "--capture-wt", co)
        self.assertEqual(p.returncode, 0, p.stderr)
        text = brief(co, 8, "crit")
        self.assertNotIn("{{", text)
        self.assertIn("Screen grade `native`", text)
        self.assertIn("/ and /settings", text)
        self.assertIn("no screen to score", run(co, "pm-brief", "crit", 7, "--targets", "/", "--capture-wt", co).stderr)
