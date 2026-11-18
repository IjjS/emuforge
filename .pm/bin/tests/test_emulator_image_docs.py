"""The rules name pm-emulator-image and the run's own image (issue 68, requirement R4; test criteria
`test_emulator_image_docs`).

Check id `harness.emulator-image-docs`. One class per heading of the test criteria. The cases read the PM skill and
pane-mode.md as text, as test_docs.py and test_emulator_dir_guides.py do, and start nothing but `git ls-files`.

A section is the text from its heading to the next heading of the same or a higher level. A sentence is a run of
text of one paragraph, list item or table cell ending at `. ` followed by a capital letter, a backtick or the end;
lines are joined with one space first, so a sentence wrapped over several lines is one sentence. The words a case
looks for are the ones the requirement gives (R4); the wording around them is the guide's.

On a checkout without the change every case fails on the guides' text, but the last case of Panes (the symbolic
links), which holds on main already (guard).
"""
import pathlib
import re
import subprocess
import unittest

CHECKOUT = pathlib.Path(__file__).resolve().parents[3]  # as _fixture.CHECKOUT is computed
SKILL = CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md"
PANE_MODE = CHECKOUT / ".agents" / "skills" / "pm" / "references" / "pane-mode.md"


def section(text, heading):
    """The body of the section under `heading` (a whole heading line such as `## Events`), or None."""
    level = len(heading) - len(heading.lstrip("#"))
    lines = text.splitlines()
    try:
        start = lines.index(heading)
    except ValueError:
        return None
    body = []
    for line in lines[start + 1:]:
        m = re.match(r"(#+) ", line)
        if m and len(m.group(1)) <= level:
            break
        body.append(line)
    return "\n".join(body)


def blocks(text):
    """The paragraphs, list items and table rows of `text`, each with its lines joined by one space."""
    out, cur = [], []
    for line in text.splitlines():
        s = line.strip()
        starts = not s or s.startswith("|") or re.match(r"(\d+\.|[-*]) ", s)
        if starts and cur:
            out.append(" ".join(cur))
            cur = []
        if s.startswith("|"):
            out.append(s)
        elif s:
            cur.append(s)
    if cur:
        out.append(" ".join(cur))
    return out


def sentences(text):
    """Every sentence of `text` (see the module docstring)."""
    out = []
    for b in blocks(text):
        out += [s.strip() for s in re.split(r"(?<=\.)\s+(?=[A-Z`])", b) if s.strip()]
    return out


def numbered_steps(text):
    """The numbered list items of `text` in order, each joined into one line: [(number, text)]."""
    return [(int(m.group(1)), m.group(2)) for m in (re.match(r"(\d+)\. (.*)", b) for b in blocks(text)) if m]


def rows(text):
    """The table rows of `text` that are not the header's rule: [[cell, …]]."""
    out = []
    for b in blocks(text):
        if b.startswith("|") and not re.fullmatch(r"\|[\s|:-]+\|?", b):
            out.append([c.strip() for c in b.strip("|").split("|")])
    return out


NOT_WAIT = re.compile(r"\b(not|never|without)\b[^.]*\bwait", re.I)
NEG = r"\b(no|not|never|nothing|without)\b"
NO_RETRY = re.compile(rf"{NEG}[^.;]*\bretr(y|ies|ied)\b|\bretr(y|ies|ied)\b[^.;]*{NEG}", re.I)


class Skill(unittest.TestCase):
    """R4.1, R4.2: the PM skill."""

    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text()

    def part(self, heading):
        body = section(self.text, heading)
        self.assertIsNotNone(body, f"no heading {heading!r} in {SKILL}")
        return body

    def test_session_start_runs_the_refresh_after_the_daemon_and_does_not_wait(self):
        steps = numbered_steps(self.part("## Session start"))
        watchd = [n for n, s in steps if "pm-watchd start" in s]
        refresh = [(n, s) for n, s in steps if "pm-emulator-image refresh" in s]
        self.assertTrue(watchd, f"no numbered step of `## Session start` starts pm-watchd: {steps}")
        self.assertEqual(len(refresh), 1, f"numbered steps that name `pm-emulator-image refresh`: {refresh}")
        n, step = refresh[0]
        self.assertGreater(n, watchd[0], f"the refresh step {n} does not come after the pm-watchd step {watchd[0]}")
        self.assertRegex(step, NOT_WAIT, "the step does not say the session does not wait for the refresh")

    def test_events_has_a_row_for_refreshed_and_one_for_failed(self):
        table = rows(self.part("## Events"))
        refreshed = [r for r in table if "EVENT emulator-image refreshed" in r[0]]
        failed = [r for r in table if "EVENT emulator-image failed" in r[0]]
        self.assertEqual(len(refreshed), 1, f"rows for EVENT emulator-image refreshed: {refreshed}")
        self.assertEqual(len(failed), 1, f"rows for EVENT emulator-image failed: {failed}")
        does = " | ".join(refreshed[0][1:])
        self.assertIn("`pm-check .`", does)
        self.assertIn("main", does)
        does = " | ".join(failed[0][1:])
        self.assertIn("owner", does)
        self.assertIn("report", does)
        self.assertRegex(does, NO_RETRY, "the failed row does not say it is not retried")

    def test_events_has_a_row_for_a_pane_blocked_on_the_emulator_image(self):
        table = rows(self.part("## Events"))
        found = [r for r in table if "BLOCKED" in r[0] and "depends emulator image" in r[0]]
        self.assertEqual(len(found), 1, f"rows for BLOCKED <name> depends emulator image: {found}")
        does = " | ".join(found[0][1:])
        self.assertIn("pm-emulator-image refresh", does)
        self.assertRegex(does, re.compile(r"\bcheck\b[^|]*\bagain\b", re.I),
                         "the row does not say the pane is told to run its check again")

    def test_next_issue_names_the_refreshed_event_and_not_pinned(self):
        found = [s for s in sentences(self.part("### Next issue")) if "`pm-check .`" in s and "by hand" in s]
        self.assertEqual(len(found), 1, f"sentences that allow `pm-check .` on main by hand: {found}")
        self.assertIn("EVENT emulator-image refreshed", found[0])
        self.assertNotIn("pinned", found[0])

    def test_scripts_has_a_row_for_the_script(self):
        found = [ln for ln in self.part("## Scripts").splitlines() if ln.startswith("| `pm-emulator-image` ")]
        self.assertEqual(len(found), 1, found)


class Panes(unittest.TestCase):
    """R4.3: pane-mode.md, and no rule in the files that are links."""

    @classmethod
    def setUpClass(cls):
        cls.body = section(PANE_MODE.read_text(), "## Emulator")

    def said(self):
        self.assertIsNotNone(self.body, f"no heading `## Emulator` in {PANE_MODE}")
        return sentences(self.body)

    def test_no_pane_builds_or_tags_the_name_and_a_unit_is_checked_on_its_own_image(self):
        said = self.said()
        name = [s for s in said if "`aws-emulator`" in s and re.search(r"\bbuild", s) and re.search(r"\btag", s)
                and re.search(r"\b(no|never|not)\b", s, re.I)]
        self.assertTrue(name, f"no sentence says no pane builds or tags `aws-emulator`: {said}")
        own = [s for s in said if "`infra/aws-emulator/`" in s and "image" in s and re.search(r"\bown\b", s)
               and "check" in s]
        self.assertTrue(own, f"no sentence says a unit that changes `infra/aws-emulator/` is checked on the image "
                             f"its own check run builds: {said}")

    def test_the_machine_refusal_is_reported_as_blocked_depends_emulator_image(self):
        said = self.said()
        found = [s for s in said if "the emulator built for this run is" in s
                 and "BLOCKED <name> depends emulator image" in s]
        self.assertTrue(found, f"no sentence reports the refusal as `BLOCKED <name> depends emulator image`: {said}")

    def test_guard_claude_md_and_claude_skills_are_still_links(self):
        for rel in ("CLAUDE.md", ".claude/skills"):
            self.assertTrue((CHECKOUT / rel).is_symlink(), f"{rel} is not a symbolic link")
            staged = subprocess.run(["git", "-C", str(CHECKOUT), "ls-files", "-s", "--", rel], capture_output=True,
                                    text=True, timeout=30).stdout.split()
            self.assertTrue(staged and staged[0] == "120000", f"{rel} is not tracked as a link: {staged}")


if __name__ == "__main__":
    unittest.main()
