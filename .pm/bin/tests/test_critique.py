"""pm-critique check (issue 478, part 3): the score decides nothing; only a P0 or P1 finding of the last final does.

Each case records snapshots with a fixture checkout's own copy of `pm-critique` (its `_pmlib.py` takes the fixture
as its ROOT, so `.pm/issue-<n>/critique-scores.json` is written there) and reads the exit status of `check`.
"""
import unittest

from _fixture import make, run

SNAPSHOT = """---
target: /aws/s3/buckets
total_score: {total}
max_score: 40
p0_count: {p0}
p1_count: {p1}
---

# Critique
"""


class Check(unittest.TestCase):
    def setUp(self):
        self.co = make("critique", self.id().rsplit(".", 1)[-1], ("pm-critique",))

    def record(self, phase, total, p0=0, p1=0):
        path = self.co / "output" / f"{phase}-{total}-{p0}-{p1}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(SNAPSHOT.format(total=total, p0=p0, p1=p1))
        p = run(self.co, "pm-critique", "record", 9, phase, path)
        self.assertEqual(p.returncode, 0, p.stderr)

    def check(self):
        return run(self.co, "pm-critique", "check", 9)

    def test_a_final_without_p0_or_p1_passes_whatever_its_score(self):
        self.record("mock", 36)
        self.record("final", 12)
        p = self.check()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("| final | 12/40 | 0 | 0 |", p.stdout)

    def test_a_p1_in_the_last_final_fails(self):
        self.record("final", 38, p1=1)
        p = self.check()
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("final has P0=0 P1=1", p.stdout)

    def test_a_p0_in_the_last_final_fails(self):
        self.record("final", 38, p0=1)
        self.assertEqual(self.check().returncode, 1)

    def test_the_last_final_decides_once_the_findings_are_fixed(self):
        self.record("final", 30, p1=2)
        self.record("final", 28)
        self.assertEqual(self.check().returncode, 0)

    def test_no_final_is_not_a_pass(self):
        self.record("mock", 30)
        p = self.check()
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("no final score yet", p.stderr)


if __name__ == "__main__":
    unittest.main()
