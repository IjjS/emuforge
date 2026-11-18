"""Which modules a checkout's changes call for (issue 52): the rules of `_pmscope.decide` and the `pm-scope` command.

Interface used (design 2.2, 3.1): `_pmscope.decide(paths)` gives `{module: [why, ...]}` for the called-for
modules; `pm-scope <checkout> [--json]` prints the decision, and with `--json` an object with `kind`, `reason`,
`main`, `base`, `paths` and `modules` (`{module: {called, why}}`).

`Rules` calls `decide` with path lists. `Scope` runs a fixture checkout's own copy of `pm-scope` (see
`_fixture.py`) on branches made in that fixture. Every case of both classes fails on `main`, where
`_pmscope.py` and `pm-scope` do not exist.
"""
import json
import os
import re
import unittest

from _fixture import clean_env, git, make, run

try:
    import _pmscope
except ImportError as e:  # every case fails on its own when the module does not exist
    _pmscope, IMPORT_ERROR = None, e

SCRIPTS = ("pm-scope", "pm-check", "pm-merge", "pm-emulator-dir", "_pmlib.py", "_pmscope.py")
ALL = {"engine", "studio", "integration", "harness"}
PRODUCT = {"engine", "studio", "integration"}
HARNESS = {"harness"}
ISSUE = "issues/things-that-do-not-work/a.md"
RULE8 = "the harness scripts, their tests and the guides those tests read"  # requirement R2, rule 8
OTHER_MODULE = re.compile(r"\b(engine|studio|integration)\b")


def decide(paths):
    if _pmscope is None:
        raise IMPORT_ERROR
    return _pmscope.decide(list(paths))


class Rules(unittest.TestCase):
    def assertCalls(self, paths, modules):
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(set(decide([path])), modules)

    def test_rule_1_root_class(self):
        self.assertCalls(["studio/src/providers/aws/area/styles/root-class.ts"], ALL)

    def test_rule_2_studio_package_and_lock(self):
        self.assertCalls(["studio/package.json", "studio/bun.lock"], ALL)

    def test_rule_3_the_guides_and_references(self):
        """Issue 478 (part 3, the pm's answer Q1 a): the AGENTS.md guides and the modules' references call for the
        harness alone; no product step reads them."""
        self.assertCalls(["AGENTS.md", "engine/AGENTS.md", "tests/integration/AGENTS.md",
                          "engine/references/workflow.md", "tests/integration/references/a.md",
                          "studio/references/critique.md", "studio/references/console/s3/a.yaml"], HARNESS)

    def test_rule_3_studio_agents_is_read_by_studio_unit_tests(self):
        """Two Studio unit tests read studio/AGENTS.md (request-module.test.ts, brand-files.test.ts), so a change of it
        calls for the Studio steps as well as the harness."""
        self.assertCalls(["studio/AGENTS.md"], {"studio", "harness"})

    def test_rule_3_is_the_guides_only(self):
        self.assertCalls(["studio/references/shot.png", "engine/references/a.rs", "studio/PRODUCT.md",
                          "tests/integration/README.md", "studio/src/AGENTS.md"], PRODUCT)

    def test_rule_4_places_that_start_an_emulator(self):
        self.assertCalls(["tests/integration/run", "tests/integration/engine/support/emulator.rs",
                          "tests/integration/studio/support/emulator.ts"], ALL)

    def test_rule_5_infra_and_compose_files(self):
        self.assertCalls(["infra/aws-emulator/Dockerfile", "docker-compose.yml", "studio/dev.compose.yaml",
                          "tests/integration/a/docker-compose.yml"], ALL)

    def test_rule_5_leaves_pm_bin_out(self):
        self.assertCalls([".pm/bin/tests/fixtures/a/docker-compose.yml"], HARNESS)

    def test_rule_6_product_paths(self):
        self.assertCalls(["engine/crates/a/src/lib.rs", "engine/README.md", "studio/src/a.tsx", "studio/DESIGN.md",
                          "studio/public/logo.png", "tests/integration/manifest.jsonl", "README.md"], PRODUCT)

    def test_rule_7_images_anywhere_else_any_case(self):
        self.assertCalls([".pm/bin/tests/fixtures/a.png", ".agents/skills/a/b.JPG", "c.jpeg", "a/b.gif"], ALL)

    def test_rule_8_harness_paths(self):
        self.assertCalls([".pm/bin/pm-check", ".pm/bin/tests/test_a.py", ".agents/skills/pm/SKILL.md"], HARNESS)

    def test_rule_9_issue_files_call_for_nothing(self):
        self.assertCalls(["issues/things-that-do-not-work/a.md", "issues/things-that-now-work/a.md"], set())

    def test_github_folder_calls_for_the_harness_by_its_own_rule(self):
        """Issue 53 (requirement section 7): the workflow, the not-run list and the runner helper are read by the
        harness tests (test_ci.py), so a path under .github/ calls for them by a rule that names the folder."""
        for path in [".github/workflows/main.yml", ".github/not-run.json", ".github/ci"]:
            with self.subTest(path=path):
                answer = decide([path])
                self.assertIn("harness", answer)
                rules = [re.sub(r" \(\d+ paths?, e\.g\. .*\)$", "", why) for why in answer["harness"]]
                self.assertFalse(any(r.startswith("the rules do not know") for r in rules), rules)
                self.assertTrue(any(".github/" in r for r in rules), rules)

    def test_unknown_path_calls_for_every_module_and_is_named(self):
        for path in ["CONTRIBUTING.md", "LICENSE", ".gitignore", ".githubx/a.yml", "issues/README.md",
                     "issues/things-that-do-not-work/a.txt", "studio", "enginex/a.rs", ".pm/binx/a"]:
            with self.subTest(path=path):
                answer = decide([path])
                self.assertEqual(set(answer), ALL)
                for module in ALL:
                    self.assertTrue(any(path in why for why in answer[module]), (module, answer[module]))

    def test_no_path_calls_for_nothing(self):
        self.assertEqual(set(decide([])), set())

    def test_issue_file_and_harness_path(self):
        self.assertEqual(set(decide([ISSUE, ".pm/bin/a"])), HARNESS)

    def test_studio_and_harness_paths(self):
        self.assertEqual(set(decide(["studio/src/a.tsx", ".pm/bin/a"])), ALL)

    def test_one_unknown_path_is_enough(self):
        self.assertEqual(set(decide([ISSUE, ".pm/bin/a", "LICENSE"])), ALL)

    def test_one_reason_per_rule_with_count_and_example(self):
        paths = [".pm/bin/a", ".pm/bin/b", ".agents/c"]
        answer = decide(paths)
        self.assertEqual(set(answer), HARNESS)
        self.assertEqual(len(answer["harness"]), 1, answer)
        why = answer["harness"][0]
        self.assertIn(RULE8, why)
        self.assertIn("3 paths", why)
        self.assertTrue(any(p in why for p in paths), why)

    def test_order_does_not_change_the_answer(self):
        paths = ["studio/src/a.tsx", ".pm/bin/b", ISSUE, "LICENSE", ".pm/bin/a", "studio/references/a.md"]
        self.assertEqual(decide(paths), decide(list(reversed(paths))))


def write(co, rel, text="x\n"):
    p = co / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def commit(co, paths, message="change"):
    for rel in paths:
        write(co, rel, f"{rel}\n")
    git(co, "add", "-A")
    git(co, "commit", "-q", "-m", message)


def branch(co, paths, name="feat/x"):
    """A branch made from the current head of `co` with one commit that creates `paths`."""
    git(co, "checkout", "-q", "-b", name)
    commit(co, paths, name)


def scope(co, target=None, env=None):
    """`pm-scope <target> --json`: the process and the parsed object."""
    p = run(co, "pm-scope", target or co, "--json", env=env)
    return p, (json.loads(p.stdout) if p.returncode == 0 else None)


def called(answer):
    return {m for m, v in answer["modules"].items() if v["called"]}


class Scope(unittest.TestCase):
    def fixture(self, case, files=None):
        return make("scope", case, SCRIPTS, files)

    def assertAnswer(self, co, modules, target=None, env=None):
        p, answer = scope(co, target, env)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(called(answer), modules, answer)
        return answer

    # Given F on a branch with paths .pm/bin/a (R1, R6)

    def test_text_names_the_harness_and_the_path_only(self):
        co = self.fixture("text")
        branch(co, [".pm/bin/a"])
        p = run(co, "pm-scope", co)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        lines = p.stdout.splitlines()
        self.assertTrue(lines[0].startswith("scope: diff"), p.stdout)
        self.assertTrue(lines[0].endswith("harness"), p.stdout)
        self.assertEqual(len(lines), 2, p.stdout)
        self.assertIn("harness", lines[1])
        self.assertIn(".pm/bin/a", lines[1])
        for line in lines:
            self.assertIsNone(OTHER_MODULE.search(line), line)

    def test_json_object(self):
        co = self.fixture("json")
        main = git(co, "rev-parse", "main")
        branch(co, [".pm/bin/a"])
        answer = self.assertAnswer(co, HARNESS)
        self.assertEqual(answer["kind"], "diff")
        self.assertEqual(answer["paths"], 1)
        self.assertEqual((answer["main"], answer["base"]), (main, main))

    def test_twice_is_the_same_and_writes_nothing(self):
        co = self.fixture("twice")
        branch(co, [".pm/bin/a"])
        first, second = run(co, "pm-scope", co), run(co, "pm-scope", co)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual(git(co, "status", "--porcelain"), "")
        self.assertFalse((co / "output").exists())

    # Given F on a branch, what counts as changed (R4)

    def test_untracked_file_counts(self):
        co = self.fixture("untracked")
        branch(co, [ISSUE])
        write(co, "studio/src/new.ts")
        self.assertAnswer(co, PRODUCT)

    def test_uncommitted_change_counts(self):
        co = self.fixture("uncommitted", {".pm/bin/note.txt": "x\n"})
        branch(co, [ISSUE])
        write(co, ".pm/bin/note.txt", "changed\n")
        self.assertAnswer(co, HARNESS)

    def test_rename_counts_under_both_names(self):
        co = self.fixture("rename", {"studio/src/a.txt": "same\n"})
        git(co, "checkout", "-q", "-b", "feat/x")
        git(co, "mv", "studio/src/a.txt", ".pm/bin/a.txt")
        git(co, "commit", "-q", "-m", "move")
        self.assertAnswer(co, ALL)

    def test_deleted_file_counts(self):
        co = self.fixture("delete", {"studio/src/a.txt": "x\n"})
        git(co, "checkout", "-q", "-b", "feat/x")
        git(co, "rm", "-q", "studio/src/a.txt")
        git(co, "commit", "-q", "-m", "delete")
        self.assertAnswer(co, PRODUCT)

    def test_issue_file_only_calls_for_nothing(self):
        co = self.fixture("issue-only")
        branch(co, [ISSUE])
        self.assertAnswer(co, set())
        p = run(co, "pm-scope", co)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertTrue(p.stdout.splitlines()[0].endswith("nothing"), p.stdout)

    def test_what_main_gained_is_not_the_branchs(self):
        co = self.fixture("main-moved")
        left = git(co, "rev-parse", "main")
        branch(co, [".pm/bin/a"])
        git(co, "checkout", "-q", "main")
        commit(co, ["studio/src/b.txt"])
        git(co, "checkout", "-q", "feat/x")
        answer = self.assertAnswer(co, HARNESS)
        self.assertEqual(answer["base"], left)
        self.assertNotEqual(answer["base"], git(co, "rev-parse", "main"))

    def test_stacked_branch_until_its_base_is_merged(self):
        co = self.fixture("stacked")
        branch(co, ["studio/src/a.tsx"], "feat/a")
        branch(co, [".pm/bin/a"], "feat/b")
        self.assertAnswer(co, ALL)
        git(co, "checkout", "-q", "main")
        git(co, "merge", "-q", "--no-ff", "-m", "merge feat/a", "feat/a")
        git(co, "checkout", "-q", "feat/b")
        self.assertAnswer(co, HARNESS)

    def test_newline_in_a_name_is_one_path(self):
        co = self.fixture("newline")
        branch(co, [".pm/bin/odd\nstudio/src/a.ts"])
        self.assertAnswer(co, HARNESS)

    def test_foreign_git_dir_is_not_followed(self):
        other = make("scope", "git-dir-other", ())
        branch(other, ["studio/src/a.tsx"])
        co = self.fixture("git-dir")
        branch(co, [".pm/bin/a"])
        env = {**clean_env(), "GIT_DIR": str(other / ".git"), "GIT_WORK_TREE": str(other)}
        self.assertAnswer(co, HARNESS, env=env)

    def test_unknown_path_is_a_diff_of_every_module(self):
        co = self.fixture("unknown")
        branch(co, ["LICENSE"])
        p, answer = scope(co)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(answer["kind"], "diff")
        self.assertEqual(called(answer), ALL)
        self.assertIn("LICENSE", p.stdout)

    # Given a checkout with no commit of its own (R3 c)

    def assertMain(self, co):
        answer = self.assertAnswer(co, PRODUCT)
        self.assertEqual(answer["kind"], "main")
        self.assertTrue(answer["reason"])

    def test_on_main(self):
        self.assertMain(self.fixture("on-main"))

    def test_new_branch_without_a_commit(self):
        co = self.fixture("new-branch")
        git(co, "checkout", "-q", "-b", "feat/x")
        self.assertMain(co)

    def test_new_branch_behind_main(self):
        co = self.fixture("new-branch-behind")
        git(co, "checkout", "-q", "-b", "feat/x")
        git(co, "checkout", "-q", "main")
        commit(co, [".pm/bin/b"])
        git(co, "checkout", "-q", "feat/x")
        self.assertMain(co)

    # Given changes that cannot be read (R3 b)

    def test_changes_that_cannot_be_read_call_for_every_module(self):
        sub = self.fixture("unreadable-subfolder")
        trunk = self.fixture("unreadable-trunk")
        git(trunk, "branch", "-m", "main", "trunk")
        orphan = self.fixture("unreadable-orphan")
        git(orphan, "checkout", "-q", "--orphan", "other")
        commit(orphan, [".pm/bin/a"])
        no_git = self.fixture("unreadable-git")
        stub = no_git / "home" / "bin"
        write(no_git, "home/bin/git", "#!/bin/sh\nexit 1\n")
        (stub / "git").chmod(0o755)
        stub_env = {**clean_env(), "PATH": f"{stub}{os.pathsep}{os.environ.get('PATH', '')}"}
        for name, co, target, env in [("not the top of a work tree", sub, sub / ".pm" / "bin", None),
                                      ("only branch trunk", trunk, None, None),
                                      ("no commit shared with main", orphan, None, None),
                                      ("git exits 1", no_git, None, stub_env)]:
            with self.subTest(name):
                p, answer = scope(co, target, env)
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertEqual(answer["kind"], "full")
                self.assertEqual(called(answer), ALL)
                self.assertTrue(answer["reason"].startswith("cannot read the changes"), answer["reason"])

    # Given a command line that is wrong

    def test_wrong_command_line_exits_2(self):
        co = self.fixture("usage")
        for name, args in [("no argument", ()), ("unknown option", (co, "--no-such-option")),
                           ("a file", (co / ".gitignore",)), ("a missing path", (co / "no-such-dir",))]:
            with self.subTest(name):
                p = run(co, "pm-scope", *args)
                self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
                self.assertTrue(p.stderr.strip())
                self.assertEqual(p.stdout, "")


if __name__ == "__main__":
    unittest.main()
