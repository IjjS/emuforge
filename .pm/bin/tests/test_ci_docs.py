"""The rules say that GitHub Actions checks `main` at each push (issue 53, R5 and R7), read as text like test_docs.py.

`Skill` reads the PM skill and `references/archive.md`; `Root_and_readme` reads root `AGENTS.md`, `README.md` and
`tests/integration/AGENTS.md`. Every case but the last of `Root_and_readme` fails on the rules as they were before
the issue: the skill still runs `pm-check .` on `main` at a merge and before the push, and names no run.

What a failed run becomes follows `decisions.md` (owner decision of 2026-11-16 and the PM decision after it): an
issue file that waits for the owner's signal, not one taken ahead of other work, so the case asserts the signal
where test-criteria.md's line says "ahead of".
"""
import pathlib
import re
import unittest

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
PM = CHECKOUT / ".agents" / "skills" / "pm"
SKILL = PM / "SKILL.md"
ARCHIVE = PM / "references" / "archive.md"
ROOT = CHECKOUT / "AGENTS.md"
README = CHECKOUT / "README.md"
INTEGRATION = CHECKOUT / "tests" / "integration" / "AGENTS.md"
BADGE = "https://github.com/IjjS/emuforge/actions/workflows/main.yml/badge.svg?branch=main"
RUNS = "https://github.com/IjjS/emuforge/actions/workflows/main.yml"
PM_CHECK = "`pm-check .`"


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


def sentences(text):
    """The sentences of `text`, each on one line: a block ends one, and so does `.`, `!` or `?` before a space."""
    out = []
    for b in blocks(text):
        out.extend(s for s in re.split(r"(?<=[.!?])\s+", b) if s)
    return out


def flat(text):
    return " ".join(text.split())


class Skill(unittest.TestCase):
    def setUp(self):
        self.text = SKILL.read_text()
        self.merge = part(self.text, "### 2. Close (you)")
        self.report = part(self.text, "### 3. Report and archive")

    def pointed_to(self):
        """Section 6 and what it points to: a reference file it names, a section of the skill it names in quotes,
        as a link or in bold."""
        texts = [self.report]
        for name in re.findall(r"references/[\w-]+\.md", self.report):
            texts.append((PM / name).read_text())
        for line in self.text.splitlines():
            m = re.match(r"#+ (?:\d+\. )?(.+)$", line)
            if m and line != "### 3. Report and archive":
                title = m.group(1).strip()
                if any(f"{o}{title}{c}" in self.report for o, c in (('"', '"'), ("[", "]"), ("**", "**"))):
                    texts.append(part(self.text, line))
        return texts

    def test_merge_needs_the_units_own_passing_record(self):
        self.assertNotIn("It must pass.", flat(self.merge))
        said = [s for s in sentences(self.merge) if "pm-merge" in s
                and re.search(r"\bown\b[^.]*\bpass(ing|ed)?\b[^.]*\brecord\b|\bpassing record\b", s)]
        self.assertTrue(said, self.merge)

    def test_push_then_read_the_run(self):
        report = flat(self.report)
        self.assertNotIn(f"the last {PM_CHECK} a pass", report)
        push = report.find("git push origin main")
        self.assertGreaterEqual(push, 0, report)
        after = report[push:]
        self.assertIn("gh run list --workflow main.yml --commit", after)
        self.assertTrue(any("gh run watch" in b and "background" in b for b in blocks(after)), after)
        self.assertTrue(any("gh run view" in b and "--log-failed" in b for b in blocks(after)), after)

    def test_one_sentence_runs_the_full_check_on_main_by_hand(self):
        said = [s for s in sentences(self.text) if PM_CHECK in s and re.search(r"\bmain\b", s)]
        self.assertEqual(len(said), 1, said)
        self.assertIn("by hand", said[0])
        self.assertRegex(said[0], r"owner('s)? (asks|request|word)|owner asks|asked by the owner|owner's request")
        self.assertRegex(said[0], r"emulator('s)? version|version of the emulator|emulator image version")

    def test_next_issue_and_intermittent_failures_name_the_run(self):
        nxt = blocks(part(self.text, "### Next issue"))
        self.assertTrue(any("--source finder" in b and re.search(r"\brun\b", b)
                            and re.search(r"workflow|GitHub Actions|main\.yml", b) for b in nxt), nxt)
        flaky = [b for b in blocks(self.text) if "Intermittent failures" in b]
        self.assertEqual(len(flaky), 1, flaky)
        self.assertIn("(second run)", flaky[0])
        self.assertRegex(flaky[0], r"run's url|url of the run|run url")

    def test_archive_first_paragraph_does_not_run_the_full_check(self):
        first = blocks(part(ARCHIVE.read_text(), "# Archive"))[0]
        self.assertNotIn(PM_CHECK, first)


class Root_and_readme(unittest.TestCase):
    def test_root_agents(self):
        text = ROOT.read_text()
        row = [ln for ln in text.splitlines() if ln.startswith("| `pm` |")]
        self.assertEqual(len(row), 1, row)
        self.assertNotIn("runs the full check suite", row[0])
        branches = part(text, "## Branches and main")
        self.assertNotIn("the checks passing on `main`", flat(branches))
        self.assertIn("GitHub Actions", flat(branches))
        self.assertTrue(any(re.search(r"\bfail(ed|s|ing)?\b[^.]*\brun\b|\brun\b[^.]*\bfails\b", s)
                            and "issue file" in s for s in sentences(branches)), branches)

    def test_readme_develop(self):
        develop = part(README.read_text(), "## Develop")
        for word in ("GitHub Actions", "Ubuntu", ".github/not-run.json"):
            self.assertIn(word, flat(develop))
        badge = rf"\[!\[[^\]]*\]\({re.escape(BADGE)}\)\]\({re.escape(RUNS)}\)"
        self.assertRegex(develop, badge)

    def test_integration_guide_keeps_the_not_run_verdict(self):  # guard: passes on main once h1 is merged
        verdicts = part(INTEGRATION.read_text(), "## Verdicts")
        row = [ln for ln in verdicts.splitlines() if ln.startswith("| `not-run` |")]
        self.assertEqual(len(row), 1, verdicts)
        self.assertIn("never", row[0])
        self.assertIn("`pm`", row[0])


if __name__ == "__main__":
    unittest.main()
