"""Every turn of a pane ends with a typed line, and a turn that ends with none is an event to the pane's lead; READY
is gone (issue 497).

Check id `harness.turn-end`.

- Judgement: pm-watchd's `turn_end(name, entry, reported_at, last, at)`, which the daemon calls when herdr says a
  registered pane's turn ended, run on the fixture's copy of pm-watchd (its `main()` left out). A line sent with
  pm-report within 180 s ends the turn; else the last reply on the screen: a delivered type is `EVENT ready`, a
  logged type (`WAITING`, `REVIEWED`, `RESET READY`) a log line, a turn while `pm-pane reset` runs (`resetting`) a
  log line, anything else `EVENT silent <pane>`.
- pm-report takes `WAITING <name> <what>` and refuses an untyped line.
- The texts: pane-mode.md's Reporting lines table holds every type pm-report takes, each with its handling, and the
  turn with no line; the PM skill's and lead.md's events tables each have an `EVENT silent` row; the daemon's
  docstring names `EVENT silent`; no guide, script or test names `pm-ready`, `EVENT go` or a READY comment as a go
  signal; the PM skill reads a run with `gh run watch <id> --interval 300` (owner, decisions.md).
"""
import ast
import json
import re
import subprocess
import sys
import unittest

from _fixture import CHECKOUT, clean_env, make, run

GROUP = "turn-end"
PM = CHECKOUT / ".agents" / "skills" / "pm"

JUDGE = """
import json, sys
src = open(sys.argv[1]).read().rsplit("\\nmain()", 1)[0]
ns = {"__file__": sys.argv[1], "__name__": "watchd"}
exec(compile(src, sys.argv[1], "exec"), ns)
out = [ns["turn_end"](*args) for args in json.loads(sys.argv[2])]
print(json.dumps(dict(out=out, logged=list(ns["LOGGED_LINES"]), delivered=list(ns["PM_LINES"]))))
"""


class Judgement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.co = make(GROUP, "judge", ("pm-watchd",))

    def judge(self, *calls):
        p = subprocess.run([sys.executable, "-I", "-c", JUDGE, str(self.co / ".pm" / "bin" / "pm-watchd"), json.dumps(calls)],
                           capture_output=True, text=True, env=clean_env(), timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout.strip().splitlines()[-1])

    T = 1_800_000_000.0

    def one(self, last, reported_at=0, entry=None, at=None):
        return self.judge(["i9-worker-e1", entry or {}, reported_at, last, at or self.T])["out"][0]

    def test_a_turn_with_no_typed_line_is_event_silent(self):
        self.assertEqual(self.one(""), ["EVENT silent i9-worker-e1", None])
        self.assertEqual(self.one("All done, the tests pass."), ["EVENT silent i9-worker-e1", None])

    def test_a_pm_report_line_within_180_s_ends_the_turn(self):
        self.assertEqual(self.one("", reported_at=self.T - 179), [None, "turn-end i9-worker-e1 (reported via file)"])
        self.assertEqual(self.one("", reported_at=self.T - 181), ["EVENT silent i9-worker-e1", None])

    def test_a_delivered_type_on_the_screen_is_event_ready(self):
        for line in ("STAGE READY i9-crit", "UNIT READY i9-worker-e1 feat/9-e1", "ISSUE READY i9-plan feat/9 report=x",
                     "DONE i9-worker-e1 stopped 3 pids", "BLOCKED i9-worker-e1 memory"):
            with self.subTest(line):
                self.assertEqual(self.one(line), [f"EVENT ready i9-worker-e1 {line}", None])

    def test_a_logged_type_on_the_screen_is_logged(self):
        for line in ("WAITING i9-worker-e1 check /x/emuforge-9-e1", "WAITING i9-plan review design r1",
                     "REVIEWED design r1 verdict=pass p1=0 p2=0 p3=0 x.md", "RESET READY i9-worker-e1 102730"):
            with self.subTest(line):
                self.assertEqual(self.one(line), [None, f"turn-end i9-worker-e1 {line}"])

    def test_a_turn_of_a_reset_in_progress_is_logged_and_a_stale_mark_is_not_believed(self):
        self.assertEqual(self.one("", entry=dict(resetting=self.T - 30)), [None, "turn-end i9-worker-e1 (reset)"])
        self.assertEqual(self.one("", entry=dict(resetting=self.T - 3600)), ["EVENT silent i9-worker-e1", None])

    def test_waiting_is_a_logged_type_and_not_a_delivered_one(self):
        got = self.judge()
        self.assertIn("WAITING", got["logged"])
        self.assertNotIn("WAITING", got["delivered"])


class Report(unittest.TestCase):
    def setUp(self):
        self.co = make(GROUP, f"report-{self._testMethodName[5:]}".replace("_", "-"), ("pm-report",))
        run_dir = self.co / ".pm" / "run"
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "panes.json").write_text(json.dumps([dict(name="i9-plan", pane_id="P9", gone=False)]))

    def lines(self):
        f = self.co / ".pm" / "run" / "reports.jsonl"
        return [json.loads(x)["line"] for x in f.read_text().splitlines()] if f.exists() else []

    def test_waiting_is_taken(self):
        p = run(self.co, "pm-report", "WAITING i9-plan unit e1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.lines(), ["WAITING i9-plan unit e1"])

    def test_an_untyped_line_is_refused(self):
        p = run(self.co, "pm-report", "i9-plan is waiting for e1")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("not a reporting line", p.stderr)
        self.assertEqual(self.lines(), [])


def flat(text):
    return re.sub(r"\s+", " ", text)


def table(text, heading):
    """The rows of the first table under `## heading`: [[cell, …]]."""
    part = text.split(f"## {heading}", 1)[1].split("\n## ", 1)[0]
    return [[c.strip() for c in re.split(r"(?<!\\)\|", ln.strip())[1:-1]] for ln in part.splitlines()
            if ln.startswith("|") and not re.match(r"^\|[-| ]+\|$", ln.strip())]


class Texts(unittest.TestCase):
    def prefixes(self):
        tree = ast.parse((CHECKOUT / ".pm" / "bin" / "pm-report").read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "PREFIXES" for t in node.targets):
                return [e.value for e in node.value.elts]
        self.fail("pm-report has no PREFIXES")

    def test_pane_mode_tables_every_type_with_its_handling(self):
        rows = table((PM / "references" / "pane-mode.md").read_text(), "Reporting lines")
        self.assertEqual(rows[0], ["line", "you end your turn with it when", "handling"])
        typed = {r[0].strip("`").split(" <")[0]: r[2] for r in rows[1:] if r[0].startswith("`")}
        for prefix in self.prefixes():
            with self.subTest(prefix):
                self.assertIn(prefix, typed)
                self.assertRegex(typed[prefix], r"^(delivered to|logged only)")
        for logged in ("WAITING", "REVIEWED", "RESET READY"):
            self.assertTrue(typed[logged].startswith("logged only"), logged)
        none = [r for r in rows[1:] if r[0] == "no typed line"]
        self.assertEqual(len(none), 1, rows)
        self.assertIn("`EVENT silent <name>` to your lead", none[0][2])

    def test_pane_mode_says_every_turn_ends_with_a_typed_line(self):
        text = flat((PM / "references" / "pane-mode.md").read_text())
        self.assertIn("Every turn you take ends with exactly one typed line", text)
        self.assertIn("end your turn with `WAITING <name> check <worktree>`", text)
        self.assertIn("end your turn with `WAITING <name> review <stage> r<k>`", text)

    def test_the_leads_tables_have_a_silent_row(self):
        for rel, heading in (("SKILL.md", "Events"), ("references/lead.md", "Events that reach you")):
            with self.subTest(rel):
                rows = table((PM / rel).read_text(), heading)
                silent = [r for r in rows if r[0] == "`EVENT silent <pane>`"]
                self.assertEqual(len(silent), 1, rel)
                for words in ("herdr agent read <pane>", "go on", "typed line", "pm-pane reset <pane>"):
                    self.assertIn(words, silent[0][1])

    def test_the_daemon_names_event_silent(self):
        doc = ast.get_docstring(ast.parse((CHECKOUT / ".pm" / "bin" / "pm-watchd").read_text())) or ""
        self.assertIn("EVENT silent <pane>", doc)
        self.assertNotIn("turns without a line are logged only", flat(doc))

    def test_ready_is_gone(self):
        self.assertFalse((CHECKOUT / ".pm" / "bin" / "pm-ready").exists())
        files = subprocess.run(["git", "-C", str(CHECKOUT), "ls-files", "AGENTS.md", ".agents/skills/pm", ".pm/bin",
                                "issues/README.md"], capture_output=True, text=True, env=clean_env()).stdout.split()
        files = [f for f in files if not f.startswith(".pm/bin/tests/")]  # the guides and the scripts
        self.assertIn(".pm/bin/pm-watchd", files)
        for rel in files:
            path = CHECKOUT / rel
            if not path.is_file():
                continue
            text = flat(path.read_text(errors="replace"))
            for gone in ("pm-ready", "EVENT go ", "exactly `READY`", "owner's `READY`", "READY` comment"):
                with self.subTest(rel=rel, gone=gone):
                    self.assertFalse(gone in text, f"{rel} names {gone!r}")

    def test_the_skill_reads_a_run_every_five_minutes(self):
        text = (PM / "SKILL.md").read_text()
        self.assertIn("gh run watch <id> --interval 300 --exit-status", text)
        self.assertNotRegex(text, r"gh run watch <id> (?!--interval 300)")


if __name__ == "__main__":
    unittest.main()
