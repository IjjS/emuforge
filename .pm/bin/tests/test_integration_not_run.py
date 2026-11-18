"""tests/integration/run --not-run <file>: refusals, the report, what is passed to cargo and Playwright, and the
engine check's early return (issue 53, R3.4 to R3.6).

A fixture checkout holds copies of tests/integration/run and the manifest, an engine/Cargo.toml, a
studio/package.json with a stand-in studio/node_modules/.bin/playwright, a made-up HOME, and stand-ins for docker,
cargo, bun, node, curl and shasum first on PATH. Every stand-in appends its tool name, its arguments and
EMUFORGE_IT_NOT_RUN (with the text of the file it names) to <case>/calls.jsonl; the cargo test and playwright
stand-ins write the verdict files <case>/verdicts.json gives them into EMUFORGE_IT_VERDICTS.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import unittest

from _fixture import CHECKOUT, clean_env, make

RUN = CHECKOUT / "tests" / "integration" / "run"
MANIFEST = CHECKOUT / "tests" / "integration" / "manifest.jsonl"
GROUP = "integration-not-run"
TOOLS = ("docker", "cargo", "bun", "node", "curl", "shasum")

STANDIN = f"""#!{sys.executable} -I
import json, os, pathlib, sys
tool = os.path.basename(sys.argv[0])
case = pathlib.Path(os.environ["STANDIN_DIR"])
args = sys.argv[1:]
named = os.environ.get("EMUFORGE_IT_NOT_RUN")
record = dict(tool=tool, args=args, not_run=named, not_run_text=None)
if named is not None and os.path.isfile(named):
    record["not_run_text"] = pathlib.Path(named).read_text()
with open(case / "calls.jsonl", "a") as f:
    f.write(json.dumps(record) + "\\n")


def write_verdicts(kind):
    plan = json.loads((case / "verdicts.json").read_text())[kind]
    out = pathlib.Path(os.environ["EMUFORGE_IT_VERDICTS"])
    for check_id, verdict in plan.items():
        (out / (check_id + ".json")).write_text(json.dumps(dict(
            check_id=check_id, verdict=verdict, seconds=0, log=None, message="")))


if tool == "docker" and "--version" in args:
    print("Version: 0.0.0-standin")
    print("Commit: 0000000")
elif tool == "curl":
    print("ok")
elif tool == "cargo" and args[:1] == ["metadata"]:
    print(json.dumps(dict(target_directory=str(case / "target"))))
elif tool == "cargo" and args[:1] == ["test"]:
    write_verdicts("cargo")
elif tool == "playwright":
    write_verdicts("playwright")
"""


def manifest():
    """The checkout's manifest rows, in order."""
    return [json.loads(line) for line in MANIFEST.read_text().splitlines() if line.strip()]


ROWS = manifest()
IDS = [r["check_id"] for r in ROWS]
ENGINE_IDS = [r["check_id"] for r in ROWS if r["path"].endswith(".rs")]
SPEC_IDS = [r["check_id"] for r in ROWS if r["path"].endswith(".spec.ts")]
PRODUCT_IDS = [i for i in IDS if i.startswith("engine.product-")]
# the ids of the rows labelled `on-request` (issue 315): a run without --on-request leaves them out
ON = [r["check_id"] for r in ROWS if isinstance(r.get("labels"), list) and "on-request" in r["labels"]]
# one id of an engine test file and one of a .spec.ts file
ENGINE_ID = "engine.health-reports-emulator-reachable"
SPEC_ID = "studio.home-shows-connected"
LIST = {ENGINE_ID: "listed engine check: reason one", SPEC_ID: "listed studio check: reason two"}


def list_text(checks):
    """A not-run list of the shape of R3.1 for {id: reason}."""
    return json.dumps(dict(checks=[dict(id=i, reason=r, issue=54) for i, r in checks.items()],
                           steps=[dict(step="harness-test", reason="runs on the owner's machine")]))


class Fixture:
    """One fixture checkout with its stand-ins; `case` is its own directory, ignored by the checkout's git."""

    def __init__(self, name):
        self.co = make(GROUP, name, (), {
            "tests/integration/run": RUN.read_text(),
            "tests/integration/manifest.jsonl": MANIFEST.read_text(),
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
        self.verdicts(passed_except=())

    def verdicts(self, passed_except, extra=None):
        """The stand-ins write `passed` for every manifest id but `passed_except`, then `extra` ({id: verdict})."""
        plan = dict(cargo={i: "passed" for i in ENGINE_IDS if i not in passed_except},
                    playwright={i: "passed" for i in SPEC_IDS if i not in passed_except})
        for check_id, verdict in (extra or {}).items():
            plan["cargo" if check_id in ENGINE_IDS else "playwright"][check_id] = verdict
        (self.case / "verdicts.json").write_text(json.dumps(plan))

    def file(self, name, text):
        p = self.case / name
        p.write_text(text)
        return p

    def run(self, *args, env=None):
        e = clean_env()
        for name in ("EMULATOR_PORT", "EMUFORGE_ENGINE_PORT", "EMUFORGE_STUDIO_PORT", "EMUFORGE_IT_NOT_RUN"):
            e.pop(name, None)
        e.update(PATH=f"{self.bin}{os.pathsep}{e.get('PATH', '/usr/bin:/bin')}", HOME=str(self.co / "home"),
                 STANDIN_DIR=str(self.case))
        e.update(env or {})
        return subprocess.run([str(self.co / "tests" / "integration" / "run"), *map(str, args)],
                              capture_output=True, text=True, env=e, cwd=str(self.co), timeout=120)

    @property
    def report_path(self):
        return self.co / "output" / "integration" / "report.json"

    def report(self):
        """report.json by check id, or None when there is none."""
        if not self.report_path.exists():
            return None
        return {c["check_id"]: c for c in json.loads(self.report_path.read_text())["checks"]}

    def calls(self, tool=None):
        f = self.case / "calls.jsonl"
        rows = [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []
        return [r for r in rows if tool is None or r["tool"] == tool]


def out(p):
    return p.stdout + p.stderr


def lines_naming(p, check_id):
    """The output lines that name `check_id` as a word, stripped."""
    return [line.strip() for line in out(p).splitlines() if check_id in line.split()]


def grep_invert(case, calls):
    """The one pattern the playwright stand-in got after --grep-invert."""
    runs = [c["args"] for c in calls]
    case.assertEqual(len(runs), 1, f"playwright was not started once: {runs}")
    args = runs[0]
    case.assertEqual(args.count("--grep-invert"), 1, f"no single --grep-invert in the playwright arguments {args}")
    i = args.index("--grep-invert")
    case.assertLess(i + 1, len(args), f"--grep-invert without a pattern: {args}")
    return args[i + 1]


class Refused(unittest.TestCase):
    def test_a_bad_list_is_an_error_of_every_check_before_anything_starts(self):
        a = ENGINE_ID
        table = {
            "missing": None,
            "not-json": "{not json",
            "no-checks": json.dumps(dict(steps=[])),
            "empty-reason": json.dumps(dict(checks=[dict(id=a, reason="", issue=54)], steps=[])),
            "unknown-id": json.dumps(dict(checks=[dict(id="engine.no-such-check", reason="r", issue=54)], steps=[])),
            "twice": json.dumps(dict(checks=[dict(id=a, reason="r", issue=54), dict(id=a, reason="r", issue=54)],
                                     steps=[])),
        }
        for name, text in table.items():
            with self.subTest(name):
                fx = Fixture(f"refused-{name}")
                path = fx.case / "list.json" if text is None else fx.file("list.json", text)
                p = fx.run("--not-run", path)
                self.assertEqual(p.returncode, 127, out(p))
                report = fx.report()
                self.assertIsNotNone(report, out(p))
                self.assertEqual(sorted(report), sorted(IDS))
                for check_id, c in report.items():
                    self.assertEqual(c["verdict"], "error", check_id)
                    self.assertTrue(c["message"].startswith("not-run list"), f"{check_id}: {c['message']!r}")
                self.assertEqual([c["tool"] for c in fx.calls() if c["tool"] in ("docker", "cargo")], [],
                                 "docker or cargo was started")

    def test_an_unknown_argument_or_a_missing_file_is_a_usage_error(self):
        for name, args in {"bogus": ["--bogus"], "no-file": ["--not-run"]}.items():
            with self.subTest(name):
                fx = Fixture(f"usage-{name}")
                p = fx.run(*args)
                self.assertEqual(p.returncode, 2, out(p))
                self.assertRegex(p.stderr, r"(?im)^.*usage.*--not-run")
                self.assertFalse(fx.report_path.exists(), "report.json was written")
                self.assertEqual([c["tool"] for c in fx.calls() if c["tool"] in ("docker", "cargo")], [],
                                 "docker or cargo was started")


class Report(unittest.TestCase):
    def test_listed_checks_are_not_run_with_their_reason(self):
        fx = Fixture("report-listed")
        fx.verdicts(passed_except=LIST)
        p = fx.run("--not-run", fx.file("list.json", list_text(LIST)))
        self.assertEqual(p.returncode, 0, out(p))
        report = fx.report()
        self.assertIsNotNone(report, out(p))
        for check_id, reason in LIST.items():
            self.assertEqual((report[check_id]["verdict"], report[check_id]["message"]), ("not-run", reason))
            named = lines_naming(p, check_id)
            self.assertTrue(any(line.startswith("not-run") for line in named), f"no not-run line for {check_id}")
            self.assertFalse(any(line.startswith("passed") for line in named), f"a passed line for {check_id}")
        others = {i: c["verdict"] for i, c in report.items() if i not in LIST}
        self.assertEqual(len(others), len(IDS) - 2)
        self.assertEqual({i: v for i, v in others.items() if i not in ON and v != "passed"}, {})
        self.assertEqual({i: v for i, v in others.items() if i in ON}, {i: "not-run" for i in ON if i not in LIST})

    def test_a_listed_check_stays_not_run_and_an_unlisted_failure_fails_the_run(self):
        fx = Fixture("report-failed")
        unlisted = next(i for i in ENGINE_IDS if i not in LIST)
        fx.verdicts(passed_except=LIST, extra={ENGINE_ID: "failed", unlisted: "failed"})
        p = fx.run("--not-run", fx.file("list.json", list_text(LIST)))
        report = fx.report()
        self.assertIsNotNone(report, out(p))
        self.assertEqual(report[ENGINE_ID]["verdict"], "not-run")
        self.assertEqual(report[unlisted]["verdict"], "failed")
        self.assertEqual(p.returncode, 1, out(p))

    def test_a_list_of_every_check_checks_nothing(self):
        fx = Fixture("report-every")
        # The stand-ins write `passed` for every id, listed or not: a listed check is never counted as passed.
        fx.verdicts(passed_except=())
        p = fx.run("--not-run", fx.file("list.json", list_text({i: "every check listed" for i in IDS})))
        self.assertEqual(p.returncode, 127, out(p))

    def test_without_the_option_the_environment_lists_nothing(self):
        fx = Fixture("report-env")
        every = fx.file("every.txt", "".join(i + "\n" for i in IDS))
        p = fx.run(env={"EMUFORGE_IT_NOT_RUN": str(every)})
        report = fx.report()
        self.assertIsNotNone(report, out(p))
        self.assertEqual(sorted(i for i, c in report.items() if c["verdict"] == "not-run"), sorted(ON))
        tests = [c for c in fx.calls("cargo") if c["args"][:1] == ["test"]]
        self.assertTrue(tests, "cargo test was not started")
        for c in tests:
            self.assertNotEqual(c["not_run"], str(every), "the caller's EMUFORGE_IT_NOT_RUN reached cargo test")
            if not ON:
                self.assertIsNone(c["not_run"], "EMUFORGE_IT_NOT_RUN reached cargo test")
            elif c["not_run"] is not None:
                self.assertEqual(sorted((c["not_run_text"] or "").splitlines()), sorted(ON))
        runs = fx.calls("playwright")
        self.assertTrue(runs, "playwright was not started")
        spec_on = [i for i in ON if i in SPEC_IDS]
        if not spec_on:
            self.assertEqual([c["args"] for c in runs if "--grep-invert" in c["args"]], [])
        else:
            pattern = grep_invert(self, runs)
            self.assertEqual([i for i in SPEC_IDS if bool(re.search(pattern, f"x.spec.ts {i}")) != (i in spec_on)],
                             [], f"{pattern!r} does not match exactly the .spec.ts ids of {ON}")


class Passed_on(unittest.TestCase):
    def test_cargo_test_gets_a_file_of_the_listed_ids(self):
        fx = Fixture("passed-cargo")
        fx.verdicts(passed_except=LIST)
        p = fx.run("--not-run", fx.file("list.json", list_text(LIST)))
        tests = [c for c in fx.calls("cargo") if c["args"][:1] == ["test"]]
        self.assertEqual(len(tests), 1, out(p))
        self.assertIsNotNone(tests[0]["not_run"], "cargo test got no EMUFORGE_IT_NOT_RUN")
        text = tests[0]["not_run_text"]
        self.assertIsNotNone(text, f"EMUFORGE_IT_NOT_RUN={tests[0]['not_run']} named no file")
        lines = text.splitlines()
        self.assertEqual(sorted(lines), sorted({*LIST, *ON}))

    def test_playwright_gets_one_pattern_that_matches_the_listed_id_only(self):
        fx = Fixture("passed-playwright")
        fx.verdicts(passed_except=LIST)
        fx.run("--not-run", fx.file("list.json", list_text(LIST)))
        pattern = grep_invert(self, fx.calls("playwright"))
        unlisted = next(i for i in SPEC_IDS if i not in LIST)
        self.assertRegex(f"x.spec.ts {SPEC_ID}", pattern)
        for other in (unlisted, SPEC_ID + "-more", SPEC_ID + "x", "pre-" + SPEC_ID, "x" + SPEC_ID):
            with self.subTest(other):
                self.assertIsNone(re.search(pattern, f"x.spec.ts {other}"), f"{pattern!r} matches {other}")

    def test_the_real_playwright_leaves_out_the_listed_product_checks(self):
        playwright = CHECKOUT / "studio" / "node_modules" / ".bin" / "playwright"
        self.assertTrue(os.access(playwright, os.X_OK),
                        f"{playwright} is missing: install Studio's dependencies (bun install --frozen-lockfile)")
        self.assertEqual(len(PRODUCT_IDS), 22)
        fx = Fixture("passed-real-playwright")
        products = {i: "the product form does not run on Docker Engine on Linux" for i in PRODUCT_IDS}
        fx.verdicts(passed_except=products)
        fx.run("--not-run", fx.file("list.json", list_text(products)))
        pattern = grep_invert(self, fx.calls("playwright"))
        # The suite's own reporter prints no listing; the list reporter does.
        e = {k: v for k, v in clean_env().items() if not k.startswith(("AWS_", "EMUFORGE_"))}
        e["NODE_PATH"] = str(CHECKOUT / "studio" / "node_modules")
        p = subprocess.run([str(playwright), "test", "--config", "tests/integration/studio/playwright.config.ts",
                            "--list", "--reporter", "list", "--grep-invert", pattern],
                           capture_output=True, text=True, env=e, cwd=str(CHECKOUT), timeout=300)
        self.assertEqual(p.returncode, 0, out(p))
        listed = set(re.findall(r"› (\S+)\s*$", p.stdout, re.M))
        self.assertEqual(sorted(set(PRODUCT_IDS) & listed), [])
        self.assertEqual(sorted(set(SPEC_IDS) - set(PRODUCT_IDS) - set(ON) - listed), [])
        self.assertEqual(sorted(set(SPEC_IDS) & set(ON) & listed), [])


class Engine_check(unittest.TestCase):
    CHECK = "engine.health-reports-emulator-reachable"

    def cargo_test(self, name, not_run):
        """The test function of CHECK alone, with no engine and no emulator; returns (process, verdicts dir)."""
        d = CHECKOUT / "output" / "tests" / GROUP / f"engine-{name}"
        if d.exists():
            shutil.rmtree(d)
        verdicts = d / "verdicts"
        verdicts.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, d, True)
        e = {k: v for k, v in clean_env().items()
             if not k.startswith(("AWS_", "EMUFORGE_")) and k != "EMULATOR_PORT"}
        e.update(EMUFORGE_IT_VERDICTS=str(verdicts), EMUFORGE_IT_NOT_RUN=str(not_run(d)))
        manifest_path = CHECKOUT / "tests" / "integration" / "engine" / "Cargo.toml"
        # --show-output prints what the passing test wrote, which libtest captures otherwise.
        p = subprocess.run(["cargo", "test", "--manifest-path", str(manifest_path), "--test", "health", "--",
                            "--exact", "health_reports_emulator_reachable", "--show-output"],
                           capture_output=True, text=True, env=e, timeout=1200)
        return p, verdicts

    def files(self, d):
        return sorted(str(p.relative_to(d)) for p in d.rglob("*") if p.is_file())

    def test_a_listed_check_returns_early_and_writes_no_verdict(self):
        def listing(d):
            f = d / "not-run.txt"
            f.write_text(self.CHECK + "\n")
            return f
        p, verdicts = self.cargo_test("listed", listing)
        self.assertEqual(p.returncode, 0, out(p)[-4000:])
        self.assertEqual(self.files(verdicts), [])
        self.assertRegex(out(p), rf"(?m)(^|\s)not-run {re.escape(self.CHECK)}\s*$")

    def test_a_missing_list_file_fails_naming_it_and_writes_no_verdict(self):
        missing = []

        def absent(d):
            missing.append(d / "no-such-list.txt")
            return missing[0]
        p, verdicts = self.cargo_test("missing", absent)
        self.assertNotEqual(p.returncode, 0, out(p)[-4000:])
        self.assertIn(str(missing[0]), out(p))
        self.assertEqual(self.files(verdicts), [])


if __name__ == "__main__":
    unittest.main()
