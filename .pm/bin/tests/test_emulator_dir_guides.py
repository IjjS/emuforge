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


if __name__ == "__main__":
    unittest.main()
