"""The guides name pm-emulator-dir (issue 49, requirement R8). Moved, every case and assertion as it was, from
test_emulator_dir.py (issue 328): the cases read only pane-mode.md and the PM skill, and start nothing.

Check id `harness.emulator-dir`. The cases fail on the guides' text.
"""
import pathlib
import unittest

CHECKOUT = pathlib.Path(__file__).resolve().parents[3]  # as _fixture.CHECKOUT is computed


# ---------------------------------------------------------------------------------------------------- guides

class PaneRule(unittest.TestCase):
    def test_emulator_section_names_both_commands(self):
        """R8"""
        guide = (CHECKOUT / ".agents" / "skills" / "pm" / "references" / "pane-mode.md").read_text()
        self.assertIn("\n## Emulator\n", guide)
        section = guide.split("\n## Emulator\n", 1)[1].split("\n## ", 1)[0]
        self.assertIn("<Root>/.pm/bin/pm-emulator-dir rm --worktree", section)
        self.assertIn("<Root>/.pm/bin/pm-emulator-dir rm --port", section)

    def test_scripts_table_has_one_row(self):
        """R8"""
        guide = (CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md").read_text()
        self.assertIn("\n## Scripts\n", guide)
        section = guide.split("\n## Scripts\n", 1)[1].split("\n## ", 1)[0]
        rows = [ln for ln in section.splitlines() if ln.startswith("| `pm-emulator-dir` |")]
        self.assertEqual(len(rows), 1, rows)


class StoppedRun(unittest.TestCase):
    def test_emulator_section_leaves_a_stopped_run_to_pm_check(self):
        """Issue 342: the leftovers of a stopped integration run are pm-check's to remove, not the pane's."""
        guide = (CHECKOUT / ".agents" / "skills" / "pm" / "references" / "pane-mode.md").read_text()
        section = guide.split("\n## Emulator\n", 1)[1].split("\n## ", 1)[0]
        flat = " ".join(section.split())
        self.assertIn("`pm-check --stop` ends it, `pm-check` removes what the run left", flat)
        self.assertIn("the next `pm-check` of your worktree removes what an earlier stopped run left", flat)
        self.assertIn("you remove none of it by hand", flat)
        self.assertIn("`integration: leftovers of run <id> kept: …`", flat)


if __name__ == "__main__":
    unittest.main()
