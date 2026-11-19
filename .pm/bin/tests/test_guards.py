"""The harness guards (issue 523): what a script may stop, remove or delete, and nothing more.

Check id `harness.guards`. The harness keeps no other test. Three guards, each of a fault that cannot be undone:

A. what the orphan sweep may stop (_pmorphans, as pm-worktree orphans --stop, rm, pm-pane reset and close use it);
B. what a check's clean-up may remove of containers, volumes, networks and images (_pmitrun.sweep, pm-check's);
C. what `pm-worktree rm` may delete.

Stand-ins only: A runs on a made-up process table with `cwds` and `os.kill` replaced, so no process is ever
signalled; B runs _pmitrun in this process against a stand-in `docker` that keeps its state in a JSON file and a
stand-in `pm-emulator-dir`; C runs a copy of pm-worktree in a fixture repository under output/tests/guards/ with a
stand-in `pm-emulator-dir`. No real Docker, herdr or emulator, and no sleep. All of it runs in under 30 s; a case
that makes it slower goes (owner decision, 2026-11-19). A new case is added only on the pm's decision, for a new
way a script could delete, stop or remove what is not its own.
"""
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import unittest
from unittest import mock

BIN = pathlib.Path(__file__).resolve().parents[1]
CHECKOUT = BIN.parents[1]
WORK = CHECKOUT / "output" / "tests" / "guards"
sys.path.insert(0, str(BIN))
import _pmitrun  # noqa: E402
import _pmorphans  # noqa: E402
from _pmorphans import Proc  # noqa: E402

UID = os.getuid()
START = "Thu Nov 19 12:00:00 2026"


def fresh(name):
    d = WORK / name
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    return d.resolve()


# ---------------------------------------------------------------------------------------------- A. orphan sweep

def proc(pid, ppid, cwd, uid=UID, pgid=None, start=START, command="node server.js", state="S"):
    return Proc(pid, ppid, pgid or pid, uid, start, 0.0, state, "01:00", command, None, None), cwd


class OrphanSweep(unittest.TestCase):
    def setUp(self):
        base = fresh("orphans")
        self.wt = base / "emuforge-1-h1"
        self.other = base / "emuforge-1-h1x"  # shares the worktree's name as a prefix
        for d in (self.wt / "studio", self.other):
            d.mkdir(parents=True)
        self.wt, self.other = str(self.wt), str(self.other)

    def scan(self, rows):
        tab = {p.pid: p for p, _ in rows}
        dirs = {p.pid: cwd for p, cwd in rows}
        with mock.patch.object(_pmorphans, "cwds", lambda pids: {p: dirs[p] for p in pids if p in dirs}):
            return [p.pid for p in _pmorphans.find(self.wt, tab=tab)]

    def test_an_orphan_of_the_worktree_and_its_child_there_are_found(self):
        rows = [proc(1, 0, "/"), proc(100, 1, self.wt), proc(101, 100, self.wt + "/studio")]
        self.assertEqual(self.scan(rows), [100, 101])

    def test_a_process_with_a_live_parent_is_not_found(self):
        rows = [proc(1, 0, "/"), proc(200, 1, "/"), proc(201, 200, self.wt), proc(202, 201, self.wt)]
        self.assertEqual(self.scan(rows), [])

    def test_nothing_outside_the_worktree_is_found(self):
        rows = [proc(1, 0, "/"), proc(300, 1, self.other), proc(301, 300, self.wt),
                proc(302, 1, self.wt), proc(303, 302, self.other), proc(304, 1, os.path.dirname(self.wt))]
        self.assertEqual(self.scan(rows), [302])

    def test_another_users_orphan_and_this_process_are_not_found(self):
        rows = [proc(1, 0, "/"), proc(400, 1, self.wt, uid=UID + 1), proc(os.getpid(), 1, self.wt)]
        self.assertEqual(self.scan(rows), [])

    def test_the_running_pm_check_and_its_step_group_are_left_out(self):
        checks = pathlib.Path(self.wt) / "output" / "checks"
        checks.mkdir(parents=True)
        (checks / "running.json").write_text(json.dumps({"pm_check_pid": 500, "pgid": 510}))
        rows = [proc(1, 0, "/"), proc(500, 1, self.wt, command=f"python3 -I /x/.pm/bin/pm-check {self.wt}"),
                proc(510, 1, self.wt, pgid=510, command="cargo test"), proc(511, 510, self.wt, pgid=510),
                proc(520, 1, self.wt)]
        self.assertEqual(self.scan(rows), [520])

    def test_stop_signals_by_pid_and_only_the_same_process(self):
        found = [proc(600, 1, self.wt)[0], proc(601, 1, self.wt)[0], proc(602, 1, self.wt)[0]]
        now = {p.pid: p for p, _ in [proc(1, 0, "/"), proc(600, 1, self.wt),
                                     proc(601, 1, self.wt, start="Thu Nov 19 13:00:00 2026"),  # a reused PID
                                     proc(602, 1, self.wt)]}
        dirs = {600: self.wt, 601: self.wt, 602: self.other}  # 602 moved out of the worktree
        sent = []

        def kill(pid, sig):
            sent.append((pid, sig))
            now.pop(pid, None)

        with mock.patch.object(_pmorphans, "table", lambda: dict(now)), \
                mock.patch.object(_pmorphans, "cwds", lambda pids: {p: dirs[p] for p in pids if p in dirs}), \
                mock.patch.object(_pmorphans.os, "kill", kill):
            stopped, left = _pmorphans.stop(found, self.wt)
        self.assertEqual(sent, [(600, signal.SIGTERM)])
        self.assertEqual([p.pid for p in stopped], [600])
        self.assertEqual(left, [])


# ---------------------------------------------------------------------------------------------- B. check clean-up

DOCKER = r'''#!@PYTHON@ -I
"""Stand-in docker: state in docker.json beside it, each call appended to calls.jsonl."""
import json, pathlib, sys
here = pathlib.Path(__file__).resolve().parent
s = json.loads((here / "docker.json").read_text())
args = sys.argv[1:]
with open(here / "calls.jsonl", "a") as f:
    f.write(json.dumps(args) + "\n")
if s.get("fail"):
    sys.exit(1)
def save():
    (here / "docker.json").write_text(json.dumps(s))
def ref(r):
    return r if ":" in r else r + ":latest"
def filters(rest):
    return [rest[i + 1] for i, a in enumerate(rest) if a == "--filter"]
def labelled(labels, value):
    k, _, v = value.partition("=")
    return labels.get(k) == v
def matches(c, f):
    kind, _, value = f.partition("=")
    if kind == "label":
        return labelled(c["labels"], value)
    if kind == "ancestor":
        i = s["images"].get(ref(value))
        return i is not None and s["images"].get(ref(c["image"])) == i
    return False
code = 0
if args[:2] == ["image", "ls"]:
    refs = [f.partition("=")[2] for f in filters(args[2:])]
    for r in s["images"]:
        if r in refs:
            print(r)
elif args[:1] == ["ps"]:
    for c in s["containers"]:
        if all(matches(c, f) for f in filters(args[1:])):
            print(c["id"])
elif args[:1] == ["inspect"]:
    for i in args[3:]:
        c = next((c for c in s["containers"] if c["id"] == i), None)
        if c is None:
            code = 1
            continue
        print("|".join([c["id"], "/" + c["name"], c["image"], c["labels"].get("emuforge-it-run", "<no value>"),
                        c["labels"].get("com.docker.compose.project", "<no value>"),
                        "".join(m + " " for m in c["mounts"])]))
elif args[:1] == ["rm"]:
    s["containers"] = [c for c in s["containers"] if c["id"] != args[-1]]; save()
elif args[:2] == ["volume", "ls"]:
    for v in s["volumes"]:
        if all(labelled(v["labels"], f.partition("=")[2]) for f in filters(args[2:])):
            print(v["name"])
elif args[:2] == ["volume", "rm"]:
    if any(args[2] in c["mounts"] for c in s["containers"]):
        code = 1
    else:
        s["volumes"] = [v for v in s["volumes"] if v["name"] != args[2]]; save()
elif args[:2] == ["network", "ls"]:
    for n in s["networks"]:
        if all(labelled(n["labels"], f.partition("=")[2]) for f in filters(args[2:])):
            print(n["id"])
elif args[:2] == ["network", "rm"]:
    s["networks"] = [n for n in s["networks"] if n["id"] != args[2]]; save()
elif args[:2] == ["image", "rm"]:
    r = ref(args[2])
    i = s["images"].get(r)
    shared = [o for o, j in s["images"].items() if j == i and o != r]
    if i is None or (not shared and any(s["images"].get(ref(c["image"])) == i for c in s["containers"])):
        code = 1  # an image a container uses, under its last name, is refused as Docker does
    else:
        del s["images"][r]; save()
else:
    code = 2
sys.exit(code)
'''

EMULATOR_DIR = '''#!/bin/sh
echo "$*" >> "$(dirname "$0")/dir-calls.txt"
echo "pm-emulator-dir: removed ~/.aws/emulator/$3"
'''

A, B = "1700000000-1111", "1700000000-2222"


def run_things(run, port, emulator_id):
    """What an integration run makes: its emulator, a check's emulator, a product form with volume and network."""
    form = f"fxform-{run}"
    images = {f"emuforge-it-product-{run}:latest": f"sha-product-{run}",
              f"emuforge-it-emulator-{run}:latest": emulator_id, f"aws-emulator:it-{run}": "sha-emu"}
    containers = [
        dict(id=f"run{run}", name=f"emuforge-it-{port}-{run}", image=f"aws-emulator:it-{run}",
             labels={"emuforge-it-run": run}, mounts=[]),
        dict(id=f"chk{run}", name=f"emuforge-it-{port + 1}-{run}", image=f"aws-emulator:it-{run}",
             labels={"emuforge-it-run": run}, mounts=[]),
        dict(id=f"form{run}", name=f"{form}-emulator-1", image=f"emuforge-it-emulator-{run}",
             labels={"com.docker.compose.project": form}, mounts=[f"{form}_data"])]
    volumes = [dict(name=f"vol{run}", labels={"emuforge-it-run": run}),
               dict(name=f"{form}_data", labels={"com.docker.compose.project": form})]
    networks = [dict(id=f"net{run}", labels={"com.docker.compose.project": form})]
    return images, containers, volumes, networks


class CheckCleanUp(unittest.TestCase):
    def setUp(self):
        d = fresh("clean-up")
        self.bin, self.co = d / "bin", d / "checkout"
        self.bin.mkdir()
        (self.co / "output").mkdir(parents=True)
        (self.bin / "docker").write_text(DOCKER.replace("@PYTHON@", sys.executable))
        (self.bin / "pm-emulator-dir").write_text(EMULATOR_DIR)
        for f in ("docker", "pm-emulator-dir"):
            (self.bin / f).chmod(0o755)
        ia, ca, va, na = run_things(A, 9350, "sha-emulator-build")
        ib, cb, vb, nb = run_things(B, 9360, "sha-emulator-build")  # a build cache hit: one image id for both
        self.state = dict(
            images={**ia, **ib, "aws-emulator:latest": "sha-emu", "someapp:latest": "sha-emulator-build"},
            containers=ca + cb + [
                dict(id="other", name="someapp-web-1", image="someapp:latest", labels={}, mounts=["someapp_db"]),
                dict(id="owner", name="emuforge-9297", image="aws-emulator:latest", labels={}, mounts=[])],
            volumes=va + vb + [dict(name="someapp_db", labels={})],
            networks=na + nb)
        self.write(self.state)
        self.env = mock.patch.dict(os.environ, {"PATH": f"{self.bin}{os.pathsep}{os.environ.get('PATH', '')}"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def write(self, state):
        (self.bin / "docker.json").write_text(json.dumps(state))

    def read(self):
        return json.loads((self.bin / "docker.json").read_text())

    def dir_calls(self):
        f = self.bin / "dir-calls.txt"
        return f.read_text().splitlines() if f.exists() else []

    def test_a_sweep_removes_its_run_and_nothing_else(self):
        out = _pmitrun.sweep(self.co, A, 9350, self.bin)
        after = self.read()
        self.assertIsNone(out["docker"])
        self.assertEqual(sorted(c["id"] for c in after["containers"]), sorted([f"run{B}", f"chk{B}", f"form{B}",
                                                                               "other", "owner"]))
        self.assertEqual(sorted(v["name"] for v in after["volumes"]),
                         sorted([f"vol{B}", f"fxform-{B}_data", "someapp_db"]))
        self.assertEqual([n["id"] for n in after["networks"]], [f"net{B}"])
        self.assertEqual(sorted(after["images"]), sorted([f"emuforge-it-product-{B}:latest",
                                                          f"emuforge-it-emulator-{B}:latest", f"aws-emulator:it-{B}",
                                                          "aws-emulator:latest", "someapp:latest"]))

    def test_folders_go_through_pm_emulator_dir_for_the_runs_own_ports(self):
        _pmitrun.sweep(self.co, A, 9350, self.bin)
        self.assertEqual(self.dir_calls(), ["rm --port 9350", "rm --port 9351"])

    def test_docker_not_answering_removes_nothing(self):
        self.state["fail"] = True
        self.write(self.state)
        out = _pmitrun.sweep(self.co, A, 9350, self.bin)
        self.assertEqual(self.read(), self.state)
        self.assertEqual(out["removed"], [])
        self.assertEqual(self.dir_calls(), [])
        self.assertTrue(_pmitrun.lines(out)[0].endswith("not swept: docker `docker image ls` exit 1"), out)


# ---------------------------------------------------------------------------------------------- C. pm-worktree rm

def git(repo, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    return subprocess.run(["git", "-C", str(repo), "-c", "user.name=fixture", "-c", "user.email=fixture@localhost",
                           "-c", "commit.gpgsign=false", *args], check=True, capture_output=True, text=True,
                          env=env).stdout.strip()


class WorktreeRm(unittest.TestCase):
    def setUp(self):
        base = fresh("worktree-rm")
        self.root = base / "emuforge"
        b = self.root / ".pm" / "bin"
        b.mkdir(parents=True)
        for f in [h.name for h in BIN.glob("_pm*.py")] + ["pm-worktree"]:
            shutil.copy2(BIN / f, b / f)
        (b / "pm-emulator-dir").write_text(EMULATOR_DIR)
        (b / "pm-emulator-dir").chmod(0o755)
        (self.root / "keep.txt").write_text("the main checkout\n")
        (self.root / "sub").mkdir()
        (self.root / "sub" / "keep.txt").write_text("a folder of the main checkout\n")
        (self.root / ".gitignore").write_text(".pm/run/\noutput/\n__pycache__/\n")
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "fixture")
        self.merged, self.open = base / "emuforge-1-s1", base / "emuforge-2-s1"
        git(self.root, "worktree", "add", "-q", "-b", "feat/1-s1", str(self.merged))
        git(self.root, "worktree", "add", "-q", "-b", "feat/2-s1", str(self.open))
        (self.open / "work.txt").write_text("unmerged\n")
        git(self.open, "add", "-A")
        git(self.open, "commit", "-q", "-m", "work")
        entries = [("emuforge-1-s1", self.merged, "feat/1-s1", 0), ("emuforge-2-s1", self.open, "feat/2-s1", 1),
                   ("w-main", self.root, "main", 2), ("w-under", self.root / "sub", "main", 3),
                   ("w-above", base, "main", 4)]
        self.registry = [dict(name=n, path=str(p), issue="1", unit="s1", branch=br, base="main", slot=s)
                         for n, p, br, s in entries]
        run = self.root / ".pm" / "run"
        run.mkdir()
        (run / "worktrees.json").write_text(json.dumps(self.registry))
        (run / "ports.json").write_text(json.dumps({str(s): str(p) for _, p, _, s in entries}))

    def rm(self, *args):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "HERDR_"))}
        env["HOME"] = str(self.root.parent / "home")
        return subprocess.run([str(self.root / ".pm" / "bin" / "pm-worktree"), "rm", *args], capture_output=True,
                              text=True, env=env, cwd=str(self.root), timeout=60)

    def names(self):
        return [w["name"] for w in json.loads((self.root / ".pm" / "run" / "worktrees.json").read_text())]

    def branches(self):
        return git(self.root, "branch", "--format=%(refname:short)").split()

    def main_whole(self):
        self.assertEqual((self.root / "keep.txt").read_text(), "the main checkout\n")
        self.assertEqual((self.root / "sub" / "keep.txt").read_text(), "a folder of the main checkout\n")
        self.assertTrue((self.root / ".git").is_dir())

    def test_rm_removes_that_worktree_and_its_merged_branch_only(self):
        r = self.rm("emuforge-1-s1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertFalse(self.merged.exists())
        self.assertNotIn("emuforge-1-s1", self.names())
        self.assertNotIn("0", json.loads((self.root / ".pm" / "run" / "ports.json").read_text()))
        self.assertNotIn("feat/1-s1", self.branches())
        self.assertEqual((self.open / "work.txt").read_text(), "unmerged\n")
        self.assertIn("feat/2-s1", self.branches())
        self.main_whole()

    def test_an_unmerged_branch_is_kept(self):
        r = self.rm("emuforge-2-s1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertFalse(self.open.exists())
        self.assertIn("feat/2-s1", self.branches())
        self.assertIn("is not merged into main; kept", r.stdout)

    def test_a_name_not_registered_removes_nothing(self):
        r = self.rm("emuforge-9-s1")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.names(), [w["name"] for w in self.registry])
        self.assertTrue(self.merged.is_dir() and self.open.is_dir())
        self.main_whole()

    def test_the_main_checkout_its_folders_and_ancestors_are_refused(self):
        for name in ("w-main", "w-under", "w-above"):
            r = self.rm(name)
            self.assertNotEqual(r.returncode, 0, name)
            self.assertIn("refused", r.stderr, name)
        self.assertEqual(self.names(), [w["name"] for w in self.registry])
        self.assertIn("main", self.branches())
        self.assertTrue(self.merged.is_dir() and self.open.is_dir())
        self.main_whole()


if __name__ == "__main__":
    unittest.main()
