"""The harness step leaves out a slow test file when no changed path is one of its sources (issue 328, test criteria
`test_on_touch`).

Check id `harness.on-touch`. One class per heading of the test criteria, one case per line. This file is an
always file: it has no entry in the map and runs on every harness change.

Interface used (design 2.1 to 2.6): `_pmscope.ON_TOUCH`, a list of entries `{test, why, sources[, outside]}` whose
sources are patterns in the forms of `RULES`, matched by `_pmscope._matches`; `_pmscope.EVERY_FILE`, the paths
whose change runs every file; `_pmscope.harness_tests(paths)` -> `{all, why, called: {test: [why]}, left_out}`;
the key `harness_tests` of the scope object (`pm-scope --json`, the record's `scope`) with `on_touch` beside those
four, and its lines `  harness tests every file: <why>` or `  harness tests left out: <names or none>`;
`.pm/bin/tests/run --leave-out <test file> ...`; the key `left_out` of a `harness-test` entry of `last.json`; the
refusal of `pm-merge` that names the left-out files and says `run pm-check again`.

`Map`, `Decide`, `Moved` and `Guides` read this checkout and start nothing but `git ls-files`; `Map` writes one
made-up folder of scripts and test files for its last three cases. `Run` copies this checkout's runner into a
folder of its own with made-up test files, so nothing of the real tests runs. `Scope`, `Check` and `Merge` build a
fixture checkout per case with `_fixture.make` under <checkout>/output/tests/on-touch/<case>/ that holds copies of
the scripts they drive, empty files `test_emulator_telemetry.py` and `test_orphans.py` (two of the on-touch
files) and, for `Check`, a stand-in `.pm/bin/tests/run` that writes its arguments to <checkout>/output/runner-args
at each start and exits with the code of <checkout>/output/runner-exit for that start (0 when there is none). The
worktrees of the issue-branch cases are the fixture's siblings, removed before the case builds its fixture again;
`pm-merge` runs with a made-up HOME inside the fixture.

On a checkout without the change every case fails on its own, for the reason under its heading: `_pmscope` has no
`ON_TOUCH`, `EVERY_FILE` or `harness_tests`; the scope object has no `harness_tests`; the runner ignores its
arguments; `pm-check` gives the runner none and writes no `left_out`; `pm-merge` does not read it; the texts do not
name the new things. The cases whose name ends in `guard` hold a behavior of today and pass there already, and the
cases of `Moved` are made true by the move of this unit itself.
"""
import ast
import json
import re
import shutil
import subprocess
import unittest

from _fixture import BIN, CHECKOUT, HERE, clean_env, git, make, run

import _pmscope

ON_TOUCH_FILES = ["test_check_issue.py", "test_check_stop.py", "test_emulator_dir.py", "test_emulator_telemetry.py", "test_issue_branch.py",
                  "test_orphans.py"]
HELD = ["test_emulator_telemetry.py", "test_orphans.py"]  # the two of the on-touch files a fixture checkout holds
EVERY_FILE = [".pm/bin/_pmscope.py", ".pm/bin/tests/run"]
B, T = ".pm/bin/", ".pm/bin/tests/"
GROUP = "on-touch"
ISSUE_FILE = "issues/things-that-do-not-work/a.md"
GUIDE = ".agents/a.md"  # rule 8: harness, and a source of no on-touch file
LEFT_OUT = "left out: {} (no changed path is one of its sources; .pm/bin/tests/run without arguments runs every file)"
USAGE = "usage: .pm/bin/tests/run [--leave-out <test file> ...]"
STEP_LINE = re.compile(r"^\s*\S+\s+(absent|not needed|deferred|passed|failed|flaky|error)\b")
MIB = 1024 * 1024


def need(*names):
    """Fail the case, not error it, when `_pmscope` lacks one of `names` (the change is not there)."""
    missing = [n for n in names if not hasattr(_pmscope, n)]
    if missing:
        raise AssertionError(f"_pmscope has no {', '.join(missing)}")


def out(p):
    return f"exit {p.returncode}\nstdout:\n{p.stdout}\nstderr:\n{p.stderr}"


def matched(entry, rel):
    """Whether a source of the map entry matches the path, as the map's own matching does."""
    return any(_pmscope._matches(pat, rel, entry.get("outside", ())) for pat in entry["sources"])


def tracked():
    p = subprocess.run(["git", "-C", str(CHECKOUT), "ls-files", "-z"], capture_output=True, text=True,
                       env=clean_env(), timeout=30, check=True)
    return {f for f in p.stdout.split("\0") if f}


# ---------------------------------------------------------------------------------------------------- the questions

def imports(path):
    """The first part of every module name a Python file imports, at any depth of the file."""
    names = []
    for n in ast.walk(ast.parse(path.read_bytes())):
        if isinstance(n, ast.Import):
            names += [a.name.split(".")[0] for a in n.names]
        elif isinstance(n, ast.ImportFrom) and not n.level and n.module:
            names.append(n.module.split(".")[0])
    return names


def missing_test_modules(entries, bin_dir, exempt):
    """(test, path) for every module under <bin>/tests/ an on-touch file imports, in turn, that no source of its
    entry matches."""
    tests, found = bin_dir / "tests", []
    for e in entries:
        seen, todo = set(), [tests / e["test"]]
        while todo:
            f = todo.pop()
            if not f.is_file():
                continue
            for name in imports(f):
                if name in seen or not (tests / f"{name}.py").is_file():
                    continue
                seen.add(name)
                todo.append(tests / f"{name}.py")
                rel = f"{T}{name}.py"
                if rel not in exempt and not matched(e, rel):
                    found.append((e["test"], rel))
    return sorted(set(found))


def scripts_of(entry, bin_dir):
    """The scripts <bin>/pm-* a source of the entry matches."""
    return sorted(p.name for p in bin_dir.glob("pm-*") if p.is_file() and matched(entry, B + p.name))


def missing_helpers(entries, bin_dir, exempt):
    """(test, path) for every helper _pm* that a script among the entry's sources imports, directly or through
    another helper, and that no source of the entry matches."""
    found = []
    for e in entries:
        seen, todo = set(), [bin_dir / s for s in scripts_of(e, bin_dir)]
        while todo:
            for name in imports(todo.pop()):
                if not name.startswith("_pm") or name in seen or not (bin_dir / f"{name}.py").is_file():
                    continue
                seen.add(name)
                todo.append(bin_dir / f"{name}.py")
                rel = f"{B}{name}.py"
                if rel not in exempt and not matched(e, rel):
                    found.append((e["test"], rel))
    return sorted(set(found))


STARTS = re.compile(r'\bBIN\s*/\s*"(pm-[A-Za-z0-9_-]+)"')


def missing_started(entries, bin_dir, exempt):
    """(test, path) for every script that a script among the entry's sources starts as BIN / "pm-<name>", in turn,
    and that no source of the entry matches."""
    found = []
    for e in entries:
        todo = scripts_of(e, bin_dir)
        seen = set(todo)
        while todo:
            for name in STARTS.findall((bin_dir / todo.pop()).read_text(errors="replace")):
                if name in seen:
                    continue
                seen.add(name)
                if (bin_dir / name).is_file():
                    todo.append(name)
                rel = B + name
                if rel not in exempt and not matched(e, rel):
                    found.append((e["test"], rel))
    return sorted(set(found))


def example(pattern):
    """One path made from a source: the path itself, `<folder>x`, or the `*` replaced by `x`."""
    if pattern.endswith("/"):
        return pattern + "x"
    return pattern.replace("*", "x")


# ---------------------------------------------------------------------------------------------------- Map

MADE_UP = {
    "tests/test_one.py": "import unittest\nimport _named\nfrom _unnamed import x\n",
    "tests/_named.py": "",
    "tests/_unnamed.py": "x = 1\n",
    "pm-alpha": "#!/usr/bin/env -S python3 -I\nimport sys\nfrom _pmfirst import a\nfrom _pmscope import decide\n",
    "_pmfirst.py": "import _pmsecond\na = 1\n",
    "_pmsecond.py": "",
    "_pmscope.py": "def decide(paths):\n    return {}\n",
    "pm-beta": '#!/usr/bin/env -S python3 -I\nimport subprocess\nsubprocess.run([str(BIN / "pm-gamma")])\n',
    "pm-gamma": "#!/usr/bin/env -S python3 -I\n",
}


class Map(unittest.TestCase):
    """Given `_pmscope.ON_TOUCH` and `_pmscope.EVERY_FILE` of this checkout and the files under .pm/bin/."""

    def entries(self):
        need("ON_TOUCH", "EVERY_FILE")
        return _pmscope.ON_TOUCH

    def test_entries_are_the_six(self):
        names = [e["test"] for e in self.entries()]
        self.assertEqual(sorted(names), ON_TOUCH_FILES, names)
        for e in _pmscope.ON_TOUCH:
            with self.subTest(test=e["test"]):
                self.assertTrue((HERE / e["test"]).is_file(), e["test"])
                self.assertIsInstance(e.get("why"), str)
                self.assertTrue(e["why"].strip(), e)
                self.assertTrue(e.get("sources"), e)

    def test_every_file_is_the_map_and_the_runner(self):
        entries = self.entries()
        self.assertEqual(sorted(_pmscope.EVERY_FILE), EVERY_FILE)
        self.assertEqual(len(_pmscope.EVERY_FILE), 2, _pmscope.EVERY_FILE)
        for e in entries:
            for path in EVERY_FILE:
                self.assertFalse(matched(e, path), (e["test"], path))

    def test_exact_sources_are_tracked(self):
        entries, files = self.entries(), tracked()
        for e in entries:
            for src in e["sources"]:
                if "*" in src:
                    continue
                with self.subTest(test=e["test"], source=src):
                    if src.endswith("/"):
                        self.assertTrue(any(f.startswith(src) for f in files), f"{src} holds no tracked file")
                    else:
                        self.assertIn(src, files)

    def test_every_source_calls_for_the_harness(self):
        for e in self.entries():
            for src in e["sources"]:
                path = example(src)
                with self.subTest(test=e["test"], path=path):
                    self.assertIn("harness", _pmscope.decide([path]))

    def test_imported_test_modules_are_sources(self):
        entries = self.entries()
        self.assertEqual(missing_test_modules(entries, BIN, set(_pmscope.EVERY_FILE)), [])

    def test_helpers_of_source_scripts_are_sources(self):
        entries = self.entries()
        self.assertEqual(missing_helpers(entries, BIN, set(_pmscope.EVERY_FILE)), [])

    def test_started_scripts_are_sources(self):
        entries = self.entries()
        self.assertEqual(missing_started(entries, BIN, set(_pmscope.EVERY_FILE)), [])

    # Given the same three questions asked of a made-up map and a made-up folder

    def made_up(self):
        need("EVERY_FILE")
        root = CHECKOUT / "output" / "tests" / GROUP / "map-made-up" / ".pm" / "bin"
        if root.parent.parent.exists():
            shutil.rmtree(root.parent.parent)
        for rel, text in MADE_UP.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text)
        return root, set(_pmscope.EVERY_FILE)

    def test_made_up_test_module_not_named_is_reported(self):
        root, exempt = self.made_up()
        entry = dict(test="test_one.py", why="made up", sources=[T + "test_one.py", T + "_named.py"])
        self.assertEqual(missing_test_modules([entry], root, exempt), [("test_one.py", T + "_unnamed.py")])

    def test_made_up_helper_of_a_helper_is_reported(self):
        root, exempt = self.made_up()
        entry = dict(test="test_two.py", why="made up", sources=[B + "pm-alpha", B + "_pmfirst.py"])
        self.assertEqual(missing_helpers([entry], root, exempt), [("test_two.py", B + "_pmsecond.py")])

    def test_made_up_started_script_is_reported(self):
        root, exempt = self.made_up()
        entry = dict(test="test_three.py", why="made up", sources=[B + "pm-beta"])
        self.assertEqual(missing_started([entry], root, exempt), [("test_three.py", B + "pm-gamma")])


# ---------------------------------------------------------------------------------------------------- Decide

class Decide(unittest.TestCase):
    """Given `_pmscope.harness_tests(paths)`; no fixture."""

    def ht(self, *paths):
        need("harness_tests")
        return _pmscope.harness_tests(list(paths))

    def test_one_test_file_of_its_own(self):
        a = self.ht(T + "test_emulator_telemetry.py")
        self.assertIs(a["all"], False)
        self.assertEqual(list(a["called"]), ["test_emulator_telemetry.py"])
        self.assertEqual(a["left_out"], [n for n in ON_TOUCH_FILES if n != "test_emulator_telemetry.py"])

    def test_a_guide_calls_for_none(self):
        a = self.ht(".agents/skills/pm/SKILL.md")
        self.assertIs(a["all"], False)
        self.assertEqual(a["called"], {})
        self.assertEqual(a["why"], "")
        self.assertEqual(a["left_out"], ON_TOUCH_FILES)

    def test_no_path_leaves_out_the_six(self):
        a = self.ht()
        self.assertIs(a["all"], False)
        self.assertEqual(a["left_out"], ON_TOUCH_FILES)

    def test_pm_check(self):
        self.assertEqual(set(self.ht(B + "pm-check")["called"]),
                         {"test_check_issue.py", "test_check_stop.py", "test_issue_branch.py"})

    def test_pmlib_is_asked_of_every_entry(self):
        self.assertEqual(set(self.ht(B + "_pmlib.py")["called"]),
                         {"test_check_issue.py", "test_check_stop.py", "test_emulator_dir.py", "test_issue_branch.py",
                          "test_orphans.py"})

    def test_folders_and_the_union_over_paths(self):
        a = self.ht(T + "fixtures/emulator-telemetry/a/compose.yml", B + "_pmwake.py")
        self.assertEqual(set(a["called"]), {"test_emulator_telemetry.py", "test_orphans.py"})

    def test_called_line_counts_the_paths(self):
        two = self.ht(T + "test_emulator_telemetry.py",
                      T + "_emulator_telemetry.py")["called"]["test_emulator_telemetry.py"]
        self.assertEqual(len(two), 1, two)
        self.assertTrue(two[0].endswith(f"(2 paths, e.g. {T}_emulator_telemetry.py)"), two)
        one = self.ht(T + "test_emulator_telemetry.py")["called"]["test_emulator_telemetry.py"]
        self.assertTrue(one[0].endswith(f"(1 path, e.g. {T}test_emulator_telemetry.py)"), one)

    def test_compose_files(self):
        for path in ["infra/aws-emulator/docker-compose.yml", "docker-compose.yml", "a/b/compose.dev.yaml"]:
            with self.subTest(path=path):
                self.assertIn("test_emulator_telemetry.py", self.ht(path)["called"])
        self.assertNotIn("test_emulator_telemetry.py",
                         self.ht(T + "fixtures/compose-side-by-side/a/docker-compose.yml")["called"])

    def test_an_exact_source_matches_only_itself(self):
        for path in [B + "pm-watchd-old", "studio/package.json.bak", B + "x/pm-watchd", T + "test_orphans.pyc"]:
            with self.subTest(path=path):
                a = self.ht(path)
                self.assertIs(a["all"], False)
                self.assertNotIn("test_orphans.py", a["called"])

    def assertEvery(self, a, path):
        self.assertIs(a["all"], True)
        self.assertIn(path, a["why"])
        self.assertEqual(a["called"], {})
        self.assertEqual(a["left_out"], [])

    def test_the_map_runs_every_file(self):
        for paths in ([B + "_pmscope.py"], [B + "_pmscope.py", T + "test_emulator_telemetry.py", GUIDE]):
            with self.subTest(paths=paths):
                self.assertEvery(self.ht(*paths), B + "_pmscope.py")

    def test_the_runner_runs_every_file(self):
        for paths in ([T + "run"], [T + "run", T + "test_emulator_telemetry.py"]):
            with self.subTest(paths=paths):
                self.assertEvery(self.ht(*paths), T + "run")

    def test_a_path_no_rule_knows_runs_every_file(self):
        self.assertEvery(self.ht("LICENSE", T + "test_emulator_telemetry.py"), "LICENSE")


# ---------------------------------------------------------------------------------------------------- fixtures

def fixture(case, scripts, files=None, held=HELD):
    """A fixture checkout of `case` holding `scripts`, every helper, `files` and empty files of the `held` test
    files; the worktrees an earlier run of the case left beside it are removed first."""
    parent = CHECKOUT / "output" / "tests" / GROUP
    if parent.exists():
        for sibling in parent.iterdir():
            if re.fullmatch(re.escape(case) + r"-\d+(-[a-z0-9]+)?", sibling.name):
                shutil.rmtree(sibling)
    return make(GROUP, case, scripts, {**{T + n: "" for n in held}, **(files or {})})


def touch(repo, paths):
    """Change `paths` in `repo`: a file that exists gets a comment line at its end, any other is created."""
    for rel in paths:
        p = repo / rel
        if p.exists():
            with open(p, "a") as f:
                f.write("\n# changed by test_on_touch\n")
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(f"{rel}\n")


def commit(repo, paths, msg="change"):
    touch(repo, paths)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", msg)


def branch(co, paths, name="feat/x"):
    """A branch from main's head in `co` with one commit that changes `paths`."""
    git(co, "checkout", "-q", "-b", name)
    commit(co, paths, name)


def issue_branch(co):
    """Issue 9 of the fixture: feat/9, in a worktree of its own, holding another unit's change of pm-watchd, and
    its unit feat/9-h1 cut from it in a second worktree with one commit of `.agents/a.md`. Returns both."""
    iw, uw = co.parent / f"{co.name}-9", co.parent / f"{co.name}-9-h1"
    git(co, "worktree", "add", "-q", "-b", "feat/9", str(iw), "main")
    commit(iw, [B + "pm-watchd"], "another unit")
    git(co, "worktree", "add", "-q", "-b", "feat/9-h1", str(uw), "feat/9")
    commit(uw, [GUIDE], "h1")
    return iw, uw


def name_of(case):
    return f"{type(case).__name__}-{case._testMethodName[5:]}".lower().replace("_", "-")


# ---------------------------------------------------------------------------------------------------- Scope

SCOPE_SCRIPTS = ("pm-scope",)


class Scope(unittest.TestCase):
    """Given a fixture checkout F with pm-scope and _pmscope.py, and empty test_emulator_telemetry.py and
    test_orphans.py."""

    def setUp(self):
        self.co = fixture(name_of(self), SCOPE_SCRIPTS)

    def text(self, target=None):
        p = run(self.co, "pm-scope", target or self.co)
        self.assertEqual(p.returncode, 0, out(p))
        return p.stdout.splitlines()

    def json(self, target=None):
        p = run(self.co, "pm-scope", target or self.co, "--json")
        self.assertEqual(p.returncode, 0, out(p))
        return json.loads(p.stdout)

    def ht(self, target=None):
        sc = self.json(target)
        self.assertIn("harness_tests", sc, sc)
        return sc["harness_tests"]

    def line(self, lines, start):
        found = [ln for ln in lines if ln.startswith(start)]
        self.assertEqual(len(found), 1, "\n".join(lines))
        return found[0]

    def test_json_left_out_names_only_what_f_holds(self):
        branch(self.co, [GUIDE])
        ht = self.ht()
        self.assertIs(ht["all"], False)
        self.assertEqual(ht["left_out"], HELD)
        self.assertEqual(ht["called"], {})
        self.assertEqual(ht["on_touch"], 2)

    def test_text_line_after_the_harness_module(self):
        branch(self.co, [GUIDE])
        lines = self.text()
        mine = self.line(lines, "  harness tests")
        self.assertEqual(mine, "  harness tests left out: test_emulator_telemetry.py, test_orphans.py")
        module = [i for i, ln in enumerate(lines) if ln.startswith("  harness ") and not ln.startswith("  harness tests")]
        self.assertTrue(module, "\n".join(lines))
        self.assertGreater(lines.index(mine), module[0], "\n".join(lines))

    def test_a_called_for_file_has_its_line(self):
        branch(self.co, [B + "pm-watchd"])
        lines = self.text()
        mine = self.line(lines, "  harness tests")
        self.assertEqual(mine, "  harness tests left out: test_emulator_telemetry.py")
        after = lines[lines.index(mine) + 1:]
        self.assertTrue(any("test_orphans.py" in ln and B + "pm-watchd" in ln for ln in after), "\n".join(lines))
        ht = self.ht()
        self.assertEqual(list(ht["called"]), ["test_orphans.py"])
        self.assertEqual(ht["left_out"], ["test_emulator_telemetry.py"])

    def test_both_called_for_leaves_out_none(self):
        branch(self.co, [B + "pm-watchd", T + "_emulator_telemetry.py"])
        self.assertEqual(self.line(self.text(), "  harness tests"), "  harness tests left out: none")

    def test_the_map_changed_is_every_file(self):
        branch(self.co, [B + "_pmscope.py"])
        mine = self.line(self.text(), "  harness tests")
        self.assertTrue(mine.startswith("  harness tests every file:"), mine)
        self.assertIn(B + "_pmscope.py", mine)
        ht = self.ht()
        self.assertIs(ht["all"], True)
        self.assertEqual(ht["left_out"], [])

    def test_a_source_only_of_files_f_does_not_hold(self):
        branch(self.co, [B + "pm-check"])
        ht = self.ht()
        self.assertEqual(ht["left_out"], HELD)
        self.assertEqual(ht["called"], {})

    def test_no_harness_no_line_guard(self):
        for i, path in enumerate([ISSUE_FILE, "studio/src/a.ts"]):
            with self.subTest(path=path):
                git(self.co, "checkout", "-q", "main")
                branch(self.co, [path], f"feat/x{i}")
                self.assertFalse([ln for ln in self.text() if "harness tests" in ln])
                self.assertNotIn("harness_tests", self.json())

    def test_kind_main_has_no_key_guard(self):
        sc = self.json()
        self.assertEqual(sc["kind"], "main", sc)
        self.assertNotIn("harness_tests", sc)

    def test_changes_that_cannot_be_read_are_every_file(self):
        git(self.co, "branch", "-m", "main", "trunk")
        commit(self.co, [GUIDE])
        sc = self.json()
        self.assertEqual(sc["kind"], "full", sc)
        self.assertIn("harness_tests", sc, sc)
        self.assertIs(sc["harness_tests"]["all"], True)
        self.assertEqual(sc["harness_tests"]["why"], sc["reason"])

    # Given F as a unit feat/9-h1 of an issue branch feat/9 that holds another unit's change of pm-watchd

    def test_unit_is_held_to_its_own_paths(self):
        _, uw = issue_branch(self.co)
        sc = self.json(uw)
        self.assertEqual((sc["kind"], sc["target"]), ("unit", "feat/9"), sc)
        self.assertIn("harness_tests", sc, sc)
        self.assertIn("test_orphans.py", sc["harness_tests"]["left_out"])

    def test_issue_branch_calls_for_what_a_unit_did(self):
        iw, _ = issue_branch(self.co)
        sc = self.json(iw)
        self.assertEqual(sc["target"], "main", sc)
        self.assertIn("harness_tests", sc, sc)
        self.assertIn("test_orphans.py", sc["harness_tests"]["called"])


class ScopeNoOnTouchFile(unittest.TestCase):
    """Given a fixture checkout that holds none of the on-touch files, on a branch that changes .pm/bin/a."""

    def setUp(self):
        self.co = fixture(name_of(self), SCOPE_SCRIPTS, held=())
        branch(self.co, [B + "a"])

    def test_prints_two_lines_guard(self):
        p = run(self.co, "pm-scope", self.co)
        self.assertEqual(p.returncode, 0, out(p))
        lines = p.stdout.splitlines()
        self.assertEqual(len(lines), 2, p.stdout)
        self.assertFalse([ln for ln in lines if "harness tests" in ln], p.stdout)

    def test_json_counts_no_on_touch_file(self):
        p = run(self.co, "pm-scope", self.co, "--json")
        self.assertEqual(p.returncode, 0, out(p))
        sc = json.loads(p.stdout)
        self.assertIn("harness_tests", sc, sc)
        ht = sc["harness_tests"]
        self.assertIs(ht["all"], False)
        self.assertEqual(ht["on_touch"], 0)
        self.assertEqual(ht["left_out"], [])
        self.assertEqual(ht["called"], {})


# ---------------------------------------------------------------------------------------------------- Run

def module(name, ok=True, extra=""):
    """A made-up test file: it writes `imported-<name>` beside the folder when imported, and its one case appends
    its file name to `ran` there, then passes or fails."""
    return f'''import pathlib
import unittest
{extra}
ROOT = pathlib.Path(__file__).resolve().parent.parent
(ROOT / "imported-{name}").write_text("x")


class Case_{name}(unittest.TestCase):
    def test_{name}(self):
        with open(ROOT / "ran", "a") as f:
            f.write("{name}\\n")
        self.assertTrue({ok})
'''


class Run(unittest.TestCase):
    """This checkout's runner, copied with made-up test files into a folder of its own; nothing real runs."""

    def folder(self, files):
        root = CHECKOUT / "output" / "tests" / GROUP / name_of(self)
        if root.exists():
            shutil.rmtree(root)
        tests = root / "tests"
        tests.mkdir(parents=True)
        shutil.copy2(HERE / "run", tests / "run")
        for name, text in files.items():
            (tests / name).write_text(text)
        self.root, self.tests = root, tests
        return root

    def first(self, extra=None):
        """The first Given: test_a.py and test_b.py pass, test_c.py fails; each writes its marker when imported."""
        return self.folder({"test_a.py": module("a"), "test_b.py": module("b"), "test_c.py": module("c", ok=False),
                            **(extra or {})})

    def run_it(self, *args):
        return subprocess.run([str(self.tests / "run"), *args], capture_output=True, text=True, cwd=str(self.tests),
                              env=clean_env(), timeout=120)

    def ran(self):
        f = self.root / "ran"
        return f.read_text().split() if f.exists() else []

    def markers(self):
        return sorted(p.name for p in self.root.glob("imported-*"))

    def left(self, p):
        return [ln for ln in p.stdout.splitlines() if ln.startswith("left out:")]

    def test_no_argument_runs_every_file_guard(self):
        self.first()
        p = self.run_it()
        self.assertEqual(p.returncode, 1, out(p))
        self.assertEqual(self.ran(), ["a", "b", "c"])
        self.assertEqual(self.left(p), [])
        (self.tests / "test_c.py").unlink()
        self.assertEqual(self.run_it().returncode, 0)

    def test_leave_out_the_failing_file(self):
        self.first()
        p = self.run_it("--leave-out", "test_c.py")
        self.assertEqual(p.returncode, 0, out(p))
        self.assertEqual(p.stdout.splitlines()[:1], [LEFT_OUT.format("test_c.py")], out(p))
        self.assertEqual(self.ran(), ["a", "b"])

    def test_a_left_out_file_is_not_imported(self):
        self.first()
        p = self.run_it("--leave-out", "test_b.py")
        self.assertEqual(p.returncode, 1, out(p))
        self.assertNotIn("imported-b", self.markers())

    def test_two_left_out_in_name_order_before_the_tests(self):
        self.first()
        p = self.run_it("--leave-out", "test_c.py", "test_a.py")
        self.assertEqual(p.stdout.splitlines()[:2], [LEFT_OUT.format("test_a.py"), LEFT_OUT.format("test_c.py")],
                         out(p))
        self.assertEqual(len(self.left(p)), 2, out(p))
        self.assertEqual(self.ran(), ["b"])

    def test_a_name_given_twice_counts_once(self):
        self.first()
        p = self.run_it("--leave-out", "test_c.py", "test_c.py")
        self.assertEqual(p.returncode, 0, out(p))
        self.assertEqual(self.left(p), [LEFT_OUT.format("test_c.py")], out(p))

    def test_every_file_left_out_finds_no_test(self):
        self.first()
        p = self.run_it("--leave-out", "test_a.py", "test_b.py", "test_c.py")
        self.assertEqual(p.returncode, 1, out(p))
        self.assertIn("no test_*.py test found", p.stdout + p.stderr)
        self.assertEqual(self.ran(), [])

    def test_an_import_error_is_reported_as_today(self):
        self.first({"test_b.py": "import unittest\ndef broken(:\n"})
        p = self.run_it("--leave-out", "test_c.py")
        self.assertEqual(p.returncode, 1, out(p))
        self.assertEqual(p.stdout.splitlines()[:1], [LEFT_OUT.format("test_c.py")], out(p))
        both = p.stdout + p.stderr
        self.assertIn("test_b", both)
        self.assertIn("SyntaxError", both)
        self.assertNotIn("c", self.ran())

    def test_a_base_class_from_a_left_out_file(self):
        base = "class Base(unittest.TestCase):\n    def helper(self):\n        return 1\n"
        self.first({"test_c.py": module("c", ok=False, extra=base),
                    "test_d.py": module("d", extra="from test_c import Base\n").replace(
                        "(unittest.TestCase)", "(Base)")})
        p = self.run_it("--leave-out", "test_c.py")
        self.assertIn("d", self.ran(), out(p))
        self.assertNotIn("c", self.ran(), out(p))

    def test_the_others_run_in_todays_order(self):
        self.folder({f"test_{n}.py": module(n) for n in "abcde"})
        p = self.run_it("--leave-out", "test_c.py")
        self.assertEqual(self.ran(), ["a", "b", "d", "e"], out(p))

    def test_refusals(self):
        rows = [("--leave-out",), ("--leave-out", "test_zzz.py"), ("--leave-out", "../test_a.py"),
                ("--leave-out", "test_a"), ("--leave-out", "Test_a.py"), ("--leave-out", "_helper.py"),
                ("--leave-out", "test_a.py", "--verbose"), ("test_a.py",), ("--verbose",)]
        for args in rows:
            with self.subTest(args=args):
                self.first({"_helper.py": "x = 1\n"})
                p = self.run_it(*args)
                self.assertEqual(p.returncode, 2, out(p))
                self.assertIn(USAGE, p.stderr)
                self.assertEqual(self.ran(), [])
                self.assertEqual(self.markers(), [])


# ---------------------------------------------------------------------------------------------------- Check

CHECK_SCRIPTS = ("pm-check", "pm-scope")
RUNNER = """#!/bin/sh
# Stand-in for .pm/bin/tests/run (test_on_touch.Check): {knows}
out=../../../output
mkdir -p "$out"
printf '%s\\n' "$*" >> "$out/runner-args"
n=$(wc -l < "$out/runner-args" | tr -d ' ')
code=$(sed -n "${{n}}p" "$out/runner-exit" 2>/dev/null)
[ -n "$code" ] || code=$(tail -n 1 "$out/runner-exit" 2>/dev/null)
exit "${{code:-0}}"
"""
KNOWS = "it takes --leave-out <test file> ..."
OLD = "it takes no argument, as the runner of a checkout cut before issue 328"
ARGS = "--leave-out test_emulator_telemetry.py test_orphans.py"


class Check(unittest.TestCase):
    """Given F with pm-check and the helpers, empty test_emulator_telemetry.py and test_orphans.py, and a stand-in
    runner."""

    def fixture(self, runner=None, row=None):
        case = name_of(self) + (f"-{row}" if row else "")
        self.co = fixture(case, CHECK_SCRIPTS)
        self.runner(self.co, RUNNER.format(knows=KNOWS).encode() if runner is None else runner)
        return self.co

    def runner(self, co, data):
        f = co / T / "run"
        f.write_bytes(data)
        f.chmod(0o755)
        git(co, "add", "-A")
        git(co, "commit", "-q", "-m", "the stand-in runner")

    def exits(self, *codes, co=None):
        f = (co or self.co) / "output" / "runner-exit"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("".join(f"{c}\n" for c in codes))

    def check(self, *args, target=None):
        return run(self.co, "pm-check", target or self.co, *args, timeout=300)

    def args(self, co=None):
        f = (co or self.co) / "output" / "runner-args"
        return f.read_text().split("\n")[:-1] if f.exists() else None

    def record(self, co=None):
        return json.loads(((co or self.co) / "output" / "checks" / "last.json").read_text())

    def step(self, co=None):
        found = [s for s in self.record(co)["steps"] if s["name"] == "harness-test"]
        self.assertEqual(len(found), 1, self.record(co)["steps"])
        return found[0]

    def left_out(self, co=None):
        s = self.step(co)
        self.assertIn("left_out", s, s)
        return s["left_out"]

    def scope_ht(self):
        sc = self.record()["scope"]
        self.assertIn("harness_tests", sc, sc)
        return sc["harness_tests"]

    def test_a_guide_leaves_out_both(self):
        self.fixture()
        branch(self.co, [GUIDE])
        p = self.check()
        self.assertEqual(self.args(), [ARGS], out(p))
        self.assertEqual(self.left_out(), HELD)
        self.assertEqual(self.step()["status"], "passed")
        self.assertEqual(p.returncode, 0, out(p))
        self.assertIs(self.record()["passed"], True)

    def test_pm_watchd_leaves_out_test_emulator_telemetry(self):
        self.fixture()
        branch(self.co, [B + "pm-watchd"])
        p = self.check()
        self.assertEqual(self.args(), ["--leave-out test_emulator_telemetry.py"], out(p))
        self.assertEqual(self.left_out(), ["test_emulator_telemetry.py"])

    def test_both_called_for_gives_no_argument(self):
        self.fixture()
        branch(self.co, [B + "pm-watchd", T + "_emulator_telemetry.py"])
        p = self.check()
        self.assertEqual(self.args(), [""], out(p))
        self.assertEqual(self.left_out(), [])

    def test_the_map_changed_gives_no_argument(self):
        self.fixture()
        branch(self.co, [B + "_pmscope.py"])
        p = self.check()
        self.assertEqual(self.args(), [""], out(p))
        self.assertEqual(self.left_out(), [])

    def test_full_gives_no_argument(self):
        self.fixture()
        branch(self.co, [GUIDE])
        p = self.check("--full")
        self.assertEqual(self.args(), [""], out(p))
        self.assertEqual(self.left_out(), [])
        ht = self.scope_ht()
        self.assertIs(ht["all"], True)
        self.assertEqual(ht["why"], "--full")

    def test_only_harness_gives_no_argument(self):
        self.fixture()
        branch(self.co, [GUIDE])
        p = self.check("--only", "harness")
        self.assertEqual(self.args(), [""], out(p))
        self.assertEqual(self.left_out(), [])
        self.assertEqual(self.scope_ht()["why"], "--only harness")

    def test_the_line_comes_before_the_first_step(self):
        self.fixture()
        branch(self.co, [GUIDE])
        p = self.check()
        lines = p.stdout.splitlines()
        first = next((i for i, ln in enumerate(lines) if STEP_LINE.match(ln)), len(lines))
        self.assertIn("  harness tests left out: test_emulator_telemetry.py, test_orphans.py", lines[:first], out(p))

    def test_the_retry_gets_the_same_arguments(self):
        self.fixture()
        branch(self.co, [GUIDE])
        self.exits(1, 0)
        p = self.check()
        self.assertEqual(self.args(), [ARGS, ARGS], out(p))
        self.assertEqual(self.step()["status"], "flaky")
        self.assertEqual(self.left_out(), HELD)

    def test_a_refusing_runner_fails_the_step(self):
        self.fixture()
        branch(self.co, [GUIDE])
        self.exits(2)
        p = self.check()
        self.assertEqual(self.step()["status"], "failed", out(p))
        self.assertEqual(self.left_out(), HELD)
        self.assertNotEqual(p.returncode, 0, out(p))
        self.assertIs(self.record()["passed"], False)

    def test_a_changed_path_never_reaches_the_runner(self):
        self.fixture()
        branch(self.co, [GUIDE, T + "test_new.py"])
        p = self.check()
        self.assertEqual(self.args(), [ARGS], out(p))

    def test_on_request_is_not_given_to_the_runner(self):
        self.fixture()
        branch(self.co, [GUIDE])
        p = self.check("--on-request")
        args = self.args()
        self.assertEqual(len(args or []), 1, out(p))
        self.assertEqual(args[0].split(), ARGS.split())
        self.assertNotIn("--on-request", args[0])

    def test_a_step_not_needed_has_no_left_out_guard(self):
        self.fixture()
        branch(self.co, ["studio/src/a.ts"])
        p = self.check()
        s = self.step()
        self.assertEqual(s["status"], "not-needed", out(p))
        self.assertNotIn("left_out", s)

    # Given F with a stand-in runner whose text does not name the option

    def test_an_old_runner_gets_no_argument(self):
        self.fixture(RUNNER.format(knows=OLD).encode())
        branch(self.co, [GUIDE])
        p = self.check()
        self.assertEqual(self.args(), [""], out(p))
        self.assertEqual(self.left_out(), [])
        self.assertEqual(self.scope_ht()["left_out"], HELD)

    # Given F with a stand-in runner whose text cannot be used, and a branch that changes .agents/a.md

    def test_a_runner_of_one_mib_and_one_byte_more(self):
        text = RUNNER.format(knows=KNOWS).encode()
        for size, want in ((MIB, [ARGS]), (MIB + 1, [""])):
            with self.subTest(size=size):
                pad = size - len(text) - 2
                self.fixture(text + b"#" + b"x" * pad + b"\n", row=str(size))
                self.assertEqual((self.co / T / "run").stat().st_size, size)
                branch(self.co, [GUIDE])
                p = self.check()
                self.assertEqual(self.args(), want, out(p))
                if size > MIB:
                    self.assertEqual(self.left_out(), [])

    def test_a_runner_that_is_not_utf8(self):
        self.fixture(RUNNER.format(knows=KNOWS).encode() + b"# \xff\xfe\xc3\x28 not UTF-8\n")
        branch(self.co, [GUIDE])
        p = self.check()
        self.assertEqual(self.args(), [""], out(p))
        self.assertEqual(self.left_out(), [])
        self.assertEqual(self.step()["status"], "passed")

    # Given F as a unit feat/9-h1 of an issue branch feat/9 that holds another unit's change of pm-watchd

    def test_a_unit_is_held_to_its_own_paths(self):
        self.fixture()
        _, uw = issue_branch(self.co)
        p = self.check(target=uw)
        self.assertEqual(self.record(uw)["scope"]["kind"], "unit", out(p))
        self.assertEqual(self.args(uw), [ARGS], out(p))


# ---------------------------------------------------------------------------------------------------- Merge

MERGE_SCRIPTS = ("pm-scope", "pm-check", "pm-merge", "pm-emulator-dir")
MISSING = object()


class Merge(unittest.TestCase):
    """A record is written by the case in the shape pm-check writes, as test_merge_scope.py does; pm-merge runs with
    a made-up HOME and --dry-run, except where a case merges."""

    def unit(self, paths):
        """A fixture with a reviewed unit feat/7-h1 from main, in a registered worktree, with one commit of `paths`."""
        self.co = fixture(name_of(self), MERGE_SCRIPTS)
        (self.co / "home").mkdir()
        w = self.co.parent / f"{self.co.name}-7-h1"
        git(self.co, "worktree", "add", "-q", "-b", "feat/7-h1", str(w), "main")
        commit(w, paths, "h1")
        self.register([dict(issue="7", unit="h1", branch="feat/7-h1", path=str(w), base="main")])
        self.review(7, "h1")
        return w

    def issue(self):
        """A fixture with issue 9 (see `issue_branch`) registered and its unit h1 reviewed."""
        self.co = fixture(name_of(self), MERGE_SCRIPTS)
        (self.co / "home").mkdir()
        iw, uw = issue_branch(self.co)
        self.register([dict(issue="9", unit="issue", branch="feat/9", path=str(iw), base="main"),
                       dict(issue="9", unit="h1", branch="feat/9-h1", path=str(uw), base="feat/9")])
        self.review(9, "h1")
        return iw, uw

    def register(self, entries):
        reg = self.co / ".pm" / "run"
        reg.mkdir(parents=True, exist_ok=True)
        (reg / "worktrees.json").write_text(json.dumps(entries))

    def review(self, issue, unit):
        d = self.co / ".pm" / f"issue-{issue}"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"review-impl-{unit}-r1.md").write_text("verdict: pass\np1: 0\np2: 0\np3: 0\n---\n")

    def record(self, w, left_out=MISSING, status="passed"):
        """The passing last.json of `w`'s head: engine and studio absent, integration not needed, the harness step
        with `status` and, unless MISSING, `left_out`."""
        harness = dict(name="harness-test", module="harness", status=status, seconds=1,
                       log=str(w / "output" / "logs" / "check-harness-test.log"))
        if left_out is not MISSING:
            harness["left_out"] = left_out
        steps = [dict(name="engine", module="engine", status="absent", seconds=0, log=None),
                 dict(name="studio", module="studio", status="absent", seconds=0, log=None),
                 dict(name="integration", module="integration", status="not-needed", seconds=0, log=None), harness]
        rec = dict(at="2026-11-17T00:00:00+00:00", commit=git(w, "rev-parse", "HEAD"), dirty=False, full=False,
                   on_request=False, passed=True, failed=[], flaky=["harness-test"] if status == "flaky" else [],
                   cpu_at_start=None, ports={}, scope=dict(kind="diff", reason="written by the case"), steps=steps)
        d = w / "output" / "checks"
        d.mkdir(parents=True, exist_ok=True)
        (d / "last.json").write_text(json.dumps(rec, indent=1))

    def merge(self, *args):
        return run(self.co, "pm-merge", *args, env={**clean_env(), "HOME": str(self.co / "home")})

    def assertOk(self, p):
        self.assertEqual(p.returncode, 0, out(p))
        self.assertIn("ok to merge", p.stdout, out(p))

    def assertRefused(self, p, *words):
        """Refused, with one line of stderr that holds every word and `run pm-check again`; returns that line."""
        self.assertEqual(p.returncode, 1, out(p))
        self.assertIn("cannot merge", p.stderr, out(p))
        found = [ln for ln in p.stderr.splitlines() if all(w in ln for w in (*words, "run pm-check again"))]
        self.assertTrue(found, out(p))
        return found[0]

    # Given a fixture checkout with a reviewed unit whose branch changes .pm/bin/pm-watchd

    def test_a_file_not_called_for_merges_guard(self):
        self.record(self.unit([B + "pm-watchd"]), ["test_emulator_telemetry.py"])
        p = self.merge(7, "h1")
        self.assertEqual(p.returncode, 0, out(p))
        self.assertEqual(git(self.co, "log", "-1", "--format=%s", "main"), "merge: #7 h1 (feat/7-h1)")

    def test_a_called_for_file_left_out_is_refused(self):
        self.record(self.unit([B + "pm-watchd"]), HELD)
        line = self.assertRefused(self.merge(7, "h1", "--dry-run"), "test_orphans.py")
        self.assertNotIn("test_emulator_telemetry.py", line)

    def test_none_left_out_guard(self):
        self.record(self.unit([B + "pm-watchd"]), [])
        self.assertOk(self.merge(7, "h1", "--dry-run"))

    def test_a_record_without_the_key_guard(self):
        self.record(self.unit([B + "pm-watchd"]))
        self.assertOk(self.merge(7, "h1", "--dry-run"))

    def test_a_flaky_step_is_asked_too(self):
        self.record(self.unit([B + "pm-watchd"]), ["test_orphans.py"], status="flaky")
        self.assertRefused(self.merge(7, "h1", "--dry-run"), "test_orphans.py")

    def test_left_out_that_cannot_be_read(self):
        w = self.unit([B + "pm-watchd"])
        for value in ("test_emulator_telemetry.py", [1], {"a": 1}):
            with self.subTest(left_out=value):
                self.record(w, value)
                self.assertRefused(self.merge(7, "h1", "--dry-run"), "left_out cannot be read")

    # Given the same with a branch that changes .pm/bin/_pmscope.py

    def test_the_map_changed_calls_for_every_file(self):
        self.record(self.unit([B + "_pmscope.py"]), ["test_emulator_telemetry.py"])
        self.assertRefused(self.merge(7, "h1", "--dry-run"), "test_emulator_telemetry.py")

    # Given a unit feat/9-h1 of an issue branch feat/9 that holds another unit's change of pm-watchd

    def test_a_unit_into_its_issue_branch_is_held_to_its_paths_guard(self):
        _, uw = self.issue()
        self.record(uw, HELD)
        self.assertOk(self.merge(9, "h1", "--dry-run"))

    def whole(self, left_out):
        iw, _ = self.issue()
        git(iw, "merge", "-q", "--no-ff", "-m", "merge: #9 h1 (feat/9-h1) into feat/9", "feat/9-h1")
        self.record(iw, left_out)
        return self.merge(9, "--dry-run")

    def test_the_whole_check_is_held_to_the_issue_branchs_paths(self):
        self.assertRefused(self.whole(["test_orphans.py"]), "test_orphans.py")

    def test_the_whole_check_leaving_out_what_nothing_called_for_guard(self):
        self.assertOk(self.whole(["test_emulator_telemetry.py"]))


# ---------------------------------------------------------------------------------------------------- Moved

SCAN_RULES = [
    "test_shell_without_flag", "test_shell_flag_t_off", "test_shell_flag_telemetry_off",
    "test_shell_flag_telemetry_equals_off", "test_flag_on_continuation_line", "test_flag_after_the_statement_ended",
    "test_rust_array_without_flag", "test_rust_array_with_flag", "test_typescript_array_without_flag",
    "test_typescript_array_with_flag", "test_inside_command_substitution", "test_image_with_tag",
    "test_image_with_registry_path", "test_run_with_tty_flag", "test_compose_without_flag", "test_compose_with_flag",
    "test_two_starts_in_file_order", "test_ignored_entrypoint_option", "test_ignored_one_shot_version",
    "test_ignored_one_shot_help", "test_ignored_dockerfile_entrypoint", "test_ignored_build_tag",
    "test_ignored_image_inspect", "test_ignored_prose_comment", "test_ignored_path", "test_not_scanned_markdown",
    "test_not_scanned_under_issues", "test_not_scanned_symlink", "test_not_scanned_not_utf8",
]  # the cases of ScanRules at 3002fc5, which moved; ScanRules may have more since
PANE_RULE = ["test_emulator_section_names_both_commands", "test_scripts_table_has_one_row"]


def cases(name):
    """{class name: [method names]} of the test file `name`, as the loader finds them; nothing is run."""
    found = {}

    def walk(suite):
        for t in suite:
            if isinstance(t, unittest.TestSuite):
                walk(t)
            else:
                found.setdefault(type(t).__name__, []).append(t._testMethodName)

    walk(unittest.TestLoader().discover(str(HERE), pattern=name, top_level_dir=str(HERE)))
    return found


class Moved(unittest.TestCase):
    """Given the test files under .pm/bin/tests/ of this checkout."""

    def test_the_scan_file_holds_the_scan_classes(self):
        found = cases("test_emulator_scan.py")
        self.assertEqual(found.get("RepositoryScan"), ["test_every_start_site_passes_t_off"])
        missing = sorted(set(SCAN_RULES) - set(found.get("ScanRules", [])))
        self.assertEqual(missing, [], found.get("ScanRules"))

    def test_the_guides_file_holds_pane_rule(self):
        found = cases("test_emulator_dir_guides.py")
        missing = sorted(set(PANE_RULE) - set(found.get("PaneRule", [])))
        self.assertEqual(missing, [], found.get("PaneRule"))

    def test_the_two_slow_files_lost_them(self):
        telemetry, emulator_dir = cases("test_emulator_telemetry.py"), cases("test_emulator_dir.py")
        self.assertNotIn("RepositoryScan", telemetry)
        self.assertNotIn("ScanRules", telemetry)
        self.assertNotIn("PaneRule", emulator_dir)
        moved = set(SCAN_RULES) | set(PANE_RULE) | {"test_every_start_site_passes_t_off"}
        for name, found in (("test_emulator_telemetry.py", telemetry), ("test_emulator_dir.py", emulator_dir)):
            with self.subTest(name):
                self.assertTrue(found, name)
                kept = {f"{c}.{m}" for c, ms in found.items() for m in ms if m in moved}
                self.assertEqual(sorted(kept), [], name)

    def test_neither_imports_the_other_and_both_the_helper(self):
        scan, telemetry = imports(HERE / "test_emulator_scan.py"), imports(HERE / "test_emulator_telemetry.py")
        self.assertNotIn("test_emulator_telemetry", scan)
        self.assertNotIn("test_emulator_scan", telemetry)
        self.assertIn("_emulator_telemetry", scan)
        self.assertIn("_emulator_telemetry", telemetry)

    def test_what_the_repository_scan_leaves_out(self):
        tree = ast.parse((HERE / "test_emulator_scan.py").read_text())
        values = [ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                  and any(isinstance(t, ast.Name) and t.id == "REPO_SCAN_EXCLUDED" for t in n.targets)]
        self.assertEqual(len(values), 1, values)
        self.assertEqual(sorted(values[0]), sorted([
            T + "test_emulator_scan.py", T + "test_emulator_telemetry.py", T + "_emulator_telemetry.py",
            T + "fixtures/emulator-telemetry/"]))
        self.assertEqual(len(values[0]), 4)


# ---------------------------------------------------------------------------------------------------- Guides

def flat(text):
    """The text in lower case with backticks dropped and every run of whitespace one space."""
    return re.sub(r"\s+", " ", text.replace("`", "")).lower()


def near(text, words, span=400):
    """Whether every word occurs within `span` characters after some occurrence of the first."""
    for m in re.finditer(re.escape(words[0]), text):
        window = text[m.start():m.start() + span]
        if all(w in window for w in words[1:]):
            return True
    return False


def docstring(rel):
    return ast.get_docstring(ast.parse((CHECKOUT / rel).read_bytes())) or ""


class Guides(unittest.TestCase):
    """Given the docstrings of the scripts and the PM skill of this checkout; text only."""

    def test_the_runner(self):
        doc = docstring(T + "run")
        self.assertIn(".pm/bin/tests/run [--leave-out <test file> ...]", doc)
        self.assertRegex(flat(doc), r"(no|without( an| any)?) arguments?\b.{0,80}\bevery (test )?file")

    def test_pm_check(self):
        doc = docstring(B + "pm-check")
        for word in ("--leave-out", "left_out", "--only harness"):
            self.assertIn(word, doc)
        paragraphs = [flat(p) for p in re.split(r"\n\s*\n", doc)]
        self.assertTrue(any("--full" in p and "--only harness" in p and re.search(r"every (harness )?(test )?file", p)
                            for p in paragraphs), "no paragraph names --full and --only harness as runs of every file")

    def test_pm_scope_and_pm_merge(self):
        self.assertRegex(docstring(B + "pm-scope"), r"harness tests (left out|every file)")
        merge = docstring(B + "pm-merge")
        self.assertIn("left_out", merge)
        self.assertIn("run pm-check again", merge)

    def test_pmscope_says_what_a_source_is_and_who_decides(self):
        text = flat((BIN / "_pmscope.py").read_text())
        self.assertTrue(near(text, ("source", "run", "read")), "no sentence says what a source is")
        self.assertIn("pm's decision", text)
        self.assertTrue(near(text, ("source", "entry", "pm's decision"), 600) or
                        near(text, ("entry", "source", "pm's decision"), 600),
                        "no sentence says that taking a source away or adding an entry is the pm's decision")

    def test_the_pm_skill(self):
        text = flat((CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md").read_text())
        self.assertTrue(near(text, ("pm-check --full", "every"), 200), "pm-check --full is not named as every file")
        self.assertTrue(near(text, ("_pmscope.py", "entry"), 300) or near(text, ("entry", "_pmscope.py"), 300),
                        "_pmscope.py is not named as where a new slow test file gets its entry")
        self.assertTrue(near(text, ("source", "pm's decision"), 300), "no source taken away on the pm's decision")
        self.assertIn("left-out file", text)
        self.assertTrue(near(text, ("left-out file", "unseen"), 400) or near(text, ("unseen", "left-out file"), 400),
                        "what a left-out file leaves unseen is not said")


if __name__ == "__main__":
    unittest.main()
