"""pm-check --stop during the integration step, and the next pm-check, leave nothing of the run (issue 342).

Check id `harness.check-stop`.

Every case runs on a fixture checkout (`_fixture.make`) on the branch `fixture`, so pm-check cannot read its changes
against `main` and calls every module; of them only integration exists, as a stand-in tests/integration/run. The
checkout is registered in its own `.pm/run/worktrees.json` with its `output/ports.json`, so the fixture's
pm-emulator-dir takes `rm --worktree` for it. Every script runs with HOME=<fixture>/home: the emulator folders are
<fixture>/home/.aws/emulator/<port> and no case touches the real ones.

A stand-in `docker` is first on PATH. It keeps containers, images (each a reference and an id), volumes and networks
in `docker.json` beside itself, answers the calls pm-check's sweep and pm-emulator-dir make, refuses to remove an
image, volume or network in use as Docker does, records each call in `calls.jsonl`, and fails every call when the
state says `fail`. Two calls are its own, for the stand-in run: `_start <id> <port> <check port>` makes what a real
run makes (its emulator container, a check's emulator container, a product form's container, volumes and network,
the three images) and `_clean <id>` removes it, as the run's EXIT trap does.

The stand-in run prints the real run's first line with FIXTURE_RUN_ID, refuses an existing folder as the real run
does, makes the folders of its port and of its check's port, starts its things and, with FIXTURE_WAIT, writes the
marker FIXTURE_MARK and waits in a foreground pipeline. FIXTURE_TRAP `slow` gives it an EXIT trap that takes 15 s
(more than the ten seconds a stopped step had before this issue) and then cleans up; `none` gives it no trap. Without
FIXTURE_WAIT it cleans up and passes.

Ports are free loopback ports the case draws, outside 9297 and the ranges pm-worktree gives.
"""
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import unittest

from _fixture import BIN, clean_env, git, make

sys.path.insert(0, str(BIN))
import _pmitrun  # noqa: E402

TAKEN = {9297, *range(8100, 8200), *range(8300, 8400), *range(9300, 9400)}
OTHER = "1700000000-4242"  # another run, of another worktree, that a sweep never touches

STAND_IN = r'''#!@PYTHON@ -I
"""Stand-in docker for test_check_stop; keeps its state in docker.json beside it and records each call."""
import json, pathlib, sys
here = pathlib.Path(__file__).resolve().parent
state_file = here / "docker.json"
s = json.loads(state_file.read_text())
args = sys.argv[1:]
with open(here / "calls.jsonl", "a") as f:
    f.write(json.dumps(args) + "\n")
if s.get("fail"):
    sys.exit(1)

def save():
    state_file.write_text(json.dumps(s))

def ref(r):
    return r if ":" in r else r + ":latest"

def filters(rest):
    return [rest[i + 1] for i, a in enumerate(rest) if a == "--filter"]

def labelled(labels, f):
    k, _, v = f.partition("=")
    return labels.get(k) == v

def image_id(r):
    return s["images"].get(ref(r))

def matches(c, f):
    kind, _, value = f.partition("=")
    if kind == "label":
        return labelled(c["labels"], value)
    if kind == "ancestor":
        return image_id(value) is not None and image_id(c["image"]) == image_id(value)
    return False

def start(run_id, port, check_port):
    project = f"fxform-{run_id}"
    s["images"].update({f"emuforge-it-product-{run_id}:latest": "sha-product",
                        f"emuforge-it-emulator-{run_id}:latest": "sha-emulator", f"aws-emulator:it-{run_id}": "sha-emulator"})
    s["containers"] += [
        dict(id=f"run{run_id}", name=f"emuforge-it-{port}-{run_id}", image=f"aws-emulator:it-{run_id}",
             labels={"emuforge-it-run": run_id}, mounts=[], ports=[port]),
        dict(id=f"chk{run_id}", name=f"emuforge-it-{check_port}-{run_id}", image=f"aws-emulator:it-{run_id}",
             labels={"emuforge-it-run": run_id}, mounts=[], ports=[check_port]),
        dict(id=f"form{run_id}", name=f"{project}-emulator-1", image=f"emuforge-it-emulator-{run_id}",
             labels={"com.docker.compose.project": project}, mounts=[f"{project}_data"], ports=[])]
    s["volumes"] += [dict(name=f"vol{run_id}", labels={"emuforge-it-run": run_id}),
                     dict(name=f"{project}_data", labels={"com.docker.compose.project": project})]
    s["networks"] += [dict(id=f"net{run_id}", labels={"com.docker.compose.project": project})]

def clean(run_id):
    s["containers"] = [c for c in s["containers"] if run_id not in c["id"]]
    s["volumes"] = [v for v in s["volumes"] if run_id not in v["name"]]
    s["networks"] = [n for n in s["networks"] if run_id not in n["id"]]
    s["images"] = {r: i for r, i in s["images"].items() if run_id not in r}

def inspect(fmt, ids):
    code = 0
    for i in ids:
        c = next((c for c in s["containers"] if c["id"] == i), None)
        if c is None:
            code = 1
            continue
        if "PortBindings" in fmt:
            pb = {f"{p}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(p)}] for p in c["ports"]}
            print(f"/{c['name']} running {json.dumps(pb)}")
        else:
            print("|".join([c["id"], "/" + c["name"], c["image"], c["labels"].get("emuforge-it-run", "<no value>"),
                            c["labels"].get("com.docker.compose.project", "<no value>"),
                            "".join(m + " " for m in c["mounts"])]))
    return code

cmd, rest = args[:1], args[1:]
code = 0
if args[:1] == ["_start"]:
    start(args[1], int(args[2]), int(args[3])); save()
elif args[:1] == ["_clean"]:
    clean(args[1]); save()
elif cmd == ["ps"]:
    for c in s["containers"]:
        if all(matches(c, f) for f in filters(rest)):
            print(c["id"])
elif cmd == ["inspect"]:
    code = inspect(rest[rest.index("-f") + 1], [a for a in rest[rest.index("-f") + 2:]])
elif cmd == ["rm"]:
    ids = [a for a in rest if not a.startswith("-")]
    s["containers"] = [c for c in s["containers"] if c["id"] not in ids]; save()
elif args[:2] == ["volume", "ls"]:
    for v in s["volumes"]:
        if all(labelled(v["labels"], f.partition("=")[2]) for f in filters(rest[1:])):
            print(v["name"])
elif args[:2] == ["volume", "rm"]:
    name = args[2]
    if any(name in c["mounts"] for c in s["containers"]):
        code = 1
    else:
        s["volumes"] = [v for v in s["volumes"] if v["name"] != name]; save()
elif args[:2] == ["network", "ls"]:
    for n in s["networks"]:
        if all(labelled(n["labels"], f.partition("=")[2]) for f in filters(rest[1:])):
            print(n["id"])
elif args[:2] == ["network", "rm"]:
    n = next((n for n in s["networks"] if n["id"] == args[2]), None)
    project = (n or {}).get("labels", {}).get("com.docker.compose.project")
    if n is None or any(c["labels"].get("com.docker.compose.project") == project for c in s["containers"]):
        code = 1
    else:
        s["networks"].remove(n); save()
elif args[:2] == ["image", "ls"]:
    wanted = {ref(f.partition("=")[2]) for f in filters(rest[1:])}
    for r in s["images"]:
        if r in wanted:
            print(r)
elif args[:2] == ["image", "rm"]:
    for r in args[2:]:
        if ref(r) not in s["images"] or any(ref(c["image"]) == ref(r) for c in s["containers"]):
            code = 1
        else:
            del s["images"][ref(r)]
    save()
else:
    code = 1
sys.exit(code)
'''

RUN = r'''#!/usr/bin/env bash
set -uo pipefail
run_id="$FIXTURE_RUN_ID"
echo "integration: run $run_id, emulator port $EMULATOR_PORT, engine port $EMUFORGE_ENGINE_PORT, studio port x" >&2
emulator_dir="$HOME/.aws/emulator/$EMULATOR_PORT"
check_dir="$HOME/.aws/emulator/$FIXTURE_CHECK_PORT"
if [[ -e "$emulator_dir" ]]; then
  echo "integration: $emulator_dir already exists; a leftover would be mistaken for this run's files" >&2
  exit 2
fi
mkdir -p "$emulator_dir" "$check_dir"
echo fixture >"$emulator_dir/key.pem"
docker _start "$run_id" "$EMULATOR_PORT" "$FIXTURE_CHECK_PORT"
clean() { docker _clean "$run_id"; rm -rf "$emulator_dir" "$check_dir"; }
if [[ "${FIXTURE_TRAP:-}" == slow ]]; then
  trap 'sleep 15; clean; echo end >"$FIXTURE_MARK.end"' EXIT
fi
if [[ -n "${FIXTURE_WAIT:-}" ]]; then
  touch "$FIXTURE_MARK"
  sleep 300 | cat
fi
clean
trap - EXIT
exit 0
'''


def free_ports(n):
    """`n` distinct free loopback ports outside the owner's and pm-worktree's."""
    out = []
    while len(out) < n:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            p = s.getsockname()[1]
        if p not in TAKEN and p not in out:
            out.append(p)
    return out


class Fixture:
    """A registered fixture checkout with its stand-in docker and run, and its own HOME."""

    def __init__(self, case):
        self.co = make("check-stop", case, ["pm-check", "pm-emulator-dir"], {"tests/integration/run": RUN})
        git(self.co, "branch", "-m", "main", "fixture")
        self.port, self.check_port, self.other_port, studio, engine = free_ports(5)
        (self.co / "output").mkdir(exist_ok=True)
        (self.co / "output" / "ports.json").write_text(
            json.dumps(dict(studio=studio, engine=engine, emulator=self.port)))
        run_dir = self.co / ".pm" / "run"
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "worktrees.json").write_text(
            json.dumps([dict(name=f"fx-{case}", path=str(self.co), ports=dict(emulator=self.port))]))
        self.home = self.co / "home"
        self.emu = self.home / ".aws" / "emulator"
        self.emu.mkdir(parents=True)
        self.bin = self.home / "bin"
        self.bin.mkdir()
        (self.bin / "docker").write_text(STAND_IN.replace("@PYTHON@", sys.executable))
        (self.bin / "docker").chmod(0o755)
        self.mark = self.co / "output" / "started"
        self.state = dict(containers=[], images={}, volumes=[], networks=[])
        self.other()
        self.save()

    def other(self):
        """Another run's things: its emulator image shares this run's image id (a build cache hit), so a container
        found by image is held to the name it was created under. Its folder is another port's."""
        self.state["images"].update({f"emuforge-it-emulator-{OTHER}:latest": "sha-emulator",
                                     f"aws-emulator:it-{OTHER}": "sha-emulator"})
        self.state["containers"] += [
            dict(id="otherrun", name=f"emuforge-it-{self.other_port}-{OTHER}", image=f"aws-emulator:it-{OTHER}",
                 labels={"emuforge-it-run": OTHER}, mounts=[], ports=[self.other_port]),
            dict(id="otherform", name=f"fxform-{OTHER}-emulator-1", image=f"emuforge-it-emulator-{OTHER}",
                 labels={"com.docker.compose.project": f"fxform-{OTHER}"}, mounts=[], ports=[])]
        (self.emu / str(self.other_port)).mkdir()

    def save(self):
        (self.bin / "docker.json").write_text(json.dumps(self.state))

    def load(self):
        return json.loads((self.bin / "docker.json").read_text())

    def env(self, run_id, **extra):
        env = {k: v for k, v in clean_env().items() if not k.startswith("HERDR")}
        env.update(HOME=str(self.home), PATH=f"{self.bin}{os.pathsep}{env['PATH']}", FIXTURE_RUN_ID=run_id,
                   FIXTURE_CHECK_PORT=str(self.check_port), FIXTURE_MARK=str(self.mark), **extra)
        return env

    def pm_check(self, run_id, *args, **extra):
        return subprocess.run([str(self.co / ".pm" / "bin" / "pm-check"), str(self.co), *args], capture_output=True,
                              text=True, env=self.env(run_id, **extra), cwd=str(self.co), timeout=300)

    def start(self, run_id, **extra):
        """A pm-check started in the background, returned once its run waits in its checks."""
        p = subprocess.Popen([str(self.co / ".pm" / "bin" / "pm-check"), str(self.co)], stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, env=self.env(run_id, FIXTURE_WAIT="1", **extra),
                             cwd=str(self.co))
        end = time.time() + 120
        while not self.mark.exists():
            if p.poll() is not None or time.time() > end:
                p.kill()
                raise AssertionError(f"the run did not reach its checks: {p.communicate()[0]}")
            time.sleep(0.1)
        return p

    def stop(self, run_id):
        return self.pm_check(run_id, "--stop")

    def calls(self):
        f = self.bin / "calls.jsonl"
        return [json.loads(ln) for ln in f.read_text().splitlines()] if f.exists() else []

    def events(self):
        f = self.co / ".pm" / "run" / "events.log"
        return f.read_text() if f.exists() else ""

    def swept(self):
        f = self.co / "output" / "checks" / "swept.json"
        return {r["id"] for r in json.loads(f.read_text())["runs"]} if f.exists() else set()

    def log_run(self, run_id):
        """An earlier run's log naming `run_id`, as tests/integration/run's first line does."""
        logs = self.co / "output" / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        (logs / "check-integration.log").write_text(
            f"integration: run {run_id}, emulator port {self.port}, engine port 1, studio port 2\nmore\n")


def left_of(state, run_id):
    """What of run `run_id` the stand-in still holds."""
    return dict(containers=[c["name"] for c in state["containers"] if run_id in c["id"]],
                images=[r for r in state["images"] if run_id in r],
                volumes=[v["name"] for v in state["volumes"] if run_id in v["name"]],
                networks=[n["id"] for n in state["networks"] if run_id in n["id"]])


NOTHING = dict(containers=[], images=[], volumes=[], networks=[])


class Stop(unittest.TestCase):
    def assert_other_untouched(self, fx):
        st = fx.load()
        self.assertEqual(sorted(c["id"] for c in st["containers"] if OTHER in c["name"]), ["otherform", "otherrun"])
        self.assertIn(f"emuforge-it-emulator-{OTHER}:latest", st["images"])
        self.assertIn(f"aws-emulator:it-{OTHER}", st["images"])
        self.assertTrue((fx.emu / str(fx.other_port)).is_dir())

    def test_a_slow_trap_is_given_its_time(self):
        fx = Fixture("slow-trap")
        run_id = "1800000001-101"
        p = fx.start(run_id, FIXTURE_TRAP="slow")
        s = fx.stop(run_id)
        out = p.communicate(timeout=60)[0]
        self.assertEqual(s.returncode, 0, s.stdout + s.stderr)
        self.assertIn("(step integration)", s.stdout)
        self.assertTrue(pathlib.Path(str(fx.mark) + ".end").exists(), "the run's EXIT trap was cut short\n" + out)
        self.assertEqual(left_of(fx.load(), run_id), NOTHING)
        self.assertFalse((fx.emu / str(fx.port)).exists())
        self.assertFalse((fx.emu / str(fx.check_port)).exists())
        self.assertIn(f"integration: nothing of run {run_id} was left", s.stdout)
        self.assert_other_untouched(fx)

    def test_what_the_run_left_is_swept(self):
        fx = Fixture("no-trap")
        run_id = "1800000002-102"
        p = fx.start(run_id, FIXTURE_TRAP="none")
        before = left_of(fx.load(), run_id)
        self.assertEqual(len(before["containers"]), 3, before)
        s = fx.stop(run_id)
        out = p.communicate(timeout=60)[0]
        self.assertEqual(s.returncode, 0, s.stdout + s.stderr)
        self.assertEqual(left_of(fx.load(), run_id), NOTHING, out)
        self.assertFalse((fx.emu / str(fx.port)).exists(), out)
        self.assertFalse((fx.emu / str(fx.check_port)).exists(), out)
        events = fx.events()
        self.assertIn(f"emulator-dir rm worktree fx-no-trap port {fx.port} removed", events)
        self.assertIn(f"emulator-dir rm port {fx.check_port} removed", events)
        self.assertIn(f"integration: leftovers of run {run_id} removed:", s.stdout)
        self.assertIn(f"container emuforge-it-{fx.port}-{run_id}", s.stdout)
        self.assertIn(f"image aws-emulator:it-{run_id}", s.stdout)
        self.assertIn(run_id, fx.swept())
        self.assert_other_untouched(fx)


class NextCheck(unittest.TestCase):
    def leftover(self, fx, run_id):
        fx.log_run(run_id)
        subprocess.run([str(fx.bin / "docker"), "_start", run_id, str(fx.port), str(fx.check_port)], check=True)
        (fx.emu / str(fx.port)).mkdir()
        (fx.emu / str(fx.check_port)).mkdir()

    def test_an_earlier_stopped_run_is_swept_before_the_steps(self):
        fx = Fixture("next")
        old, new, third = "1800000003-103", "1800000003-104", "1800000003-105"
        self.leftover(fx, old)
        p = fx.pm_check(new)
        self.assertIn(f"integration: leftovers of run {old} removed:", p.stdout, p.stdout + p.stderr)
        rec = json.loads((fx.co / "output" / "checks" / "last.json").read_text())
        step = next(s for s in rec["steps"] if s["name"] == "integration")
        self.assertEqual(step["status"], "passed", p.stdout + p.stderr)
        self.assertEqual(left_of(fx.load(), old), NOTHING)
        self.assertEqual(left_of(fx.load(), new), NOTHING)
        self.assertEqual(fx.swept(), {old, new})
        self.assertTrue(rec["passed"], p.stdout + p.stderr)
        n = len(fx.calls())
        fx.pm_check(third)
        self.assertFalse([c for c in fx.calls()[n:] if any(old in a or new in a for a in c)],
                         "a recorded sweep was asked again")
        Stop.assert_other_untouched(self, fx)

    def test_a_live_run_of_the_checkout_is_not_swept(self):
        fx = Fixture("live")
        old = "1800000004-106"
        self.leftover(fx, old)
        holder = subprocess.Popen(["sleep", "60"])
        try:
            (fx.co / "output" / "checks").mkdir(parents=True, exist_ok=True)
            (fx.co / "output" / "checks" / "running.json").write_text(
                json.dumps(dict(pm_check_pid=holder.pid, pgid=holder.pid, step="integration")))
            fx.pm_check("1800000004-107", "--only", "harness")
        finally:
            holder.kill()
            holder.wait()
        self.assertEqual(len(left_of(fx.load(), old)["containers"]), 3)
        self.assertTrue((fx.emu / str(fx.port)).is_dir())
        self.assertFalse([c for c in fx.calls() if c[:1] != ["_start"] and any(old in a for a in c)])

    def test_docker_not_answering_is_said_and_not_recorded(self):
        fx = Fixture("no-docker")
        old = "1800000005-108"
        self.leftover(fx, old)
        st = fx.load()
        st["fail"] = True
        fx.state = st
        fx.save()
        p = fx.pm_check("1800000005-109", "--only", "harness")
        self.assertIn(f"integration: leftovers of run {old} not swept: docker", p.stdout, p.stdout + p.stderr)
        self.assertIn("NOT PASSED", p.stdout)  # --only is partial: pm-check went on to its end
        self.assertEqual(fx.swept(), set())
        self.assertTrue((fx.emu / str(fx.port)).is_dir())


class RunOf(unittest.TestCase):
    def check(self, text):
        d = pathlib.Path(BIN).parents[1] / "output" / "tests" / "check-stop"
        d.mkdir(parents=True, exist_ok=True)
        f = d / "run-of.log"
        f.write_text(text)
        return _pmitrun.run_of(f)

    def test_the_run_line(self):
        self.assertEqual(self.check("x\nintegration: run 1795060626-27661, emulator port 9319, engine port 8319,\n"),
                         ("1795060626-27661", 9319))

    def test_no_run(self):
        for text in ("", "integration: run abc-1, emulator port 9319,\n",
                     "integration: run 1-1, emulator port 70000,\n", "  integration: run 1-1, emulator port 9319,\n",
                     "integration: run 1-1/../x, emulator port 9319,\n"):
            self.assertIsNone(self.check(text), text)
        self.assertIsNone(_pmitrun.run_of(pathlib.Path("/nonexistent/check-integration.log")))


if __name__ == "__main__":
    unittest.main()
