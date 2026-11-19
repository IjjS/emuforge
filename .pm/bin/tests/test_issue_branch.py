"""The issue branch in the scripts: pm-worktree, pm-scope, the three forms of pm-merge, pm-brief and pm-archive
(issue 63, requirement R1, R2, R4, R6; test criteria `test_issue_branch`).

Check id `harness.issue-branch`. One class per heading of the test criteria.

Every case builds a fixture checkout with `_fixture.make` under <checkout>/output/tests/issue-branch/<case>/ that
holds its own copies of the scripts, so `_pmlib.ROOT` is the fixture and nothing touches the real .pm/run or the
real worktrees. The worktrees a case makes are the fixture's siblings, named by pm-worktree
(`<fixture>-<issue>[-<unit>]`), and are removed before the case builds its fixture again. Every script runs with a
made-up HOME inside the fixture (`<fixture>/home`, ignored by git) and a stand-in folder first on PATH: `docker`
answers that no container exists, `top` reports the CPU 98 % idle (so a run never waits for the machine) and
`herdr` answers with no agent, pane or tab.

The fixture has no engine/Cargo.toml and no studio/package.json (both modules are absent), a stand-in
.pm/bin/tests/run (the harness step) and a stand-in tests/integration/run with a manifest of three rows,
`engine.a`, `studio.b`, `studio.c`. Each stand-in appends its module's name and its arguments to
<its checkout>/output/ran. The harness stand-in exits with the number in <its checkout>/output/harness-exit (0 when
there is none). The integration stand-in does, at its n-th start in a checkout, what the n-th entry of `runs` in
<its checkout>/output/integration.json says (the last entry after that; `{}` when there is no file): it writes
<its checkout>/output/integration/report.json with the checkout's commit and one entry per manifest id (`not-run`
for every id of the `--not-run` list it was given), or no report, or a text that is not JSON, or leaves what is
there; it prints a line and exits with the code the entry gives.

Issue 9 is the fixture's issue with an issue branch (`pm-worktree new 9`); issue 8 has none. A unit is made with
`pm-worktree new <issue> <unit>` and one commit of the paths the case names. A record is a last.json the case
writes for a worktree's head with the shape pm-check writes; a review is review-impl-<unit>-r1.md with
`verdict: pass`.

Interface used (design 2.1 to 2.4): the registry entry of an issue branch has `unit` "issue"; `pm-scope --json`
answers `target` and, for a deferred module, `deferred: true`; a fast record's `integration` step has status
`deferred`.

On a checkout without the change every case fails on its own, not at import: `pm-worktree new <id>`,
`pm-merge <id>` and `--take-main` do not exist there and a unit's paths are measured against main. The cases
whose name says `guard` hold a behavior of today and pass there already.
"""
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import unittest

from _fixture import CHECKOUT, clean_env, git, make, run

SCRIPTS = ("pm-worktree", "pm-scope", "pm-check", "pm-merge", "pm-emulator-dir", "pm-brief", "pm-archive",
           "pm-cost", "pm-pane", "pm-critique")
PRODUCT_PATH = "studio/src/a.txt"  # rule 6: engine, studio, integration
HARNESS_PATH = ".pm/bin/note.txt"  # rule 8: harness
ISSUE_FILE = "issues/things-that-do-not-work/a.md"  # rule 9: nothing
MANIFEST_IDS = ("engine.a", "studio.b", "studio.c")
STEPS = {
    "engine": ("engine-fmt", "engine-clippy", "engine-test"),
    "studio": ("studio-typecheck", "studio-lint", "studio-format", "studio-unit", "studio-build"),
    "integration": ("integration",),
    "harness": ("harness-test",),
}
TAKEN = {9297, *range(8100, 8200), *range(8300, 8400), *range(9300, 9400)}  # the owner's and pm-worktree's ports

HARNESS_RUN = """#!/bin/sh
mkdir -p ../../../output
echo harness "$@" >> ../../../output/ran
code=0
if [ -f ../../../output/harness-exit ]; then code=$(cat ../../../output/harness-exit); fi
exit "$code"
"""

INTEGRATION_RUN = r'''#!/usr/bin/env -S python3 -I
"""Stand-in for tests/integration/run (see the docstring of test_issue_branch.py)."""
import json, pathlib, subprocess, sys
co = pathlib.Path.cwd().parents[1]
out = co / "output"
out.mkdir(exist_ok=True)
with open(out / "ran", "a") as f:
    f.write(" ".join(["integration", *sys.argv[1:]]) + "\n")
conf = out / "integration.json"
runs = json.loads(conf.read_text())["runs"] if conf.exists() else [{}]
starts = out / "integration-starts"
n = int(starts.read_text()) if starts.exists() else 0
starts.write_text(str(n + 1))
r = runs[min(n, len(runs) - 1)]
manifest = co / "tests" / "integration" / "manifest.jsonl"
ids = [json.loads(x)["check_id"] for x in manifest.read_text().splitlines() if x.strip()] if manifest.exists() else []
skip = set()
if "--not-run" in sys.argv:
    listed = json.loads(pathlib.Path(sys.argv[sys.argv.index("--not-run") + 1]).read_text())
    skip = {c["id"] for c in listed["checks"]}
report = out / "integration" / "report.json"
mode = r.get("report", "write")
if mode != "keep":
    report.unlink(missing_ok=True)
if mode in ("write", "other-commit"):
    commit = "0" * 40 if mode == "other-commit" else subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    def verdict(i):
        if "every" in r:
            return r["every"]
        return "not-run" if i in skip else r.get("verdicts", {}).get(i, "passed")
    checks = [dict(check_id=i, verdict=verdict(i), seconds=1, log=None,
                   message=r.get("messages", {}).get(i, r.get("message", ""))) for i in ids]
    report.parent.mkdir(exist_ok=True)
    report.write_text(json.dumps(dict(commit=commit, checks=checks)))
elif mode == "text":
    report.parent.mkdir(exist_ok=True)
    report.write_text("this is not JSON\n")
print(r.get("print", "stand-in integration output, start %d" % (n + 1)))
sys.exit(r.get("exit", 0))
'''

TOP = "#!/bin/sh\necho 'CPU usage: 1.0% user, 1.0% sys, 98.0% idle'\necho 'CPU usage: 1.0% user, 1.0% sys, 98.0% idle'\n"
DOCKER = "#!/bin/sh\nexit 0\n"
HERDR = '#!/bin/sh\necho \'{"result": {"agents": [], "panes": [], "tabs": []}}\'\n'


def exact(name):
    """A pattern for a branch or worktree name that a longer name starting with it does not match."""
    return re.compile(re.escape(str(name)) + r"(?![\w/-])")


def has(line, word):
    return bool(word.search(line)) if isinstance(word, re.Pattern) else word in line


def line_with(text, *words):
    """The first line of `text` that holds every word (a string, or a pattern from `exact`), or None."""
    return next((ln for ln in text.splitlines() if all(has(ln, w) for w in words)), None)


def manifest(ids):
    return "".join(json.dumps(dict(check_id=i)) + "\n" for i in ids)


def files():
    return {".pm/bin/tests/run": HARNESS_RUN, "tests/integration/run": INTEGRATION_RUN,
            "tests/integration/manifest.jsonl": manifest(MANIFEST_IDS)}


class IssueCase(unittest.TestCase):
    """A fixture checkout of the issue-branch cases and the helpers that drive its scripts."""

    group = "issue-branch"

    # ---- the fixture

    def fixture(self, row=None, extra=None, scripts=SCRIPTS):
        name = f"{type(self).__name__}-{self._testMethodName[5:]}".lower().replace("_", "-")
        case = f"{name}-{row}" if row else name
        parent = CHECKOUT / "output" / "tests" / self.group
        if parent.exists():
            for sibling in parent.iterdir():  # the worktrees of an earlier run of this case
                if re.fullmatch(re.escape(case) + r"-\d+(-.+)?", sibling.name):
                    shutil.rmtree(sibling)
        self.co = make(self.group, case, scripts, {**files(), **(extra or {})})
        self.home = self.co / "home"
        self.home.mkdir()
        self.stub = self.co / "output" / "stub-bin"
        self.stub.mkdir(parents=True)
        for n, text in (("top", TOP), ("docker", DOCKER), ("herdr", HERDR)):
            (self.stub / n).write_text(text)
            (self.stub / n).chmod(0o755)
        self.drawn = set()
        return self.co

    def env(self):
        env = {**clean_env(), "HOME": str(self.home)}
        env["PATH"] = f"{self.stub}{os.pathsep}{env.get('PATH', '')}"
        return env

    def script(self, name, *args, timeout=120):
        return run(self.co, name, *args, env=self.env(), timeout=timeout)

    def out(self, p):
        return f"exit {p.returncode}\nstdout:\n{p.stdout}\nstderr:\n{p.stderr}"

    def ok(self, p):
        self.assertEqual(p.returncode, 0, self.out(p))
        return p

    def wt(self, issue, unit=None):
        return self.co.parent / (f"{self.co.name}-{issue}" + (f"-{unit}" if unit else ""))

    def issue_branch(self, issue=9):
        """`pm-worktree new <issue>`: the issue branch and its worktree."""
        self.ok(self.script("pm-worktree", "new", issue))
        return self.wt(issue)

    def unit(self, issue, name, paths=(), *opts):
        """`pm-worktree new <issue> <name> [opts]` and one commit of `paths` in it (when there are any)."""
        self.ok(self.script("pm-worktree", "new", issue, name, *opts))
        w = self.wt(issue, name)
        if paths:
            self.commit(w, paths, name)
        return w

    def commit(self, repo, paths, msg):
        """One commit in `repo`: a list of paths, each holding `<msg>`, or {path: text}; a text None removes it."""
        items = paths.items() if isinstance(paths, dict) else ((p, f"{msg}\n") for p in paths)
        for rel, text in items:
            p = pathlib.Path(repo) / rel
            if text is None:
                git(repo, "rm", "-q", rel)
                continue
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", msg)

    def head(self, ref="HEAD", repo=None):
        return git(repo or self.co, "rev-parse", ref)

    def is_ancestor(self, a, b):
        return subprocess.run(["git", "-C", str(self.co), "merge-base", "--is-ancestor", a, b],
                              env=clean_env(), capture_output=True).returncode == 0

    def branches(self):
        return git(self.co, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads")

    def registry(self):
        f = self.co / ".pm" / "run" / "worktrees.json"
        return json.loads(f.read_text()) if f.exists() else []

    def state(self):
        """What a refusal must leave as it was: the branches, the worktrees, the registry and the port slots."""
        reg = self.co / ".pm" / "run"
        return (self.branches(), git(self.co, "worktree", "list", "--porcelain"),
                *((reg / f).read_text() if (reg / f).exists() else None for f in ("worktrees.json", "ports.json")))

    def review(self, issue, name, verdict="pass", stage="impl"):
        d = self.co / ".pm" / f"issue-{issue}"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"review-{stage}-{name}-r1.md").write_text(f"verdict: {verdict}\np1: 0\np2: 0\np3: 0\n---\n")

    def record(self, w, commit=None, passed=True, failed=(), **status):
        """The last.json of `w`'s head as pm-check writes it: each module's steps have the status the case gives
        (`engine` and `studio` absent unless given)."""
        status = dict(dict(engine="absent", studio="absent", integration="not-needed", harness="not-needed"), **status)
        steps = []
        for m, names in STEPS.items():
            st = status[m]
            if st == "absent":
                steps.append(dict(name=m, module=m, status="absent", seconds=0, log=None))
                continue
            for n in names:
                idle = st in ("not-needed", "deferred")
                steps.append(dict(name=n, module=m, status=st, seconds=0 if idle else 1,
                                  log=None if idle else str(pathlib.Path(w) / "output" / "logs" / f"check-{n}.log")))
        rec = dict(at="2026-11-17T00:00:00+00:00", commit=commit or self.head(repo=w), dirty=False, full=False,
                   passed=passed, failed=list(failed), flaky=[s["name"] for s in steps if s["status"] == "flaky"],
                   cpu_at_start=None, ports={}, scope=dict(kind="diff", reason="written by the case"), steps=steps)
        out = pathlib.Path(w) / "output" / "checks"
        out.mkdir(parents=True, exist_ok=True)
        (out / "last.json").write_text(json.dumps(rec, indent=1))
        return out / "last.json"

    def port(self):
        """A free loopback port outside the owner's and pm-worktree's, not drawn before in this case."""
        while True:
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                p = s.getsockname()[1]
            if p not in TAKEN and p not in self.drawn:
                self.drawn.add(p)
                return p

    def emulator_folder(self, w):
        """A drawn emulator port for worktree `w` (its output/ports.json and its registry entry) and that port's
        folder under the made-up HOME, with one file."""
        port = self.port()
        reg = self.co / ".pm" / "run" / "worktrees.json"
        wts = json.loads(reg.read_text())
        for e in wts:
            if os.path.realpath(e["path"]) == os.path.realpath(w):
                e["ports"]["emulator"] = port
        reg.write_text(json.dumps(wts, indent=1))
        ports = pathlib.Path(w) / "output" / "ports.json"
        ports.write_text(json.dumps({**json.loads(ports.read_text()), "emulator": port}))
        d = self.home / ".aws" / "emulator" / str(port)
        d.mkdir(parents=True)
        (d / "ca.pem").write_text("fixture\n")
        return d

    # ---- reading answers

    def scope(self, w):
        p = self.ok(self.script("pm-scope", w, "--json"))
        return json.loads(p.stdout)

    def assertLine(self, text, *words):
        found = line_with(text, *words)
        self.assertIsNotNone(found, f"no line holds {words!r} in:\n{text}")
        return found

    def assertRefused(self, p, *words):
        """A non-zero exit and, when words are given, one line of stderr that holds them all."""
        self.assertNotEqual(p.returncode, 0, self.out(p))
        if words:
            self.assertLine(p.stderr, *words)

    def assertNoDeferred(self, sc):
        self.assertEqual([m for m, v in sc["modules"].items() if "deferred" in v], [], sc)


# ---------------------------------------------------------------------------------------------------- R1

class Worktree(IssueCase):
    def test_new_issue_makes_the_issue_branch_and_its_worktree(self):
        self.fixture()
        p = self.script("pm-worktree", "new", 9)
        self.ok(p)
        w = self.wt(9)
        self.assertEqual(self.head("feat/9"), self.head("main"))
        self.assertEqual(git(w, "symbolic-ref", "--short", "HEAD"), "feat/9")
        self.assertIn(f"worktree {os.path.realpath(w)}", git(self.co, "worktree", "list", "--porcelain"))
        self.assertTrue((w / "output" / "ports.json").exists())
        reg = self.registry()
        self.assertEqual(len(reg), 1, reg)
        e = reg[0]
        self.assertEqual((e.get("issue"), e.get("unit"), e.get("branch"), e.get("base")), ("9", "issue", "feat/9", "main"))
        for key in ("name", "path", "slot", "ports", "created"):
            self.assertIn(key, e)

    def test_new_issue_is_refused(self):
        rows = {
            "again": (lambda: self.issue_branch(), ("new", 9)),
            "unit-first": (lambda: self.unit(9, "s1"), ("new", 9)),
            "branch-exists": (lambda: git(self.co, "branch", "feat/9", "main"), ("new", 9)),
            "base": (None, ("new", 9, "--base", "main")),
            "branch": (None, ("new", 9, "--branch", "feat/x")),
            "type": (None, ("new", 9, "--type", "fix")),
            "not-digits": (None, ("new", "9a")),
        }
        for row, (before, args) in rows.items():
            with self.subTest(row):
                self.fixture(row)
                if before:
                    before()
                kept = self.state()
                dirs = {d: d.exists() for d in (self.wt(9), self.wt("9a"))}
                p = self.script("pm-worktree", *args)
                self.assertRefused(p)
                self.assertNotIn("arguments are required", p.stderr)  # refused by the form, not by its absence
                self.assertEqual(self.state(), kept)
                self.assertEqual({d: d.exists() for d in dirs}, dirs)

    def test_unit_of_an_issue_branch_is_based_on_it(self):
        self.fixture()
        w9 = self.issue_branch()
        self.commit(w9, [ISSUE_FILE], "one more")
        self.unit(9, "s1")
        e = next(x for x in self.registry() if x["unit"] == "s1")
        self.assertEqual(e["base"], "feat/9")
        self.assertEqual(self.head("feat/9-s1"), self.head("feat/9"))

    def test_stacked_unit_keeps_the_given_base(self):
        self.fixture()
        self.issue_branch()
        self.unit(9, "s1", [PRODUCT_PATH])
        self.unit(9, "s2", (), "--base", "feat/9-s1")
        e = next(x for x in self.registry() if x["unit"] == "s2")
        self.assertEqual(e["base"], "feat/9-s1")
        self.assertEqual(self.head("feat/9-s2"), self.head("feat/9-s1"))

    def test_guard_unit_of_an_issue_without_issue_branch_is_based_on_main(self):
        self.fixture()
        self.unit(8, "s1")
        e = next(x for x in self.registry() if x["unit"] == "s1")
        self.assertEqual(e["base"], "main")

    def test_unit_form_is_refused(self):
        rows = {
            "unit-issue": (None, ("new", 9, "issue"), "feat/9-issue"),
            "issue-branch-name": (None, ("new", 8, "s1", "--branch", "feat/8"), "feat/8"),
            "typo": (lambda: self.issue_branch(), ("new", 9, "s1", "--branch", "feat/typo"), "feat/typo"),
        }
        for row, (before, args, branch) in rows.items():
            with self.subTest(row):
                self.fixture(row)
                if before:
                    before()
                kept = self.state()
                p = self.script("pm-worktree", *args)
                self.assertRefused(p)
                self.assertEqual(self.state(), kept)
                self.assertNotIn(f"refs/heads/{branch}", git(self.co, "for-each-ref", "--format=%(refname)"))
                self.assertFalse(self.wt(args[1], args[2]).exists())

    def test_guard_any_branch_name_without_issue_branch(self):
        self.fixture()
        p = self.script("pm-worktree", "new", 8, "s1", "--branch", "feat/typo")
        self.ok(p)
        self.assertEqual(git(self.wt(8, "s1"), "symbolic-ref", "--short", "HEAD"), "feat/typo")

    def test_rm_removes_the_issue_worktree_and_deletes_a_merged_branch(self):
        for row in ("ahead", "merged"):
            with self.subTest(row):
                self.fixture(row)
                w9 = self.issue_branch()
                if row == "ahead":
                    self.commit(w9, [ISSUE_FILE], "on the issue branch")
                p = self.script("pm-worktree", "rm", w9.name)
                self.ok(p)
                self.assertFalse(w9.exists())
                self.assertEqual(self.registry(), [])
                kept = "refs/heads/feat/9" in git(self.co, "for-each-ref", "--format=%(refname)")
                self.assertEqual(kept, row == "ahead", p.stdout)


# ---------------------------------------------------------------------------------------------------- R2

class Scope(IssueCase):
    def given(self, row=None):
        """Issue 9 and unit s1 with a product path (not merged)."""
        self.fixture(row)
        self.w9 = self.issue_branch()
        self.s1 = self.unit(9, "s1", [PRODUCT_PATH])

    def given_h1(self):
        """The Given of the criteria: s1 merged into feat/9 by hand, then h1 cut from feat/9 with a harness path."""
        self.given()
        git(self.w9, "merge", "-q", "--no-ff", "-m", "s1 by hand", "feat/9-s1")
        self.h1 = self.unit(9, "h1", [HARNESS_PATH])

    def test_unit_paths_are_its_own(self):
        self.given_h1()
        p = self.ok(self.script("pm-scope", self.h1))
        first = p.stdout.splitlines()[0]
        self.assertTrue(first.startswith("scope: unit"), p.stdout)
        self.assertRegex(first, exact("feat/9"))
        listed = first.rsplit(": ", 1)[1].split(";")[0]
        self.assertEqual([m.strip() for m in listed.split(",")], ["harness"], first)
        sc = self.scope(self.h1)
        self.assertEqual((sc["kind"], sc.get("target"), sc["paths"]), ("unit", "feat/9", 1), sc)
        self.assertIs(sc["modules"]["studio"]["called"], False)

    def test_product_unit_leaves_integration_to_the_issue_branch(self):
        self.given()
        p = self.ok(self.script("pm-scope", self.s1))
        first = p.stdout.splitlines()[0]
        listed = first.rsplit(": ", 1)[1].split(";")[0]
        self.assertIn("engine", listed, first)
        self.assertIn("studio", listed, first)
        self.assertLine(p.stdout, "integration", exact("left to feat/9"))
        sc = self.scope(self.s1)
        integration = sc["modules"]["integration"]
        self.assertIs(integration["called"], False, sc)
        self.assertIs(integration.get("deferred"), True, sc)
        self.assertTrue(integration["why"], sc)

    def test_unit_without_a_change_of_its_own_calls_for_nothing(self):
        self.given()
        sc = self.scope(self.unit(9, "s3"))
        self.assertEqual(sc["kind"], "unit", sc)
        self.assertEqual([m for m, v in sc["modules"].items() if v["called"]], [], sc)

    def test_untracked_file_counts(self):
        self.given_h1()
        (self.h1 / "studio" / "src").mkdir(parents=True, exist_ok=True)
        (self.h1 / "studio" / "src" / "new.txt").write_text("untracked\n")
        sc = self.scope(self.h1)
        self.assertIs(sc["modules"]["studio"]["called"], True, sc)
        self.assertIs(sc["modules"]["integration"].get("deferred"), True, sc)

    def test_stacked_unit_counts_its_base_until_it_is_in_the_issue_branch(self):
        self.given()
        self.unit(9, "t1", ["tests/integration/a.txt"])
        e1 = self.unit(9, "e1", [HARNESS_PATH], "--base", "feat/9-t1")
        sc = self.scope(e1)
        self.assertEqual(sc["paths"], 2, sc)
        self.assertIs(sc["modules"]["integration"].get("deferred"), True, sc)
        git(self.w9, "merge", "-q", "--no-ff", "-m", "t1 by hand", "feat/9-t1")
        sc = self.scope(e1)
        self.assertEqual(sc["paths"], 1, sc)
        self.assertIs(sc["modules"]["integration"]["called"], False, sc)
        self.assertNotIn("deferred", sc["modules"]["integration"], sc)

    def test_issue_worktree_is_measured_against_main(self):
        self.given()
        git(self.w9, "merge", "-q", "--no-ff", "-m", "s1 by hand", "feat/9-s1")
        sc = self.scope(self.w9)
        self.assertEqual((sc["kind"], sc.get("target")), ("diff", "main"), sc)
        self.assertIs(sc["modules"]["integration"]["called"], True, sc)
        self.assertNoDeferred(sc)

    def test_old_path_answers_as_today_with_target_main(self):
        self.given()
        u8 = self.unit(8, "s1", [PRODUCT_PATH])
        for where, kind in ((u8, "diff"), (self.co, "main")):
            with self.subTest(str(where)):
                sc = self.scope(where)
                self.assertEqual((sc["kind"], sc.get("target")), (kind, "main"), sc)
                self.assertIs(sc["modules"]["integration"]["called"], True, sc)
                self.assertNoDeferred(sc)

    def test_unit_of_an_issue_without_issue_branch_targets_main(self):
        self.given()
        sc = self.scope(self.unit(7, "s1"))
        self.assertEqual(sc.get("target"), "main", sc)

    def test_unit_without_a_shared_commit_runs_everything(self):
        self.given()
        w = self.wt(9, "o1")
        git(self.co, "worktree", "add", "-q", "--detach", str(w), "main")
        git(w, "checkout", "-q", "--orphan", "feat/9-o1")
        self.commit(w, [HARNESS_PATH], "orphan")
        sc = self.scope(w)
        self.assertEqual(sc["kind"], "full", sc)
        self.assertEqual([m for m, v in sc["modules"].items() if not v["called"]], [], sc)
        self.assertNoDeferred(sc)

    def test_target_of_other_checkouts(self):
        self.given()
        for unit, branch in (("wr", "refactor/9-x"), ("wf", "fix/9-x")):
            git(self.co, "worktree", "add", "-q", "-b", branch, str(self.wt(9, unit)), "feat/9")
        git(self.co, "worktree", "add", "-q", "--detach", str(self.wt(9, "wd")), "feat/9-s1")
        w6 = self.issue_branch(6)
        rows = ((self.wt(9, "wr"), "feat/9"), (self.wt(9, "wf"), "feat/9"), (self.wt(9, "wd"), "main"), (w6, "main"))
        for w, target in rows:
            with self.subTest(w.name):
                sc = self.scope(w)
                self.assertEqual(sc.get("target"), target, sc)
                if w == w6:
                    self.assertEqual(sc["kind"], "main", sc)


# ---------------------------------------------------------------------------------------------------- R4.2

class UnitIntoIssueBranch(IssueCase):
    def given(self, row=None, s1_paths=(PRODUCT_PATH, HARNESS_PATH)):
        """Issue 9 with s1 (reviewed, fast record: harness passed, integration deferred); issue 8 with h1 from main
        (a harness path, reviewed, harness passed)."""
        self.fixture(row)
        self.w9 = self.issue_branch()
        self.s1 = self.unit(9, "s1", s1_paths)
        self.review(9, "s1")
        self.record(self.s1, integration="deferred", harness="passed")
        self.h1 = self.unit(8, "h1", [HARNESS_PATH])
        self.review(8, "h1")
        self.record(self.h1, harness="passed")
        self.main, self.feat = self.head("main"), self.head("feat/9")

    def assertUnmoved(self):
        self.assertEqual((self.head("main"), self.head("feat/9")), (self.main, self.feat))

    def assertMergedIntoIssueBranch(self, p, unit="s1"):
        self.ok(p)
        subject = git(self.co, "log", "-1", "--format=%s", "feat/9")
        self.assertIn(f"#9 {unit}", subject)
        self.assertIn("into feat/9", subject)
        self.assertEqual(len(git(self.co, "log", "-1", "--format=%p", "feat/9").split()), 2, subject)
        self.assertEqual(self.head("main"), self.main)

    def test_unit_merges_into_the_issue_branch(self):
        self.given()
        p = self.script("pm-merge", 9, "s1")
        self.assertMergedIntoIssueBranch(p)
        self.assertTrue(self.is_ancestor("feat/9-s1", "feat/9"))
        self.assertRegex(p.stdout, exact("feat/9"))

    def test_main_checkout_is_not_asked(self):
        self.given()
        (self.co / "untracked.txt").write_text("x\n")
        self.assertMergedIntoIssueBranch(self.script("pm-merge", 9, "s1"))

    def test_dry_run(self):
        self.given()
        p = self.ok(self.script("pm-merge", 9, "s1", "--dry-run"))
        self.assertRegex(p.stdout, r"ok to merge feat/9-s1 \(.+\) into feat/9(?![\w/-])")
        self.assertUnmoved()

    def test_passed_integration_also_covers(self):
        self.given()
        self.record(self.s1, integration="passed", harness="passed")
        self.assertMergedIntoIssueBranch(self.script("pm-merge", 9, "s1"))

    def test_dry_run_is_refused(self):
        def wip(w):
            (w / "wip.txt").write_text("wip\n")
        def rows():  # read after the fixture of the row is built: the words name its worktrees
            return {
            "issue-dirty": (lambda: wip(self.w9), (exact(self.w9.name), "uncommitted")),
            "issue-other-branch": (lambda: git(self.w9, "checkout", "-q", "-b", "elsewhere"),
                                   (exact(self.w9.name), exact("feat/9"))),
            "unit-dirty": (lambda: wip(self.s1), (exact(self.s1.name), "uncommitted")),
            "other-commit": (lambda: self.record(self.s1, commit=self.main, integration="deferred", harness="passed"),
                             (self.main[:9],)),
            "not-passed": (lambda: self.record(self.s1, passed=False, failed=["harness-test"], integration="deferred",
                                               harness="failed"), ("pm-check failed", "harness-test")),
            "integration-not-needed": (lambda: self.record(self.s1, integration="not-needed", harness="passed"),
                                       (re.compile(r"does not cover.*integration"),)),
            "harness-not-needed": (lambda: self.record(self.s1, integration="deferred", harness="not-needed"),
                                   (re.compile(r"does not cover.*harness"),)),
            "no-review": (lambda: (self.co / ".pm" / "issue-9" / "review-impl-s1-r1.md").unlink(),
                          ("review-impl-s1",)),
            "revise": (lambda: self.review(9, "s1", verdict="revise"), ("review-impl-s1-r1.md",)),
            }
        for row in ("issue-dirty", "issue-other-branch", "unit-dirty", "other-commit", "not-passed",
                    "integration-not-needed", "harness-not-needed", "no-review", "revise"):
            with self.subTest(row):
                self.given(row)
                change, words = rows()[row]
                change()
                p = self.script("pm-merge", 9, "s1", "--dry-run")
                self.assertRefused(p, *words)
                self.assertIn("cannot merge:", p.stderr)
                self.assertUnmoved()

    def test_every_problem_is_listed(self):
        self.given()
        (self.w9 / "wip.txt").write_text("wip\n")
        (self.co / ".pm" / "issue-9" / "review-impl-s1-r1.md").unlink()
        p = self.script("pm-merge", 9, "s1", "--dry-run")
        self.assertRefused(p, exact(self.w9.name), "uncommitted")
        self.assertLine(p.stderr, "review-impl-s1")
        self.assertEqual(p.stderr.count("cannot merge:"), 1, p.stderr)

    def test_issue_branch_gained_a_harness_path(self):
        self.given()
        self.commit(self.w9, [".pm/bin/other.txt"], "the issue branch gains")
        self.feat = self.head("feat/9")
        p = self.script("pm-merge", 9, "s1")
        self.assertRefused(p, "harness", exact("feat/9"))
        self.assertUnmoved()

    def test_issue_branch_gained_a_product_path_a_harness_unit_does_not_call_for(self):
        self.given()
        h2 = self.unit(9, "h2", [".pm/bin/h2.txt"])
        self.review(9, "h2")
        self.record(h2, harness="passed")
        self.commit(self.w9, ["studio/src/b.txt"], "the issue branch gains")
        p = self.script("pm-merge", 9, "h2")
        self.assertMergedIntoIssueBranch(p, "h2")
        self.assertRegex(p.stdout, r"behind " + exact("feat/9").pattern)

    def test_issue_branch_gained_only_an_issue_file(self):
        self.given()
        self.commit(self.w9, ["issues/things-that-do-not-work/b.md"], "the issue branch gains")
        self.assertMergedIntoIssueBranch(self.script("pm-merge", 9, "s1"))

    def test_conflict_leaves_the_issue_branch_as_it_was(self):
        self.given(s1_paths={PRODUCT_PATH: "s1\n", HARNESS_PATH: "s1\n", ISSUE_FILE: "from s1\n"})
        self.commit(self.w9, {ISSUE_FILE: "from the issue branch\n"}, "same line")
        self.feat = self.head("feat/9")
        p = self.script("pm-merge", 9, "s1")
        self.assertNotEqual(p.returncode, 0, self.out(p))
        self.assertUnmoved()
        self.assertEqual(git(self.w9, "status", "--porcelain"), "")

    def test_unit_merges_again(self):
        self.given()
        self.assertMergedIntoIssueBranch(self.script("pm-merge", 9, "s1"))
        self.commit(self.s1, {HARNESS_PATH: "s1, second commit\n"}, "s1 again")
        self.record(self.s1, integration="deferred", harness="passed")
        self.assertMergedIntoIssueBranch(self.script("pm-merge", 9, "s1"))
        merges = git(self.co, "log", "--merges", "--format=%s", "feat/9").splitlines()
        self.assertEqual(len([s for s in merges if "#9 s1" in s]), 2, merges)
        self.assertTrue(self.is_ancestor("feat/9-s1", "feat/9"))

    def test_emulator_folder_of_the_unit_only(self):
        self.given()
        unit_folder, issue_folder = self.emulator_folder(self.s1), self.emulator_folder(self.w9)
        self.assertMergedIntoIssueBranch(self.script("pm-merge", 9, "s1"))
        self.assertFalse(unit_folder.exists())
        self.assertTrue(issue_folder.exists())

    def test_issue_is_not_a_unit(self):
        self.given()
        p = self.script("pm-merge", 9, "issue")
        self.assertRefused(p, re.compile(r"pm-merge 9\b(?! issue)"))
        self.assertUnmoved()

    def test_guard_old_path_next_to_it(self):
        self.given()
        self.assertMergedIntoIssueBranch(self.script("pm-merge", 9, "s1"))
        self.feat = self.head("feat/9")
        p = self.ok(self.script("pm-merge", 8, "h1"))
        self.assertEqual(git(self.co, "log", "-1", "--format=%s", "main"), "merge: #8 h1 (feat/8-h1)", p.stdout)
        self.assertFalse(self.is_ancestor("feat/8-h1", "feat/9"))
        self.assertEqual(self.head("feat/9"), self.feat)

    def test_deferred_does_not_cover_into_main(self):
        self.given()
        p1 = self.unit(8, "p1", [PRODUCT_PATH])
        self.review(8, "p1")
        self.record(p1, integration="deferred")
        p = self.script("pm-merge", 8, "p1", "--dry-run")
        self.assertRefused(p, re.compile(r"does not cover.*integration"))
        self.assertUnmoved()


# ---------------------------------------------------------------------------------------------------- R4.4

class TakeMain(IssueCase):
    def given(self, row=None, conflict=False):
        """Issue 9 whose feat/9 holds s1 (merged with pm-merge), and main with one commit more (a harness path)."""
        self.fixture(row, extra={"x.txt": "base\n"})
        self.w9 = self.issue_branch()
        self.s1 = self.unit(9, "s1", [PRODUCT_PATH])
        self.review(9, "s1")
        self.record(self.s1, integration="deferred")
        self.ok(self.script("pm-merge", 9, "s1"))
        if conflict:
            self.commit(self.w9, {"x.txt": "the issue branch\n"}, "x on the issue branch")
        self.commit(self.co, {".pm/bin/other.txt": "main\n", **({"x.txt": "main\n"} if conflict else {})}, "main gains")
        self.main, self.feat = self.head("main"), self.head("feat/9")

    def assertUnmoved(self):
        self.assertEqual((self.head("main"), self.head("feat/9")), (self.main, self.feat))

    def test_take_main(self):
        self.given()
        self.ok(self.script("pm-merge", 9, "--take-main"))
        self.assertTrue(self.is_ancestor(self.main, "feat/9"))
        self.assertEqual(self.head("main"), self.main)
        subject = git(self.co, "log", "-1", "--format=%s", "feat/9")
        self.assertIn("main", subject)
        self.assertRegex(subject, exact("feat/9"))

    def test_dry_run(self):
        self.given()
        p = self.ok(self.script("pm-merge", 9, "--take-main", "--dry-run"))
        self.assertTrue(any(ln.startswith("would merge main") for ln in p.stdout.splitlines()), p.stdout)
        self.assertUnmoved()

    def test_again_changes_nothing(self):
        self.given()
        self.ok(self.script("pm-merge", 9, "--take-main"))
        self.feat = self.head("feat/9")
        p = self.ok(self.script("pm-merge", 9, "--take-main"))
        self.assertIn("already holds main", p.stdout + p.stderr)
        self.assertUnmoved()

    def test_conflict_names_the_paths(self):
        self.given(conflict=True)
        p = self.script("pm-merge", 9, "--take-main")
        self.assertNotEqual(p.returncode, 0, self.out(p))
        self.assertIn("x.txt", p.stdout + p.stderr)
        self.assertUnmoved()
        self.assertEqual(git(self.w9, "status", "--porcelain"), "")

    def test_refused(self):
        rows = {
            "issue-dirty": (lambda: (self.w9 / "wip.txt").write_text("wip\n"), 9),
            "issue-other-branch": (lambda: git(self.w9, "checkout", "-q", "-b", "elsewhere"), 9),
            "no-issue-branch": (None, 8),
        }
        for row, (change, issue) in rows.items():
            with self.subTest(row):
                self.given(row)
                if change:
                    change()
                p = self.script("pm-merge", issue, "--take-main")
                self.assertRefused(p)
                self.assertNotIn("unrecognized arguments", p.stderr)
                self.assertUnmoved()

    def test_take_main_with_a_unit_is_a_usage_error(self):
        self.given()
        p = self.script("pm-merge", 9, "s1", "--take-main")
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertNotIn("unrecognized arguments", p.stderr)
        self.assertUnmoved()


# ---------------------------------------------------------------------------------------------------- R4.5

class IssueIntoMain(IssueCase):
    def given(self, row=None):
        """Issue 9 with s1 (a product path) and h1 (a harness path), both merged with pm-merge on fast records and
        reviews; the whole check's record on feat/9's head in the issue's worktree; issue 8 with e1, merged
        nowhere."""
        self.fixture(row)
        self.w9 = self.issue_branch()
        self.s1 = self.unit(9, "s1", [PRODUCT_PATH])
        self.h1 = self.unit(9, "h1", [HARNESS_PATH])
        self.record(self.s1, integration="deferred")
        self.record(self.h1, harness="passed")
        for u in ("s1", "h1"):
            self.review(9, u)
            self.ok(self.script("pm-merge", 9, u))
        self.whole = self.record(self.w9, integration="passed", harness="passed")
        self.e1 = self.unit(8, "e1", ["engine/a.txt"])
        self.main, self.feat = self.head("main"), self.head("feat/9")

    def assertMerged(self, p):
        self.ok(p)
        self.assertEqual(git(self.co, "log", "-1", "--format=%s", "main"), "merge: #9 (feat/9)")

    def test_issue_branch_merges_into_main(self):
        self.given()
        p = self.script("pm-merge", 9)
        self.assertMerged(p)
        for b in ("feat/9-s1", "feat/9-h1"):
            self.assertTrue(self.is_ancestor(b, "main"), b)
        self.assertLine(p.stdout, str(self.whole), re.compile(r"\bs1\b"), re.compile(r"\bh1\b"))
        both = p.stdout + p.stderr
        self.assertNotIn("feat/8-e1", both)
        self.assertNotRegex(both, exact(self.e1.name))

    def test_dry_run(self):
        self.given()
        p = self.ok(self.script("pm-merge", 9, "--dry-run"))
        self.assertRegex(p.stdout, r"ok to merge feat/9 \(.+\) into main")
        self.assertEqual(self.head("main"), self.main)

    def test_dry_run_is_refused(self):
        def wip(w):
            (w / "wip.txt").write_text("wip\n")

        def third():
            s2 = self.unit(9, "s2", ["studio/src/c.txt"])
            self.review(9, "s2")
            self.record(s2, integration="deferred")

        def rows():  # read after the fixture of the row is built: the words name its worktrees
            return {
            "main-other-branch": (lambda: git(self.co, "checkout", "-q", "-b", "elsewhere"), ("not on main",)),
            "main-dirty": (lambda: wip(self.co), ("main checkout", "uncommitted")),
            "issue-dirty": (lambda: wip(self.w9), (exact(self.w9.name), "uncommitted")),
            "issue-other-branch": (lambda: git(self.w9, "checkout", "-q", "-b", "elsewhere"),
                                   (exact(self.w9.name), exact("feat/9"))),
            "unit-not-in": (third, (exact("feat/9-s2"),)),
            "no-record": (lambda: self.whole.unlink(), ("no pm-check run recorded",)),
            "other-commit": (lambda: self.record(self.w9, commit=self.main, integration="passed", harness="passed"),
                             (self.main[:9],)),
            "not-passed": (lambda: self.record(self.w9, passed=False, failed=["integration"], integration="failed",
                                               harness="passed"), ("pm-check failed", "integration")),
            "integration-deferred": (lambda: self.record(self.w9, integration="deferred", harness="passed"),
                                     (re.compile(r"does not cover.*integration"),)),
            "integration-not-needed": (lambda: self.record(self.w9, integration="not-needed", harness="passed"),
                                       (re.compile(r"does not cover.*integration"),)),
            "harness-not-needed": (lambda: self.record(self.w9, integration="passed", harness="not-needed"),
                                   (re.compile(r"does not cover.*harness"),)),
            "review-missing": (lambda: (self.co / ".pm" / "issue-9" / "review-impl-h1-r1.md").unlink(),
                               ("review-impl-h1",)),
            }
        for row in ("main-other-branch", "main-dirty", "issue-dirty", "issue-other-branch", "unit-not-in",
                    "no-record", "other-commit", "not-passed", "integration-deferred", "integration-not-needed",
                    "harness-not-needed", "review-missing"):
            with self.subTest(row):
                self.given(row)
                change, words = rows()[row]
                change()
                p = self.script("pm-merge", 9, "--dry-run")
                self.assertRefused(p, *words)
                self.assertIn("cannot merge:", p.stderr)
                self.assertEqual((self.head("main"), self.head("feat/9")), (self.main, self.feat))

    def test_main_gained_only_an_issue_file(self):
        self.given()
        self.commit(self.co, ["issues/things-that-do-not-work/b.md"], "main gains")
        p = self.script("pm-merge", 9)
        self.assertMerged(p)
        self.assertIn("behind main", p.stdout)

    def test_flaky_whole_check_merges_and_is_named(self):
        self.given()
        self.record(self.w9, integration="flaky", harness="passed")
        p = self.script("pm-merge", 9)
        self.assertMerged(p)
        self.assertLine(p.stdout, "flaky", "integration")

    def test_emulator_folders_of_the_issue(self):
        self.given()
        folders = [self.emulator_folder(w) for w in (self.w9, self.s1, self.h1)]
        self.assertMerged(self.script("pm-merge", 9))
        self.assertEqual([f for f in folders if f.exists()], [])


# ---------------------------------------------------------------------------------------------------- R6

ISSUE_99963 = """Issue-Id: {id}
Issue-Severity: LOW
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|x|y
Issue-Check-Ids:
Issue-Commit: 0

# Make the thing work

## Description
"""
BRIEFS = CHECKOUT / ".agents" / "skills" / "pm" / "references" / "briefs"


class BriefAndArchive(IssueCase):
    def brief_fixture(self):
        extra = {f".agents/skills/pm/references/briefs/{n}.md": (BRIEFS / f"{n}.md").read_text()
                 for n in ("plan", "rev", "worker", "crit")}
        extra["issues/things-that-do-not-work/9-harness.md"] = ISSUE_99963.format(id=9)
        extra["engine/AGENTS.md"] = extra["engine/references/workflow.md"] = "x\n"
        co = self.fixture(extra=extra, scripts=("pm-brief",))
        reg = co / ".pm" / "run"
        reg.mkdir(parents=True, exist_ok=True)
        (reg / "worktrees.json").write_text(json.dumps([
            dict(name=f"{co.name}-9", path=f"{co}-9", issue="9", unit="issue", branch="feat/9", base="main", slot=0,
                 ports=dict(studio=8100, engine=8300, emulator=9300), created="2026-11-17T00:00:00+00:00"),
            dict(name=f"{co.name}-9-s1", path=f"{co}-9-s1", issue="9", unit="s1", branch="feat/9-s1", base="feat/9",
                 slot=1, ports=dict(studio=8101, engine=8301, emulator=9301), created="2026-11-17T00:00:00+00:00"),
        ]))

    def test_guard_brief_of_a_unit_cut_from_the_issue_branch(self):
        self.brief_fixture()
        self.ok(self.script("pm-brief", "worker", 9, "s1", "--summary", "x"))
        self.assertIn("based on `feat/9`", (self.co / ".pm" / "issue-9" / "brief-s1.md").read_text())

    def test_guard_brief_of_the_issue_branch_is_refused(self):
        self.brief_fixture()
        self.assertRefused(self.script("pm-brief", "worker", 9, "issue", "--summary", "x"), "expected e<n>")

    def archive_given(self):
        """Issue 99963 with its issue branch and unit h1, merged into the issue branch with pm-merge."""
        self.fixture()
        self.w = self.issue_branch(99963)
        self.h1 = self.unit(99963, "h1", [HARNESS_PATH])
        self.review(99963, "h1")
        self.record(self.h1, harness="passed")
        self.ok(self.script("pm-merge", 99963, "h1"))

    def test_archive_waits_for_the_issue_branch(self):
        self.archive_given()
        kept = self.state()
        p = self.script("pm-archive", 99963, "--yes", timeout=180)
        self.assertRefused(p, exact("feat/99963"))
        self.assertEqual(self.state(), kept)
        self.assertTrue(self.w.exists() and self.h1.exists())

    def test_archive_after_the_issue_branch_merged(self):
        self.archive_given()
        self.record(self.w, harness="passed")
        self.ok(self.script("pm-merge", 99963))
        self.ok(self.script("pm-archive", 99963, "--yes", timeout=180))
        self.assertFalse(self.w.exists())
        self.assertFalse(self.h1.exists())
        heads = git(self.co, "for-each-ref", "--format=%(refname:short)", "refs/heads").splitlines()
        self.assertEqual([b for b in heads if b.startswith("feat/99963")], [])
        self.assertEqual([e for e in self.registry() if e.get("issue") == "99963"], [])


if __name__ == "__main__":
    unittest.main()
