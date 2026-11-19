"""`pm-pane reset` finds the reset marker however a narrow pane wraps it (issue 495, done in issue 497), and tells
each role where its resume note goes (issue 497, PM decision Q5).

Check id `harness.pane-reset`.

A pane lays its reply out at its own width, so in a pane of about 27 columns `RESET READY i486-worker-s2 102730`
reaches the terminal as two rows; the prompt that asked for it is echoed (`❯ …`) with the marker in it and wraps the
same way. `_pmlib.reset_marker_pattern` is the regex `pm-pane reset` gives `herdr pane wait-output` (a Rust regex;
the pattern uses only what Python's `re` reads the same way). The rows below are laid out as Claude Code and Codex
lay them out at that width.

The end-to-end cases run `pm-pane reset` as the pm on the fixture checkout of test_lead.py with a stand-in herdr
whose `pane wait-output` applies the regex it is given to a screen the case writes, and which records the registry
as it was at that moment.
"""
import json
import re
import unittest

import _pmlib
from test_lead import LeadCase

MARKER = "RESET READY i486-worker-s2 102730"
ECHO = "❯ Context reset requested. Write your resume note now to output/state.md: what is done, what is next, open P1s, paths. Then print exactly this line and stop: "


def found(screen, marker=MARKER):
    return re.search(_pmlib.reset_marker_pattern(marker), screen) is not None


class Pattern(unittest.TestCase):
    def test_the_marker_over_two_rows_of_a_narrow_reply_is_found_regression(self):
        self.assertTrue(found("❯ Context reset requested…\n\n⏺ RESET READY\n  i486-worker-s2 102730\n\n❯ \n"))

    def test_the_marker_on_one_row_is_found(self):
        self.assertTrue(found("❯ Context reset requested…\n\n⏺ RESET READY i486-worker-s2 102730\n"))

    def test_the_marker_at_the_end_of_the_screen_is_found(self):
        self.assertTrue(found("⏺ RESET READY i486-worker-s2\n  102730"))

    def test_the_marker_in_a_later_paragraph_of_the_reply_is_found(self):
        self.assertTrue(found("❯ Context reset requested…\n\n⏺ Note written to\n  output/state.md.\n\n  RESET READY\n  i486-worker-s2 102730\n"))

    def test_a_codex_reply_is_found(self):
        self.assertTrue(found("› Context reset requested…\n\n• RESET READY\n  i486-worker-s2 102730\n\n› Ask Codex to do anything\n"))

    def test_the_echo_of_the_prompt_is_not_found_however_it_wraps(self):
        for screen in (
                "⏺ earlier reply\n\n" + ECHO + MARKER + "\n",
                "⏺ earlier reply\n\n❯ Context reset requested.\n  Then print exactly this\n  line and stop:\n  RESET READY\n  i486-worker-s2 102730\n",
                "⏺ earlier reply\n\n❯ Context reset requested.\n  Then print exactly this\n  line and stop: RESET\n  READY i486-worker-s2\n  102730\n",
                "• earlier reply\n\n› Context reset requested.\n  line and stop:\n  RESET READY\n  i486-worker-s2 102730\n"):
            with self.subTest(screen=screen):
                self.assertFalse(found(screen))

    def test_a_tool_row_or_its_result_that_holds_the_marker_is_not_found(self):
        for screen in (
                "⏺ Bash(.pm/bin/pm-report \"RESET READY i486-worker-s2 102730\")\n",
                "⏺ Bash(.pm/bin/pm-report\n      \"RESET READY i486-worker-s2 102730\")\n",
                "⏺ Bash(.pm/bin/pm-report …)\n  ⎿  reported #12:\n     RESET READY\n     i486-worker-s2 102730\n",
                "• Ran pm-report …\n  └ reported #12:\n    RESET READY i486-worker-s2 102730\n"):
            with self.subTest(screen=screen):
                self.assertFalse(found(screen))

    def test_another_nonce_or_pane_or_more_text_on_the_row_is_not_found(self):
        self.assertFalse(found("⏺ RESET READY i486-worker-s2 102731\n"))
        self.assertFalse(found("⏺ RESET READY i486-worker-s3 102730\n"))
        self.assertFalse(found("⏺ RESET READY i486-worker-s2 1027305\n"))
        self.assertFalse(found("⏺ RESET READY i486-worker-s2 102730 done\n"))
        self.assertFalse(found("⏺ I will print RESET READY i486-worker-s2 102730\n"))


class Notes(unittest.TestCase):
    def test_a_worker_and_a_harness_engineer_write_output_state_md(self):
        for role in ("worker", "harness-engineer"):
            with self.subTest(role=role):
                self.assertEqual(_pmlib.state_note(dict(role=role, issue="9")), "output/state.md")

    def test_a_plan_rev_and_crit_write_their_state_file_under_the_issue(self):
        for role in ("plan", "rev", "crit"):
            with self.subTest(role=role):
                self.assertEqual(_pmlib.state_note(dict(role=role, issue="9")),
                                 f"{_pmlib.ROOT}/.pm/issue-9/state-{role}.md")


STAND_IN = r'''#!/usr/bin/env -S python3 -I
import json, os, pathlib, re, sys
args = sys.argv[1:]
log = pathlib.Path(os.environ["HERDR_LOG"])
with log.open("a") as f:
    f.write(json.dumps(args) + "\n")
cleared = pathlib.Path(str(log) + ".cleared")
out = {}
if args[:2] == ["agent", "list"]:
    out = {"agents": [{"name": "i9-harness-engineer", "pane_id": "H9", "agent_status": "idle",
                       "agent_session": {"value": "S2" if cleared.exists() else "S1"}}]}
elif args[:2] == ["agent", "prompt"] and args[3:4] == ["/clear"]:
    cleared.touch()
elif args[:2] == ["pane", "wait-output"]:
    pathlib.Path(str(log) + ".panes-at-wait").write_text(pathlib.Path(os.environ["PANES_FILE"]).read_text())
    regex = args[args.index("--regex") + 1]
    screen = pathlib.Path(os.environ["SCREEN"]).read_text()
    # the marker's nonce is the one pm-pane put into its prompt
    prompt = [json.loads(l) for l in log.read_text().splitlines() if json.loads(l)[:2] == ["agent", "prompt"]][-1][-1]
    nonce = prompt.rsplit(" ", 1)[1]
    if not re.search(regex, screen.replace("NONCE", nonce)):
        sys.exit(1)
elif args[:2] == ["pane", "list"]:
    out = {"panes": [{"pane_id": "H9"}]}
print(json.dumps({"result": out}))
'''


class Reset(LeadCase):
    group = "pane-reset"

    def given(self, screen):
        self.fixture()
        self.run_dir = self.co / ".pm" / "run"
        reg = [dict(name="i9-harness-engineer", issue="9", role="harness-engineer", unit="h1", side="harness",
                    pane_id="H9", gone=False, brief=".pm/issue-9/brief-harness-engineer.md", cwd=str(self.co / "nowhere"),
                    session="S1", kind="claude")]
        (self.run_dir / "panes.json").write_text(json.dumps(reg))
        self.log = self.co / "output" / "herdr.log"
        self.screen = self.co / "output" / "screen.txt"
        self.screen.write_text(screen)
        (self.stub / "herdr").write_text(STAND_IN)
        (self.stub / "herdr").chmod(0o755)

    def env(self):
        return {**super().env(), "HERDR_LOG": str(self.log), "SCREEN": str(self.screen),
                "PANES_FILE": str(self.co / ".pm" / "run" / "panes.json")}

    def calls(self):
        return [json.loads(ln) for ln in self.log.read_text().splitlines()]

    def entry(self):
        return json.loads((self.run_dir / "panes.json").read_text())[0]

    def test_a_marker_wrapped_over_two_rows_resets_the_pane_regression(self):
        self.given("❯ Context reset requested…\n\n⏺ RESET READY\n  i9-harness-engineer NONCE\n\n❯ \n")
        p = self.ok(self.script("pm-pane", "reset", "i9-harness-engineer"))
        self.assertIn("session S1 -> S2", p.stdout)
        prompts = [c[3] for c in self.calls() if c[:2] == ["agent", "prompt"]]
        self.assertEqual(prompts[1], "/clear")
        self.assertIn("resume from the state file", prompts[2])

    def test_a_harness_engineer_is_told_to_write_output_state_md(self):
        self.given("⏺ RESET READY i9-harness-engineer NONCE\n")
        self.ok(self.script("pm-pane", "reset", "i9-harness-engineer"))
        first = next(c[3] for c in self.calls() if c[:2] == ["agent", "prompt"])
        self.assertIn("Write your resume note now to output/state.md:", first)

    def test_the_entry_says_resetting_while_it_waits_and_not_after(self):
        self.given("⏺ RESET READY i9-harness-engineer NONCE\n")
        self.ok(self.script("pm-pane", "reset", "i9-harness-engineer"))
        at_wait = json.loads(pathlib_text(str(self.log) + ".panes-at-wait"))[0]
        self.assertIsInstance(at_wait.get("resetting"), (int, float))
        self.assertNotIn("resetting", self.entry())
        self.assertIn("reset_at", self.entry())

    def test_no_marker_in_a_reply_fails_and_clears_resetting(self):
        self.given("⏺ earlier\n\n❯ Context reset requested.\n  line and stop:\n  RESET READY\n  i9-harness-engineer NONCE\n")
        p = self.script("pm-pane", "reset", "i9-harness-engineer")
        self.assertNotEqual(p.returncode, 0, self.out(p))
        self.assertIn("did not print the reset marker", p.stderr)
        self.assertNotIn("resetting", self.entry())
        self.assertNotIn(["agent", "prompt", "i9-harness-engineer", "/clear"], self.calls())


def pathlib_text(path):
    with open(path) as f:
        return f.read()


if __name__ == "__main__":
    unittest.main()
