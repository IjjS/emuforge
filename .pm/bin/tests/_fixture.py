"""Fixture checkouts for the tests of the harness scripts. Not a test.

A fixture checkout is a git repository under <checkout>/output/tests/<group>/<case>/ with its own copies of the
scripts under test in .pm/bin, so `_pmlib.ROOT` is the fixture and nothing touches the real .pm/run. Its `home/`
is ignored by git, so a case can use it as a made-up HOME without making the checkout dirty.
"""
import os
import pathlib
import shutil
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]


# An idle machine (issue 478): `top` 98 % idle, `vm_stat` 1 GB in use, `sysctl` no swap in use. clean_env() puts
# them first on PATH, so a fixture script's look at the machine (_pmlib.machine_room: a heavy pm-check asks for
# room) never reads the real one; a case that writes its own stand-ins puts them before these.
IDLE = {
    "top": "#!/bin/sh\necho 'CPU usage: 1.0% user, 1.0% sys, 98.0% idle'\n"
           "echo 'CPU usage: 1.0% user, 1.0% sys, 98.0% idle'\n",
    "vm_stat": "#!/bin/sh\necho 'Mach Virtual Memory Statistics: (page size of 16384 bytes)'\n"
               "echo 'Pages active:                            65536.'\n"
               "echo 'Pages wired down:                            0.'\n"
               "echo 'Pages occupied by compressor:                0.'\n",
    "sysctl": "#!/bin/sh\necho 'total = 1024.00M  used = 0.00M  free = 1024.00M  (encrypted)'\n",
}


def machine_bin(name="idle", tools=None):
    """A folder of machine stand-ins (`IDLE` by default, or `tools` {name: script text}) written under
    <checkout>/output/tests/machine/<name>/; its path."""
    d = CHECKOUT / "output" / "tests" / "machine" / name
    d.mkdir(parents=True, exist_ok=True)
    for tool, text in (IDLE if tools is None else tools).items():
        f = d / tool
        if not f.exists() or f.read_text() != text:  # written whole, then moved in: another case may run it now
            tmp = d / f".{tool}.{os.getpid()}"
            tmp.write_text(text)
            tmp.chmod(0o755)
            tmp.replace(f)
    return d


def clean_env():
    """The caller's environment without git variables that would point git at another repository, with the idle
    machine's stand-ins first on PATH."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["PATH"] = f"{machine_bin()}{os.pathsep}{env.get('PATH', '')}"
    return env


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), "-c", "user.name=fixture", "-c", "user.email=fixture@localhost",
                           "-c", "commit.gpgsign=false", *args],
                          check=True, capture_output=True, text=True, env=clean_env()).stdout.strip()


def make(group, case, scripts, files=None):
    """A committed fixture checkout holding `scripts` (names in .pm/bin), every `_pm*.py` helper of .pm/bin that
    exists, and `files` ({relative path: text}). A named script is copied without asking whether it exists."""
    co = CHECKOUT / "output" / "tests" / group / case
    if co.exists():
        shutil.rmtree(co)
    b = co / ".pm" / "bin"
    b.mkdir(parents=True)
    for f in [h.name for h in sorted(BIN.glob("_pm*.py"))] + list(scripts):
        shutil.copy2(BIN / f, b / f)
    for rel, text in (files or {}).items():
        p = co / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        if text.startswith("#!"):
            p.chmod(0o755)
    (co / ".gitignore").write_text("output/\nhome/\n.pm/run/\n.pm/issue-*/\n__pycache__/\n")
    git(co, "init", "-q", "-b", "main")
    git(co, "add", "-A")
    git(co, "commit", "-q", "-m", "fixture")
    return co


def run(co, script, *args, cwd=None, timeout=120, env=None):
    """Run a fixture script; `env` replaces the default environment (`clean_env()`) when given."""
    return subprocess.run([str(co / ".pm" / "bin" / script), *map(str, args)], capture_output=True, text=True,
                          env=clean_env() if env is None else env, cwd=str(cwd or co), timeout=timeout)
