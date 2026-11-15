"""Fixture checkouts for the tests of the harness scripts. Not a test.

A fixture checkout is a git repository under <checkout>/output/tests/<group>/<case>/ with its own copies of the
scripts under test in .pm/bin, so `_pmlib.ROOT` is the fixture and nothing touches the real .pm/run.
"""
import os
import pathlib
import shutil
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]


def clean_env():
    """The caller's environment without git variables that would point git at another repository."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), "-c", "user.name=fixture", "-c", "user.email=fixture@localhost",
                           "-c", "commit.gpgsign=false", *args],
                          check=True, capture_output=True, text=True, env=clean_env()).stdout.strip()


def make(group, case, scripts, files=None):
    """A committed fixture checkout holding `scripts` (names in .pm/bin) and `files` ({relative path: text})."""
    co = CHECKOUT / "output" / "tests" / group / case
    if co.exists():
        shutil.rmtree(co)
    b = co / ".pm" / "bin"
    b.mkdir(parents=True)
    for f in scripts:
        shutil.copy2(BIN / f, b / f)
    for rel, text in (files or {}).items():
        p = co / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        if text.startswith("#!"):
            p.chmod(0o755)
    (co / ".gitignore").write_text("output/\n.pm/run/\n.pm/issue-*/\n__pycache__/\n")
    git(co, "init", "-q", "-b", "main")
    git(co, "add", "-A")
    git(co, "commit", "-q", "-m", "fixture")
    return co


def run(co, script, *args, cwd=None, timeout=120):
    return subprocess.run([str(co / ".pm" / "bin" / script), *map(str, args)], capture_output=True, text=True,
                          env=clean_env(), cwd=str(cwd or co), timeout=timeout)
