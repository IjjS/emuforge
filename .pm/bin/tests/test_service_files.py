"""A service's folder of checks and its manifest in the scripts: the selection's new folder, the manifest of R3.2 in
every reader, `run`'s refusals of rows and imports, and the comments that say so (issue 402, requirement R2 to R4
and R6.1; test criteria `test_service_files`).

Check id `harness.service-files`. One class per heading of the test criteria.

`T` is `tests/integration/studio/`, `S` is `studio/src/providers/aws/area/services/`. `F` is the fixture tree of
the test criteria (`f_files()`): the main manifest holds `engine.plain-a` and `studio.plain-b` (no `service`),
`T/services/alpha/manifest.jsonl` holds `studio.alpha-one` and `studio.alpha-two` (labelled `on-request`) of
`alpha`, `T/services/beta/manifest.jsonl` holds `studio.beta-one` of `beta`; the support files and check files
import as its table says. The folder `T/services/beta/` is made before `T/services/alpha/`. "The manifest of `F`"
is `F_IDS`, in that order. `F0` (`f_files(f0=True)`) is `F` without `T/services/`, its three service rows in the
main manifest.

- `Select` calls `_pmscope.select(paths, head, base)` with the text of the manifest of `F` (main, then alpha's,
  then beta's) unless the case names others.
- `Manifest` calls `_pmscope.manifest_of`, `manifest_paths`, `manifest_at` and `service_of_manifest` on a git
  repository whose `main` holds `F` (made with `_fixture.make` under <checkout>/output/tests/service-files/).
- `Scope` runs the fixture's own `pm-scope` on such a repository; a branch is a branch from `main` with one commit.
- `Check` is `CheckCase` of `test_check_issue.py` with the integration stand-in of `test_services_scope.py`, its
  `main` holding `F` (or `F0`).
- `Merge` is the unit of `test_merge_scope.py` with the record of `test_services_scope.py`, its `main` holding `F`.
- `Ci` is `Case` of `test_ci.py` with `.github/ci`, `pm-scope` and `pm-check` committed on `main` with `F`.
- `Run`, `Rows` and `Imports` start `tests/integration/run` in a fixture checkout of `F` with the stand-ins of
  `test_integration_not_run.py`, which write `passed` for every id of the manifest of the fixture.
- `Docs` reads this checkout's files.

On a checkout without the change every case fails on its own, not at import: line 1 of the selection does not know
`T/services/`, every reader reads the main manifest alone, `run` refuses no row and reads no import, and the texts
do not name the folder. The cases whose name says `guard` hold a behavior of today and pass there already.
"""
import ast
import itertools
import json
import os
import pathlib
import re
import shutil
import stat
import unittest

import test_ci
from _fixture import CHECKOUT, git, make, run
from test_check_issue import CheckCase
from test_integration_not_run import RUN, STANDIN as RUN_STANDIN, TOOLS, Fixture, grep_invert, list_text, out
from test_merge_scope import merge as merge_in, unit as merge_unit
from test_services_scope import STANDIN as CHECK_STANDIN, BUN, merge_record, refusal

try:
    import _pmscope
except ImportError as e:  # every case fails on its own when the module does not exist
    _pmscope, IMPORT_ERROR = None, e

GROUP = "service-files"
T = "tests/integration/studio/"
S = "studio/src/providers/aws/area/services/"
MAIN = "tests/integration/manifest.jsonl"
SVC = T + "services/"
ALPHA_M = SVC + "alpha/manifest.jsonl"
BETA_M = SVC + "beta/manifest.jsonl"
LINE = "  services     "
SCRIPTS = ("pm-scope", "pm-check", "pm-merge", "pm-emulator-dir", "_pmlib.py", "_pmscope.py")
NONE = object()  # a row without the key `service`
ON_REQUEST = "on request: not part of a default run; run it with --on-request"


def row(cid, path, service=NONE, labels=(), module=None):
    r = dict(check_id=cid, path=path, module=module or cid.split(".")[0], operations=[], issue=402,
             labels=list(labels))
    if service is not NONE:
        r["service"] = service
    return r


def rows_text(rows):
    return "".join(json.dumps(r) + "\n" for r in rows)


MAIN_ROWS = [row("engine.plain-a", "tests/integration/engine/tests/a.rs"), row("studio.plain-b", T + "b.spec.ts")]
ALPHA_ROWS = [row("studio.alpha-one", T + "alpha-one.spec.ts", "alpha"),
              row("studio.alpha-two", T + "alpha-two.spec.ts", "alpha", ["on-request"])]
BETA_ROWS = [row("studio.beta-one", T + "beta.spec.ts", "beta")]
F_IDS = ["engine.plain-a", "studio.plain-b", "studio.alpha-one", "studio.alpha-two", "studio.beta-one"]
F_TEXT = rows_text(MAIN_ROWS + ALPHA_ROWS + BETA_ROWS)
F0_TEXT = F_TEXT  # F0's main manifest: the same rows in the same order, in one file
NEW_ALPHA = row("studio.alpha-three", T + "alpha-three.spec.ts", "alpha")

IMPORT_ALPHA = "import { a } from './services/alpha/alpha';\n"
TS = {
    T + "services/alpha/alpha.ts": "export const a = 1;\n",
    T + "services/alpha/more.ts": "import { a } from './alpha';\nimport { s } from '../../support/shared';\n"
                                  "export const more = a + s;\n",
    T + "support/shared.ts": "export const s = 1;\n",
    T + "support/index.ts": "export { s } from './shared';\n",
    T + "alpha-one.spec.ts": "import { s } from './support';\n" + IMPORT_ALPHA,
    T + "alpha-two.spec.ts": "import { s } from './support';\n" + IMPORT_ALPHA,
    T + "b.spec.ts": "import { s } from './support';\n",
}
BETA_TS = {T + "services/beta/beta.ts": "import { s } from '../../support/shared';\nexport const b = s;\n",
           T + "beta.spec.ts": "import { b } from './services/beta/beta';\n"}


def f_files(f0=False):
    """The files of F ({path: text}), or of F0. The folder of beta comes first, so it is made first."""
    if f0:
        files = {MAIN: F0_TEXT}
    else:
        files = {MAIN: rows_text(MAIN_ROWS), BETA_M: rows_text(BETA_ROWS), **BETA_TS, ALPHA_M: rows_text(ALPHA_ROWS)}
    for path, text in {**BETA_TS, **TS}.items():
        if not (f0 and path.startswith(SVC)):
            files.setdefault(path, text)
    files["tests/integration/engine/tests/a.rs"] = "// a\n"
    return files


def ids_of(text):
    return [json.loads(ln)["check_id"] for ln in text.splitlines() if ln.strip()]


def manifest_ids(files):
    """The ids of the manifest of R3.2 over a fixture's files: the main manifest's, then each service folder's of
    the form, in name order."""
    ids = ids_of(files.get(MAIN, ""))
    folders = sorted({p[len(SVC):].split("/", 1)[0] for p in files if p.startswith(SVC) and p.endswith(
        "/manifest.jsonl") and p.count("/") == SVC.count("/") + 1})
    for s in folders:
        if re.fullmatch(r"[a-z][a-z0-9]*(-[a-z0-9]+)*", s):
            ids += ids_of(files[f"{SVC}{s}/manifest.jsonl"])
    return ids


def need_pmscope(case, name):
    if _pmscope is None:
        raise IMPORT_ERROR
    fn = getattr(_pmscope, name, None)
    if fn is None:
        case.fail(f"_pmscope has no {name}")
    return fn


def link_folder(co, rel, away):
    """Move the folder `rel` of `co` to `away` and leave a symbolic link to it at `rel`."""
    src, dst = co / rel, co / away
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))
    os.symlink(os.path.relpath(dst, src.parent), src)


def link_file(co, rel, away):
    """Move the file `rel` of `co` to `away` and leave a symbolic link to it at `rel`."""
    link_folder(co, rel, away)


# ---------------------------------------------------------------------------------------------------- R2

class Select(unittest.TestCase):
    def select(self, paths, head=F_TEXT, base=F_TEXT):
        return need_pmscope(self, "select")(list(paths), head, base)

    def assertNames(self, paths, names, why=None, **kw):
        r = self.select(paths, **kw)
        self.assertIs(r["all"], False, r)
        self.assertEqual(r["names"], names, r)
        if why is not None:
            self.assertEqual(r["why"], why, r)
        return r

    def assertAll(self, paths, why=None, named=(), **kw):
        r = self.select(paths, **kw)
        self.assertIs(r["all"], True, r)
        if why is not None:
            self.assertEqual(r["why"], why, r)
        for word in named:
            self.assertIn(word, r["why"], r)
        return r

    def test_a_path_under_a_service_folder_of_checks_gives_the_service(self):
        self.assertNames([SVC + "alpha/alpha.ts"], ["alpha"])

    def test_its_screens_its_check_file_and_its_folder_of_checks(self):
        self.assertNames([S + "alpha/x.tsx", T + "alpha-one.spec.ts", SVC + "alpha/more.ts"], ["alpha"],
                         why="3 paths touch a service")

    def test_two_folders_of_checks_give_two_services(self):
        self.assertNames([SVC + "alpha/more.ts", SVC + "beta/beta.ts"], ["alpha", "beta"])

    def test_a_folder_not_of_the_form_gives_every_service(self):
        for path in (SVC + "Alpha/a.ts", SVC + "a_b/a.ts"):
            with self.subTest(path):
                self.assertAll([path], named=(path, "is under a folder that is not a service name"))

    def test_guard_a_file_directly_under_the_folder_gives_every_service(self):
        self.assertAll([SVC + "notes.md"], named=(SVC + "notes.md",))

    def test_a_service_manifest_unchanged_in_its_rows_gives_its_service(self):
        self.assertNames([ALPHA_M], ["alpha"])

    def test_a_new_id_whose_file_changed_gives_its_service(self):
        head = rows_text(MAIN_ROWS + ALPHA_ROWS + [NEW_ALPHA] + BETA_ROWS)
        self.assertNames([ALPHA_M, NEW_ALPHA["path"]], ["alpha"], head=head)

    def test_a_new_id_whose_file_did_not_change_gives_every_service(self):
        head = rows_text(MAIN_ROWS + ALPHA_ROWS + [NEW_ALPHA] + BETA_ROWS)
        self.assertAll([ALPHA_M], why="studio.alpha-three is new and its file did not change", head=head)

    def test_a_service_changed_in_a_service_manifest_gives_every_service(self):
        moved = [row("studio.alpha-one", T + "alpha-one.spec.ts", "beta"), ALPHA_ROWS[1]]
        head = rows_text(MAIN_ROWS + moved + BETA_ROWS)
        self.assertAll([ALPHA_M], why="the manifest's service of studio.alpha-one changed", head=head)

    def test_rows_moved_from_the_main_manifest_with_their_service_give_the_service(self):
        self.assertNames([MAIN, ALPHA_M], ["alpha"], head=F_TEXT, base=F0_TEXT)

    def test_a_service_given_while_both_manifests_changed_gives_every_service(self):
        base = rows_text(MAIN_ROWS + [row("studio.alpha-one", T + "alpha-one.spec.ts"), ALPHA_ROWS[1]] + BETA_ROWS)
        self.assertAll([MAIN, ALPHA_M], why="the manifest's service of studio.alpha-one changed", base=base)

    def test_a_base_that_cannot_be_read_gives_every_service(self):
        self.assertAll([ALPHA_M], why="the base's manifest cannot be read", base=None)

    def test_guard_a_head_that_cannot_be_read_gives_every_service(self):
        self.assertAll([SVC + "alpha/alpha.ts"], why="the manifest cannot be read", head=None)

    def test_guard_shared_support_gives_every_service(self):
        for path in (T + "support/alpha.ts", T + "support/index.ts", T + "support/services/alpha/a.ts"):
            with self.subTest(path):
                self.assertAll([path], named=(path,))


# ---------------------------------------------------------------------------------------------------- R3.1 to R3.4

class Manifest(unittest.TestCase):
    def fixture(self, files=None):
        case = self._testMethodName[5:].replace("_", "-")
        return make(GROUP, f"manifest-{case}", (), files or f_files())

    def of(self, co):
        return need_pmscope(self, "manifest_of")(co)

    def at(self, co, commit):
        return need_pmscope(self, "manifest_at")(str(co), commit)

    def test_the_work_tree_s_manifest_is_the_main_one_then_each_service_s(self):
        co = self.fixture()
        text = self.of(co)
        self.assertIsNotNone(text)
        self.assertEqual(ids_of(text), F_IDS)

    def test_an_uncommitted_row_of_a_service_is_read(self):
        co = self.fixture()
        with open(co / BETA_M, "a") as f:
            f.write(json.dumps(row("studio.beta-two", T + "beta.spec.ts", "beta")) + "\n")
        text = self.of(co)
        self.assertIsNotNone(text)
        self.assertEqual(ids_of(text), F_IDS + ["studio.beta-two"])

    def test_a_part_without_a_newline_at_its_end(self):
        co = self.fixture()
        (co / ALPHA_M).write_text(rows_text(ALPHA_ROWS).rstrip("\n"))
        text = self.of(co)
        self.assertIsNotNone(text)
        self.assertEqual(ids_of(text), F_IDS)

    def test_a_folder_not_of_the_form_or_without_a_manifest_adds_nothing(self):
        co = self.fixture()
        before = self.of(co)
        (co / SVC / "Gamma_1").mkdir()
        (co / SVC / "Gamma_1" / "manifest.jsonl").write_text(rows_text([row("studio.gamma", T + "g.spec.ts", "gamma")]))
        (co / SVC / "delta").mkdir()
        (co / SVC / "delta" / "d.ts").write_text("export const d = 1;\n")
        text = self.of(co)
        self.assertEqual(text, before)
        self.assertIsNotNone(text)
        self.assertEqual(ids_of(text), F_IDS)

    def test_a_manifest_that_is_a_folder_or_a_link_cannot_be_read(self):
        with self.subTest("a folder"):
            co = self.fixture()
            (co / ALPHA_M).unlink()
            (co / ALPHA_M).mkdir()
            self.assertIsNone(self.of(co))
        with self.subTest("a link to a file of rows"):
            co = self.fixture()
            link_file(co, ALPHA_M, "elsewhere/alpha.jsonl")
            self.assertIsNone(self.of(co))

    def test_a_service_folder_or_the_folder_that_is_a_link_cannot_be_read(self):
        for rel in (SVC + "alpha", SVC.rstrip("/")):
            with self.subTest(rel):
                co = self.fixture()
                link_folder(co, rel, "elsewhere/" + rel.rsplit("/", 1)[1])
                self.assertIsNone(self.of(co))

    def test_guard_f0_is_its_main_manifest(self):
        co = self.fixture(f_files(f0=True))
        self.assertEqual(self.of(co), F0_TEXT)

    def test_guard_no_main_manifest(self):
        co = self.fixture()
        (co / MAIN).unlink()
        self.assertIsNone(self.of(co))

    def test_the_paths_read(self):
        co = self.fixture()
        paths = need_pmscope(self, "manifest_paths")(co)
        rel = [os.path.relpath(str(p), str(co)) if os.path.isabs(str(p)) else str(p) for p in paths]
        self.assertEqual(rel, [MAIN, ALPHA_M, BETA_M])

    def test_at_a_commit(self):
        co = self.fixture()
        text = self.at(co, "main")
        self.assertEqual(ids_of(text), F_IDS)

    def test_at_a_commit_without_a_main_manifest(self):
        co = self.fixture()
        git(co, "rm", "-q", MAIN)
        git(co, "commit", "-q", "-m", "no main manifest")
        self.assertEqual(ids_of(self.at(co, "HEAD")), F_IDS[2:])

    def test_guard_at_a_commit_without_either(self):
        co = self.fixture()
        git(co, "rm", "-q", "-r", MAIN, SVC.rstrip("/"))
        git(co, "commit", "-q", "-m", "no manifest")
        self.assertEqual(self.at(co, "HEAD"), "")

    def test_at_a_commit_a_link_cannot_be_read(self):
        for name, rel in (("manifest", ALPHA_M), ("alpha", SVC + "alpha"), ("services", SVC.rstrip("/"))):
            with self.subTest(name):
                co = self.fixture()
                link_folder(co, rel, "elsewhere/" + name)
                git(co, "add", "-A")
                git(co, "commit", "-q", "-m", "a link")
                need_pmscope(self, "manifest_at")
                with self.assertRaises(_pmscope.Unreadable):
                    self.at(co, "HEAD")

    def test_the_service_of_a_manifest_path(self):
        fn = need_pmscope(self, "service_of_manifest")
        self.assertEqual(fn(ALPHA_M), "alpha")
        for path in (SVC + "Alpha/manifest.jsonl", SVC + "alpha/x/manifest.jsonl", SVC + "manifest.jsonl",
                     SVC + "alpha/manifest.json", MAIN):
            with self.subTest(path):
                self.assertIsNone(fn(path))


# ---------------------------------------------------------------------------------------------------- R2 (pm-scope)

class Scope(unittest.TestCase):
    def fixture(self):
        case = self._testMethodName[5:].replace("_", "-")
        return make(GROUP, f"scope-{case}", SCRIPTS, f_files())

    def branch(self, co, files):
        """A branch feat/x from main with one commit of `files` ({path: text})."""
        git(co, "checkout", "-q", "-b", "feat/x")
        self.commit(co, files)

    def commit(self, co, files):
        for rel, text in files.items():
            p = co / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        git(co, "add", "-A")
        git(co, "commit", "-q", "-m", "change")

    def line(self, co, *args):
        p = run(co, "pm-scope", co, *args)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        found = [ln for ln in p.stdout.splitlines() if ln.startswith(LINE)]
        self.assertEqual(len(found), 1, p.stdout)
        return found[0]

    def changed(self, *paths):
        return {p: f"{p} changed\n" for p in paths}

    def test_a_service_s_screens_check_file_and_folder_of_checks(self):
        co = self.fixture()
        self.branch(co, self.changed(S + "alpha/x.tsx", T + "alpha-one.spec.ts", SVC + "alpha/alpha.ts"))
        self.assertEqual(self.line(co), LINE + "alpha (3 paths touch a service)")

    def test_a_new_check_file_and_its_row(self):
        co = self.fixture()
        self.branch(co, {T + "alpha-three.spec.ts": IMPORT_ALPHA,
                         ALPHA_M: rows_text(ALPHA_ROWS + [NEW_ALPHA])})
        self.assertEqual(self.line(co), LINE + "alpha (2 paths touch a service)")

    def test_with_shared_support_every_service(self):
        co = self.fixture()
        self.branch(co, {T + "alpha-three.spec.ts": IMPORT_ALPHA, ALPHA_M: rows_text(ALPHA_ROWS + [NEW_ALPHA]),
                         T + "support/shared.ts": "export const s = 2;\n"})
        self.assertEqual(self.line(co), LINE + "every service: tests/integration/studio/support/shared.ts is shared "
                                               "by the services (1 path)")

    def test_a_new_row_whose_file_did_not_change(self):
        co = self.fixture()
        new = row("studio.alpha-three", T + "alpha-one.spec.ts", "alpha")
        self.branch(co, {ALPHA_M: rows_text(ALPHA_ROWS + [new])})
        self.assertEqual(self.line(co), LINE + "every service: studio.alpha-three is new and its file did not change")

    def test_a_work_tree_manifest_that_is_not_json(self):
        co = self.fixture()
        self.branch(co, self.changed(SVC + "alpha/alpha.ts"))
        with open(co / ALPHA_M, "a") as f:
            f.write("this is not JSON\n")
        self.assertEqual(self.line(co), LINE + "every service: the manifest cannot be read")

    def test_json(self):
        co = self.fixture()
        self.branch(co, self.changed(SVC + "beta/beta.ts"))
        p = run(co, "pm-scope", co, "--json")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        sv = json.loads(p.stdout)["services"]
        self.assertEqual((sv["all"], sv["names"]), (False, ["beta"]), sv)

    def test_push(self):
        co = self.fixture()
        before = git(co, "rev-parse", "main")
        self.commit(co, self.changed(SVC + "alpha/more.ts"))
        self.commit(co, self.changed(T + "alpha-one.spec.ts"))
        self.assertEqual(self.line(co, "--push", before, git(co, "rev-parse", "main")),
                         LINE + "alpha (2 paths touch a service)")

    def test_push_with_a_manifest_that_is_a_link(self):
        co = self.fixture()
        link_file(co, ALPHA_M, "elsewhere/alpha.jsonl")
        git(co, "add", "-A")
        git(co, "commit", "-q", "-m", "a link")
        before = git(co, "rev-parse", "main")
        self.commit(co, self.changed(S + "alpha/x.tsx"))
        line = self.line(co, "--push", before, git(co, "rev-parse", "main"))
        self.assertTrue(line.startswith(LINE + "every service: "), line)
        self.assertGreater(len(line), len(LINE + "every service: "), line)
        self.assertNotIn("is shared by the services", line)


# ---------------------------------------------------------------------------------------------------- R2, R3.2 (pm-check)

class Check(CheckCase):
    group = "service-files-check"

    def fixture(self, row=None, extra=None, f0=False, **kw):
        co = super().fixture(row, {**f_files(f0), "tests/integration/run": CHECK_STANDIN, **(extra or {})}, **kw)
        (self.stub / "bun").write_text(BUN)
        (self.stub / "bun").chmod(0o755)
        return co

    def given(self, paths, row=None, f0=False):
        """Issue 9's branch and worktree with one commit of `paths` (kind diff), and a stand-in that passes."""
        self.fixture(row, f0=f0)
        w = self.issue_branch()
        self.commit(w, list(paths), "a change")
        self.standin(w, {})
        return w

    def starts(self, w):
        return [ln.split()[1:] for ln in self.ran(w) or [] if ln.split()[0] == "integration"]

    def one_start(self, w, p):
        starts = self.starts(w)
        self.assertEqual(len(starts), 1, self.out(p))
        return starts[0]

    def not_run(self, w, args):
        self.assertIn("--not-run", args)
        listed = json.loads(pathlib.Path(args[args.index("--not-run") + 1]).read_text())
        return sorted(c["id"] for c in listed["checks"])

    def test_a_service_s_folder_of_checks_runs_its_service(self):
        paths = (SVC + "alpha/alpha.ts", T + "alpha-one.spec.ts")
        w = self.given(paths)
        p = self.check(w)
        args = self.one_start(w, p)
        self.assertEqual(args.count("--services"), 1, args)
        f = pathlib.Path(args[args.index("--services") + 1])
        self.assertEqual(json.loads(f.read_text())["services"], ["alpha"])
        rec = self.last(w)
        self.assertEqual(rec["scope"]["services"]["names"], ["alpha"], rec["scope"])
        w0 = self.given(paths, row="f0", f0=True)
        self.check(w0)
        rec0 = self.last(w0)
        self.assertEqual(sorted(rec), sorted(rec0))
        self.assertEqual(sorted(rec["scope"]), sorted(rec0["scope"]))

    def test_guard_with_shared_support_no_services(self):
        w = self.given((SVC + "alpha/alpha.ts", T + "alpha-one.spec.ts", T + "support/shared.ts"))
        p = self.check(w)
        self.assertNotIn("--services", self.one_start(w, p))

    def test_checks_with_an_id_of_a_service_s_manifest(self):
        w = self.given((T + "b.spec.ts",))
        p = self.check(w, "--checks", "studio.alpha-one")
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(self.not_run(w, self.one_start(w, p)),
                         sorted(["engine.plain-a", "studio.plain-b", "studio.alpha-two", "studio.beta-one"]))

    def test_checks_with_an_id_of_the_main_manifest(self):
        w = self.given((T + "b.spec.ts",))
        p = self.check(w, "--checks", "studio.plain-b")
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(self.not_run(w, self.one_start(w, p)),
                         sorted(["engine.plain-a", "studio.alpha-one", "studio.alpha-two", "studio.beta-one"]))

    def test_guard_checks_with_an_unknown_id(self):
        w = self.given((T + "b.spec.ts",))
        p = self.check(w, "--checks", "studio.nope")
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertIn("is not a check of", p.stderr)
        self.assertEqual(self.starts(w), [])

    def test_checks_with_a_service_s_manifest_that_is_not_json(self):
        w = self.given((T + "b.spec.ts",))
        with open(w / BETA_M, "a") as f:
            f.write("this is not JSON\n")
        p = self.check(w, "--checks", "studio.alpha-one")
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertIn(BETA_M, p.stderr)
        self.assertIn("cannot be read", p.stderr)
        self.assertEqual(self.starts(w), [])


# ---------------------------------------------------------------------------------------------------- R2 (pm-merge)

class Merge(unittest.TestCase):
    PATHS = {SVC + "alpha/alpha.ts": "export const a = 2;\n", T + "alpha-one.spec.ts": IMPORT_ALPHA + "// 2\n"}

    def given(self, files, services):
        case = self._testMethodName[5:].replace("_", "-")
        co = make(GROUP, f"merge-{case}", SCRIPTS, f_files())
        wt = co.parent / f"{co.name}-7-h1"
        if wt.exists():  # the worktree of an earlier run of this case
            shutil.rmtree(wt)
        (co / "home").mkdir()
        merge_record(merge_unit(co, files), services=services)
        return co

    def refused(self, co, *words):
        before = git(co, "rev-parse", "main")
        p = merge_in(co, 7, "h1")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertEqual(git(co, "rev-parse", "main"), before)
        found = [ln for ln in refusal(p.stderr) if all(w in ln for w in words)]
        self.assertTrue(found, f"no line ending 'run pm-check again' holds {words!r} in:\n{p.stderr}")

    def test_a_record_that_ran_alpha_merges(self):
        co = self.given(self.PATHS, ["alpha"])
        p = merge_in(co, 7, "h1")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(git(co, "log", "-1", "--format=%s", "main"), "merge: #7 h1 (feat/7-h1)")

    def test_a_record_that_ran_beta_is_refused(self):
        co = self.given(self.PATHS, ["beta"])
        self.refused(co, "ran the checks of beta, and this branch's changes touch alpha")

    def test_a_service_moved_between_service_manifests_needs_every_service(self):
        moved = {ALPHA_M: rows_text(ALPHA_ROWS[1:]),
                 BETA_M: rows_text(BETA_ROWS + [row("studio.alpha-one", T + "alpha-one.spec.ts", "beta")])}
        co = self.given({**self.PATHS, **moved}, ["alpha", "beta"])
        self.refused(co, "every service", "the manifest's service of studio.alpha-one changed")


# ---------------------------------------------------------------------------------------------------- R3.2 (.github/ci)

class Ci(test_ci.Case):
    def setUp(self):
        if not test_ci.CI.exists():
            self.fail(f"{test_ci.CI} does not exist")
        case = f"ci-{self._testMethodName[5:]}".replace("_", "-")
        listed = dict(checks=[dict(id="studio.alpha-one", reason="fixture reason", issue=402)],
                      steps=[dict(step="harness-test", reason="fixture reason: run on the owner's machine")])
        self.co = make(GROUP, case, ("pm-check", "pm-scope"),
                       {**f_files(), "studio/package.json": "{}\n",
                        ".github/not-run.json": json.dumps(listed, indent=1) + "\n"})
        shutil.copy2(test_ci.CI, self.co / ".github" / "ci")
        (self.co / ".github" / "ci").chmod(0o755)
        git(self.co, "add", "-A")
        git(self.co, "commit", "-q", "-m", "fixture: .github/ci")
        self.dir = self.co / "output" / "case"
        self.dir.mkdir(parents=True)
        self.summary = self.dir / "summary.md"
        self.summary.write_text("")
        self.services_json = self.co / "output" / "ci" / "services.json"

    def not_run_list(self, ids):
        listed = dict(checks=[dict(id=i, reason="fixture reason", issue=402) for i in ids],
                      steps=[dict(step="harness-test", reason="fixture reason: run on the owner's machine")])
        (self.co / ".github" / "not-run.json").write_text(json.dumps(listed))

    def push(self, *paths):
        before = git(self.co, "rev-parse", "HEAD")
        for rel in paths:
            p = self.co / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text((p.read_text() if p.exists() else "") + "// changed by the case\n")
        git(self.co, "add", "-A")
        git(self.co, "commit", "-q", "-m", "a push")
        return before, git(self.co, "rev-parse", "HEAD")

    def services(self, before, after):
        event = self.dir / "event.json"
        event.write_text(json.dumps({"before": before}))
        env = {k: v for k, v in self.env().items() if not k.startswith("GITHUB_")}
        env.update(GITHUB_EVENT_NAME="push", GITHUB_EVENT_PATH=str(event), GITHUB_SHA=after,
                   GITHUB_STEP_SUMMARY=str(self.summary))
        return self.ci("services", env=env)

    def selected(self, p):
        self.assertTrue(self.services_json.exists(), p.stdout + p.stderr)
        return json.loads(self.services_json.read_text())["services"]

    def test_not_run_accepts_an_id_of_a_service_s_manifest(self):
        p = self.ci("not-run")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_guard_not_run_refuses_an_unknown_id(self):
        self.not_run_list(["studio.nope"])
        p = self.ci("not-run")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("not an id of", p.stdout + p.stderr)

    def test_not_run_with_a_service_s_manifest_that_is_not_json(self):
        self.not_run_list(["studio.plain-b"])
        with open(self.co / ALPHA_M, "a") as f:
            f.write("this is not JSON\n")
        p = self.ci("not-run")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        named = [ln for ln in test_ci.lines_of(p) if ALPHA_M in ln and "cannot be read" in ln]
        self.assertTrue(named, p.stdout + p.stderr)

    def test_services_counts_each_service_s_checks(self):
        p = self.services(*self.push(SVC + "alpha/alpha.ts"))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.selected(p), ["alpha"])
        self.assertIn("not run  service beta  1 checks", test_ci.lines_of(p))
        table = self.summary.read_text()
        self.assertRegex(table, r"(?m)^\| run \| `alpha` \| 2 \|$", table)
        self.assertRegex(table, r"(?m)^\| not run \| `beta` \| 1 \|$", table)

    def test_services_with_a_service_s_manifest_that_is_a_link(self):
        link_file(self.co, BETA_M, "elsewhere/beta.jsonl")
        git(self.co, "add", "-A")
        git(self.co, "commit", "-q", "-m", "a link")
        p = self.services(*self.push(S + "alpha/x.tsx"))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIsNone(self.selected(p))
        self.assertEqual([ln for ln in test_ci.lines_of(p) if ln.startswith("not run  service ")], [])
        self.assertNotRegex(self.summary.read_text(), r"(?m)^\| (run|not run) \| `")


# ---------------------------------------------------------------------------------------------------- R3.2 (run)

class FFixture(Fixture):
    """The fixture of test_integration_not_run.py holding `files` (F unless given) instead of the checkout's
    manifest; its stand-ins write `passed` for every id of the manifest of `files`."""

    def __init__(self, name, files=None):
        self.files = dict(f_files() if files is None else files)
        self.co = make(GROUP, f"run-{name}", (), {
            **self.files,
            "tests/integration/run": RUN.read_text(),
            "engine/Cargo.toml": '[package]\nname = "fixture"\nversion = "0.0.0"\n',
            "studio/package.json": "{}\n",
            "studio/node_modules/.bin/playwright": RUN_STANDIN,
        })
        self.case = self.co / "output" / "case"
        self.bin = self.case / "bin"
        self.bin.mkdir(parents=True)
        for tool in TOOLS:
            p = self.bin / tool
            p.write_text(RUN_STANDIN)
            p.chmod(0o755)
        (self.co / "home").mkdir()
        self.verdicts()

    def rows(self):
        out = []
        for text in [self.files.get(MAIN, "")] + [t for p, t in sorted(self.files.items())
                                                    if p.startswith(SVC) and p.endswith("/manifest.jsonl")]:
            for ln in text.splitlines():
                try:
                    r = json.loads(ln)
                except ValueError:
                    continue
                if isinstance(r, dict):
                    out.append(r)
        return out

    def verdicts(self, extra=None):
        plan = dict(cargo={}, playwright={})
        for r in self.rows():
            plan["cargo" if str(r.get("path", "")).endswith(".rs") else "playwright"][str(r.get("check_id"))] = "passed"
        for check_id, verdict in (extra or {}).items():
            plan["cargo" if check_id.startswith("engine.") else "playwright"][check_id] = verdict
        (self.case / "verdicts.json").write_text(json.dumps(plan))

    def services(self, value):
        return self.file("services.json", json.dumps(dict(services=value)))

    def checks(self):
        """report.json's checks, in order, as written."""
        return json.loads(self.report_path.read_text())["checks"]


def sentence(service):
    return f"service {service} not touched: its checks are not part of this run"


class RunCase(unittest.TestCase):
    def report(self, fx, p):
        report = fx.report()
        self.assertIsNotNone(report, out(p))
        return report

    def assertManifestOfF(self, fx, p, ids=F_IDS):
        self.assertTrue(fx.report_path.exists(), out(p))
        self.assertEqual([c["check_id"] for c in fx.checks()], list(ids), out(p))

    def assertRefused(self, fx, p, reason, files=None):
        """Exit 127, every id of the manifest `error` with `reason`, the reason on stderr, no stand-in started."""
        self.assertEqual(p.returncode, 127, out(p))
        self.assertTrue(fx.report_path.exists(), out(p))
        checks = fx.checks()
        self.assertEqual([c["check_id"] for c in checks], manifest_ids(files or fx.files), out(p))
        for c in checks:
            self.assertEqual((c["verdict"], c["message"]), ("error", reason), c["check_id"])
        self.assertIn(reason, p.stderr)
        self.assertEqual([c["tool"] for c in fx.calls()], [], "a stand-in was started")

    def assertNotRefused(self, fx, p, ids=F_IDS):
        self.assertEqual(p.returncode, 0, out(p))
        self.assertManifestOfF(fx, p, ids)
        self.assertTrue(fx.calls(), "no stand-in was started")


class Run(RunCase):
    def test_the_report_lists_the_manifest_of_f(self):
        fx = FFixture("default")
        p = fx.run()
        self.assertEqual(p.returncode, 0, out(p))
        self.assertManifestOfF(fx, p)
        report = self.report(fx, p)
        self.assertEqual({i: report[i]["verdict"] for i in F_IDS if i != "studio.alpha-two"},
                         {i: "passed" for i in F_IDS if i != "studio.alpha-two"})
        self.assertEqual((report["studio.alpha-two"]["verdict"], report["studio.alpha-two"]["message"]),
                         ("not-run", ON_REQUEST))

    def test_services_leaves_out_the_other_service_s_checks(self):
        fx = FFixture("services-alpha")
        p = fx.run("--services", fx.services(["alpha"]))
        report = self.report(fx, p)
        self.assertIn("studio.beta-one", report, out(p))
        self.assertEqual((report["studio.beta-one"]["verdict"], report["studio.beta-one"]["message"]),
                         ("not-run", sentence("beta")))
        self.assertEqual(report["studio.alpha-one"]["verdict"], "passed")
        self.assertRegex("x.spec.ts studio.beta-one", grep_invert(self, fx.calls("playwright")))

    def test_a_left_out_check_that_would_fail(self):
        fx = FFixture("services-left-out-fails")
        fx.verdicts(extra={"studio.beta-one": "failed"})
        p = fx.run("--services", fx.services(["alpha"]))
        report = self.report(fx, p)
        self.assertIn("studio.beta-one", report, out(p))
        self.assertEqual((report["studio.beta-one"]["verdict"], report["studio.beta-one"]["message"]),
                         ("not-run", sentence("beta")))
        self.assertEqual(p.returncode, 0, out(p))

    def test_a_listed_service_s_failure_fails_the_run(self):
        fx = FFixture("services-listed-fails")
        fx.verdicts(extra={"studio.alpha-one": "failed"})
        p = fx.run("--services", fx.services(["alpha"]))
        self.assertEqual(p.returncode, 1, out(p))

    def test_a_not_run_list_may_name_a_service_s_check(self):
        fx = FFixture("not-run-beta")
        reason = "listed: beta one"
        p = fx.run("--not-run", fx.file("list.json", list_text({"studio.beta-one": reason})))
        self.assertEqual(p.returncode, 0, out(p))
        report = self.report(fx, p)
        self.assertEqual((report["studio.beta-one"]["verdict"], report["studio.beta-one"]["message"]),
                         ("not-run", reason))

    def test_a_manifest_of_an_earlier_run_is_not_read(self):
        fx = FFixture("stale")
        stale = fx.co / "output" / "integration" / "manifest.jsonl"
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_text(rows_text([row("studio.stale", T + "b.spec.ts")]))
        p = fx.run()
        self.assertManifestOfF(fx, p)
        self.assertNotIn("studio.stale", self.report(fx, p))

    def test_a_folder_not_of_the_form_adds_no_row(self):
        files = {**f_files(), SVC + "Gamma_1/manifest.jsonl": rows_text([row("studio.gamma", T + "b.spec.ts",
                                                                             "gamma")])}
        fx = FFixture("gamma", files)
        p = fx.run()
        self.assertManifestOfF(fx, p)

    def same_as_f0_with_a_bad_line(self, fx, p, last_line=True):
        files0 = f_files(f0=True)
        files0[MAIN] += "this is not JSON\n"
        fx0 = FFixture(fx.co.name[len("run-"):] + "-f0", files0)
        p0 = fx0.run()
        self.assertNotEqual(p.returncode, 0, out(p))
        self.assertEqual(p.returncode, p0.returncode, f"{out(p)}\n--- F0:\n{out(p0)}")
        if last_line:
            self.assertEqual(p.stderr.strip().splitlines()[-1:], p0.stderr.strip().splitlines()[-1:])
        self.assertEqual(fx.report_path.exists(), fx0.report_path.exists())

    def test_a_service_s_manifest_that_is_not_json(self):
        files = f_files()
        files[BETA_M] += "this is not JSON\n"
        fx = FFixture("beta-not-json", files)
        self.same_as_f0_with_a_bad_line(fx, fx.run())

    def test_a_service_s_manifest_or_folder_that_is_a_link(self):
        for name, rel in (("manifest", BETA_M), ("folder", SVC + "beta")):
            with self.subTest(name):
                fx = FFixture(f"beta-link-{name}")
                link_folder(fx.co, rel, "elsewhere/" + name)
                p = fx.run()
                # The last line names the file that could not be read, so it is not compared (decisions-needed).
                self.same_as_f0_with_a_bad_line(fx, p, last_line=False)
                self.assertFalse((fx.co / "output" / "integration" / "manifest.jsonl").exists())

    def test_guard_f0(self):
        fx = FFixture("f0", f_files(f0=True))
        p = fx.run()
        self.assertManifestOfF(fx, p)
        fx = FFixture("f0-services", f_files(f0=True))
        p = fx.run("--services", fx.services(["alpha"]))
        report = self.report(fx, p)
        self.assertEqual((report["studio.beta-one"]["verdict"], report["studio.beta-one"]["message"]),
                         ("not-run", sentence("beta")))


# ---------------------------------------------------------------------------------------------------- R5.5

def main_with(*rows):
    files = f_files()
    files[MAIN] += rows_text(rows)
    return files


ROW_X = row("studio.x", T + "x.spec.ts", "alpha")
MAIN_ROW_REASON = ("service files: studio.x in tests/integration/manifest.jsonl has the service alpha; its row belongs "
                   "in tests/integration/studio/services/alpha/manifest.jsonl (1 rows)")


def not_of_alpha(cid):
    return (f"service files: {cid} in tests/integration/studio/services/alpha/manifest.jsonl is not a check of alpha "
            f"in a check file (1 rows)")


class Rows(RunCase):
    def refused(self, name, files, reason, *args):
        fx = FFixture(name, files)
        p = fx.run(*(a(fx) if callable(a) else a for a in args))
        self.assertRefused(fx, p, reason)

    def test_a_row_with_a_service_in_the_main_manifest(self):
        self.refused("main-row", main_with(ROW_X), MAIN_ROW_REASON)

    def test_two_such_rows(self):
        self.refused("main-rows", main_with(ROW_X, row("studio.y", T + "y.spec.ts", "beta")),
                     MAIN_ROW_REASON.replace("(1 rows)", "(2 rows)"))

    def test_a_row_of_alpha_s_manifest_out_of_its_place(self):
        one = T + "alpha-one.spec.ts"
        table = {
            "service-beta": row("studio.alpha-one", one, "beta"),
            "no-service": row("studio.alpha-one", one),
            "module-engine": row("studio.alpha-one", one, "alpha", module="engine"),
            "path-rs": row("studio.alpha-one", "tests/integration/engine/tests/a.rs", "alpha"),
            "path-deep": row("studio.alpha-one", T + "deep/x.spec.ts", "alpha"),
        }
        for name, bad in table.items():
            with self.subTest(name):
                files = f_files()
                files[ALPHA_M] = rows_text([bad, ALPHA_ROWS[1]])
                self.refused(f"alpha-{name}", files, not_of_alpha("studio.alpha-one"))

    def test_an_id_held_twice(self):
        reason = "service files: studio.alpha-one is held by two rows of the manifest (1 ids)"
        with self.subTest("main and alpha"):
            self.refused("twice-main", main_with(row("studio.alpha-one", T + "alpha-one.spec.ts")), reason)
        with self.subTest("alpha twice"):
            files = f_files()
            files[ALPHA_M] = rows_text(ALPHA_ROWS + [ALPHA_ROWS[0]])
            self.refused("twice-alpha", files, reason)

    def test_an_id_not_of_the_form_is_a_row(self):
        files = f_files()
        files[ALPHA_M] = rows_text(ALPHA_ROWS + [row("Studio.Bad", T + "alpha-one.spec.ts", "beta", module="studio")])
        self.refused("bad-id", files, not_of_alpha("a row"))

    def test_a_row_comes_before_an_import(self):
        files = main_with(ROW_X)
        files[T + "b.spec.ts"] += IMPORT_ALPHA
        self.refused("row-and-import", files, MAIN_ROW_REASON)

    def test_options_do_not_pass_a_row_out_of_place(self):
        with self.subTest("--services"):
            self.refused("row-services", main_with(ROW_X), MAIN_ROW_REASON,
                         "--services", lambda fx: fx.services(["beta"]))
        with self.subTest("--not-run --on-request"):
            self.refused("row-not-run", main_with(ROW_X), MAIN_ROW_REASON,
                         "--not-run", lambda fx: fx.file("list.json", list_text({"studio.plain-b": "listed"})),
                         "--on-request")

    def test_guard_f0_is_not_refused(self):
        fx = FFixture("rows-f0", f_files(f0=True))
        self.assertNotRefused(fx, fx.run())


# ---------------------------------------------------------------------------------------------------- R4

B = "tests/integration/studio/b.spec.ts"
ALPHA_TS = "tests/integration/studio/services/alpha/alpha.ts"


def foreign(importer, imported=ALPHA_TS, n=1):
    return (f"service files: {importer} imports {imported} of the service alpha, and is not one of its check files "
            f"({n} imports)")


def with_file(path, text, files=None, append=True):
    files = dict(f_files() if files is None else files)
    files[path] = (files.get(path, "") if append else "") + text
    return files


class Imports(RunCase):
    def refused(self, name, files, reason, *args):
        fx = FFixture(name, files)
        p = fx.run(*(a(fx) if callable(a) else a for a in args))
        self.assertRefused(fx, p, reason)

    def not_refused(self, name, files, ids=F_IDS):
        fx = FFixture(name, files)
        p = fx.run()
        self.assertNotRefused(fx, p, ids)
        return fx

    def test_f_as_it_is_is_not_refused(self):
        self.not_refused("as-it-is", f_files())

    def test_a_check_of_no_service_imports_alpha_s_file(self):
        self.refused("b-imports", with_file(B, IMPORT_ALPHA), foreign(B))

    def test_every_form_of_an_import(self):
        forms = {
            "import-type": "import type { A } from './services/alpha/alpha';\n",
            "side-effect": "import './services/alpha/alpha';\n",
            "export-from": "export { a } from './services/alpha/alpha';\n",
            "dynamic": "const m = await import('./services/alpha/alpha');\n",
            "require": "const m = require('./services/alpha/alpha');\n",
            "double-quotes": 'import { a } from "./services/alpha/alpha";\n',
            "with-ts": "import { a } from './services/alpha/alpha.ts';\n",
        }
        for name, text in forms.items():
            with self.subTest(name):
                self.refused(f"form-{name}", with_file(B, text), foreign(B))

    def test_an_index_file_of_the_folder(self):
        files = with_file(B, "import { a } from './services/alpha';\n")
        files[SVC + "alpha/index.ts"] = "export const i = 1;\n"
        self.refused("index", files, foreign(B, "tests/integration/studio/services/alpha/index.ts"))

    def test_other_importers(self):
        table = {
            "beta-spec": (T + "beta.spec.ts", IMPORT_ALPHA),
            "beta-ts": (SVC + "beta/beta.ts", "import { a } from '../alpha/alpha';\n"),
            "shared": (T + "support/shared.ts", "import { a } from '../services/alpha/alpha';\n"),
            "index": (T + "support/index.ts", "export { a } from '../services/alpha/alpha';\n"),
            "config": (T + "playwright.config.ts", IMPORT_ALPHA),
        }
        for name, (importer, text) in table.items():
            with self.subTest(name):
                self.refused(f"importer-{name}", with_file(importer, text), foreign(importer))

    def test_a_row_of_no_service_on_alpha_s_check_file(self):
        files = main_with(row("studio.alpha-plain", T + "alpha-one.spec.ts"))
        self.refused("alpha-one-plain", files, foreign(T + "alpha-one.spec.ts"))

    def test_a_row_of_beta_on_alpha_s_check_file(self):
        files = f_files()
        files[BETA_M] += rows_text([row("studio.beta-two", T + "alpha-one.spec.ts", "beta")])
        self.refused("alpha-one-beta", files, foreign(T + "alpha-one.spec.ts"))

    def test_services_does_not_pass_a_foreign_import(self):
        self.refused("import-services", with_file(B, IMPORT_ALPHA), foreign(B),
                     "--services", lambda fx: fx.services(["beta"]))

    def test_no_option_passes_a_foreign_import(self):
        table = {
            "services-empty": ("--services", lambda fx: fx.services([])),
            "not-run": ("--not-run", lambda fx: fx.file("list.json", list_text({"studio.plain-b": "listed"}))),
            "on-request": ("--on-request",),
        }
        for name, args in table.items():
            with self.subTest(name):
                self.refused(f"import-{name}", with_file(B, IMPORT_ALPHA), foreign(B), *args)

    def test_two_importers(self):
        files = with_file(B, IMPORT_ALPHA)
        files = with_file(T + "beta.spec.ts", IMPORT_ALPHA, files)
        self.refused("two", files, foreign(B, n=2))

    def test_an_import_of_a_check_file(self):
        reason = ("service files: tests/integration/studio/support/shared.ts imports the check file "
                  "tests/integration/studio/alpha-one.spec.ts (1 imports)")
        self.refused("spec", with_file(T + "support/shared.ts", "import { x } from '../alpha-one.spec';\n"), reason)

    def test_an_import_in_a_comment_counts(self):
        self.refused("comment", with_file(B, "// " + IMPORT_ALPHA), foreign(B))

    def test_a_specifier_that_names_no_walked_file(self):
        table = {
            "not-relative": "import { a } from 'services/alpha/alpha';\n",
            "missing": "import { a } from './services/alpha/missing';\n",
            "outside": "import { a } from '../../../outside/services/alpha/alpha';\n",
        }
        for name, text in table.items():
            with self.subTest(name):
                fx = FFixture(f"names-nothing-{name}", with_file(B, text))
                outside = fx.co / "outside" / "services" / "alpha" / "alpha.ts"
                outside.parent.mkdir(parents=True)
                outside.write_text("import { b } from '../../../tests/integration/studio/services/beta/beta';\n")
                outside.chmod(0)
                self.addCleanup(outside.chmod, stat.S_IRUSR | stat.S_IWUSR)
                p = fx.run()
                self.assertNotRefused(fx, p)

    def test_a_link_out_of_the_folder_is_not_followed(self):
        fx = FFixture("link-out")
        away = fx.co / "outside" / "linked"
        away.mkdir(parents=True)
        (away / "x.ts").write_text("import { a } from '../services/alpha/alpha';\n")
        os.symlink(os.path.relpath(away, fx.co / T), fx.co / T / "linked")
        self.assertNotRefused(fx, fx.run())

    def test_guard_f0_import_of_a_check_file(self):
        self.not_refused("f0-spec", with_file(B, "import { x } from './alpha-one.spec';\n", f_files(f0=True)))


# ---------------------------------------------------------------------------------------------------- R6.1

def sentences(text):
    """The sentences of `text`, with line breaks and comment marks taken out."""
    flat = " ".join(ln.lstrip("#").strip() for ln in text.splitlines())
    return [s for s in re.split(r"(?<=[.;:])\s+", flat) if s]


def docstring(path):
    return ast.get_docstring(ast.parse(path.read_text())) or ""


class Docs(unittest.TestCase):
    def assertSentence(self, text, *words, where=""):
        found = [s for s in sentences(text) if all(re.search(w, s) for w in words)]
        self.assertTrue(found, f"{where}: no sentence holds {words!r}")

    def test_run_s_head_comment(self):
        lines = (CHECKOUT / "tests" / "integration" / "run").read_text().splitlines()[1:]
        head = "\n".join(ln for ln in itertools.takewhile(lambda ln: ln.startswith("#"), lines))
        self.assertIn("studio/services/<service>/manifest.jsonl", head)
        self.assertSentence(head, r"main manifest", r"each service", where="run")
        self.assertSentence(head, r"refuse", r"\brows?\b", where="run")
        self.assertSentence(head, r"refuse", r"\bimports?\b", where="run")

    def test_pm_scope_and_select_name_the_folder(self):
        self.assertIn("tests/integration/studio/services/", docstring(CHECKOUT / ".pm" / "bin" / "pm-scope"))
        fn = need_pmscope(self, "select")
        self.assertIn("tests/integration/studio/services/", fn.__doc__ or "")

    def test_pm_check_says_checks_takes_a_service_s_id(self):
        self.assertSentence(docstring(CHECKOUT / ".pm" / "bin" / "pm-check"), r"--checks", r"main manifest",
                            r"service'?s?\b", where="pm-check")


if __name__ == "__main__":
    unittest.main()
