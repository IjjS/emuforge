"""A plan leads its issue (issue 478, part 1): the scripts let a plan act on its own issue only, refuse every other
pane what is the pm's, judge a plan-led or harness issue's merges by its lead, and pm-watchd sends the events of a
plan's panes to the plan.

Fixtures are those of test_issue_branch.py (a stand-in herdr that knows no pane, a made-up HOME). A case names the
calling pane by writing the fixture's .pm/run/panes.json and setting HERDR_PANE_ID to that pane's id. Issue 9 is led
by the plan i9-plan (pane P9), issue 5 by the plan i5-plan (pane P5); i9-worker-e1 (pane W9) is a worker of issue 9.
"""
import json
import os
import re
import unittest

from _fixture import CHECKOUT
from _pmroute import route
from test_issue_branch import BRIEFS, HARNESS_PATH, ISSUE_99963, PRODUCT_PATH, IssueCase

PANES = [
    dict(name="i9-plan", issue="9", role="plan", unit=None, side="other", pane_id="P9", gone=False),
    dict(name="i9-worker-e1", issue="9", role="worker", unit="e1", side="engine", pane_id="W9", gone=False),
    dict(name="i9-rev", issue="9", role="rev", unit=None, side="other", pane_id="R9", gone=False),
    dict(name="i5-plan", issue="5", role="plan", unit=None, side="other", pane_id="P5", gone=False),
    dict(name="i5-worker-s1", issue="5", role="worker", unit="s1", side="studio", pane_id="W5", gone=False),
]


class LeadCase(IssueCase):
    group = "lead"
    pane = None  # HERDR_PANE_ID of the caller; None: the pm (no registered pane)

    def fixture(self, row=None, extra=None, **kw):
        co = super().fixture(row, extra, **kw)
        run = co / ".pm" / "run"
        run.mkdir(parents=True, exist_ok=True)
        (run / "panes.json").write_text(json.dumps(PANES))
        (run / "pm.json").write_text(json.dumps(dict(pm_pane="PM0")))
        return co

    def env(self):
        env = super().env()
        env.pop("HERDR_PANE_ID", None)
        if self.pane:
            env["HERDR_PANE_ID"] = self.pane
        return env

    def as_(self, pane, script, *args):
        self.pane = pane
        try:
            return self.script(script, *args)
        finally:
            self.pane = None

    def lead(self, issue, who):
        d = self.co / ".pm" / f"issue-{issue}"
        d.mkdir(parents=True, exist_ok=True)
        (d / "brief.json").write_text(json.dumps(dict(lead=who)))


class Refusals(LeadCase):
    """Each row: the calling pane, the command, words of the one refusal line. Nothing is changed by a refusal."""

    ROWS = {
        "plan-opens-for-another-issue": ("P9", ("pm-pane", "new", 5, "worker", "--unit", "e2"), ("refused", "#9", "#5")),
        "plan-opens-a-plan": ("P9", ("pm-pane", "new", 9, "plan"), ("refused", "a plan opens only")),
        "plan-opens-a-harness-engineer": ("P9", ("pm-pane", "new", 9, "harness-engineer"), ("refused", "a plan opens only")),
        "plan-no-limit": ("P9", ("pm-pane", "new", 9, "worker", "--unit", "e2", "--no-limit"), ("refused", "--no-limit")),
        "plan-closes-another-issue": ("P9", ("pm-pane", "close", "i5-worker-s1"), ("refused", "#5")),
        "plan-closes-itself": ("P9", ("pm-pane", "close", "i9-plan"), ("refused", "not i9-plan")),
        "plan-closes-an-issue": ("P9", ("pm-pane", "close", "--issue", 9), ("refused", "the pm's")),
        "plan-resets-another-issue": ("P9", ("pm-pane", "reset", "i5-plan"), ("refused", "#5")),
        "worker-opens": ("W9", ("pm-pane", "new", 9, "worker", "--unit", "e2"), ("refused", "the pm's", "i9-worker-e1")),
        "rev-closes": ("R9", ("pm-pane", "close", "i9-worker-e1"), ("refused", "the pm's", "i9-rev")),
        "plan-worktree-another-issue": ("P9", ("pm-worktree", "new", 5), ("refused", "#5")),
        "plan-worktree-test-unit": ("P9", ("pm-worktree", "new", 9, "t1"), ("refused", "e<n>", "t1")),
        "plan-worktree-before-issue-branch": ("P9", ("pm-worktree", "new", 9, "e1"), ("refused", "issue branch first")),
        "worker-worktree": ("W9", ("pm-worktree", "new", 9, "e2"), ("refused", "the pm's")),
        "plan-merges-into-main": ("P9", ("pm-merge", 9), ("refused", "the pm's")),
        "plan-merges-another-issue": ("P9", ("pm-merge", 5, "s1"), ("refused", "#5")),
        "worker-merges": ("W9", ("pm-merge", 9, "e1"), ("refused", "the pm's")),
        "plan-briefs-a-plan": ("P9", ("pm-brief", "plan", 9), ("refused", "the pm's")),
        "plan-briefs-a-harness-engineer": ("P9", ("pm-brief", "harness-engineer", 9, "h1", "--part", "x"), ("refused", "the pm's")),
        "plan-briefs-another-issue": ("P9", ("pm-brief", "worker", 5, "s1", "--summary", "x"), ("refused", "#5")),
        "plan-archives": ("P9", ("pm-archive", 9, "--yes"), ("refused", "the pm's")),
        "plan-commits-on-main": ("P9", ("pm-issue", "commit"), ("refused", "the pm's")),
        "plan-takes-a-go-signal": ("P9", ("pm-ready", "take", 7), ("refused", "the pm's")),
        "plan-sets-the-token-target": ("P9", ("pm-tokens", "target", "1M"), ("refused", "the pm's")),
        "plan-stops-the-daemon": ("P9", ("pm-watchd", "stop"), ("refused", "the pm's")),
    }
    SCRIPTS = ("pm-worktree", "pm-scope", "pm-check", "pm-merge", "pm-emulator-dir", "pm-brief", "pm-archive",
               "pm-cost", "pm-pane", "pm-critique", "pm-structure", "pm-issue", "pm-ready", "pm-tokens", "pm-watchd")

    def test_refused(self):
        self.fixture(scripts=self.SCRIPTS)
        for row, (pane, cmd, words) in self.ROWS.items():
            with self.subTest(row=row):
                kept = (self.state(), (self.co / ".pm" / "run" / "panes.json").read_text())
                p = self.as_(pane, *cmd)
                self.assertRefused(p, *words)
                self.assertEqual((self.state(), (self.co / ".pm" / "run" / "panes.json").read_text()), kept)


class PlanActsOnItsIssue(LeadCase):
    def given(self):
        self.fixture()
        self.lead(9, "plan")
        self.ok(self.as_("P9", "pm-worktree", "new", 9))
        self.w9 = self.wt(9)
        self.ok(self.as_("P9", "pm-worktree", "new", 9, "e1"))
        self.e1 = self.wt(9, "e1")
        self.commit(self.e1, [PRODUCT_PATH, HARNESS_PATH], "e1")
        self.record(self.e1, integration="deferred", harness="passed")

    def test_plan_makes_its_worktrees(self):
        self.given()
        units = {(e["issue"], e["unit"], e["branch"], e["base"]) for e in self.registry()}
        self.assertEqual(units, {("9", "issue", "feat/9", "main"), ("9", "e1", "feat/9-e1", "feat/9")})

    def test_plan_merges_its_unit_on_the_fast_check_alone(self):
        self.given()
        p = self.ok(self.as_("P9", "pm-merge", 9, "e1"))
        self.assertTrue(self.is_ancestor("feat/9-e1", "feat/9"))
        self.assertIn("its fast check", p.stdout)

    def test_plan_takes_main(self):
        self.given()
        self.ok(self.as_("P9", "pm-merge", 9, "--take-main"))

    def test_plan_may_not_merge_a_unit_whose_target_is_main(self):
        self.fixture()
        self.ok(self.script("pm-worktree", "new", 9, "e1"))  # by the pm, without an issue branch: target main
        p = self.as_("P9", "pm-merge", 9, "e1")
        self.assertRefused(p, "refused", "into main")

    def test_plan_removes_a_unit_worktree_not_the_issue_worktree(self):
        self.given()
        self.assertRefused(self.as_("P9", "pm-worktree", "rm", self.w9.name), "refused", "pm-archive")
        self.ok(self.as_("P9", "pm-worktree", "rm", self.e1.name))
        self.assertFalse(self.e1.exists())

    def test_plan_gets_past_the_guard_of_pm_pane(self):
        """Opening a worker of its own issue is not refused; the stand-in herdr then makes no tab."""
        self.fixture()
        p = self.as_("P9", "pm-pane", "new", 9, "worker", "--unit", "e2")
        self.assertNotIn("refused", p.stderr + p.stdout)


class Callers(LeadCase):
    def test_pm_pane_and_unknown_callers_have_the_pms_rights(self):
        self.fixture()
        for pane in ("PM0", "NOT-A-PANE", None):
            with self.subTest(pane=pane):
                p = self.as_(pane, "pm-merge", 9, "--dry-run")
                self.assertNotIn("refused", p.stderr)

    def test_queue_answer_to_a_plan_is_remembered(self):
        """A QUEUE answer to a plan writes waiting.json; the pm's QUEUE writes nothing."""
        self.fixture()
        run = self.co / ".pm" / "run"
        full = [dict(p, name=f"x{i}", issue="1", pane_id=f"X{i}") for i, p in enumerate([PANES[1]] * 24)]
        reg = PANES + full
        (run / "panes.json").write_text(json.dumps(reg))
        panes = [dict(pane_id=r["pane_id"], agent="claude") for r in reg]  # every registered pane is alive
        (self.stub / "herdr").write_text("#!/bin/sh\necho '" + json.dumps(dict(result=dict(agents=[], panes=panes, tabs=[]))) + "'\n")
        p = self.as_("P9", "pm-pane", "new", 9, "worker", "--unit", "e2")
        self.assertRefused(p, "QUEUE", "EVENT room i9-plan pane worker engine")
        rows = json.loads((run / "waiting.json").read_text())
        self.assertEqual([(w["asker"], w["role"], w["side"], w["issue"]) for w in rows], [("i9-plan", "worker", "engine", "9")])


class ReviewRule(LeadCase):
    def given(self, who):
        self.fixture(extra={"issues/things-that-do-not-work/9-harness.md": ISSUE_99963.format(id=9)})
        self.lead(9, who)
        self.w9 = self.issue_branch()
        self.s1 = self.unit(9, "s1", [HARNESS_PATH])
        self.record(self.s1, integration="deferred", harness="passed")
        self.ok(self.script("pm-merge", 9, "s1"))
        self.record(self.w9, harness="passed")

    def test_plan_led_issue_branch_needs_the_whole_review(self):
        self.given("plan")
        self.assertRefused(self.script("pm-merge", 9, "--dry-run"), "review-impl-r<k>.md")
        d = self.co / ".pm" / "issue-9"
        (d / "review-impl-r1.md").write_text("verdict: revise\np1: 1\n")
        self.assertRefused(self.script("pm-merge", 9, "--dry-run"), "review-impl-r1.md", "not verdict: pass")
        (d / "review-impl-r2.md").write_text("verdict: pass\np1: 0\n")
        p = self.ok(self.script("pm-merge", 9))
        self.assertIn("reviewed: review-impl-r2.md", p.stdout)

    def test_harness_issue_needs_no_review_file(self):
        self.given("harness-engineer")
        p = self.ok(self.script("pm-merge", 9))
        self.assertIn("the pm's own judgement", p.stdout)

    def test_issue_without_a_lead_keeps_the_unit_rule(self):
        self.fixture()
        self.issue_branch()
        s1 = self.unit(9, "s1", [HARNESS_PATH])
        self.record(s1, integration="deferred", harness="passed")
        self.assertRefused(self.script("pm-merge", 9, "s1", "--dry-run"), "review-impl-s1")


class Route(unittest.TestCase):
    WTS = [dict(name="emuforge-9", path="/x/emuforge-9", issue="9", unit="issue"),
           dict(name="emuforge-9-e1", path="/x/emuforge-9-e1", issue="9", unit="e1"),
           dict(name="emuforge-7-e1", path="/x/emuforge-7-e1", issue="7", unit="e1")]
    REG = PANES + [dict(name="i7-worker-e1", issue="7", role="worker", pane_id="W7", gone=False),
                   dict(name="i9-crit", issue="9", role="crit", pane_id="C9", gone=True),
                   dict(name="i4-harness-engineer", issue="4", role="harness-engineer", pane_id="H4", gone=False)]

    def test_route(self):
        rows = [
            ("EVENT ready i9-worker-e1 UNIT READY i9-worker-e1 feat/9-e1", "i9-plan"),
            ("EVENT ready i9-rev REVIEWED impl r1 verdict=pass", "i9-plan"),
            ("EVENT gone i9-crit", "i9-plan"),
            ("EVENT stale i9-worker-e1 3h", "i9-plan"),
            ("EVENT ctx i9-rev 310K", "i9-plan"),
            ("EVENT check still emuforge-9-e1 engine-test 61m", "i9-plan"),
            ("EVENT check still emuforge-9 integration 61m", "i9-plan"),
            ("EVENT room i9-plan pane worker engine", "i9-plan"),
            ("EVENT room i3-plan pane worker engine", ""),
            ("EVENT room i7-worker-e1 check /x/emuforge-7-e1", "i7-worker-e1"),  # a WAIT answer of pm-check (issue 478)
            ("EVENT room i9-crit check /x/emuforge-9", ""),
            ("EVENT ready i9-worker-e1 BLOCKED i9-worker-e1 memory", None),
            ("EVENT ready i9-worker-e1 BLOCKED i9-worker-e1 cpu", None),
            ("EVENT ready i9-worker-e1 BLOCKED i9-worker-e1 depends emulator image", None),
            ("EVENT ready i9-worker-e1 BLOCKED i9-worker-e1 depends e2 its parser", "i9-plan"),
            ("EVENT ready i9-plan ISSUE READY i9-plan feat/9 report=x", None),
            ("EVENT ready i9-plan BLOCKED i9-plan decision-needed cut", None),
            ("EVENT ctx i9-plan 310K", None),
            ("EVENT gone i9-plan", None),
            ("EVENT ctx pm 900K", None),
            ("EVENT blocked i9-worker-e1", None),
            ("EVENT ready i4-harness-engineer UNIT READY i4-harness-engineer feat/4-h1", None),
            ("EVENT ready i7-worker-e1 UNIT READY i7-worker-e1 feat/7-e1", None),
            ("EVENT check still emuforge-7-e1 engine-test 61m", None),
            ("EVENT mem 23.0GB swap 0/0GB top=i9-worker-e1 3GB", None),
            ("EVENT cpu 95% top=i9-worker-e1 3GB", None),
            ("EVENT go github#7", None),
            ("EVENT tokens over 1M target 1M", None),
        ]
        for line, want in rows:
            with self.subTest(line=line):
                self.assertEqual(route(line, self.REG, self.WTS), want)

    def test_a_gone_plan_hands_its_issue_to_the_pm(self):
        reg = [dict(r, gone=True) if r["name"] == "i9-plan" else r for r in self.REG]
        self.assertIsNone(route("EVENT ready i9-worker-e1 UNIT READY i9-worker-e1 feat/9-e1", reg, self.WTS))


class Templates(LeadCase):
    def test_briefs_fill(self):
        extra = {f".agents/skills/pm/references/briefs/{n}.md": (BRIEFS / f"{n}.md").read_text()
                 for n in ("plan", "rev", "worker", "crit", "harness-engineer")}
        extra["issues/things-that-do-not-work/9-harness.md"] = ISSUE_99963.format(id=9)
        extra["issues/things-that-do-not-work/5-engine.md"] = ISSUE_99963.format(id=5).replace("harness", "engine")
        extra["engine/AGENTS.md"] = extra["engine/references/workflow.md"] = "x\n"
        self.fixture(extra=extra, scripts=("pm-brief", "pm-worktree"))
        self.ok(self.script("pm-brief", "plan", 5))
        self.assertEqual(json.loads((self.co / ".pm" / "issue-5" / "brief.json").read_text())["lead"], "plan")
        self.ok(self.script("pm-worktree", "new", 5))
        self.ok(self.script("pm-worktree", "new", 5, "e1"))
        self.ok(self.as_("P5", "pm-brief", "worker", 5, "e1", "--summary", "the unit"))
        self.ok(self.script("pm-worktree", "new", 9, "h1"))
        self.ok(self.script("pm-brief", "harness-engineer", 9, "h1", "--part", "part one"))
        self.assertEqual(json.loads((self.co / ".pm" / "issue-9" / "brief.json").read_text())["lead"], "harness-engineer")
        for name, issue in (("plan", 5), ("rev", 5), ("e1", 5), ("harness-engineer", 9)):
            with self.subTest(brief=name):
                text = (self.co / ".pm" / f"issue-{issue}" / f"brief-{name}.md").read_text()
                self.assertNotIn("{{", text)
        e1 = (self.co / ".pm" / "issue-5" / "brief-e1.md").read_text()
        self.assertIn("the unit-test scenarios `test-criteria.md` lists for `e1`", e1)
        self.assertIn("part one", (self.co / ".pm" / "issue-9" / "brief-harness-engineer.md").read_text())

    def test_worker_brief_takes_engine_and_studio_units_only(self):
        self.fixture(extra={"issues/things-that-do-not-work/9-harness.md": ISSUE_99963.format(id=9)},
                     scripts=("pm-brief",))
        for unit in ("t1", "h1"):
            with self.subTest(unit=unit):
                self.assertRefused(self.script("pm-brief", "worker", 9, unit, "--summary", "x"), "expected e<n>")


if __name__ == "__main__":
    unittest.main()
