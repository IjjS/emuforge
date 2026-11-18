"""The tier full of an integration check: the manifest label `full`, `tests/integration/run --full`, `pm-check
--full` and `--checks`, `.github/workflows/full.yml` and the guides (issue 482).

Check id `harness.full-tier`. A check of the tier runs only in the full run, which the owner starts, and in a local
run the owner asks for; no changed path calls it.

`Run` uses the run fixture of `test_on_request.py` (the stand-ins of `test_integration_not_run.py`, made with
`_fixture.make` under <checkout>/output/tests/on-request/full-tier-<case>/) with the test's own manifest `M`: `engine.tier-a`
and `studio.tier-b` are labelled `full`; `studio.text-c` has the string "full" as its `labels` and is not in the
tier; `studio.asked-d` is on request. Unless a case says otherwise the stand-ins write `passed` for every id.

`Check` uses the fixture of `test_check_issue.py` (`CheckCase`), under <checkout>/output/tests/full-tier-check/.
The issue worktree's change is one commit of a product path and of a stand-in suite that names --full and writes
the `full_tier` its entry in output/integration.json gives into its report.
"""
import json
import pathlib
import re
import unittest

import _pmscope
import test_ci
from _fixture import CHECKOUT
from test_check_issue import CheckCase
from test_integration_not_run import out
from test_issue_branch import INTEGRATION_RUN, PRODUCT_PATH
from test_on_request import ON_REQUEST, RunCase, RunFixture

FULL = "full: runs only in the full run; run it with --full"
USAGE = "usage: tests/integration/run [--not-run <file>] [--on-request] [--full] [--services <file>]"
RS = "tests/integration/engine/tests/fixture.rs"
SPEC = "tests/integration/studio/fixture.spec.ts"
M = (
    ("engine.plain-a", RS, []),
    ("engine.tier-a", RS, ["full"]),
    ("studio.plain-b", SPEC, []),
    ("studio.tier-b", SPEC, ["own-emulator", "full"]),
    ("studio.text-c", SPEC, "full"),
    ("studio.asked-d", SPEC, ["on-request"]),
)
TIER = ("engine.tier-a", "studio.tier-b")
LINE = re.compile(r"^integration: full tier (\d+) of (\d+) left out$", re.M)

# The PM's list (decisions.md of issue 482): the checks of the tier, and those that stay in every run.
THE_TIER = {
    "studio.addresses-stay-whole-with-five-digit-ports", "studio.language-layout-in-every-language",
    "studio.frame-bar-fits-with-the-tile-in-every-language", "studio.studio-layer-complete-in-every-language",
    "studio.korean-words-stay-whole", "studio.shell-finish", "studio.aws-area-stays-english-in-every-language",
    "studio.language-menu-dismissing-press-does-nothing-else", "studio.language-menu-is-veiled-at-480-and-below",
    "studio.brand-logos-hold-their-layout", "studio.brand-tile-and-app-icons-hold-their-layout",
    "studio.frame-wordmark-shows-the-tile", "studio.s3-bucket-screens-keyboard-and-layout",
    "studio.iam-role-screens-keyboard-and-layout", "studio.lambda-function-screens-keyboard-and-layout",
    "studio.aws-area-emulator-line-keyboard-and-layout", "studio.s3-bucket-list-keyboard-and-layout",
    "studio.lambda-function-screens-follow-emulator-stop-and-restart",
    "studio.iam-role-screens-follow-emulator-stop-and-restart",
    "studio.s3-bucket-screens-follow-emulator-stop-and-restart", "studio.s3-bucket-list-follows-emulator-stop-and-restart",
    "studio.aws-no-screen-part-follows-emulator-stop-and-start",
    "studio.frame-tile-stays-while-engine-and-emulator-are-away",
    "studio.lambda-function-screens-say-when-the-engine-stops-answering",
    "studio.iam-role-screens-say-when-the-engine-stops-answering",
    "studio.s3-bucket-screens-say-when-the-engine-stops-answering",
    "studio.s3-bucket-list-says-when-the-engine-stops-answering", "studio.aws-area-emulator-line-shows-engine-unreachable",
    "studio.home-reconnects-after-emulator-kill-and-start", "studio.home-shows-emulator-not-started-after-stop",
    "studio.home-kill-notice-stop-step-names-container",
}
STAY = {
    "studio.iam-role-create-appears-in-the-emulator", "studio.lambda-function-create-appears-in-the-emulator",
    "studio.lambda-function-delete-removes-functions-from-the-emulator", "studio.s3-empty-bucket-deletes-everything",
    "studio.s3-bucket-list-rereads-on-open-and-refresh", "studio.lambda-function-list-pages-follow-the-emulator",
    "studio.aws-clients-of-any-service-go-through-the-engine", "studio.studio-style-stays-outside-aws-area",
    "studio.cloudscape-stays-inside-aws-area", "studio.aws-area-emulator-line-follows-emulator-stop-and-start",
    "studio.home-shows-engine-unreachable-and-recovers", "studio.language-choice-applies-at-once-and-survives-reload",
    "studio.s3-bucket-list-preferences-keeps-focus-across-a-connection-check",
}


def flat(text):
    return " ".join(text.split())


def full_report(fx):
    return json.loads(fx.report_path.read_text())


class TierFixture(RunFixture):
    def manifest(self, text):
        (self.co / "tests" / "integration" / "manifest.jsonl").write_text(text)


def fixture(name, rows=M):
    """A run fixture under the group of test_on_request.py, named full-tier-<name>."""
    return TierFixture(f"full-tier-{name}", rows)


class Run(RunCase):
    def verdicts_of(self, fx, p):
        return self.verdicts(self.report(fx, p))

    def test_a_default_run_leaves_the_tier_out_with_its_reason(self):
        fx = fixture("default")
        p = fx.run()
        report = self.report(fx, p)
        for i in TIER:
            c = report[i]
            self.assertEqual((c["verdict"], c["seconds"], c["log"], c["message"]), ("not-run", 0, None, FULL), i)
        for i in ("engine.plain-a", "studio.plain-b", "studio.text-c"):
            self.assertEqual(report[i]["verdict"], "passed", i)
        self.assertEqual(report["studio.asked-d"]["message"], ON_REQUEST)
        self.assertEqual(p.returncode, 0, out(p))

    def test_the_report_and_the_output_count_the_tier_left_out(self):
        fx = fixture("count")
        p = fx.run()
        self.assertEqual(full_report(fx).get("full_tier"), {"of": 2, "left_out": 2}, out(p))
        self.assertEqual(LINE.findall(p.stderr), [("2", "2")], out(p))

    def test_full_runs_the_tier_like_every_other_check(self):
        fx = fixture("full")
        p = fx.run("--full")
        v = self.verdicts_of(fx, p)
        for i in TIER:
            self.assertEqual(v[i], "passed", i)
        self.assertEqual(v["studio.asked-d"], "not-run", "--full ran a check on request")
        self.assertEqual(full_report(fx).get("full_tier"), {"of": 2, "left_out": 0})
        self.assertEqual(LINE.findall(p.stderr), [("0", "2")], out(p))

    def test_a_failing_check_of_the_tier_fails_only_a_full_run(self):
        fx = fixture("fails")
        fx.verdicts(extra={"studio.tier-b": "failed"})
        self.assertEqual(fx.run().returncode, 0)
        self.assertEqual(fx.run("--full").returncode, 1)

    def test_full_and_on_request_run_everything(self):
        fx = fixture("both-options")
        p = fx.run("--on-request", "--full")
        self.assertNothingLeftOut(fx, p)

    def test_the_list_s_reason_comes_first_then_on_request_then_the_tier(self):
        fx = fixture("order")
        lst = fx.co / "output" / "list.json"
        lst.parent.mkdir(parents=True, exist_ok=True)
        lst.write_text(json.dumps(dict(checks=[dict(id="studio.tier-b", reason="listed here")])))
        p = fx.run("--not-run", lst)
        report = self.report(fx, p)
        self.assertEqual(report["studio.tier-b"]["message"], "listed here")
        self.assertEqual(report["engine.tier-a"]["message"], FULL)

    def test_the_tier_s_reason_comes_before_the_service_s(self):
        rows = [dict(check_id="studio.tier-s", path=SPEC, module="studio", operations=[], labels=["full"],
                     service="alpha", issue=482),
                dict(check_id="studio.plain-s", path=SPEC, module="studio", operations=[], labels=[],
                     service="alpha", issue=482),
                dict(check_id="engine.plain-a", path=RS, module="engine", operations=[], labels=[], issue=482)]
        fx = fixture("service")
        fx.manifest("".join(json.dumps(r) + "\n" for r in rows))
        sv = fx.co / "output" / "services.json"
        sv.parent.mkdir(parents=True, exist_ok=True)
        sv.write_text(json.dumps({"services": ["beta"]}))
        p = fx.run("--services", sv)
        report = self.report(fx, p)
        self.assertEqual(report["studio.tier-s"]["message"], FULL)
        self.assertNotEqual(report["studio.plain-s"]["message"], FULL)
        self.assertEqual(report["studio.plain-s"]["verdict"], "not-run")

    def test_a_row_both_full_and_on_request_is_refused_before_anything_starts(self):
        rows = M + (("studio.both-e", SPEC, ["on-request", "full"]),)
        for args in ((), ("--full",), ("--on-request",)):
            with self.subTest(args=args):
                fx = fixture("refused-" + "-".join(a.strip("-") for a in args), rows)
                p = fx.run(*args)
                self.assertEqual(p.returncode, 127, out(p))
                report = self.report(fx, p)
                self.assertEqual({c["verdict"] for c in report.values()}, {"error"})
                self.assertIn("studio.both-e is labelled both on-request and full", report["engine.plain-a"]["message"])
                self.assertEqual(fx.calls("cargo"), [], "something was built")
                self.assertEqual(full_report(fx)["full_tier"], {"of": 3, "left_out": 0})

    def test_full_twice_is_a_usage_error(self):
        fx = fixture("twice")
        p = fx.run("--full", "--full")
        self.assertEqual(p.returncode, 2, out(p))
        self.assertIn(USAGE, p.stderr)
        self.assertFalse(fx.report_path.exists())

    def test_guard_a_manifest_without_the_tier_counts_none(self):
        fx = fixture("none", tuple((i, p, []) for i, p, _ in M))
        p = fx.run()
        self.assertEqual(full_report(fx)["full_tier"], {"of": 0, "left_out": 0})
        self.assertEqual(LINE.findall(p.stderr), [("0", "0")])


KNOWS = INTEGRATION_RUN.replace(
    '"""Stand-in for tests/integration/run (see the docstring of test_issue_branch.py)."""',
    '"""Stand-in for tests/integration/run that takes --full (test_full_tier.py)."""').replace(
    "report.write_text(json.dumps(dict(commit=commit, checks=checks)))",
    "report.write_text(json.dumps(dict(commit=commit, checks=checks, **({'full_tier': r['full_tier']} "
    "if 'full_tier' in r else {}))))")


class Check(CheckCase):
    group = "full-tier-check"

    def change(self, knows=True):
        self.fixture()
        w = self.issue_branch()
        paths = {PRODUCT_PATH: "a product change\n"}
        if knows:
            paths["tests/integration/run"] = KNOWS
        self.commit(w, paths, "a product change")
        return w

    def starts(self, w):
        return [ln.split()[1:] for ln in self.ran(w) or [] if ln.split()[0] == "integration"]

    def test_full_starts_the_step_and_its_retry_with_full(self):
        assert "--full" in KNOWS and KNOWS != INTEGRATION_RUN
        w = self.change()
        self.standin(w, dict(exit=1), dict(exit=0))
        p = self.check(w, "--full")
        self.assertEqual(self.starts(w), [["--full"], ["--full"]], self.out(p))

    def test_without_the_option_the_step_never_gets_full(self):
        w = self.change()
        self.standin(w, {})
        p = self.check(w)
        starts = self.starts(w)
        self.assertTrue(starts, self.out(p))
        self.assertFalse(any("--full" in s for s in starts), starts)

    def test_a_suite_that_does_not_name_full_gets_nothing(self):
        w = self.change(knows=False)
        self.standin(w, {})
        p = self.check(w, "--full")
        self.assertEqual(self.starts(w), [[]], self.out(p))

    def test_checks_starts_the_suite_with_full(self):
        w = self.change()
        self.standin(w, dict(exit=0))
        p = self.check(w, "--checks", "studio.b")
        starts = self.starts(w)
        self.assertEqual(len(starts), 1, self.out(p))
        self.assertEqual((starts[0][0], starts[0][2:]), ("--not-run", ["--on-request", "--full"]), starts)

    def test_the_entry_and_the_output_give_the_count_left_out(self):
        w = self.change()
        self.standin(w, dict(full_tier={"of": 31, "left_out": 31}))
        p = self.check(w)
        self.assertEqual(self.entry(self.last(w), "integration").get("full_tier"), {"of": 31, "left_out": 31})
        self.assertRegex(p.stdout, r"(?m)^  full tier\s+31 of 31 left out$")

    def test_checks_records_the_count_too(self):
        w = self.change()
        self.standin(w, dict(full_tier={"of": 3, "left_out": 2}))
        p = self.check(w, "--checks", "studio.b")
        rec = json.loads((pathlib.Path(w) / "output" / "checks" / "checks.json").read_text())
        self.assertEqual(rec["steps"][0].get("full_tier"), {"of": 3, "left_out": 2})
        self.assertRegex(p.stdout, r"(?m)^  full tier\s+2 of 3 left out$")

    def test_a_report_without_the_count_gives_no_key_and_no_line(self):
        w = self.change()
        self.standin(w, dict(full_tier="many"))
        p = self.check(w)
        self.assertNotIn("full_tier", self.entry(self.last(w), "integration"))
        self.assertNotIn("full tier", p.stdout)


class Manifest(unittest.TestCase):
    def rows(self):
        return _pmscope._rows(_pmscope.manifest_of(CHECKOUT))

    def test_the_tier_is_the_pm_s_list(self):
        tier = {r["check_id"] for r in self.rows() if "full" in (r.get("labels") or [])}
        self.assertEqual(tier, THE_TIER)

    def test_the_checks_that_stay_are_not_in_the_tier_and_exist(self):
        ids = {r["check_id"]: r for r in self.rows()}
        for i in STAY:
            with self.subTest(i):
                self.assertIn(i, ids)
                self.assertNotIn("full", ids[i].get("labels") or [])

    def test_no_row_is_both_full_and_on_request(self):
        both = [r["check_id"] for r in self.rows()
                if {"full", "on-request"} <= set(r.get("labels") or [])]
        self.assertEqual(both, [])

    def test_no_row_has_a_calling_field(self):
        self.assertEqual([r["check_id"] for r in self.rows() if "touched_by" in r], [])


class Workflow(unittest.TestCase):
    def run_lines(self, name):
        text = (CHECKOUT / ".github" / "workflows" / name).read_text()
        return [test_ci.strip_comment(ln) for ln in text.splitlines() if "./run" in test_ci.strip_comment(ln)]

    def test_full_yml_passes_full_to_both_integration_runs(self):
        lines = self.run_lines("full.yml")
        self.assertEqual(len(lines), 2, lines)
        self.assertTrue(all(ln.rstrip().endswith(" --full") for ln in lines), lines)

    def test_main_yml_never_passes_full(self):
        lines = self.run_lines("main.yml")
        self.assertTrue(lines)
        self.assertFalse(any("--full" in ln.split() for ln in lines), lines)


class Guides(unittest.TestCase):
    def text(self, rel):
        return flat((CHECKOUT / rel).read_text())

    def test_the_integration_guide_has_the_tier(self):
        text = (CHECKOUT / "tests" / "integration" / "AGENTS.md").read_text()
        self.assertIn("## Full tier", text)
        part = flat(text.split("## Full tier", 1)[1].split("\n## ", 1)[0])
        for words in ("full.yml", "run --full", "pm-check --full", "pm-check --checks", FULL, "on its own",
                      "owner's word", "on-request"):
            self.assertIn(words, part)

    def test_the_readme_names_the_option_the_reason_and_the_count(self):
        text = self.text("tests/integration/README.md")
        for words in (USAGE, FULL, "full_tier", "full tier <left_out> of <of> left out"):
            self.assertIn(words, text)

    def test_the_manifest_reference_names_the_label(self):
        text = self.text("tests/integration/references/services-and-manifest.md")
        self.assertRegex(text, r"`labels` \|[^|]*`full`")

    def test_the_root_guide_names_the_tier_with_full_yml(self):
        text = self.text("AGENTS.md")
        self.assertRegex(text, r"full\.yml.{0,400}tier `full`")
        self.assertIn("no agent runs them on its own", text)

    def test_pm_check_says_what_full_runs(self):
        text = flat((CHECKOUT / ".pm" / "bin" / "pm-check").read_text())
        self.assertIn(FULL, text)
        self.assertIn("No agent runs the tier on its own", text)

    def test_the_pm_skill_does_not_send_the_pm_to_full_when_in_doubt(self):
        text = self.text(".agents/skills/pm/SKILL.md")
        self.assertIn("run `pm-check --only harness` when in doubt", text)
        self.assertNotIn("run `pm-check --full` when in doubt", text)


if __name__ == "__main__":
    unittest.main()
