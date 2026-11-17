"""The checks of one service's screens: the manifest field `service` and `tests/integration/run --services <file>`
(issue 327, requirement R1.2 and R4.1 to R4.4; test criteria `test_services_run`).

Check id `harness.services-run`. One class per heading of the test criteria.

The run fixture is the one of `test_on_request.py` (the stand-ins of `test_integration_not_run.py`, made with
`_fixture.make` under <checkout>/output/tests/services-run/<case>/), with the test's own manifest `M` of eight rows:
`alpha` is the service of `engine.tagged-r`, `studio.alpha-one` and `studio.alpha-two` (also labelled
`on-request`), `beta` that of `studio.beta-one`; `engine.plain-a`, `studio.plain-b`, `studio.beta-plain` (in the
file of `studio.beta-one`) and `studio.odd-c` (whose `service` is the number 7) are of no service. Unless a case
says otherwise the stand-ins write `passed` for every id of the manifest: a check that is left out is never counted
from a verdict file. `<file: X>` is a services file `{"services": X}`.

On a checkout without the change every case fails on its own, not at import: `run` refuses `--services` with its
usage line (exit 2, no report) and its report has no key `services`. The cases whose name says `guard` hold a
behavior of today and pass there already.
"""
import json
import re
import unittest

from _fixture import CHECKOUT, make
from test_integration_not_run import RUN, STANDIN, TOOLS, Fixture, grep_invert, lines_naming, list_text, out

GROUP = "services-run"
ON_REQUEST = "on request: not part of a default run; run it with --on-request"
USAGE = "usage: tests/integration/run [--not-run <file>] [--on-request] [--services <file>]"
FORM = re.compile(r"[a-z][a-z0-9]*(-[a-z0-9]+)*")
NONE = object()  # a row without the key `service`


def sentence(service):
    """The service sentence of `service`."""
    return f"service {service} not touched: its checks are not part of this run"


RS_A = "tests/integration/engine/tests/a.rs"
RS_R = "tests/integration/engine/tests/r.rs"
# (check_id, path, service, labels)
M = (
    ("engine.plain-a", RS_A, NONE, []),
    ("engine.tagged-r", RS_R, "alpha", []),
    ("studio.plain-b", "tests/integration/studio/b.spec.ts", NONE, []),
    ("studio.alpha-one", "tests/integration/studio/alpha-one.spec.ts", "alpha", []),
    ("studio.alpha-two", "tests/integration/studio/alpha-two.spec.ts", "alpha", ["on-request"]),
    ("studio.beta-one", "tests/integration/studio/beta.spec.ts", "beta", []),
    ("studio.beta-plain", "tests/integration/studio/beta.spec.ts", NONE, []),
    ("studio.odd-c", "tests/integration/studio/c.spec.ts", 7, []),
)
M_IDS = tuple(r[0] for r in M)
NO_SERVICE = ("engine.plain-a", "studio.plain-b", "studio.beta-plain", "studio.odd-c")
ALPHA = ("engine.tagged-r", "studio.alpha-one", "studio.alpha-two")


def rows_text(rows):
    """manifest.jsonl for (check_id, path, service, labels) rows."""
    text = ""
    for check_id, path, service, labels in rows:
        r = dict(check_id=check_id, path=path, module=check_id.split(".")[0], operations=[], issue=327,
                 labels=labels)
        if service is not NONE:
            r["service"] = service
        text += json.dumps(r) + "\n"
    return text


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

    def verdicts(self, extra=None):
        """The stand-ins write `passed` for every id of the rows, then `extra` ({id: verdict})."""
        rs = [r[0] for r in self.rows if r[1].endswith(".rs")]
        spec = [r[0] for r in self.rows if r[1].endswith(".spec.ts")]
        plan = dict(cargo={i: "passed" for i in rs}, playwright={i: "passed" for i in spec})
        for check_id, verdict in (extra or {}).items():
            plan["cargo" if check_id in rs else "playwright"][check_id] = verdict
        (self.case / "verdicts.json").write_text(json.dumps(plan))

    def services(self, value, name="services.json", **more):
        """A services file `{"services": value}` (and the keys `more`) in the case directory."""
        return self.file(name, json.dumps(dict(services=value, **more)))

    def tests(self):
        """The `cargo test` starts."""
        return [c for c in self.calls() if c["tool"] == "cargo" and c["args"][:1] == ["test"]]


def last_line(text):
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return lines[-1].strip() if lines else ""


class RunCase(unittest.TestCase):
    def report(self, fx, p):
        report = fx.report()
        self.assertIsNotNone(report, out(p))
        return report

    def whole(self, fx, p):
        """report.json as written, keys and all."""
        self.assertTrue(fx.report_path.exists(), out(p))
        return json.loads(fx.report_path.read_text())

    def verdicts(self, report):
        return {i: c["verdict"] for i, c in report.items()}

    def said(self, report, ids):
        """{id: (verdict, message)} of `ids`."""
        return {i: (report[i]["verdict"], report[i]["message"]) for i in ids}

    def assertPassed(self, report, ids):
        self.assertEqual({i: report[i]["verdict"] for i in ids}, {i: "passed" for i in ids})

    def assertLeftOut(self, report, ids, message):
        for check_id in ids:
            c = report[check_id]
            self.assertEqual((c["verdict"], c["seconds"], c["log"], c["message"]), ("not-run", 0, None, message),
                             check_id)


# ---------------------------------------------------------------------------------------------------- R4.1, R4.3

class Run(RunCase):
    def test_a_list_leaves_out_the_checks_of_the_other_services(self):
        fx = RunFixture("run-beta")
        p = fx.run("--services", fx.services(["beta"]))
        self.assertEqual(p.returncode, 0, out(p))
        report = self.report(fx, p)
        for check_id in ALPHA:
            c = report[check_id]
            self.assertEqual((c["verdict"], c["seconds"], c["log"]), ("not-run", 0, None), check_id)
        self.assertLeftOut(report, ("engine.tagged-r", "studio.alpha-one"), sentence("alpha"))
        self.assertPassed(report, ("studio.beta-one", *NO_SERVICE))
        for check_id in ALPHA:
            named = lines_naming(p, check_id)
            self.assertTrue(any(ln.startswith("not-run") for ln in named), f"no not-run line for {check_id}: {named}")

    def test_cargo_test_gets_the_ids_file_and_playwright_one_pattern(self):
        fx = RunFixture("run-commands")
        p = fx.run("--services", fx.services(["beta"]))
        tests = fx.tests()
        self.assertEqual(len(tests), 1, out(p))
        self.assertIsNotNone(tests[0]["not_run"], f"cargo test got no EMUFORGE_IT_NOT_RUN\n{out(p)}")
        text = tests[0]["not_run_text"]
        self.assertIsNotNone(text, f"EMUFORGE_IT_NOT_RUN={tests[0]['not_run']} named no file")
        self.assertEqual(sorted(text.splitlines()), sorted(ALPHA))
        pattern = grep_invert(self, fx.calls("playwright"))
        for left in ("studio.alpha-one", "studio.alpha-two"):
            self.assertRegex(f"x.spec.ts {left}", pattern)
        for other in ("studio.beta-one", "studio.beta-plain", "studio.plain-b", "studio.odd-c"):
            with self.subTest(other):
                self.assertIsNone(re.search(pattern, f"x.spec.ts {other}"), f"{pattern!r} matches {other}")

    def test_a_left_out_check_that_would_fail_does_not_fail_the_run(self):
        fx = RunFixture("run-left-out-fails")
        fx.verdicts(extra={"studio.alpha-one": "failed"})
        p = fx.run("--services", fx.services(["beta"]))
        report = self.report(fx, p)
        self.assertEqual(report["studio.alpha-one"]["verdict"], "not-run")
        self.assertEqual(p.returncode, 0, out(p))

    def test_a_listed_service_s_failure_fails_the_run(self):
        fx = RunFixture("run-listed-fails")
        fx.verdicts(extra={"studio.beta-one": "failed"})
        p = fx.run("--services", fx.services(["beta"]))
        report = self.report(fx, p)
        self.assertEqual(report["studio.beta-one"]["verdict"], "failed")
        self.assertEqual(p.returncode, 1, out(p))

    def test_an_empty_list_leaves_out_every_service_s_checks(self):
        fx = RunFixture("run-empty")
        p = fx.run("--services", fx.services([]))
        self.assertEqual(p.returncode, 0, out(p))
        report = self.report(fx, p)
        self.assertLeftOut(report, ("engine.tagged-r", "studio.alpha-one"), sentence("alpha"))
        self.assertLeftOut(report, ("studio.beta-one",), sentence("beta"))
        self.assertLeftOut(report, ("studio.alpha-two",), ON_REQUEST)
        self.assertPassed(report, NO_SERVICE)

    def test_a_check_left_out_by_its_service_counts_neither_way_in_relay_fidelity(self):
        rows = M + (("studio.alpha-same", "tests/integration/studio/alpha-same.spec.ts", "alpha", ["transparency"]),
                    ("studio.plain-same", "tests/integration/studio/plain-same.spec.ts", NONE, ["transparency"]))
        fx = RunFixture("run-relay", rows=rows)
        p = fx.run("--services", fx.services(["beta"]))
        self.assertEqual(p.returncode, 0, out(p))
        f = self.whole(fx, p)["relay_fidelity"]
        self.assertEqual((f["passed"], f["total"]), (1, 1))
        self.assertTrue(last_line(p.stderr).startswith("relay fidelity 1/1"), last_line(p.stderr))

    def test_null_is_every_service(self):
        fx = RunFixture("run-null")
        p = fx.run("--services", fx.services(None))
        self.assertEqual(p.returncode, 0, out(p))
        report = self.report(fx, p)
        self.assertPassed(report, [i for i in M_IDS if i != "studio.alpha-two"])
        self.assertLeftOut(report, ("studio.alpha-two",), ON_REQUEST)

    def test_a_name_no_row_has_is_no_error(self):
        fx = RunFixture("run-unknown-name")
        p = fx.run("--services", fx.services(["alpha", "gamma"]))
        self.assertEqual(p.returncode, 0, out(p))
        report = self.report(fx, p)
        self.assertEqual(sorted(i for i, v in self.verdicts(report).items() if v == "not-run"),
                         ["studio.alpha-two", "studio.beta-one"])

    def test_a_further_key_is_not_read(self):
        plain = RunFixture("run-key-plain")
        p = plain.run("--services", plain.services(["alpha"]))
        without = self.report(plain, p)
        self.assertLeftOut(without, ("studio.beta-one",), sentence("beta"))
        fx = RunFixture("run-key-why")
        p = fx.run("--services", fx.services(["alpha"], why="a further key"))
        self.assertEqual(p.returncode, 0, out(p))
        report = self.report(fx, p)
        self.assertEqual(self.said(report, M_IDS), self.said(without, M_IDS))

    def test_guard_a_row_s_service_alone_leaves_nothing_out(self):
        fx = RunFixture("run-default")
        p = fx.run()
        self.assertEqual(p.returncode, 0, out(p))
        report = self.report(fx, p)
        self.assertPassed(report, [i for i in M_IDS if i != "studio.alpha-two"])
        self.assertLeftOut(report, ("studio.alpha-two",), ON_REQUEST)
        pattern = grep_invert(self, fx.calls("playwright"))
        self.assertIsNone(re.search(pattern, "x.spec.ts studio.odd-c"), f"{pattern!r} matches studio.odd-c")


# ---------------------------------------------------------------------------------------------------- R4.2

class Reasons(RunCase):
    def test_on_request_comes_before_the_service(self):
        fx = RunFixture("reasons-on-request")
        p = fx.run("--services", fx.services(["beta"]))
        report = self.report(fx, p)
        self.assertLeftOut(report, ("studio.alpha-two",), ON_REQUEST)

    def test_with_the_option_the_service_is_the_reason(self):
        fx = RunFixture("reasons-option")
        p = fx.run("--services", fx.services(["beta"]), "--on-request")
        report = self.report(fx, p)
        self.assertLeftOut(report, ("studio.alpha-two",), sentence("alpha"))

    def test_with_the_option_a_listed_service_s_check_on_request_runs(self):
        fx = RunFixture("reasons-option-listed")
        p = fx.run("--services", fx.services(["alpha"]), "--on-request")
        report = self.report(fx, p)
        self.assertEqual(report["studio.alpha-two"]["verdict"], "passed")

    def test_the_not_run_list_comes_first_in_either_order(self):
        reason = "listed: alpha one"
        for name, list_first in (("list-first", True), ("services-first", False)):
            with self.subTest(name):
                fx = RunFixture(f"reasons-{name}")
                listed = fx.file("list.json", list_text({"studio.alpha-one": reason}))
                services = fx.services(["beta"])
                args = (("--not-run", listed, "--services", services) if list_first
                        else ("--services", services, "--not-run", listed))
                p = fx.run(*args)
                report = self.report(fx, p)
                self.assertLeftOut(report, ("studio.alpha-one",), reason)
                self.assertLeftOut(report, ("engine.tagged-r",), sentence("alpha"))


# ---------------------------------------------------------------------------------------------------- R4.4

class Report(RunCase):
    def test_the_list_is_reported_sorted_without_repeats(self):
        fx = RunFixture("report-list")
        p = fx.run("--services", fx.services(["beta", "alpha", "beta"]))
        r = self.whole(fx, p)
        self.assertIn("services", r)
        self.assertEqual(r["services"], ["alpha", "beta"])

    def test_null_is_reported_null(self):
        fx = RunFixture("report-null")
        p = fx.run("--services", fx.services(None))
        self.assertEqual(p.returncode, 0, out(p))
        r = self.whole(fx, p)
        self.assertIn("services", r)
        self.assertIsNone(r["services"])

    def test_a_run_without_the_option_reports_null(self):
        fx = RunFixture("report-default")
        p = fx.run()
        r = self.whole(fx, p)
        self.assertIn("services", r)
        self.assertIsNone(r["services"])


# ---------------------------------------------------------------------------------------------------- R4.1, D9

class Refusals(RunCase):
    def test_a_bad_services_file_is_an_error_of_every_check_before_anything_starts(self):
        table = {
            "missing": None,
            "not-json": "{not json",
            "a-list": json.dumps(["alpha"]),
            "no-key": json.dumps(dict(names=["alpha"])),
            "a-string": json.dumps(dict(services="alpha")),
            "a-number": json.dumps(dict(services=["alpha", 7])),
            "upper-case": json.dumps(dict(services=["Alpha"])),
            "a-slash": json.dumps(dict(services=["a/b"])),
        }
        for name, text in table.items():
            with self.subTest(name):
                fx = RunFixture(f"refused-{name}")
                path = fx.case / "services.json" if text is None else fx.file("services.json", text)
                p = fx.run("--services", path)
                self.assertEqual(p.returncode, 127, out(p))
                report = self.report(fx, p)
                self.assertEqual(sorted(report), sorted(M_IDS))
                for check_id, c in report.items():
                    self.assertEqual(c["verdict"], "error", check_id)
                    self.assertTrue(c["message"].startswith("services file"), f"{check_id}: {c['message']!r}")
                    self.assertIn(str(path), c["message"], check_id)
                self.assertEqual([c["tool"] for c in fx.calls()], [], "a stand-in was started")

    def test_the_option_twice_or_without_a_file_is_the_usage_line(self):
        table = {
            "no-file": lambda fx: ["--services"],
            "twice": lambda fx: ["--services", fx.services(["beta"]), "--services", fx.services(["beta"])],
        }
        for name, args in table.items():
            with self.subTest(name):
                fx = RunFixture(f"usage-{name}")
                p = fx.run(*args(fx))
                self.assertEqual(p.returncode, 2, out(p))
                self.assertEqual(last_line(p.stderr), USAGE, p.stderr)
                self.assertEqual([c["tool"] for c in fx.calls()], [], "a stand-in was started")
                self.assertFalse(fx.report_path.exists(), "report.json was written")


# ---------------------------------------------------------------------------------------------------- R1.2

class Manifest(unittest.TestCase):
    def test_guard_a_row_s_service_is_a_name_of_a_studio_check(self):
        text = (CHECKOUT / "tests" / "integration" / "manifest.jsonl").read_text()
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        for r in rows:
            if "service" not in r:
                continue
            with self.subTest(r.get("check_id")):
                self.assertIsInstance(r["service"], str)
                self.assertRegex(r["service"], r"\A" + FORM.pattern + r"\Z")
                self.assertTrue(str(r.get("path", "")).endswith(".spec.ts"), r)
                self.assertEqual(r.get("module"), "studio", r)


if __name__ == "__main__":
    unittest.main()
