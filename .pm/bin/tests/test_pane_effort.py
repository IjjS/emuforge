"""`pm-pane new --effort` (issue 478, part 3; owner, 2026-11-18: "Pane이나 탭 같이 에이전트 하위로 시작할 때 effort
넣게 해줘라!!").

The effort goes to the agent as the model does: for Claude Code `--effort <level>` after the `--` of `herdr agent
start`. The registry remembers it and a pane opened again gets the same; without the option and without a
remembered one, a pane gets its role's (PM decision, issue 478 decisions.md: plan, rev, crit, harness-engineer
`high`, worker `medium`). A Codex pane ignores the option with one line saying so. A plan may pass it for its own
panes.

Fixture: the checkout of test_issue_branch.py (via test_lead.LeadCase) with a stand-in herdr that knows one tab-less
machine, makes tab T1 holding the shell pane PX, and writes the arguments of every call to a log. The pm runs
`pm-pane new … --no-limit`, so the machine's room is not read.
"""
import json
import unittest

from test_lead import PANES, LeadCase

STAND_IN = r'''#!/usr/bin/env -S python3 -I
import json, os, sys
args = sys.argv[1:]
with open(os.environ["HERDR_LOG"], "a") as f:
    f.write(json.dumps(args) + "\n")
made = os.path.exists(os.environ["HERDR_LOG"] + ".tab")
if args[:2] == ["tab", "create"]:
    open(os.environ["HERDR_LOG"] + ".tab", "w").close()
    out = {"tab": {"tab_id": "T1"}}
elif args[:2] == ["tab", "list"]:
    out = {"tabs": [{"tab_id": "T1", "label": "#9"}] if made else []}
elif args[:2] == ["pane", "list"]:
    out = {"panes": [{"pane_id": "PX", "tab_id": "T1"}] if made else []}
else:
    out = {"agents": []}
print(json.dumps({"result": out}))
'''


class Effort(LeadCase):
    group = "pane-effort"

    def given(self, history=(), registry=None):
        self.fixture()
        run = self.co / ".pm" / "run"
        (run / "panes.json").write_text(json.dumps(registry or []))
        (run / "panes-history.jsonl").write_text("".join(json.dumps(h) + "\n" for h in history))
        self.log = self.co / "output" / "herdr.log"
        (self.stub / "herdr").write_text(STAND_IN)
        (self.stub / "herdr").chmod(0o755)

    def env(self):
        return {**super().env(), "HERDR_LOG": str(self.log)}

    def new(self, *args):
        p = self.script("pm-pane", "new", 9, *args, "--no-limit")
        self.ok(p)
        return p

    def start(self):
        """The arguments after `--` of the one `herdr agent start` call."""
        calls = [json.loads(ln) for ln in self.log.read_text().splitlines()]
        starts = [c for c in calls if c[:2] == ["agent", "start"]]
        self.assertEqual(len(starts), 1, calls)
        c = starts[0]
        return c[c.index("--") + 1:] if "--" in c else []

    def entry(self, name):
        reg = json.loads((self.co / ".pm" / "run" / "panes.json").read_text())
        return next(r for r in reg if r["name"] == name)

    def test_effort_goes_to_claude_as_the_model_does_and_is_remembered(self):
        self.given()
        p = self.new("worker", "--unit", "e2", "--effort", "xhigh")
        self.assertEqual(self.start(), ["--model", "claude-opus-5-5", "--effort", "xhigh"])
        self.assertEqual(self.entry("i9-worker-e2")["effort"], "xhigh")
        self.assertIn("effort=xhigh", p.stdout)

    def test_defaults_by_role(self):
        for role, unit, want in (("plan", None, "high"), ("rev", None, "high"), ("crit", None, "high"),
                                 ("harness-engineer", "h1", "high"), ("worker", "s1", "medium")):
            with self.subTest(role=role):
                self.given()
                self.new(role, *(("--unit", unit) if unit else ()))
                self.assertEqual(self.start()[-2:], ["--effort", want])

    def test_a_pane_opened_again_gets_the_same(self):
        """From its gone registry entry, and after a close (no entry) from its last history line."""
        gone = dict(name="i9-worker-e2", issue="9", role="worker", unit="e2", kind="claude", side="engine",
                    pane_id="OLD", tab_id="T0", cwd="/nowhere", gone=True, effort="low")
        for case, given in (("registry", dict(registry=[gone])),
                            ("history", dict(history=[dict(gone, effort="max"), dict(gone, effort="low")]))):
            with self.subTest(case=case):
                self.given(**given)
                self.new("worker", "--unit", "e2")
                self.assertEqual(self.start()[-2:], ["--effort", "low"])
                self.assertEqual(self.entry("i9-worker-e2")["effort"], "low")

    def test_the_option_wins_over_the_remembered_effort(self):
        self.given(history=[dict(name="i9-rev", effort="low")])
        self.new("rev", "--effort", "max")
        self.assertEqual(self.start()[-2:], ["--effort", "max"])

    def test_codex_ignores_it_in_one_line(self):
        self.given()
        p = self.new("worker", "--unit", "e2", "--kind", "codex", "--effort", "high")
        self.assertNotIn("--effort", self.start())
        lines = [ln for ln in (p.stdout + p.stderr).splitlines() if "effort" in ln and "ignored" in ln]
        self.assertEqual(len(lines), 1, p.stdout + p.stderr)
        self.assertIsNone(self.entry("i9-worker-e2")["effort"])

    def test_an_unknown_level_is_refused(self):
        self.given()
        p = self.script("pm-pane", "new", 9, "worker", "--unit", "e2", "--effort", "huge", "--no-limit")
        self.assertNotEqual(p.returncode, 0)
        self.assertFalse(self.log.exists() and any('"start"' in ln for ln in self.log.read_text().splitlines()))

    def test_a_plan_may_pass_it_for_its_own_panes(self):
        self.given(registry=PANES)
        p = self.as_("P9", "pm-pane", "new", 9, "worker", "--unit", "e2", "--effort", "low")
        self.assertNotIn("refused", p.stdout + p.stderr)
        self.assertNotIn("invalid choice", p.stderr)


if __name__ == "__main__":
    unittest.main()
