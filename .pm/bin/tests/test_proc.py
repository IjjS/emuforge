"""_pmproc: the child environment allowlist and the one way the tool starts a child process (design 2.4, D6 P1 P2).

Interface used: `_pmproc.child_env()` returns a dict; `_pmproc.run(cmd, timeout=..., cwd=...)` runs an argument
list without a shell and returns a `subprocess.CompletedProcess` with text `stdout`, or raises a timeout error
(an exception whose type is or derives from `subprocess.TimeoutExpired` or `TimeoutError`) after killing the
child. The children are `/usr/bin/env` and `/bin/sh`, which add no variable of their own to what they print.
"""
import os
import pathlib
import shutil
import subprocess
import time
import unittest
from unittest import mock

try:
    import _pmproc
except ImportError as e:  # every case fails on its own when the module does not exist
    _pmproc, IMPORT_ERROR = None, e

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
WORK = CHECKOUT / "output" / "tests" / f"proc-{os.getpid()}"

SCRUBBED = ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_CONFIG_FILE",
            "AWS_SHARED_CREDENTIALS_FILE", "AWS_ENDPOINT_URL", "AWS_DEFAULT_PROFILE", "AWS_ROLE_ARN",
            "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_REGION"]
CALLER = {**{k: f"caller-value-of-{k.lower()}" for k in SCRUBBED}, "FOO": "foo-value",
          "PATH": os.environ.get("PATH", "/usr/bin:/bin")}


class ProcCase(unittest.TestCase):
    def setUp(self):
        if _pmproc is None:
            self.fail(f"_pmproc cannot be imported: {IMPORT_ERROR}")
        WORK.mkdir(parents=True, exist_ok=True)
        self.addCleanup(shutil.rmtree, WORK, True)


class ChildEnv(ProcCase):
    def test_allowlist(self):
        with mock.patch.dict(os.environ, CALLER, clear=True):
            env = _pmproc.child_env()
        self.assertEqual(env.get("PATH"), CALLER["PATH"])
        self.assertEqual(env.get("AWS_EC2_METADATA_DISABLED"), "true")
        self.assertEqual([k for k in env if k.startswith("AWS_") and k != "AWS_EC2_METADATA_DISABLED"], [])
        self.assertNotIn("FOO", env)
        for value in CALLER.values():
            if value != CALLER["PATH"]:
                self.assertNotIn(value, env.values())


class Run(ProcCase):
    def test_child_sees_exactly_child_env(self):
        with mock.patch.dict(os.environ, CALLER, clear=True):
            expected = _pmproc.child_env()
            p = _pmproc.run(["/usr/bin/env", "-0"], timeout=10, cwd=str(WORK))
        printed = dict(entry.split("=", 1) for entry in p.stdout.split("\0") if entry)
        self.assertEqual(printed, expected)

    def test_timeout_kills_the_child(self):
        pidfile = WORK / "child.pid"
        script = f'echo $$ > "{pidfile}"; exec sleep 30'
        started = time.monotonic()
        with self.assertRaises((subprocess.TimeoutExpired, TimeoutError)):
            _pmproc.run(["/bin/sh", "-c", script], timeout=1, cwd=str(WORK))
        self.assertLess(time.monotonic() - started, 20)
        pid = int(pidfile.read_text())
        with self.assertRaises(ProcessLookupError, msg=f"child {pid} still runs after the timeout"):
            os.kill(pid, 0)

    def test_shell_metacharacters_are_literal(self):
        marker = WORK / "injected"
        arg = f"a; touch {marker}; echo $(touch {marker}) `touch {marker}` | cat && echo b"
        p = _pmproc.run(["/bin/sh", "-c", 'printf "%s" "$1"', "sh", arg], timeout=10, cwd=str(WORK))
        self.assertEqual(p.stdout, arg)
        self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
