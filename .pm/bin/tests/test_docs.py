"""The guides say how a Studio screen is judged, and that the structure score is gone.

Issue 478 (owner decisions, `decisions.md`, 2026-11-18): "구조점수는 빼는 방향으로 가자" and "Ui/ux는 강제성 없이
자율성과 impeccable critique에 의존하고싶고". So the structure score, its tool `pm-structure`, the reference specs
(`console-reference.md`) and the screen grade are removed, not moved; a screen is judged by the impeccable critique
alone, once, on the built app: a P0 or P1 finding is fixed, and the score is told and decides nothing. The PM
skill, the crit brief and critique.md say so.

Issue 478 (part 3, the owner's word on effort, 2026-11-18): the guides name `pm-pane new --effort` where they name the
model: the PM skill's session start and scripts table, lead.md's step that opens a worker, pane-mode.md's "Model and
kind"; each says the role defaults that `pm-pane` holds.

Issue 478 (part 3, item 4): before `pm-pane reset` on `EVENT ctx`, the lead reads the pane's state file and, when it
is behind, tells the pane to write it first. lead.md (the plan's events) and the PM skill (the pm's) say so.
"""
import pathlib
import re
import unittest

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
PM = CHECKOUT / ".agents" / "skills" / "pm"
SKILL = PM / "SKILL.md"
LEAD = PM / "references" / "lead.md"
CRIT = PM / "references" / "briefs" / "crit.md"
CRITIQUE = CHECKOUT / "studio" / "references" / "critique.md"


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


def flat(text):
    return " ".join(text.split())


class StructureScoreGone(unittest.TestCase):
    def test_tool_and_reference_specs_are_removed(self):
        self.assertFalse((CHECKOUT / ".pm" / "bin" / "pm-structure").exists())
        self.assertFalse((CHECKOUT / "studio" / "references" / "console-reference.md").exists())
        self.assertFalse((CHECKOUT / "studio" / "references" / "console").exists())

    def test_guides_name_neither_the_score_nor_a_grade(self):
        for path in (SKILL, CRIT, CRITIQUE, LEAD):
            text = path.read_text()
            self.assertNotIn("pm-structure", text, path)
            self.assertNotIn("--grade", text, path)
            self.assertNotIn("{{grade}}", text, path)
            self.assertNotIn("reference spec", text, path)


class PmSkill(unittest.TestCase):
    def test_scripts_table_has_no_structure_row(self):
        scripts = section(SKILL.read_text(), "## Scripts")
        rows = [ln for ln in scripts.splitlines() if ln.startswith("| `")]
        self.assertTrue(any(ln.startswith("| `pm-critique`") for ln in rows), scripts)
        self.assertFalse(any("structure" in ln for ln in rows), scripts)

    def test_report_tells_the_critique_scores_and_they_decide_nothing(self):
        report = flat(section(SKILL.read_text(), "### 3. Report and archive"))
        self.assertIn("pm-critique table", report)
        self.assertIn("deciding nothing", report)


class CritBrief(unittest.TestCase):
    def setUp(self):
        self.text = flat(CRIT.read_text())

    def test_final_on_the_built_app_and_mock_only_when_asked(self):
        self.assertIn("`final`", self.text)
        self.assertIn("built app", self.text)
        self.assertRegex(self.text, r"`mock`, only when the plan asks")

    def test_records_and_checks_and_the_score_decides_nothing(self):
        self.assertIn("pm-critique record", self.text)
        self.assertIn("pm-critique check", self.text)
        self.assertIn("P0 or P1", self.text)
        self.assertIn("decides nothing", self.text)


class Critique(unittest.TestCase):
    def setUp(self):
        self.text = CRITIQUE.read_text()

    def test_judged_once_on_the_built_app_by_the_critique_alone(self):
        head = flat(self.text.split("\n## ", 1)[0])
        self.assertIn("impeccable critique alone", head)
        self.assertIn("once, on the built app", head)
        self.assertIn("impeccable critique에 의존", head)  # the owner's words, 2026-11-18

    def test_p0_p1_fixed_and_the_score_decides_nothing(self):
        point = flat(section(self.text, "## The point"))
        self.assertRegex(point, r"P0 and P1 finding[^.]*fixed")
        self.assertIn("decides nothing", point)

    def test_records_check_fails_on_a_p0_or_p1(self):
        records = flat(section(self.text, "## Records"))
        self.assertIn("pm-critique check", records)
        self.assertRegex(records, r"fails while the last `final` has a P0 or P1")
        self.assertNotIn("structure", records)


class ResetReadsTheStateFile(unittest.TestCase):
    """The EVENT ctx row reads the pane's state file before `pm-pane reset`, and has the pane write it when behind."""

    def row(self, path, event):
        rows = [ln for ln in path.read_text().splitlines() if ln.startswith(f"| `{event}")]
        self.assertEqual(len(rows), 1, (path, event))
        return rows[0]

    def check(self, row):
        self.assertIn("state file first", row)
        self.assertRegex(row, r"behind[^|]*tell the pane[^|]*write it")
        self.assertLess(row.index("state file first"), row.index("pm-pane reset"), row)

    def test_lead(self):
        self.check(self.row(LEAD, "EVENT ctx <pane>"))

    def test_pm_skill(self):
        row = self.row(SKILL, "EVENT ctx <pane>")
        self.check(row)
        self.assertIn("output/state.md", row)  # a harness-engineer's


class EffortNamedWithTheModel(unittest.TestCase):
    PANE_MODE = PM / "references" / "pane-mode.md"

    def test_skill_names_it_beside_the_model_with_the_defaults(self):
        text = SKILL.read_text()
        start = next(b for b in flat(text).split(" 4. ") if "kind and model the owner names" in b)
        self.assertIn("--effort", start)
        self.assertRegex(start, r"`plan`, `rev`, `crit`, `harness-engineer` `high`, `worker` `medium`")
        row = next(ln for ln in section(text, "## Scripts").splitlines() if ln.startswith("| `pm-pane`"))
        self.assertIn("`--model`, `--effort`", row)

    def test_lead_lets_a_plan_pass_it(self):
        text = flat(LEAD.read_text())
        self.assertRegex(text, r"You may pass `--effort [a-z|]+` to any pane you open")
        self.assertRegex(text, r"worker runs at `medium`, `rev` and `crit` at `high`")

    def test_pane_mode_says_the_effort_beside_the_model(self):
        self.assertIn("--effort", section(self.PANE_MODE.read_text(), "## Model and kind"))

    def test_pm_pane_holds_the_same_defaults(self):
        text = (CHECKOUT / ".pm" / "bin" / "pm-pane").read_text()
        self.assertIn('EFFORT_BY_ROLE = {"plan": "high", "rev": "high", "crit": "high", "harness-engineer": "high", '
                      '"worker": "medium"}', text)


if __name__ == "__main__":
    unittest.main()
