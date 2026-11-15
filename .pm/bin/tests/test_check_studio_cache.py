"""pm-check: the studio-unit step reports Studio's unit tests on the files on disk, never on a module cache that an
earlier Vitest run left in studio/node_modules (issue 33).

Each class is one "Given" of the issue's test criteria: it builds a fixture checkout with its own copies of pm-check
and _pmlib.py and a tiny Vitest project whose glob has the form of studio/src/i18n/bundled.ts, makes the earlier run
by hand when the case has one, then runs the fixture's pm-check once (a full run). The cases need bun and Vitest in
this checkout's studio/node_modules; without them a case fails, it never skips.
"""
import json
import pathlib
import shutil
import subprocess
import unittest

from _fixture import CHECKOUT, clean_env, git, make, run

SCRIPTS = ("pm-check", "_pmlib.py")
GROUP = "check-studio-cache"
MODULES = CHECKOUT / "studio" / "node_modules"
TIMEOUT = 600  # a heavy pm-check run may wait up to 300 s for the CPU before its first step

PACKAGE = """{ "name": "fixture", "private": true, "type": "module",
  "scripts": { "typecheck": "true", "lint": "true", "format:check": "true", "build": "true", "test:unit": "%s" } }
"""
FOUND = """const FILES = import.meta.glob<unknown>('./items/*.json', { eager: true, import: 'default' });
export const FOUND = Object.keys(FILES).sort();
"""
# writes what the glob found to stdout itself: Vitest's reporter may hide a passing test's console output
TEST = """import { readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { FOUND } from './found';
test('what the glob finds', () => {
  process.stdout.write(`GLOB FOUND ${JSON.stringify(FOUND)}\\n`);
  expect(FOUND).toEqual(%s);
});
"""
ON_DISK = "readdirSync(new URL('./items/', import.meta.url)).sort().map((f) => `./items/${f}`)"
ONLY_A = "['./items/a.json']"
# a tool that refuses every option
STAND_IN = """#!/bin/sh
for a in "$@"; do echo "unknown option $a"; exit 2; done
echo "ran with no option"
"""
OWN_CACHE = """export default { test: { fsModuleCache: true, fsModuleCachePath: './node_modules/.own-cache' } };
"""
FOUND_ONE = 'GLOB FOUND ["./items/a.json"]'
FOUND_TWO = 'GLOB FOUND ["./items/a.json","./items/b.json"]'
PRINTED = ("GLOB FOUND", "unknown option", "ran with no option")  # the lines the fixture's tools print


def fixture(case, unit="vitest run", expected=ON_DISK, extra=None):
    """The fixture checkout of the criteria, committed and clean, with studio/node_modules as a directory of links."""
    files = {"studio/package.json": PACKAGE % unit, "studio/src/found.ts": FOUND,
             "studio/src/found.test.ts": TEST % expected, "studio/src/items/a.json": "{}\n", **(extra or {})}
    co = make(GROUP, case, SCRIPTS, files)
    with open(co / ".gitignore", "a") as f:
        f.write("node_modules/\n")
    git(co, "commit", "-q", "-am", "ignore node_modules")
    assert shutil.which("bun"), "bun is not on PATH: the cases of issue 33 need it"
    assert (MODULES / "vitest").is_dir(), f"no Vitest in {MODULES}: run bun install in studio/"
    nm = co / "studio" / "node_modules"
    nm.mkdir()
    for e in MODULES.iterdir():
        if e.name == ".bin" or not e.name.startswith("."):
            (nm / e.name).symlink_to(e)
    return co


def earlier_run(co):
    """bun run test:unit by hand in the fixture's studio/, with no option, as a person or an earlier check would."""
    p = subprocess.run(["bun", "run", "test:unit"], cwd=str(co / "studio"), capture_output=True, text=True,
                       env=clean_env(), timeout=TIMEOUT)
    assert p.returncode == 0, f"the earlier run failed:\n{p.stdout}{p.stderr}"


def add_b(co):
    (co / "studio" / "src" / "items" / "b.json").write_text("{}\n")
    git(co, "add", "-A")
    git(co, "commit", "-q", "-m", "a second item")


def names(d):
    return sorted(str(p.relative_to(d)) for p in d.rglob("*"))


def check(co):
    """The fixture's own pm-check, a full run: (process, last.json, the studio-unit step)."""
    p = run(co, "pm-check", co, timeout=TIMEOUT)
    rec = json.loads((co / "output" / "checks" / "last.json").read_text())
    step = next(s for s in rec["steps"] if s["name"] == "studio-unit")
    return p, rec, step


def text(path):
    return pathlib.Path(path).read_text() if path else ""


def seen(step):
    """What each attempt of the step printed about the glob, for the failure messages."""
    out = []
    for key in ("first_log", "log"):
        lines = [x.strip() for x in text(step.get(key)).splitlines() if x.startswith(PRINTED)]
        out.append(f"{key}: {lines or '(nothing)'}")
        out.append(f"  ran: {step.get(key)}")
    return "\n".join(out)


class CacheOfOneItemFilesOnDiskPass(unittest.TestCase):
    """An earlier run cached the module while src/items/ held a.json alone; b.json is then added and committed, and
    the test expects exactly the files now in src/items/."""

    @classmethod
    def setUpClass(cls):
        cls.co = fixture("on-disk")
        earlier_run(cls.co)
        add_b(cls.co)
        cls.cache = cls.co / "studio" / "node_modules" / ".vitest-cache"
        cls.before = names(cls.cache) if cls.cache.is_dir() else None
        cls.p, cls.rec, cls.step = check(cls.co)

    def test_first_attempt_passes_on_the_files_on_disk(self):
        why = seen(self.step)
        self.assertEqual(self.p.returncode, 0, f"pm-check failed on a correct tree\n{why}\n{self.p.stdout}")
        self.assertTrue(self.rec["passed"], why)
        self.assertEqual(self.step["status"], "passed", why)
        self.assertNotIn("first_log", self.step, why)
        self.assertIn(FOUND_TWO, text(self.step["log"]), why)

    def test_the_cache_directory_keeps_its_file_names(self):
        self.assertIsNotNone(self.before, "the earlier run wrote no studio/node_modules/.vitest-cache")
        self.assertTrue(self.before, "the earlier run's .vitest-cache is empty")
        self.assertEqual(names(self.cache), self.before, "pm-check removed or added files in .vitest-cache")


class CacheOfAPassingTreeFilesOnDiskFail(unittest.TestCase):
    """The same fixture and steps, with a test that expects the glob to have found exactly a.json."""

    @classmethod
    def setUpClass(cls):
        cls.co = fixture("only-a", expected=ONLY_A)
        earlier_run(cls.co)
        add_b(cls.co)
        cls.p, cls.rec, cls.step = check(cls.co)

    def test_the_step_fails(self):
        why = seen(self.step)
        self.assertEqual(self.p.returncode, 1, f"pm-check passed a tree whose test fails\n{why}\n{self.p.stdout}")
        self.assertEqual(self.rec["failed"], ["studio-unit"], why)
        self.assertEqual(self.rec["flaky"], [], why)
        self.assertEqual(self.step["status"], "failed", why)

    def test_both_attempts_see_the_files_on_disk(self):
        why = seen(self.step)
        self.assertIn("first_log", self.step, f"the step was not run a second time\n{why}")
        self.assertIn(FOUND_TWO, text(self.step["first_log"]), why)
        self.assertIn(FOUND_TWO, text(self.step["log"]), why)
        self.assertNotIn(FOUND_ONE, text(self.step["first_log"]), why)
        self.assertNotIn(FOUND_ONE, text(self.step["log"]), why)


class NoEarlierRun(unittest.TestCase):
    """No earlier run, and a test that expects the glob to have found exactly the files in src/items/."""

    def test_a_passing_run_leaves_no_cache(self):
        co = fixture("no-earlier-run")
        cache = co / "studio" / "node_modules" / ".vitest-cache"
        self.assertFalse(cache.exists())
        p, rec, step = check(co)
        self.assertEqual(p.returncode, 0, f"{seen(step)}\n{p.stdout}")
        self.assertFalse(cache.exists(), f"the step left {cache} with {len(names(cache))} entries for a later run")


class ToolRefusesTheOption(unittest.TestCase):
    """test:unit is a stand-in that runs with no argument and refuses any argument."""

    def test_the_step_fails_and_both_logs_hold_the_refusal(self):
        co = fixture("refused", unit="sh ./stand-in.sh", extra={"studio/stand-in.sh": STAND_IN})
        p, rec, step = check(co)
        why = seen(step)
        self.assertEqual(p.returncode, 1, f"the step was given no option\n{why}\n{p.stdout}")
        self.assertEqual(step["status"], "failed", why)
        self.assertIn("first_log", step, why)
        for key in ("first_log", "log"):
            self.assertIn("unknown option", text(step[key]), why)
            self.assertNotIn("ran with no option", text(step[key]), why)


class ConfigurationKeepsItsOwnCache(unittest.TestCase):
    """studio/vite.config.ts turns the cache on at node_modules/.own-cache; an earlier run cached the module while
    src/items/ held a.json alone; b.json is then added and committed; the test expects the files now in src/items/."""

    def test_first_attempt_passes_and_the_own_cache_keeps_its_file_names(self):
        co = fixture("own-cache", extra={"studio/vite.config.ts": OWN_CACHE})
        earlier_run(co)
        add_b(co)
        cache = co / "studio" / "node_modules" / ".own-cache"
        self.assertTrue(cache.is_dir() and names(cache), "the earlier run wrote nothing to node_modules/.own-cache")
        before = names(cache)
        p, rec, step = check(co)
        why = seen(step)
        self.assertEqual(p.returncode, 0, f"pm-check failed on a correct tree\n{why}\n{p.stdout}")
        self.assertEqual(step["status"], "passed", why)
        self.assertNotIn("first_log", step, why)
        self.assertEqual(names(cache), before, "pm-check removed or added files in node_modules/.own-cache")


if __name__ == "__main__":
    unittest.main()
