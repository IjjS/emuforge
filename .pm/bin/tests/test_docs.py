"""The guides name the structure score tool: the PM skill, the crit brief, critique.md and console-reference.md.

console-reference.md is checked because the owner took decision line 6 (`decisions.md`, owner decisions,
2026-11-15: two runs, seeded and empty, and the formula without the not-applicable items).
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


if __name__ == "__main__":
    unittest.main()
