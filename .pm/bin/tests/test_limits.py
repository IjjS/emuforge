"""The pane limits of `_pmlib.LIMITS` and the two texts that state them (issue 67, requirement section 9).

`Limits` holds the worker limits at 8 per side and the total of live panes at 24 (H1, H2), the other limits as
they are (H3), and ties `pm-pane`'s help text and the PM skill's sentence to `LIMITS` (H4, H5): a later change of
the numbers in the code or in a text alone fails here. On `main` before the issue the first two cases fail.
"""
import os
import pathlib
import re
import subprocess
import sys
import unittest

from _pmlib import LIMITS, SIDES

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]
SKILL = CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md"
BUILD = "### 3. Build (worker panes and rev)"
SENTENCE = "Worker panes are counted per side:"


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


def per_side():
    """`studio 8, engine 8, tests 8, harness 8`: every side of SIDES with the value of its `_worker` key."""
    return ", ".join(f"{side} {LIMITS[side + '_worker']}" for side in SIDES.values())


def help_text():
    """`pm-pane --help` run as a child process with no herdr session in its environment."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("HERDR_", "GIT_"))}
    return subprocess.run([sys.executable, "-I", str(BIN / "pm-pane"), "--help"], capture_output=True, text=True,
                          env=env, cwd=str(CHECKOUT), timeout=60)


class Limits(unittest.TestCase):
    def test_worker_keys_are_the_four_sides_at_8(self):
        workers = {k: v for k, v in LIMITS.items() if k.endswith("_worker")}
        self.assertEqual(workers, {"studio_worker": 8, "engine_worker": 8, "tests_worker": 8, "harness_worker": 8})

    def test_total_is_24(self):
        self.assertEqual(LIMITS["total"], 24)

    def test_memory_cpu_and_checks_stay(self):
        self.assertEqual((LIMITS["mem_gb"], LIMITS["cpu_pct"], LIMITS["checks"]), (22.5, 90, 2))

    def test_help_states_the_worker_limits_and_the_total(self):
        r = help_text()
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = [line for line in r.stdout.splitlines() if line.startswith("Limits")]
        self.assertEqual(len(lines), 1, r.stdout)
        self.assertIn(f"({per_side()})", lines[0])
        self.assertIn(f"total live panes {LIMITS['total']},", lines[0])

    def test_help_still_states_memory_and_cpu(self):
        r = help_text()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("memory 22.5 GB", r.stdout)
        self.assertIn("CPU 90%", r.stdout)

    def test_skill_sentence_states_the_worker_limits_only(self):
        body = " ".join(part(SKILL.read_text(), BUILD).split())
        start = body.index(SENTENCE)  # ValueError names a missing sentence
        sentence = body[start:body.index(".", start) + 1]
        self.assertEqual(sentence, f"{SENTENCE} {per_side()}.")
        self.assertEqual(re.findall(r"\d+(?:\.\d+)?", sentence),
                         [str(LIMITS[side + "_worker"]) for side in SIDES.values()])


if __name__ == "__main__":
    unittest.main()
