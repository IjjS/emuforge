"""The checks of the touched services on GitHub Actions: `.github/ci services`, the text of
`.github/workflows/main.yml` and `full.yml`, the form of a service name in three files and the guides (issue 327,
requirement R5 to R7; test criteria `test_services_ci`).

Check id `harness.services-ci`. One class per heading of the test criteria (`Services`, `Workflow`, `Form`,
`Guides`).

The ci fixture is `Case` of `test_ci.py` (a fixture checkout made with `_fixture.make`, here under
<checkout>/output/tests/services-ci/<case>/, with a copy of .github/ci), with the real `pm-scope` and `pm-check`
copied in beside every `_pm*.py` helper, and the test's own manifest `M` of eight rows committed on `main`. A push
is made in the fixture: `before` is `main`'s commit, then one commit per case changes the paths the case names
and `GITHUB_SHA` is the new commit. The case writes the event file `{"before": <before>}` into its own directory
and sets `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_SHA` and `GITHUB_STEP_SUMMARY` itself; nothing reaches
GitHub. `F` is <fixture>/output/ci/services.json.

`Workflow`, `Form` and `Guides` read the checkout's own files as text; the sentence helpers are those of
`test_ci_docs.py`, the workflow helpers those of `test_ci.py`.

Without the change every case fails on its own, not at import: `.github/ci` has no subcommand `services`,
`main.yml` has no step `services` and no `--services`, `full.yml` does not exist, the three files do not hold the
form and the guides do not say it. The case whose name says `guard` holds a behavior of today and passes there
already.
"""
import json
import re
import shlex
import shutil
import unittest

import test_ci
import test_ci_docs as docs
from _fixture import CHECKOUT, git, make

GROUP = "services-ci"
S = "studio/src/providers/aws/area/services/"
ISSUE_FILE = "issues/things-that-do-not-work/20261117T000000Z-fixture-issue.md"
FORM = "[a-z][a-z0-9]*(-[a-z0-9]+)*"
ZEROS = "0" * 40
SERVICES_PREFIX = "  services     "

MAIN_YML = CHECKOUT / ".github" / "workflows" / "main.yml"
FULL_YML = CHECKOUT / ".github" / "workflows" / "full.yml"
FORM_FILES = (CHECKOUT / ".pm" / "bin" / "_pmscope.py", CHECKOUT / "tests" / "integration" / "run",
              CHECKOUT / ".github" / "ci")
INTEGRATION_GUIDE = CHECKOUT / "tests" / "integration" / "AGENTS.md"
ROOT_GUIDE = CHECKOUT / "AGENTS.md"
SKILL = CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md"

NO_SERVICE = object()  # a row without the key `service`
M = (  # (check_id, path, service, labels)
    ("engine.plain-a", "tests/integration/engine/tests/a.rs", NO_SERVICE, []),
    ("engine.tagged-r", "tests/integration/engine/tests/r.rs", "alpha", []),
    ("studio.plain-b", "tests/integration/studio/b.spec.ts", NO_SERVICE, []),
    ("studio.alpha-one", "tests/integration/studio/alpha-one.spec.ts", "alpha", []),
    ("studio.alpha-two", "tests/integration/studio/alpha-two.spec.ts", "alpha", ["on-request"]),
    ("studio.beta-one", "tests/integration/studio/beta.spec.ts", "beta", []),
    ("studio.beta-plain", "tests/integration/studio/beta.spec.ts", NO_SERVICE, []),
    ("studio.odd-c", "tests/integration/studio/c.spec.ts", 7, []),
)
CHECKS_OF = {"alpha": 3, "beta": 1}  # the rows of M that name each service


def manifest_text():
    out = []
    for cid, path, service, labels in M:
        row = {"check_id": cid, "path": path, "module": cid.split(".")[0], "operations": [], "labels": labels,
               "issue": 327}
        if service is not NO_SERVICE:
            row["service"] = service
        out.append(json.dumps(row) + "\n")
    return "".join(out)


# ---------------------------------------------------------------------------------------------- ci services

class Services(test_ci.Case):
    """A fixture checkout with .github/ci, pm-scope, pm-check, the helpers and M on `main`."""

    def setUp(self):
        if not test_ci.CI.exists():
            self.fail(f"{test_ci.CI} does not exist")
        case = f"{type(self).__name__}-{self._testMethodName}".lower().replace("_", "-")
        self.co = make(GROUP, case, ("pm-check", "pm-scope"),
                       {"tests/integration/manifest.jsonl": manifest_text(), "studio/package.json": "{}\n"})
        (self.co / ".github").mkdir(exist_ok=True)
        shutil.copy2(test_ci.CI, self.co / ".github" / "ci")
        (self.co / ".github" / "ci").chmod(0o755)
        self.dir = self.co / "output" / "case"
        self.dir.mkdir(parents=True)
        self.F = self.co / "output" / "ci" / "services.json"
        self.summary = self.dir / "summary.md"
        self.summary.write_text("")
        self.event = self.dir / "event.json"

    def head(self):
        return git(self.co, "rev-parse", "HEAD")

    def push(self, *paths):
        """One commit on `main` that changes `paths`; (before, after)."""
        before = self.head()
        for rel in paths:
            p = self.co / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text((p.read_text() if p.exists() else "") + "// changed by the case\n")
        git(self.co, "add", "-A")
        git(self.co, "commit", "-q", "-m", "a push")
        return before, self.head()

    def services(self, before, after, name="push", event=None):
        """`.github/ci services` with the event file `{"before": before}` (or `event`, written as given; a value
        of None writes no file) and the three variables."""
        if event is None:
            self.event.write_text(json.dumps({"before": before}))
        elif event is not False:
            self.event.write_text(event)
        env = {k: v for k, v in self.env().items() if not k.startswith("GITHUB_")}
        env.update(GITHUB_EVENT_NAME=name, GITHUB_EVENT_PATH=str(self.event), GITHUB_SHA=after,
                   GITHUB_STEP_SUMMARY=str(self.summary))
        return self.ci("services", env=env)

    def selected(self):
        """The value of `services` in F."""
        self.assertTrue(self.F.exists(), f"{self.F} was not written")
        data = json.loads(self.F.read_text())
        self.assertIsInstance(data, dict, f"{self.F} is not an object")
        self.assertIn("services", data, f"{self.F} has no key `services`")
        return data["services"]

    def services_line(self, p):
        found = [ln for ln in test_ci.lines_of(p) if ln.startswith(SERVICES_PREFIX)]
        self.assertEqual(len(found), 1, f"not one line starting `{SERVICES_PREFIX}`:\n{p.stdout}{p.stderr}")
        return found[0]

    def assertNotRun(self, p, service):
        n = CHECKS_OF[service]
        want = re.compile(rf"not run  service {service}  {n} checks?")
        self.assertTrue(any(want.fullmatch(ln) for ln in test_ci.lines_of(p)),
                        f"no line `not run  service {service}  {n} checks`:\n{p.stdout}{p.stderr}")

    def assertEveryService(self, p, label):
        self.assertEqual(p.returncode, 0, f"{label}:\n{p.stdout}{p.stderr}")
        self.assertIsNone(self.selected(), f"{label}: `services` in {self.F} is not null")
        line = self.services_line(p)
        self.assertRegex(line, rf"^{SERVICES_PREFIX}every service: \S", f"{label}: no reason")

    def test_a_push_of_one_service(self):
        before, after = self.push(S + "beta/a.ts")
        p = self.services(before, after)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.selected(), ["beta"])
        self.assertTrue(self.services_line(p).startswith(SERVICES_PREFIX + "beta"), p.stdout)
        self.assertTrue(any(ln == "not run  service alpha  3 checks" for ln in test_ci.lines_of(p)),
                        f"no line `not run  service alpha  3 checks`:\n{p.stdout}{p.stderr}")
        text = self.summary.read_text()
        lines = text.splitlines()
        heading = [i for i, ln in enumerate(lines) if re.fullmatch(r"#+ Services\s*", ln)]
        self.assertEqual(len(heading), 1, f"the summary has not one heading `Services`:\n{text}")
        table = []
        for ln in lines[heading[0] + 1:]:
            if re.match(r"#+ ", ln):
                break
            if ln.startswith("|"):
                table.append(ln)
        self.assertTrue(any(re.search(r"\bbeta\b", ln) for ln in table), f"no row of the table names beta:\n{text}")
        self.assertTrue(any(re.search(r"\balpha\b", ln) and "not run" in ln and re.search(r"\b3\b", ln)
                            for ln in table), f"no row of the table names alpha, not run and 3:\n{text}")

    def test_a_shared_path_is_every_service(self):
        before, after = self.push("studio/package.json")
        p = self.services(before, after)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIsNone(self.selected())
        line = self.services_line(p)
        self.assertTrue(line.startswith(SERVICES_PREFIX + "every service"), line)
        self.assertIn("studio/package.json", line)

    def test_a_push_of_no_service(self):
        before, after = self.push(ISSUE_FILE)
        p = self.services(before, after)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.selected(), [])
        self.assertNotRun(p, "alpha")
        self.assertNotRun(p, "beta")

    def test_every_doubt_is_every_service(self):
        before, after = self.push(S + "beta/a.ts")
        root = git(self.co, "rev-list", "--max-parents=0", "HEAD")
        side = git(self.co, "commit-tree", f"{root}^{{tree}}", "-p", root, "-m", "a commit beside main")
        scope = self.co / ".pm" / "bin" / "pm-scope"
        real = scope.read_text()

        def failing_scope():
            scope.write_text("#!/bin/sh\nexit 1\n")
            scope.chmod(0o755)

        cases = [
            ("GITHUB_EVENT_NAME is workflow_dispatch", dict(name="workflow_dispatch"), None),
            ("the event file is missing", dict(event=False), lambda: self.event.unlink(missing_ok=True)),
            ("the event file is not JSON", dict(event='{"before": '), None),
            ("the event has no before", dict(event=json.dumps({"after": after})), None),
            ("before is forty zeros", dict(event=json.dumps({"before": ZEROS})), None),
            ("before is --help", dict(event=json.dumps({"before": "--help"})), None),
            ("GITHUB_SHA is not forty hexadecimal digits", dict(after="HEAD"), None),
            ("before is not an ancestor of GITHUB_SHA", dict(event=json.dumps({"before": side})), None),
            ("pm-scope exits 1", {}, failing_scope),
        ]
        for label, how, prepare in cases:
            with self.subTest(label):
                scope.write_text(real)
                self.F.unlink(missing_ok=True)
                if prepare:
                    prepare()
                p = self.services(before, how.get("after", after), name=how.get("name", "push"),
                                  event=how.get("event"))
                self.assertEveryService(p, label)
        scope.write_text(real)

    def test_the_event_name_is_not_printed(self):
        before, after = self.push(S + "beta/a.ts")
        name = "push\n::error title=fixture::event-name-of-the-case"
        p = self.services(before, after, name=name)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        both = p.stdout + p.stderr
        self.assertNotIn("event-name-of-the-case", both)
        self.assertNotIn("::error", both)

    def test_an_unwritable_output_folder(self):
        before, after = self.push(S + "beta/a.ts")
        (self.co / "output" / "ci").write_text("a file where the folder would be\n")
        p = self.services(before, after)
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        named = [ln for ln in test_ci.lines_of(p) if "output/ci/services.json" in ln]
        self.assertEqual(len(named), 1, f"not one line naming output/ci/services.json:\n{p.stdout}{p.stderr}")

    def test_an_unknown_subcommand(self):
        p = self.ci("no-such-subcommand")
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        usage = [ln for ln in test_ci.lines_of(p) if ln.startswith("usage: .github/ci")]
        self.assertEqual(len(usage), 1, p.stdout + p.stderr)
        self.assertRegex(usage[0], r"\bservices\b")


# ---------------------------------------------------------------------------------------------- workflows

def read_workflow(path):
    if not path.exists():
        raise AssertionError(f"{path} does not exist")
    text = path.read_text()
    return text, test_ci.workflow_steps(text)


def named(steps, name):
    found = [s for s in steps if s["name"] == name]
    if len(found) != 1:
        raise AssertionError(f"not one step named {name}: {len(found)}")
    return found[0]


def body(step):
    """The step's lines without blank lines and lines that hold only a comment."""
    return [ln.rstrip() for ln in step["lines"] if ln.strip() and not ln.strip().startswith("#")]


def with_block(step):
    """The stripped lines under the step's `with:`."""
    lines = step["lines"]
    at = [i for i, ln in enumerate(lines) if re.match(r"^\s*with:\s*$", test_ci.strip_comment(ln))]
    if not at:
        return []
    indent = len(lines[at[0]]) - len(lines[at[0]].lstrip())
    out = []
    for ln in lines[at[0] + 1:]:
        s = test_ci.strip_comment(ln)
        if not s.strip():
            continue
        if len(s) - len(s.lstrip()) <= indent:
            break
        out.append(s.strip())
    return out


MAIN_RUN_END = "./run --not-run ../../.github/not-run.json --services ../../output/ci/services.json"
FULL_STEPS = ("checkout", "node", "not-run", "versions", "rust", "bun", "tools", "studio dependencies", "chromium",
              "emulator image", "integration", "integration (second run)")
FULL_RUN = "../../.github/ci run --tails -- ./run --not-run ../../.github/not-run.json"
FULL_SECOND = "../../.github/ci run --second integration --tails -- ./run --not-run ../../.github/not-run.json"
TRIGGERS = ("push", "pull_request", "pull_request_target", "schedule", "workflow_run", "workflow_call")


class Workflow(unittest.TestCase):
    def test_main_checkout_fetches_the_history(self):
        _text, steps = read_workflow(MAIN_YML)
        held = with_block(named(steps, "checkout"))
        self.assertIn("fetch-depth: 0", held)
        self.assertIn("persist-credentials: false", held)

    def test_main_services_step(self):
        _text, steps = read_workflow(MAIN_YML)
        at = [i for i, s in enumerate(steps) if shlex.split(test_ci.step_key(s, "run") or "")[:2]
              == [".github/ci", "services"]]
        self.assertEqual(len(at), 1, "not one step runs .github/ci services")
        not_run = [i for i, s in enumerate(steps) if ".github/ci not-run" in (test_ci.step_key(s, "run") or "")]
        self.assertTrue(not_run, "no step runs .github/ci not-run")
        fmt = [i for i, s in enumerate(steps) if s["name"] == "engine-fmt"]
        self.assertTrue(fmt, "no step engine-fmt")
        self.assertGreater(at[0], not_run[0], "the services step is not after the not-run step")
        self.assertLess(at[0], fmt[0], "the services step is not before engine-fmt")
        step = steps[at[0]]
        self.assertIsNotNone(test_ci.step_key(step, "timeout-minutes"), "the services step has no timeout-minutes")
        self.assertFalse(any(re.match(r"^\s*env:", ln) for ln in step["lines"]), "the services step has env:")

    def test_main_integration_steps_pass_the_services_file(self):
        _text, steps = read_workflow(MAIN_YML)
        for name in ("integration", "integration (second run)"):
            with self.subTest(name):
                run = test_ci.step_key(named(steps, name), "run") or ""
                self.assertTrue(run.endswith(MAIN_RUN_END), f"{name}: run: {run}")

    def test_main_names_no_event_value_guard(self):
        text, _steps = read_workflow(MAIN_YML)
        self.assertNotIn("github.event", text)

    def test_full_trigger(self):
        text, _steps = read_workflow(FULL_YML)
        self.assertEqual(len(re.findall(r"^on:", text, re.M)), 1, "not one top-level `on:`")
        value, block = test_ci.top_block(text, "on")
        self.assertEqual(value, "", "`on:` is not a block")
        keys = test_ci.children(block)
        self.assertEqual(set(keys), {"workflow_dispatch"}, f"the keys of `on:`: {sorted(keys)}")
        wd_value, wd_body = keys["workflow_dispatch"]
        self.assertIn(wd_value, ("", "{}", "null", "~"), "`workflow_dispatch:` has a value")
        self.assertEqual(wd_body, [], "`workflow_dispatch:` has keys (inputs)")
        for ln in text.splitlines():
            s = test_ci.strip_comment(ln)
            for word in TRIGGERS:
                self.assertIsNone(re.match(rf"^\s*-?\s*{word}\s*:", s), f"a trigger {word}: {ln}")

    def test_full_rights(self):
        text, _steps = read_workflow(FULL_YML)
        perms = [ln for ln in text.splitlines() if re.match(r"^\s*permissions:", test_ci.strip_comment(ln))]
        self.assertEqual(len(perms), 1, f"`permissions:` lines: {perms}")
        self.assertTrue(perms[0].startswith("permissions:"), "`permissions:` is not at the top level")
        value, block = test_ci.top_block(text, "permissions")
        held = [ln.strip() for ln in block] if value == "" else [
            v.strip() for v in value.strip("{}").split(",") if v.strip()]
        self.assertEqual([re.sub(r"\s*:\s*", ": ", h) for h in held], ["contents: read"], "permissions")
        self.assertNotIn("secrets.", text)
        self.assertNotIn("github.event", text)
        self.assertLessEqual(set(re.findall(r"AWS_[A-Za-z0-9_]*", text)), {"AWS_EC2_METADATA_DISABLED"}, "AWS_ names")
        uses = [test_ci.unquote(test_ci.strip_comment(m)) for m in re.findall(r"^\s*(?:- )?uses:(.*)$", text, re.M)]
        self.assertTrue(uses, "no `uses:`")
        for u in uses:
            self.assertRegex(u, r"^actions/(checkout|setup-node)@[0-9a-f]{40}$")

    def test_full_steps_are_the_preparing_steps_of_main(self):
        _text, steps = read_workflow(FULL_YML)
        self.assertEqual(tuple(s["name"] for s in steps), FULL_STEPS)
        _main_text, main_steps = read_workflow(MAIN_YML)
        for name in FULL_STEPS[:10]:
            with self.subTest(name):
                self.assertEqual(body(named(steps, name)), body(named(main_steps, name)))

    def test_full_integration_runs_every_service(self):
        _text, steps = read_workflow(FULL_YML)
        first, second = named(steps, "integration"), named(steps, "integration (second run)")
        self.assertEqual(test_ci.step_key(first, "run"), FULL_RUN)
        self.assertEqual(test_ci.step_key(second, "run"), FULL_SECOND)
        sid = test_ci.step_key(first, "id")
        self.assertTrue(sid, "integration: no id")
        self.assertIn(f"steps.{sid}.outcome == 'failure'", test_ci.step_key(second, "if") or "",
                      "integration (second run): if")

    def test_full_bounds(self):
        text, steps = read_workflow(FULL_YML)
        lines = text.splitlines()
        start = next(i for i, ln in enumerate(lines) if re.match(r"^\s*steps:\s*$", test_ci.strip_comment(ln)))
        job = re.findall(r"^\s*timeout-minutes:\s*(\S+)", "\n".join(test_ci.strip_comment(ln) for ln in lines[:start]),
                         re.M)
        self.assertEqual(job, ["150"], "the job's timeout-minutes")
        for s in steps:
            with self.subTest(s["name"]):
                bound = test_ci.step_key(s, "timeout-minutes")
                self.assertIsNotNone(bound, f"{s['name']}: no timeout-minutes")
                if s["name"] in ("integration", "integration (second run)"):
                    self.assertEqual(bound, "60")


# ---------------------------------------------------------------------------------------------- form

class Form(unittest.TestCase):
    def test_the_three_files_hold_the_form(self):
        for path in FORM_FILES:
            with self.subTest(str(path.relative_to(CHECKOUT))):
                self.assertTrue(path.exists(), f"{path} does not exist")
                self.assertTrue(FORM in path.read_text(), f"{path} does not hold the literal {FORM}")


# ---------------------------------------------------------------------------------------------- guides

UNCHECKED = re.compile(r"\bnot (be )?(checked|run)\b|\bnothing runs\b|\bunchecked\b")


def section(text, title):
    """The body under the one heading whose title is `title`, at any level."""
    heads = [ln for ln in text.splitlines() if re.fullmatch(rf"#+ {re.escape(title)}\s*", ln)]
    if len(heads) != 1:
        raise AssertionError(f"not one heading `{title}`: {heads}")
    return docs.part(text, heads[0])


class Guides(unittest.TestCase):
    def test_integration_guide_names_the_field_and_the_section(self):
        text = INTEGRATION_GUIDE.read_text()
        manifest = section(text, "Manifest")
        self.assertTrue(any(ln.startswith("| `service` |") for ln in manifest.splitlines()), manifest)
        verdicts = section(text, "Verdicts")
        row = [ln for ln in verdicts.splitlines() if ln.startswith("| `not-run` |")]
        self.assertEqual(len(row), 1, verdicts)
        self.assertIn("--services", row[0])
        section(text, "Service checks")

    def test_integration_guide_says_what_goes_unseen(self):
        part = section(INTEGRATION_GUIDE.read_text(), "Service checks")
        self.assertIn("full.yml", part)
        said = [s for s in docs.sentences(part) if re.search(r"\btouch", s) and UNCHECKED.search(s)]
        self.assertTrue(said, part)

    def push_bullets(self):
        branches = docs.part(ROOT_GUIDE.read_text(), "## Branches and main")
        found = [b for b in docs.blocks(branches) if b.startswith("- ") and "full.yml" in b]
        self.assertTrue(found, branches)
        return found

    def test_root_guide_names_full_and_the_push_run(self):
        found = [b for b in self.push_bullets()
                 if re.search(r"\bowner\b[^.]*\bstart|\bstart[^.]*\bowner\b", b)
                 and re.search(r"\bpush\b", b) and re.search(r"\bservices\b", b) and re.search(r"\btouch", b)]
        self.assertTrue(found, self.push_bullets())

    def test_root_guide_says_what_goes_unseen(self):
        found = [b for b in self.push_bullets()
                 if any(re.search(r"\bbetween\b", s) and re.search(r"\bfull\b", s) and re.search(r"\btouch", s)
                        and UNCHECKED.search(s) for s in docs.sentences(b))]
        self.assertTrue(found, self.push_bullets())

    def test_skill_names_full_and_the_bound_rule(self):
        text = SKILL.read_text()
        self.assertTrue("full.yml" in text, f"{SKILL} does not name full.yml")
        said = docs.sentences(text)
        never = [s for s in said if re.search(r"\bfull\b", s) and re.search(r"\bnever\b[^.]*\bstart", s)]
        self.assertTrue(never, "no sentence says the pm never starts full")
        half = [s for s in said if re.search(r"\bhalf\b", s) and re.search(r"\bbound\b", s)
                and re.search(r"\bissue\b", s)]
        self.assertTrue(half, "no sentence holds the half-of-the-bound rule")

    def test_skill_says_what_the_whole_check_runs(self):
        found = [s for s in docs.sentences(SKILL.read_text())
                 if "whole check" in s and re.search(r"\bservices\b", s) and "integration" in s
                 and "issue branch" in s and re.search(r"\bno service\b", s) and re.search(r"\btouch", s)]
        self.assertTrue(found, "no sentence says what the integration step of an issue branch's whole check runs")
        self.assertTrue(any(not ("pm-check" in s and re.search(r"\bmain\b", s)) for s in found), found)

    def test_skill_names_the_selection_of_a_failed_run(self):
        found = [s for s in docs.sentences(SKILL.read_text())
                 if "issue file" in s and re.search(r"\bfail(ed|s|ing|ure)?\b", s) and re.search(r"\bservices\b", s)
                 and re.search(r"\bselect", s)]
        self.assertTrue(found, "no sentence says the issue file of a failed run names the services it selected")


if __name__ == "__main__":
    unittest.main()
