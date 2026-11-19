"""Checks that run on request: the label `on-request` in the manifest, `tests/integration/run --on-request` and
`pm-check --on-request` (issue 315, requirement R2 and R3; test criteria `test_on_request`).

Check id `harness.on-request`. One class per heading of the test criteria.

The run fixture is the one of `test_integration_not_run.py` (its stand-ins, made with `_fixture.make` under
<checkout>/output/tests/on-request/<case>/), with the test's own manifest `M` of seven rows instead of the
checkout's: `ON` (`engine.asked-a`, `studio.asked-b`) is labelled `on-request`; `engine.bare-c` has no `labels`
and `studio.text-d` has the string "on-request" as its `labels`, and neither is on request. Unless a case says
otherwise the stand-ins write `passed` for every id of the manifest, the labelled ones too: a check that is left
out is never counted from a verdict file.

The check fixture is the one of `test_check_issue.py` (`CheckCase`), under <checkout>/output/tests/on-request-check/.
A change on the issue worktree is one commit of a product path, which calls for the integration step.

On a checkout without the change every case fails on its own, not at import: `run` refuses `--on-request` with its
usage line and leaves no labelled check out, `pm-check` does not know the option, and the guides do not name it.
`Manifest` passes once the two rows are labelled. The cases whose name says `guard` hold a behavior of today and
pass there already.
"""
import json
import pathlib
import re
import subprocess
import sys
import unittest

from _fixture import CHECKOUT, make
from test_check_issue import CheckCase
from test_integration_not_run import RUN, STANDIN, TOOLS, Fixture, grep_invert, lines_naming, list_text, out
from test_issue_branch import PRODUCT_PATH

GROUP = "on-request"
FIXED = "on request: not part of a default run; run it with --on-request"
USAGE = "usage: tests/integration/run [--not-run <file>] [--on-request] [--full] [--services <file>]"
NO_LABELS = object()  # a row without the key `labels`

RS = "tests/integration/engine/tests/fixture.rs"
SPEC = "tests/integration/studio/fixture.spec.ts"
M = (
    ("engine.plain-a", RS, []),
    ("engine.asked-a", RS, ["on-request"]),
    ("engine.bare-c", RS, NO_LABELS),
    ("studio.plain-b", SPEC, []),
    ("studio.asked-b", SPEC, ["own-emulator", "on-request"]),
    ("studio.asked-b-more", SPEC, []),
    ("studio.text-d", SPEC, "on-request"),
)
ON = ("engine.asked-a", "studio.asked-b")
M_IDS = tuple(i for i, _, _ in M)
REST = tuple(i for i in M_IDS if i not in ON)


def rows_text(rows):
    """manifest.jsonl for (check_id, path, labels) rows."""
    text = ""
    for check_id, path, labels in rows:
        r = dict(check_id=check_id, path=path, module=check_id.split(".")[0], operations=[], issue=315)
        if labels is not NO_LABELS:
            r["labels"] = labels
        text += json.dumps(r) + "\n"
    return text


def without_label(rows):
    """`rows` with `on-request` taken out of every row's `labels` (a `labels` that is not a list becomes [])."""
    def strip(labels):
        if labels is NO_LABELS:
            return labels
        return [x for x in labels if x != "on-request"] if isinstance(labels, list) else []
    return tuple((i, p, strip(labels)) for i, p, labels in rows)


class RunFixture(Fixture):
    """The fixture of test_integration_not_run.py with the manifest `rows` instead of the checkout's."""

    def __init__(self, name, rows=M):
        self.rows = tuple(rows)
        self.co = make(GROUP, name, (), {
            "tests/integration/run": RUN.read_text(),
            "tests/integration/manifest.jsonl": rows_text(self.rows),
            "engine/Cargo.toml": '[package]\nname = "fixture"\nversion = "0.0.0"\n',
            "studio/package.json": "{}\n",
            "studio/node_modules/.bin/playwright": STANDIN,
        })
        self.case = self.co / "output" / "case"
        self.bin = self.case / "bin"
        self.bin.mkdir(parents=True)
        for tool in TOOLS:
            p = self.bin / tool
            p.write_text(STANDIN)
            p.chmod(0o755)
        (self.co / "home").mkdir()
        self.verdicts()

    def verdicts(self, passed_except=(), extra=None):
        """The stand-ins write `passed` for every id of the rows but `passed_except`, then `extra` ({id: verdict})."""
        rs = [i for i, p, _ in self.rows if p.endswith(".rs")]
        spec = [i for i, p, _ in self.rows if p.endswith(".spec.ts")]
        plan = dict(cargo={i: "passed" for i in rs if i not in passed_except},
                    playwright={i: "passed" for i in spec if i not in passed_except})
        for check_id, verdict in (extra or {}).items():
            plan["cargo" if check_id in rs else "playwright"][check_id] = verdict
        (self.case / "verdicts.json").write_text(json.dumps(plan))

    def tests(self, since=0):
        """The `cargo test` starts recorded after the first `since` calls."""
        return [c for c in self.calls()[since:] if c["tool"] == "cargo" and c["args"][:1] == ["test"]]

    def playwright(self, since=0):
        return [c for c in self.calls()[since:] if c["tool"] == "playwright"]


def last_line(p):
    lines = [ln for ln in p.stderr.splitlines() if ln.strip()]
    return lines[-1] if lines else ""


class RunCase(unittest.TestCase):
    def report(self, fx, p):
        report = fx.report()
        self.assertIsNotNone(report, out(p))
        return report

    def verdicts(self, report):
        return {i: c["verdict"] for i, c in report.items()}

    def ids_file(self, fx, p, since=0):
        """The lines of the file named by EMUFORGE_IT_NOT_RUN at the one `cargo test` start, sorted."""
        tests = fx.tests(since)
        self.assertEqual(len(tests), 1, out(p))
        self.assertIsNotNone(tests[0]["not_run"], f"cargo test got no EMUFORGE_IT_NOT_RUN\n{out(p)}")
        text = tests[0]["not_run_text"]
        self.assertIsNotNone(text, f"EMUFORGE_IT_NOT_RUN={tests[0]['not_run']} named no file")
        return sorted(text.splitlines())

    def assertLeftOut(self, report, ids):
        for check_id in ids:
            c = report[check_id]
            self.assertEqual((c["verdict"], c["seconds"], c["log"], c["message"]), ("not-run", 0, None, FIXED),
                             check_id)

    def assertNothingLeftOut(self, fx, p, since=0):
        report = self.report(fx, p)
        self.assertEqual({i: v for i, v in self.verdicts(report).items() if v == "not-run"}, {})
        tests = fx.tests(since)
        self.assertTrue(tests, f"cargo test was not started\n{out(p)}")
        self.assertEqual([c["not_run"] for c in tests], [None] * len(tests), "EMUFORGE_IT_NOT_RUN reached cargo test")
        runs = fx.playwright(since)
        self.assertTrue(runs, f"playwright was not started\n{out(p)}")
        self.assertEqual([c["args"] for c in runs if "--grep-invert" in c["args"]], [])
        return report


# ---------------------------------------------------------------------------------------------------- R3.1, R3.2

class Run(RunCase):
    def test_a_default_run_leaves_the_labelled_checks_out_with_the_fixed_sentence(self):
        fx = RunFixture("run-default")
        p = fx.run()
        self.assertEqual(p.returncode, 0, out(p))
        report = self.report(fx, p)
        self.assertLeftOut(report, ON)
        self.assertEqual({i: report[i]["verdict"] for i in REST}, {i: "passed" for i in REST})
        for check_id in ON:
            named = lines_naming(p, check_id)
            self.assertTrue(any(ln.startswith("not-run") and ln.endswith(FIXED) for ln in named),
                            f"no not-run line with the fixed sentence for {check_id}: {named}")
            self.assertFalse(any(ln.startswith("passed") for ln in named), f"a passed line for {check_id}")

    def test_cargo_test_gets_the_ids_file_and_playwright_one_pattern(self):
        fx = RunFixture("run-commands")
        p = fx.run()
        self.assertEqual(self.ids_file(fx, p), sorted(ON))
        pattern = grep_invert(self, fx.playwright())
        self.assertRegex("x.spec.ts studio.asked-b", pattern)
        for other in ("studio.plain-b", "studio.asked-b-more", "studio.text-d", "studio.asked-bx",
                      "pre-studio.asked-b", "xstudio.asked-b"):
            with self.subTest(other):
                self.assertIsNone(re.search(pattern, f"x.spec.ts {other}"), f"{pattern!r} matches {other}")

    def test_a_labelled_check_that_would_fail_does_not_fail_a_default_run(self):
        fx = RunFixture("run-labelled-fail")
        fx.verdicts(extra={i: "failed" for i in ON})
        p = fx.run()
        report = self.report(fx, p)
        self.assertEqual({i: report[i]["verdict"] for i in ON}, {i: "not-run" for i in ON})
        self.assertEqual(p.returncode, 0, out(p))

    def test_an_unlabelled_failure_still_fails_a_default_run(self):
        fx = RunFixture("run-unlabelled-fail")
        fx.verdicts(extra={"engine.plain-a": "failed"})
        p = fx.run()
        report = self.report(fx, p)
        self.assertEqual(report["engine.plain-a"]["verdict"], "failed")
        self.assertEqual({i: report[i]["verdict"] for i in ON}, {i: "not-run" for i in ON})
        self.assertEqual(p.returncode, 1, out(p))

    def test_a_manifest_of_labelled_rows_only_checks_nothing(self):
        fx = RunFixture("run-every-labelled", rows=[r for r in M if r[0] in ON])
        p = fx.run()
        self.assertEqual(p.returncode, 127, out(p))
        report = self.report(fx, p)
        self.assertEqual(sorted(report), sorted(ON))
        self.assertLeftOut(report, ON)

    def test_a_row_without_labels_or_with_labels_not_a_list_is_not_on_request(self):
        fx = RunFixture("run-not-a-list")
        p = fx.run()
        self.assertEqual(self.ids_file(fx, p), sorted(ON))
        report = self.report(fx, p)
        self.assertEqual({i: report[i]["verdict"] for i in ("engine.bare-c", "studio.text-d")},
                         {"engine.bare-c": "passed", "studio.text-d": "passed"})
        pattern = grep_invert(self, fx.playwright())
        self.assertIsNone(re.search(pattern, "x.spec.ts studio.text-d"), f"{pattern!r} matches studio.text-d")

    def test_a_labelled_id_without_the_form_of_an_id_reaches_no_command_line(self):
        bad = "studio.x|.*"
        fx = RunFixture("run-bad-id", rows=M + ((bad, SPEC, ["on-request"]),))
        fx.verdicts(extra={bad: "passed"})
        p = fx.run()
        pattern = grep_invert(self, fx.playwright())
        self.assertRegex("x.spec.ts studio.asked-b", pattern)
        for other in ("studio.plain-b", bad):
            with self.subTest(other):
                self.assertIsNone(re.search(pattern, f"x.spec.ts {other}"), f"{pattern!r} matches {other}")
        self.assertEqual(self.ids_file(fx, p), sorted(ON))
        report = self.report(fx, p)
        self.assertEqual(report["studio.plain-b"]["verdict"], "passed")
        self.assertEqual(report[bad]["verdict"], "passed", report[bad])

    def test_a_labelled_check_left_out_counts_neither_way_in_relay_fidelity(self):
        rows = M + (("engine.relay-e", RS, ["transparency", "on-request"]), ("engine.relay-f", RS, ["transparency"]))
        fx = RunFixture("run-relay", rows=rows)
        fx.verdicts(extra={"engine.relay-e": "failed"})
        for args, code, fidelity in (((), 0, (1, 1)), (("--on-request",), 1, (1, 2))):
            with self.subTest(args=args):
                p = fx.run(*args)
                self.assertEqual(p.returncode, code, out(p))
                report = json.loads(fx.report_path.read_text()) if fx.report_path.exists() else None
                self.assertIsNotNone(report, out(p))
                f = report["relay_fidelity"]
                self.assertEqual((f["passed"], f["total"]), fidelity)
                self.assertTrue(last_line(p).startswith(f"relay fidelity {fidelity[0]}/{fidelity[1]}"), last_line(p))


# ---------------------------------------------------------------------------------------------------- R3.3

class With_option(RunCase):
    def test_the_option_runs_the_labelled_checks_like_every_other(self):
        fx = RunFixture("option-runs")
        p = fx.run("--on-request")
        self.assertEqual(p.returncode, 0, out(p))
        report = self.assertNothingLeftOut(fx, p)
        self.assertEqual(self.verdicts(report), {i: "passed" for i in M_IDS})

    def test_a_labelled_check_has_its_own_verdict(self):
        fx = RunFixture("option-failed")
        fx.verdicts(extra={"studio.asked-b": "failed"})
        p = fx.run("--on-request")
        report = self.report(fx, p)
        self.assertEqual(report["studio.asked-b"]["verdict"], "failed")
        self.assertEqual(p.returncode, 1, out(p))

    def test_the_option_and_a_list_in_either_order(self):
        reason = "listed: plain a"
        for name, first_option in (("option-first", True), ("list-first", False)):
            with self.subTest(name):
                fx = RunFixture(f"option-{name}")
                listed = fx.file("list.json", list_text({"engine.plain-a": reason}))
                args = ("--on-request", "--not-run", listed) if first_option else ("--not-run", listed, "--on-request")
                p = fx.run(*args)
                report = self.report(fx, p)
                self.assertEqual((report["engine.plain-a"]["verdict"], report["engine.plain-a"]["message"]),
                                 ("not-run", reason))
                self.assertEqual({i: report[i]["verdict"] for i in ON}, {i: "passed" for i in ON})
                self.assertEqual(self.ids_file(fx, p), ["engine.plain-a"])

    def test_a_run_with_the_option_reads_nothing_of_the_run_before(self):
        fx = RunFixture("option-after-default")
        fx.run()
        since = len(fx.calls())
        p = fx.run("--on-request")
        self.assertEqual(p.returncode, 0, out(p))
        self.assertNothingLeftOut(fx, p, since)


# ---------------------------------------------------------------------------------------------------- R3.4

class Both(RunCase):
    LIST = {"studio.asked-b": "listed: asked b", "engine.plain-a": "listed: plain a"}

    def test_a_listed_and_labelled_check_has_the_list_s_reason(self):
        fx = RunFixture("both-default")
        p = fx.run("--not-run", fx.file("list.json", list_text(self.LIST)))
        report = self.report(fx, p)
        for check_id, reason in self.LIST.items():
            self.assertEqual((report[check_id]["verdict"], report[check_id]["message"]), ("not-run", reason))
        self.assertLeftOut(report, ["engine.asked-a"])
        others = [i for i in M_IDS if i not in self.LIST and i != "engine.asked-a"]
        self.assertEqual({i: report[i]["verdict"] for i in others}, {i: "passed" for i in others})
        self.assertEqual(self.ids_file(fx, p), sorted([*self.LIST, "engine.asked-a"]))

    def test_the_list_wins_with_the_option_too(self):
        fx = RunFixture("both-option")
        p = fx.run("--not-run", fx.file("list.json", list_text(self.LIST)), "--on-request")
        report = self.report(fx, p)
        self.assertEqual((report["studio.asked-b"]["verdict"], report["studio.asked-b"]["message"]),
                         ("not-run", self.LIST["studio.asked-b"]))
        self.assertEqual(report["engine.asked-a"]["verdict"], "passed")
        self.assertRegex("x.spec.ts studio.asked-b", grep_invert(self, fx.playwright()))

    def test_guard_a_refused_list_comes_first(self):
        fx = RunFixture("both-refused")
        p = fx.run("--not-run", fx.file("list.json", "{not json"))
        self.assertEqual(p.returncode, 127, out(p))
        report = self.report(fx, p)
        self.assertEqual(sorted(report), sorted(M_IDS))
        for check_id, c in report.items():
            self.assertEqual(c["verdict"], "error", check_id)
            self.assertTrue(c["message"].startswith("not-run list"), f"{check_id}: {c['message']!r}")


# ---------------------------------------------------------------------------------------------------- R3.7

class Usage(RunCase):
    def test_a_wrong_argument_is_a_usage_error_before_anything_starts(self):
        table = {
            "bogus": lambda fx: ["--bogus"],
            "option-twice": lambda fx: ["--on-request", "--on-request"],
            "list-twice": lambda fx: ["--not-run", fx.file("list.json", list_text({})), "--not-run",
                                      fx.file("list.json", list_text({}))],
            "no-file": lambda fx: ["--on-request", "--not-run"],
            "extra": lambda fx: ["extra"],
        }
        for name, args in table.items():
            with self.subTest(name):
                fx = RunFixture(f"usage-{name}")
                p = fx.run(*args(fx))
                self.assertEqual(p.returncode, 2, out(p))
                self.assertIn(USAGE, [ln.strip() for ln in p.stderr.splitlines()], p.stderr)
                self.assertFalse(fx.report_path.exists(), "report.json was written")
                self.assertEqual([c["tool"] for c in fx.calls() if c["tool"] in ("docker", "cargo")], [],
                                 "docker or cargo was started")


# ---------------------------------------------------------------------------------------------------- R5

class No_label(RunCase):
    PORTS = {"EMULATOR_PORT": "19101", "EMUFORGE_ENGINE_PORT": "19102", "EMUFORGE_STUDIO_PORT": "19103"}

    def recorded(self, fx, p, since):
        """The verdicts of the report and every stand-in start after `since`, with the run's id replaced by <run>."""
        m = re.search(r"integration: run (\S+),", p.stderr)
        self.assertIsNotNone(m, out(p))

        def mask(v):
            return v.replace(m.group(1), "<run>") if isinstance(v, str) else v
        calls = [dict(tool=c["tool"], args=[mask(a) for a in c["args"]], not_run=c["not_run"],
                      not_run_text=c["not_run_text"]) for c in fx.calls()[since:]]
        return self.verdicts(self.report(fx, p)), calls

    def test_guard_without_labelled_rows_a_run_leaves_nothing_out(self):
        fx = RunFixture("no-label-default", rows=without_label(M))
        p = fx.run()
        report = self.assertNothingLeftOut(fx, p)
        self.assertEqual(self.verdicts(report), {i: "passed" for i in M_IDS})

    def test_guard_without_labelled_rows_a_list_leaves_out_its_ids_alone(self):
        fx = RunFixture("no-label-list", rows=without_label(M))
        p = fx.run("--not-run", fx.file("list.json", list_text({"engine.plain-a": "listed: plain a"})))
        report = self.report(fx, p)
        self.assertEqual({i: v for i, v in self.verdicts(report).items() if v == "not-run"}, {"engine.plain-a": "not-run"})
        self.assertEqual(self.ids_file(fx, p), ["engine.plain-a"])

    def test_without_labelled_rows_the_option_changes_nothing(self):
        fx = RunFixture("no-label-option", rows=without_label(M))
        p = fx.run(env=self.PORTS)
        default = self.recorded(fx, p, 0)
        since = len(fx.calls())
        p = fx.run("--on-request", env=self.PORTS)
        self.assertEqual(p.returncode, 0, out(p))
        self.assertEqual(self.recorded(fx, p, since), default)


# ---------------------------------------------------------------------------------------------------- R3.5, R3.6

class Check(CheckCase):
    group = "on-request-check"

    def issue_change(self):
        """Issue 9's branch and worktree with one commit of a product path: its paths call for integration."""
        self.fixture()
        self.w9 = self.issue_branch()
        self.commit(self.w9, [PRODUCT_PATH], "a product change")
        return self.w9

    def starts(self, w):
        """The arguments of each start of the integration stand-in in `w`."""
        return [ln.split()[1:] for ln in self.ran(w) or [] if ln.split()[0] == "integration"]

    def record_of(self, w, name="last.json"):
        f = pathlib.Path(w) / "output" / "checks" / name
        self.assertTrue(f.exists(), f"{f} was not written")
        return json.loads(f.read_text())

    def written(self, w):
        d = pathlib.Path(w) / "output" / "checks"
        return [f for f in ("checks.json", "checks-not-run.json", "last.json") if (d / f).exists()]

    def test_the_option_starts_the_step_with_it(self):
        w = self.issue_change()
        self.standin(w, {})
        p = self.ok(self.check(w, "--on-request"))
        self.assertEqual(self.starts(w), [["--on-request"]], self.out(p))
        rec = self.record_of(w)
        self.assertIn("on_request", rec)
        self.assertIs(rec["on_request"], True)

    def test_without_the_option_the_step_starts_without_it(self):
        w = self.issue_change()
        self.standin(w, {})
        p = self.check(w)
        self.assertEqual(self.starts(w), [[]], self.out(p))
        rec = self.record_of(w)
        self.assertIn("on_request", rec)
        self.assertIs(rec["on_request"], False)

    def test_the_retry_is_started_with_the_option(self):
        w = self.issue_change()
        self.standin(w, dict(exit=1), dict(exit=0))
        p = self.check(w, "--on-request")
        self.assertEqual(self.starts(w), [["--on-request"], ["--on-request"]], self.out(p))
        self.assertEqual(self.entry(self.record_of(w), "integration")["status"], "flaky")

    def test_the_fast_check_of_a_unit_defers_the_step_with_the_option(self):
        self.fixture()
        self.issue_branch()
        s1 = self.unit(9, "s1", [PRODUCT_PATH])
        p = self.check(s1, "--on-request")
        rec = self.record_of(s1)
        self.assertEqual(self.entry(rec, "integration")["status"], "deferred", self.out(p))
        self.assertEqual(self.starts(s1), [])
        self.assertIn("on_request", rec)
        self.assertIs(rec["on_request"], True)

    def test_merge_accepts_a_pass_with_the_option(self):
        self.fixture()
        self.issue_branch()
        s1 = self.unit(9, "s1", [PRODUCT_PATH])
        self.ok(self.check(s1, "--on-request"))
        self.review(9, "s1")
        feat = self.head("feat/9")
        self.ok(self.script("pm-merge", 9, "s1"))
        self.assertNotEqual(self.head("feat/9"), feat)
        self.assertTrue(self.is_ancestor("feat/9-s1", "feat/9"))

    def test_checks_starts_the_suite_with_the_option(self):
        w = self.issue_change()
        self.standin(w, dict(exit=0))
        p = self.check(w, "--checks", "studio.b")
        starts = self.starts(w)
        self.assertEqual(len(starts), 1, self.out(p))
        args = starts[0]
        self.assertEqual(len(args), 3, args)
        self.assertEqual((args[0], args[2]), ("--not-run", "--on-request"), args)
        self.assertEqual(pathlib.Path(args[1]).resolve(), (w / "output" / "checks" / "checks-not-run.json").resolve())
        self.assertNotIn("on_request", self.record_of(w, "checks.json"))

    def test_checks_with_the_option_is_refused(self):
        w = self.issue_change()
        self.standin(w, dict(exit=0))
        p = self.check(w, "--checks", "studio.b", "--on-request")
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertIn("pm-check: error: --checks cannot be combined with --on-request",
                      [ln.strip() for ln in p.stderr.splitlines()], p.stderr)
        self.assertEqual(self.starts(w), [])
        self.assertEqual(self.written(w), [])

    def test_list_ignores_the_option(self):
        w = self.issue_change()
        self.standin(w, {})
        plain = self.check(w, "--list")
        with_option = self.check(w, "--list", "--on-request")
        self.assertEqual((with_option.returncode, with_option.stdout, with_option.stderr),
                         (plain.returncode, plain.stdout, plain.stderr))
        self.assertEqual(self.starts(w), [])

    def test_stop_ignores_the_option(self):
        w = self.issue_change()
        self.standin(w, {})
        plain = self.check(w, "--stop")
        with_option = self.check(w, "--stop", "--on-request")
        self.assertEqual((with_option.returncode, with_option.stdout, with_option.stderr),
                         (plain.returncode, plain.stdout, plain.stderr))
        self.assertEqual(self.starts(w), [])
        self.assertEqual(self.written(w), [])


# ---------------------------------------------------------------------------------------------------- R2.2

class Manifest(unittest.TestCase):
    LABELLED = {
        "studio.count-and-unit-stay-on-one-line": {"own-emulator", "regression", "on-request"},
        "engine.product-does-not-come-up-on-a-port-collision": {"own-emulator", "on-request"},
    }

    def test_the_two_rows_are_on_request_and_keep_their_labels(self):
        text = (CHECKOUT / "tests" / "integration" / "manifest.jsonl").read_text()
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        for r in rows:
            self.assertIsInstance(r, dict)
            self.assertIn("check_id", r)
        ids = [r["check_id"] for r in rows]
        self.assertEqual(sorted({i for i in ids if ids.count(i) > 1}), [])
        labelled = {r["check_id"]: set(r["labels"]) for r in rows
                    if isinstance(r.get("labels"), list) and "on-request" in r["labels"]}
        self.assertEqual(labelled, self.LABELLED)


# ---------------------------------------------------------------------------------------------------- Guides

def part(text, heading):
    """The body under the heading line `heading`, up to the next heading of the same or a higher level."""
    lines = text.splitlines()
    start = lines.index(heading)
    level = len(heading) - len(heading.lstrip("#"))
    body = []
    for line in lines[start + 1:]:
        m = re.match(r"(#+) ", line)
        if m and len(m.group(1)) <= level:
            break
        body.append(line)
    return "\n".join(body)


def flat(text):
    return " ".join(text.split())


class Guides(unittest.TestCase):
    AGENTS = CHECKOUT / "tests" / "integration" / "AGENTS.md"
    README = CHECKOUT / "tests" / "integration" / "README.md"
    SERVICES_REF = CHECKOUT / "tests" / "integration" / "references" / "services-and-manifest.md"  # issue 478

    def row(self, section, first_cell):
        rows = [ln for ln in section.splitlines() if ln.startswith(f"| {first_cell} |")]
        self.assertEqual(len(rows), 1, section)
        return rows[0]

    def test_manifest_labels_name_on_request(self):
        row = self.row(part(self.SERVICES_REF.read_text(), "## Manifest"), "`labels`")
        for label in ("transparency", "own-emulator", "safety", "regression", "lifecycle", "on-request"):
            self.assertIn(f"`{label}`", row)

    def test_the_not_run_verdict_names_the_list_and_the_label(self):
        row = self.row(part(self.AGENTS.read_text(), "## Verdicts"), "`not-run`")
        for word in ("run --not-run", "`on-request`", "`--on-request`"):
            self.assertIn(word, row)
        self.assertRegex(row, r"list and the label[^.|]* changed only on the `pm`'s decision")

    def test_a_section_on_request_between_isolation_and_safety(self):
        text = self.AGENTS.read_text()
        headings = [ln for ln in text.splitlines() if ln.startswith("## ")]
        self.assertIn("## On request", headings)
        i = headings.index("## On request")
        self.assertEqual(headings[i - 1:i + 2], ["## Isolation", "## On request", "## Safety"], headings)
        body = flat(part(text, "## On request"))
        for word in ("`on-request`", "`not-run`", "run --on-request", "pm-check --on-request", "pm-check --checks",
                     "`pm`", "owner", "Issue-Check-Ids"):
            self.assertIn(word, body)

    def test_readme_checks_not_run_names_the_option(self):
        body = flat(part(self.README.read_text(), "## Checks not run"))
        self.assertIn("--on-request", body)
        self.assertIn(FIXED, body)
        self.assertNotIn("without arguments it runs every check", body)

    def test_pm_check_help_names_the_option(self):
        p = subprocess.run([sys.executable, "-I", str(CHECKOUT / ".pm" / "bin" / "pm-check"), "--help"],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(p.returncode, 0, out(p))
        usage = [ln for ln in p.stdout.splitlines() if ln.strip().startswith("pm-check <worktree|.>")]
        self.assertTrue(usage, p.stdout)
        self.assertIn("--on-request", usage[0])
        self.assertTrue([ln for ln in p.stdout.splitlines() if ln.startswith("On request.")], p.stdout)


if __name__ == "__main__":
    unittest.main()
