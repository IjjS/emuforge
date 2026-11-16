"""The guides name the structure score tool: the PM skill, the crit brief, critique.md and console-reference.md.

console-reference.md is checked because the owner took decision line 6 (`decisions.md`, owner decisions,
2026-11-15: two runs, seeded and empty, and the formula without the not-applicable items).

Issue 8 (requirement 9): "Format" lists the kinds without `dashboard`, says how a dashboard is written, and defines
the wizard blocks, either as the YAML of requirement 3 (`steps:` whose entries start with `- title:` followed by
`sections:`) or in prose (`steps` (each with `title` and `sections`)); "Structure score" says how a wizard is opened
and scored.

Issue 21 (design 2.5): "Structure score" step 1 (the list item `1.`) names the area root's class `aws-area` and says
that a page without exactly one such element (none, or more than one) is an error, not a score.

Issue 46 (R5.1 to R5.4): "Format"'s example omits no action; the passage on `omitted` (from the first block of
"Format" that names `` `omitted` `` to the end of the section) says what the mark is for, what can never carry
it, who sets it and on what evidence; "Structure score" says a shown omitted item fails the run and names
`omitted=` on the first line; critique.md's pass line and "Records" name them.
"""
import pathlib
import re
import unittest

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
SKILL = CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md"
CRIT = CHECKOUT / ".agents" / "skills" / "pm" / "references" / "briefs" / "crit.md"
CRITIQUE = CHECKOUT / "studio" / "references" / "critique.md"
CONSOLE = CHECKOUT / "studio" / "references" / "console-reference.md"


def section(text, heading):
    """The body of the markdown section whose heading line is `heading`, up to the next heading of any level."""
    lines = text.splitlines()
    start = lines.index(heading)  # ValueError names the missing heading
    body = []
    for line in lines[start + 1:]:
        if line.startswith("#"):
            break
        body.append(line)
    return "\n".join(body)


def blocks(text):
    """Paragraphs and list items: a blank line or a line starting a list item (`1.`, `-`) starts a new block."""
    out, cur = [], []
    for line in text.splitlines():
        if not line.strip() or re.match(r"(\d+\.|-) ", line):
            if cur:
                out.append("\n".join(cur))
            cur = [line] if line.strip() else []
        else:
            cur.append(line)
    if cur:
        out.append("\n".join(cur))
    return out


class Guides(unittest.TestCase):
    def test_pm_skill(self):
        text = SKILL.read_text()
        scripts = section(text, "## Scripts")
        self.assertTrue(any(ln.startswith("| `pm-structure`") for ln in scripts.splitlines()), scripts)
        report = section(text, "### 6. Report and archive")
        self.assertIn("pm-structure --table", report)
        not_built = section(text, "## Not built yet")
        self.assertNotIn("structure score", not_built.lower())

    def test_crit_brief(self):
        """The step (list item or paragraph) that runs pm-structure with --record is about `console` screens and
        names both states: `seeded` (the default) and `--state empty`."""
        step = next((s for s in blocks(CRIT.read_text()) if "pm-structure" in s and "--record" in s), None)
        self.assertIsNotNone(step, "no step of crit.md names pm-structure with --record")
        self.assertIn("console", step)
        self.assertIn("seeded", step)
        self.assertIn("--state empty", step)

    def test_critique_records(self):
        records = section(CRITIQUE.read_text(), "## Records")
        self.assertIn("structure-scores.json", records)
        self.assertIn("pm-structure --record", records)

    def test_console_reference_two_runs_and_formula(self):
        score = section(CONSOLE.read_text(), "## Structure score")
        flat = " ".join(score.split())
        self.assertRegex(flat, r"structure score = matched[^/]*/ \(all[^)]*- omitted[^)]*- not[- ]applicable")
        self.assertIn("seeded", score)
        self.assertIn("empty", score)


class WizardAndDashboardGuide(unittest.TestCase):
    def setUp(self):
        text = CONSOLE.read_text()
        self.format = section(text, "## Format")
        self.score = section(text, "## Structure score")

    def test_kinds_without_dashboard_and_dashboard_as_detail(self):
        self.assertIn("table | detail | form | wizard", self.format)
        self.assertNotRegex(self.format, r"\|\s*dashboard")
        said = [b for b in blocks(self.format) if "dashboard" in b.lower()]
        self.assertTrue(any("kind: detail" in b and "header" in b and "sections" in b for b in said), said)

    def test_wizard_blocks(self):
        flat = " ".join(self.format.split())
        yaml = re.search(r"\n\s*steps:[^\n]*\n\s*- title:[^\n]*\n\s*sections:", self.format)
        prose = "`steps` (each with `title` and `sections`)" in flat
        self.assertTrue(yaml or prose, self.format)
        self.assertRegex(self.format, r"`submit`|\bsubmit:")

    def test_wizard_opened_per_shown_step_and_scored_per_step(self):
        flat = " ".join(self.score.split())
        self.assertIn("?step=<k>", flat)
        self.assertRegex(flat, r"once per shown step|each shown step|every shown step")
        self.assertTrue(any("Studio" in b and "?step=<k>" in b and "wizard" in b for b in blocks(self.score)),
                        self.score)
        self.assertIn("step's tree", flat)



class AreaRootGuide(unittest.TestCase):
    def test_step_1_names_the_area_class_and_the_error(self):
        steps = [b for b in blocks(section(CONSOLE.read_text(), "## Structure score")) if b.startswith("1. ")]
        self.assertEqual(len(steps), 1, steps)
        flat = " ".join(steps[0].split())
        self.assertIn("`aws-area`", flat)
        self.assertRegex(flat, r"exactly one|more than one")
        self.assertRegex(flat, r"\berror\b")
        self.assertIn("not a score", flat)



def flat(text):
    return " ".join(text.split())


class OmittedGuide(unittest.TestCase):
    def setUp(self):
        text = CONSOLE.read_text()
        self.format = section(text, "## Format")
        self.score = section(text, "## Structure score")
        found = [b for b in blocks(self.format) if "`omitted`" in b]
        self.assertTrue(found, self.format)
        self.passage = flat(self.format[self.format.index(found[0]):])

    def test_example_omits_no_action(self):
        example = re.search(r"```yaml\n(.*?)```", self.format, re.S).group(1)
        lines = example.splitlines()
        start = next(i for i, ln in enumerate(lines) if ln.startswith("omitted:"))
        block = [lines[start]] + [ln for ln in lines[start + 1:] if ln.startswith((" ", "-"))]
        self.assertNotIn("header.actions", "\n".join(block), example)
        actions = next(ln for ln in lines if ln.strip().startswith("actions:"))
        self.assertIn("Copy ARN", actions)

    def test_passage_says_what_the_mark_is_for_and_who_sets_it(self):
        text = self.passage
        self.assertRegex(text, r"emulator (does not have|doesn't have|lacks|has no)")
        for word in ("title", "action", "column", "submit"):
            self.assertIn(word, text)
        self.assertRegex(text, r"\b(never|cannot)\b")
        self.assertRegex(text, r"\brev\b")
        self.assertRegex(text, r"(?i)screen stage")
        self.assertIn("501", text)
        self.assertRegex(text, r"(?i)empty list[^.]*not[^.]*evidence|not[^.]*evidence[^.]*empty list")
        self.assertRegex(text, r"(?i)not built yet\W*\s*is not a reason")

    def test_passage_drops_the_real_account_reason(self):
        self.assertNotIn("no meaning without a real account", self.passage.lower())

    def test_structure_score_says_shown_fails_and_names_the_count(self):
        bs = [flat(b) for b in blocks(self.score)]
        self.assertTrue(any("omitted" in b and re.search(r"\bshow(s|n)?\b", b) and re.search(r"\bfails?\b", b)
                            for b in bs), self.score)
        self.assertTrue(any("omitted=" in b and "first line" in b for b in bs), self.score)


class OmittedCritique(unittest.TestCase):
    def test_pass_line_names_an_omitted_item_shown(self):
        console = section(CRITIQUE.read_text(), "## `console` screens")
        bullets = [flat(b) for b in blocks(console) if b.startswith("- ") and "90" in b]
        self.assertEqual(len(bullets), 1, console)
        self.assertIn("omitted", bullets[0])
        self.assertRegex(bullets[0], r"\bshown\b")

    def test_records_say_a_row_carries_the_omitted_count(self):
        records = flat(section(CRITIQUE.read_text(), "## Records"))
        self.assertIn("omitted", records)
        self.assertRegex(records, r"\b(number|count|how many)\b")


if __name__ == "__main__":
    unittest.main()
