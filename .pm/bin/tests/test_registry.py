"""Every pane stays in the registry when several processes open and close panes at the same moment (issue 504).

- Update: `_pmlib.update` from many processes at once on one file loses no change and leaves no temp file.
- PanesAtOnce: `pm-pane new` from several processes at once, with a `pm-pane close` among them, on a fixture checkout
  with a stand-in herdr whose `agent start` takes half a second: the registry holds every new pane in its own pane
  and not the closed one, and pm.json's session_issues holds every issue. `--adopt` records the brief, sends none.
- Waiting, Slots: waiting.json rows (pm-pane's QUEUE, pm-check's WAIT) and pm-worktree's port slots taken from
  several processes at once: every row kept, no slot given twice.
- Unregistered: pm-watchd's judgement `unregistered` (run on the fixture's copy, its `main()` left out) and
  `_pmlib.pane_ops`; the daemon calls them on every look; the daemon's lifetime lock.
- Texts: the daemon's docstring and the pm's Events table name `EVENT unregistered`.
"""
import ast
import fcntl
import json
import os
import subprocess
import sys
import unittest

from _fixture import CHECKOUT, clean_env, make

GROUP = "registry"
PY = sys.executable

# A stand-in herdr: tabs #1..#99 (T<n>), one shell pane A<n> in each, the panes a split made (one per calling pm-pane,
# remembered as files under $HERDR_STATE/panes/), the pane C7 of a registered pane; `agent start` takes 0.5 s; the
# agents are $HERDR_AGENTS (JSON). Every call is appended to $HERDR_STATE/calls.jsonl.
HERDR = r'''#!/usr/bin/env -S python3 -I
import json, os, sys, time
args = sys.argv[1:]
state = os.environ["HERDR_STATE"]
with open(os.path.join(state, "calls.jsonl"), "a") as f:
    f.write(json.dumps(args) + "\n")
made = os.path.join(state, "panes")
agents = json.loads(os.environ.get("HERDR_AGENTS", "[]"))
if args[:2] == ["tab", "list"]:
    out = {"tabs": [{"tab_id": f"T{n}", "label": f"#{n}"} for n in range(1, 100)]}
elif args[:2] == ["pane", "list"]:
    out = {"panes": [{"pane_id": f"A{n}", "tab_id": f"T{n}"} for n in range(1, 100)]
           + [{"pane_id": "C7", "tab_id": "T7"}]
           + [{"pane_id": p, "tab_id": "T1"} for p in sorted(os.listdir(made))]
           + [{"pane_id": a["pane_id"], "tab_id": a.get("tab_id"), "agent": a.get("agent")} for a in agents]}
elif args[:2] == ["pane", "split"]:
    pid = f"S{os.getppid()}"
    open(os.path.join(made, pid), "w").close()
    out = {"pane": {"pane_id": pid}}
elif args[:2] == ["agent", "start"]:
    time.sleep(0.5)
    out = {"agent": {"name": args[2]}}
elif args[:2] == ["agent", "list"]:
    out = {"agents": agents}
else:
    out = {}
print(json.dumps({"result": out}))
'''


class Case(unittest.TestCase):
    scripts = ()

    def fixture(self, case):
        self.co = make(GROUP, case, self.scripts)
        self.bin = self.co / ".pm" / "bin"
        self.run_dir = self.co / ".pm" / "run"
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.state = self.co / "output" / "herdr"
        (self.state / "panes").mkdir(parents=True)
        stub = self.co / "output" / "stub-bin"
        stub.mkdir(parents=True)
        (stub / "herdr").write_text(HERDR)
        (stub / "herdr").chmod(0o755)
        self.stub = stub

    def env(self, agents=()):
        env = clean_env()
        for k in ("HERDR_PANE_ID", "HERDR_WORKSPACE_ID", "HERDR_SOCKET_PATH"):
            env.pop(k, None)
        env["PATH"] = f"{self.stub}{os.pathsep}{env['PATH']}"
        env["HOME"] = str(self.co / "home")
        env["HERDR_STATE"] = str(self.state)
        env["HERDR_AGENTS"] = json.dumps(list(agents))
        return env

    def at_once(self, cmds, env=None, timeout=120):
        """Start every command (an argument list) at once; wait for all; [(returncode, stdout, stderr)]."""
        procs = [subprocess.Popen(c, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=str(self.co),
                                  env=env or self.env()) for c in cmds]
        out = []
        for p in procs:
            o, e = p.communicate(timeout=timeout)
            out.append((p.returncode, o, e))
        return out

    def py(self, code, *args):
        """An argument list running `code` with the fixture's .pm/bin first on sys.path."""
        return [PY, "-I", "-c", f"import sys; sys.path.insert(0, {str(self.bin)!r})\n{code}", *map(str, args)]

    def read(self, name):
        return json.loads((self.run_dir / name).read_text())


class Update(Case):
    def test_writers_at_once_lose_nothing(self):
        self.fixture("update")
        code = ("from _pmlib import RUN, update\n"
                "for i in range(25):\n"
                "    with update(RUN / 'rows.json', []) as rows:\n"
                "        rows.append(f'{sys.argv[1]}-{i}')\n")
        for rc, out, err in self.at_once([self.py(code, k) for k in range(12)]):
            self.assertEqual(rc, 0, err)
        rows = self.read("rows.json")
        self.assertEqual(sorted(rows), sorted(f"{k}-{i}" for k in range(12) for i in range(25)))
        self.assertEqual([f.name for f in self.run_dir.iterdir() if f.name.endswith(".tmp")], [])

    def test_a_block_that_raises_saves_nothing(self):
        self.fixture("update-raises")
        (self.run_dir / "rows.json").write_text('["a"]')
        code = ("from _pmlib import RUN, update\n"
                "try:\n"
                "    with update(RUN / 'rows.json', []) as rows:\n"
                "        rows.append('b')\n"
                "        raise ValueError\n"
                "except ValueError:\n"
                "    pass\n")
        rc, _, err = self.at_once([self.py(code)])[0]
        self.assertEqual(rc, 0, err)
        self.assertEqual(self.read("rows.json"), ["a"])


class PanesAtOnce(Case):
    scripts = ("pm-pane",)

    def test_panes_opened_and_closed_at_once_are_all_in_the_registry(self):
        self.fixture("panes-at-once")
        closed = dict(name="i7-worker-s9", issue="7", role="worker", unit="s9", kind="claude", side="studio",
                      pane_id="C7", tab_id="T7", cwd="/nonexistent-504", gone=False)
        (self.run_dir / "panes.json").write_text(json.dumps([closed]))
        (self.run_dir / "pm.json").write_text(json.dumps(dict(pm_pane="PM0", pm_session="S0")))
        pane = str(self.bin / "pm-pane")
        news = [[pane, "new", str(n), "worker", "--unit", f"s{n}", "--no-limit"] for n in range(11, 17)]
        results = self.at_once(news + [[pane, "close", "i7-worker-s9"]])
        for rc, out, err in results:
            self.assertEqual(rc, 0, f"{out}\n{err}")
        reg = self.read("panes.json")
        names = {r["name"]: r for r in reg}
        self.assertEqual(sorted(names), sorted(f"i{n}-worker-s{n}" for n in range(11, 17)), reg)
        self.assertTrue(all(r["pane_id"].startswith("S") and not r.get("gone") for r in reg), reg)
        self.assertEqual(len({r["pane_id"] for r in reg}), 6, reg)
        self.assertEqual(sorted(self.read("pm.json")["session_issues"]["S0"]), [str(n) for n in range(11, 17)])
        ops = self.run_dir / "pane-ops"
        self.assertEqual(list(ops.iterdir()) if ops.exists() else [], [])

    def test_adopt_records_the_brief_and_sends_none(self):
        self.fixture("adopt")
        cwd = str(self.co)
        brief = self.co / "brief.md"
        brief.write_text("brief\n")
        agent = dict(name="i9-worker-s1", pane_id="L1", tab_id="T9", cwd=cwd, agent="claude", agent_status="working")
        rc, out, err = self.at_once([[str(self.bin / "pm-pane"), "new", "9", "worker", "--unit", "s1", "--cwd", cwd,
                                      "--brief", str(brief), "--adopt", "--no-limit"]], env=self.env([agent]))[0]
        self.assertEqual(rc, 0, f"{out}\n{err}")
        self.assertIn("brief recorded, not sent", out)
        calls = [json.loads(ln) for ln in (self.state / "calls.jsonl").read_text().splitlines()]
        self.assertFalse([c for c in calls if c[:2] in (["agent", "prompt"], ["agent", "start"])], calls)
        entry = next(r for r in self.read("panes.json") if r["name"] == "i9-worker-s1")
        self.assertEqual((entry["pane_id"], entry["brief"]), ("L1", str(brief)))


class Waiting(Case):
    def test_rows_written_at_once_are_all_kept(self):
        self.fixture("waiting")
        code = ("from _pmlib import wait_for_check_room, wait_for_room\n"
                "k = sys.argv[1]\n"
                "wait_for_room(f'i{k}-plan', 'worker', 'engine', k, 'full')\n"
                "wait_for_check_room(f'i{k}-worker-e1', f'/wt/{k}', k, 'busy', 60)\n")
        for rc, out, err in self.at_once([self.py(code, k) for k in range(10)]):
            self.assertEqual(rc, 0, err)
        rows = self.read("waiting.json")
        self.assertEqual(sorted(w["asker"] for w in rows if "role" in w), sorted(f"i{k}-plan" for k in range(10)))
        self.assertEqual(sorted(w["check"] for w in rows if "check" in w), sorted(f"/wt/{k}" for k in range(10)))


class Slots(Case):
    scripts = ("pm-worktree",)

    def test_slots_taken_at_once_are_distinct(self):
        self.fixture("slots")
        code = ("p = sys.argv[1]\n"
                "src = open(p).read().split('\\np = argparse.ArgumentParser(', 1)[0]\n"
                "ns = {'__file__': p, '__name__': 'worktree'}\n"
                "exec(compile(src, p, 'exec'), ns)\n"
                "print(ns['alloc_slot'](f'/wt/{sys.argv[2]}'))\n")
        results = self.at_once([self.py(code, self.bin / "pm-worktree", k) for k in range(10)])
        for rc, out, err in results:
            self.assertEqual(rc, 0, err)
        slots = [int(out.strip().splitlines()[-1]) for _, out, _ in results]
        self.assertEqual(sorted(slots), list(range(10)))
        self.assertEqual(sorted(self.read("ports.json").values()), sorted(f"/wt/{k}" for k in range(10)))


# runs the fixture's pm-watchd without its main(); steps: [[agents, registry, ops]]; prints the events of each step,
# with one `told` kept across the steps
JUDGE = """
import json, sys
p = sys.argv[1]
src = open(p).read().rsplit("\\nmain()", 1)[0]
ns = {"__file__": p, "__name__": "watchd"}
exec(compile(src, p, "exec"), ns)
told = {}
print(json.dumps([ns["unregistered"](ags, reg, set(ops), told, root=sys.argv[3]) for ags, reg, ops in json.loads(sys.argv[2])]))
"""


class Unregistered(Case):
    scripts = ("pm-watchd",)

    @classmethod
    def setUpClass(cls):
        cls.co_ = make(GROUP, "unregistered", ("pm-watchd",))

    def judge(self, *steps, root="/r/emuforge"):
        p = subprocess.run([PY, "-I", "-c", JUDGE, str(self.co_ / ".pm" / "bin" / "pm-watchd"), json.dumps(steps), root],
                           capture_output=True, text=True, env=clean_env(), timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout.strip().splitlines()[-1])

    @staticmethod
    def ag(name, pane, cwd="/r/emuforge-7-s1"):
        return dict(name=name, pane_id=pane, cwd=cwd, agent="claude")

    @staticmethod
    def reg(name, pane, gone=False):
        return dict(name=name, pane_id=pane, gone=gone)

    def test_a_lost_pane_is_told_once_with_its_pane_id(self):
        a = [self.ag("i7-worker-s1", "P1")]
        self.assertEqual(self.judge([a, [], []], [a, [], []]), [["EVENT unregistered i7-worker-s1 P1"], []])

    def test_a_registered_pane_is_not_told_and_one_held_in_another_pane_is(self):
        a = [self.ag("i7-worker-s1", "P1"), self.ag("i7-plan", "P2", cwd="/r/emuforge")]
        out = self.judge([a, [self.reg("i7-worker-s1", "P1"), self.reg("i7-plan", "P9")], []])
        self.assertEqual(out, [["EVENT unregistered i7-plan P2"]])
        out = self.judge([a, [self.reg("i7-worker-s1", "P1", gone=True), self.reg("i7-plan", "P2")], []])
        self.assertEqual(out, [["EVENT unregistered i7-worker-s1 P1"]])

    def test_a_pane_that_pm_pane_opens_now_is_not_told_until_it_ends(self):
        a = [self.ag("i7-worker-s1", "P1")]
        self.assertEqual(self.judge([a, [], ["i7-worker-s1"]], [a, [], []]),
                         [[], ["EVENT unregistered i7-worker-s1 P1"]])

    def test_other_names_and_other_folders_are_never_told(self):
        a = [self.ag("pm", "P1"), self.ag("foo", "P2"), self.ag("i7-builder", "P3"), self.ag("i7-plan", "P4", cwd="/elsewhere"),
             self.ag("i7-plan", "P5", cwd="/r/emuforgex"), dict(pane_id="P6", cwd="/r/emuforge")]
        self.assertEqual(self.judge([a, [], []]), [[]])

    def test_a_pane_lost_again_after_it_was_registered_is_told_again(self):
        a = [self.ag("i7-rev", "P1", cwd="/r/emuforge")]
        out = self.judge([a, [], []], [a, [self.reg("i7-rev", "P1")], []], [a, [], []], [[], [], []], [a, [], []])
        self.assertEqual(out, [["EVENT unregistered i7-rev P1"], [], ["EVENT unregistered i7-rev P1"], [],
                               ["EVENT unregistered i7-rev P1"]])

    def test_the_daemon_looks_on_every_tick(self):
        tree = ast.parse((CHECKOUT / ".pm" / "bin" / "pm-watchd").read_text())
        run = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run")
        called = {n.func.id for n in ast.walk(run) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
        self.assertTrue({"unregistered", "pane_ops"} <= called, called)


class PaneOps(Case):
    def test_a_live_pm_pane_holds_its_mark_and_a_dead_one_does_not(self):
        self.fixture("pane-ops")
        ops = self.run_dir / "pane-ops"
        ops.mkdir()
        fake = self.co / "output" / "fake" / "pm-pane"
        fake.parent.mkdir(parents=True)
        fake.write_text("#!/usr/bin/env -S python3 -I\nimport time\ntime.sleep(60)\n")
        fake.chmod(0o755)
        live = subprocess.Popen([str(fake)])
        dead = subprocess.Popen([PY, "-I", "-c", "pass"])
        dead.wait()
        other = subprocess.Popen([PY, "-I", "-c", "import time; time.sleep(60)"])
        try:
            (ops / "i7-plan").write_text(str(live.pid))
            (ops / "i7-rev").write_text(str(dead.pid))
            (ops / "i7-worker-s1").write_text(str(other.pid))
            rc, out, err = self.at_once([self.py("from _pmlib import pane_ops\nprint(sorted(pane_ops()))")])[0]
            self.assertEqual(rc, 0, err)
            self.assertEqual(out.strip(), "['i7-plan']")
            self.assertEqual(sorted(f.name for f in ops.iterdir()), ["i7-plan"])
        finally:
            for p in (live, other):
                p.kill()
                p.wait()

    def test_the_mark_goes_when_the_block_ends_however_it_ends(self):
        self.fixture("pane-op")
        code = ("from _pmlib import PANE_OPS, pane_op\n"
                "try:\n"
                "    with pane_op('i7-plan'):\n"
                "        print(sorted(f.name for f in PANE_OPS.iterdir()))\n"
                "        sys.exit('refused')\n"
                "finally:\n"
                "    print(sorted(f.name for f in PANE_OPS.iterdir()))\n")
        rc, out, err = self.at_once([self.py(code)])[0]
        self.assertEqual((rc, out.split()), (1, ["['i7-plan']", "[]"]), err)


LOCK_CODE = """
import json, sys
p = sys.argv[1]
src = open(p).read().rsplit("\\nmain()", 1)[0]
ns = {"__file__": p, "__name__": "watchd"}
exec(compile(src, p, "exec"), ns)
print(ns["hold_lock"](float(sys.argv[2])) is not None)
"""


class DaemonLock(Case):
    scripts = ("pm-watchd",)

    def hold(self, wait):
        p = subprocess.run([PY, "-I", "-c", LOCK_CODE, str(self.bin / "pm-watchd"), str(wait)], capture_output=True,
                           text=True, env=clean_env(), timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip() == "True"

    def test_one_daemon_at_a_time(self):
        self.fixture("daemon-lock")
        with open(self.run_dir / "watchd.lock", "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            self.assertFalse(self.hold(0.5))
            fcntl.flock(f, fcntl.LOCK_UN)
        self.assertTrue(self.hold(0.5))

    def test_run_takes_the_lock_before_it_runs(self):
        text = (CHECKOUT / ".pm" / "bin" / "pm-watchd").read_text()
        main = text[text.index("def main():"):]
        branch = main[main.index('if a.cmd == "run":'):]
        self.assertLess(branch.index("hold_lock()"), branch.index("run(a)"))
        self.assertIn("another pm-watchd holds watchd.lock; exiting", branch)


class Texts(unittest.TestCase):
    def test_the_daemon_and_the_pm_name_the_event(self):
        doc = ast.get_docstring(ast.parse((CHECKOUT / ".pm" / "bin" / "pm-watchd").read_text())) or ""
        self.assertIn("EVENT unregistered <pane> <pane id>", doc)
        skill = (CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md").read_text()
        row = next((ln for ln in skill.splitlines() if ln.startswith("| `EVENT unregistered <pane> <pane id>`")), None)
        self.assertIsNotNone(row, "SKILL.md has no Events row for EVENT unregistered")
        self.assertIn("--adopt", row)

    def test_pm_pane_says_adopt_sends_no_brief(self):
        doc = ast.get_docstring(ast.parse((CHECKOUT / ".pm" / "bin" / "pm-pane").read_text())) or ""
        self.assertIn("its --brief is recorded and not sent", doc)


if __name__ == "__main__":
    unittest.main()
