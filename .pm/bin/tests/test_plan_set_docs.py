"""An issue led by a plan is reviewed three times: the requirement, then design, test criteria and breakdown as one set
(the plan set, stage `plan-set`), then the implementation (owner, 2026-11-19, issue 519). Read as text like
test_issue_branch_docs.py.

A **part** is the body under a heading up to the next heading of the same or a higher level; a **block** is a
paragraph or a list item on one line (a nested item is a block of its own). Each case is one point of the issue;
each thing it asks is a subTest. Every case failed on the guides as they were before issue 519, when each of the four
stage documents went to rev alone, before the next.
"""
import re
import unittest

from _fixture import CHECKOUT

PM = CHECKOUT / ".agents" / "skills" / "pm"
SKILL = PM / "SKILL.md"
LEAD = PM / "references" / "lead.md"
PANE_MODE = PM / "references" / "pane-mode.md"
REVIEW = PM / "references" / "review-protocol.md"
BRIEFS = PM / "references" / "briefs"
ENGINE_WORKFLOW = CHECKOUT / "engine" / "references" / "workflow.md"
STUDIO_WORKFLOW = CHECKOUT / "studio" / "references" / "workflow.md"
GUIDES = (SKILL, LEAD, PANE_MODE, REVIEW, ENGINE_WORKFLOW, STUDIO_WORKFLOW, CHECKOUT / "AGENTS.md",
          CHECKOUT / ".pm" / "bin" / "pm-brief", *sorted(BRIEFS.glob("*.md")))
SET_LINE = ("`REVIEW plan-set r<k> .pm/issue-<id>/design.md .pm/issue-<id>/test-criteria.md "
            ".pm/issue-<id>/breakdown.md`")


def part(text, heading):
    """The body under the heading line `heading`, up to the next heading of the same or a higher level."""
    lines = text.splitlines()
    start = lines.index(heading)  # ValueError names the missing heading
    level = len(heading) - len(heading.lstrip("#"))
    body = []
    for line in lines[start + 1:]:
        m = re.match(r"(#+) ", line)
        if m and len(m.group(1)) <= level:
            break
        body.append(line)
    return "\n".join(body)


def blocks(text):
    """Paragraphs and list items, each on one line: a blank line or a line starting a list item starts a block."""
    out, cur = [], []
    for line in text.splitlines():
        if not line.strip() or re.match(r"\s*(\d+\.|-) ", line):
            if cur:
                out.append(" ".join(cur))
            cur = [line.strip()] if line.strip() else []
        else:
            cur.append(line.strip())
    if cur:
        out.append(" ".join(cur))
    return out


class Review_protocol(unittest.TestCase):
    def setUp(self):
        self.text = REVIEW.read_text()
        self.round = blocks(part(self.text, "## Round"))

    def test_three_stages(self):
        stage = [b for b in self.round if b.startswith("- `stage` is one of")]
        self.assertEqual(len(stage), 1, self.round)
        with self.subTest("requirement, plan-set, impl and no other"):
            self.assertIn("- `stage` is one of `requirement`, `plan-set`, `impl`:", stage[0])
        with self.subTest("the plan set is the three documents in one line"):
            self.assertIn(SET_LINE, stage[0])
        with self.subTest("one review file, one verdict"):
            self.assertIn("one review file with one verdict", stage[0])
        with self.subTest("design left out where the workflow skips it"):
            self.assertRegex(stage[0], r"skips the design for the issue's kind, the set is the two documents left")

    def test_revise_of_the_set(self):
        revise = [b for b in self.round if b.startswith("- `revise`")]
        self.assertEqual(len(revise), 1, self.round)
        with self.subTest("each P1 names its document"):
            self.assertIn("each P1's location names the document it is in", revise[0])
        with self.subTest("the next round sends and reads the whole set"):
            self.assertRegex(revise[0], r"r<k\+1> sends the whole set again, which rev reads whole")

    def test_three_rounds_hold_for_the_set(self):
        limit = [b for b in self.round if b.startswith("- **Three rounds maximum**")]
        self.assertEqual(len(limit), 1, self.round)
        self.assertIn("for the plan set as for any stage", limit[0])
        self.assertIn("`BLOCKED <lead> review <stage>`", limit[0])

    def test_checklists_of_the_set(self):
        lines = part(self.text, "## Checklists by stage").splitlines()
        top = [ln for ln in lines if re.match(r"- \*\*", ln)]
        with self.subTest("top-level checklists: requirement, plan-set, impl"):
            self.assertEqual([re.match(r"- \*\*([^*]+)\*\*", ln).group(1) for ln in top],
                             ["requirement", "plan-set", "impl"], top)
        nested = [re.match(r"  - \*\*([^*]+)\*\*( \([a-z]+ side\))?", ln) for ln in lines if ln.startswith("  - **")]
        with self.subTest("the plan set holds the four document checklists"):
            self.assertEqual([m.group(1) + (m.group(2) or "") for m in nested],
                             ["design (engine side)", "design (studio side)", "test-criteria", "breakdown"])
        whole = [b for b in blocks(part(self.text, "## Checklists by stage")) if b.startswith("- **plan-set**")]
        with self.subTest("the set is checked for agreeing documents"):
            self.assertRegex(whole[0], r"each unit of `breakdown\.md` is one the design names")
            self.assertRegex(whole[0], r"every criteria line is assigned in `breakdown\.md`")
        with self.subTest("test criteria from the requirement"):
            self.assertIn("the test criteria follow from the requirement", whole[0])


class Lead(unittest.TestCase):
    def setUp(self):
        self.stages = blocks(part(LEAD.read_text(), "## Stages before the build"))

    def test_two_reviews_before_any_code(self):
        self.assertTrue(self.stages[0].startswith("Two reviews by `rev` before any code"), self.stages[0])
        with self.subTest("no review of each document before the next"):
            self.assertEqual([b for b in self.stages if "before the next" in b], [])

    def test_requirement_then_the_set(self):
        steps = [b for b in self.stages if re.match(r"\d+\. ", b)]
        self.assertEqual(len(steps), 2, steps)
        with self.subTest("1: the requirement alone"):
            self.assertIn("`REVIEW requirement r1 .pm/issue-<id>/requirement.md`", steps[0])
        with self.subTest("2: the plan set in one line, after the requirement passes"):
            self.assertTrue(steps[1].startswith("2. On its `pass`, the plan set"), steps[1])
            self.assertIn(SET_LINE.replace("r<k>", "r1"), steps[1])
            self.assertIn("`WAITING i<id>-plan review plan-set r1`", steps[1])
        with self.subTest("a revise sends the whole set again"):
            self.assertIn("send the whole set again as r<k+1>", steps[1])
        docs = [b for b in self.stages if b.startswith("- `")]
        with self.subTest("the set's documents"):
            self.assertEqual([b.split("`")[1] for b in docs], ["design.md", "test-criteria.md", "breakdown.md"])
        with self.subTest("test criteria from the requirement"):
            self.assertTrue(docs[1].startswith("- `test-criteria.md`, from the requirement"), docs[1])
        with self.subTest("the build starts on the set's pass"):
            self.assertIn("On the plan set's `pass`, the build starts.", self.stages)


class Workflows_and_guides(unittest.TestCase):
    def test_module_workflows_name_the_plan_set(self):
        for path in (ENGINE_WORKFLOW, STUDIO_WORKFLOW):
            text = " ".join(blocks(path.read_text()))
            with self.subTest(path.parent.parent.name):
                self.assertIn("reviewed by `rev` twice before the build: the requirement alone, then design, test "
                              "criteria and breakdown as one set, the plan set (`lead.md`)", text)
                self.assertNotRegex(text, r"reviewed by `rev` one at a time|reviewed by `rev` before the next")
        with self.subTest("studio design: stage plan-set"):
            self.assertIn("(stage `plan-set`)", STUDIO_WORKFLOW.read_text())
            self.assertNotIn("(stage `design`)", STUDIO_WORKFLOW.read_text())

    def test_no_review_of_one_planning_document(self):
        for path in GUIDES:
            text = path.read_text()
            with self.subTest(str(path.relative_to(CHECKOUT))):
                self.assertEqual(re.findall(r"REVIEW (?:design|test-criteria|breakdown)\b|review-(?:design|"
                                            r"test-criteria|breakdown)-r", text), [])

    def test_batch_reviews_three_times(self):
        text = " ".join(blocks(SKILL.read_text()))
        self.assertIn("reviews the requirement, the plan set and the implementation once each for the whole batch",
                      text)


if __name__ == "__main__":
    unittest.main()
