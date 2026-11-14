"""Child processes of pm-structure: the environment allowlist and the one way a child is started. Not a command.

Every child of the tool (git, node with Playwright, the browser it launches) is started by `run`: an argument
list, never a shell, the environment from `child_env` and a timeout after which the child's whole process group
is killed. No AWS_* variable of the caller can pass (requirement 7, design 2.4).
"""
import os
import signal
import subprocess

# the only variables copied from the caller's environment
ALLOW = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER", "PLAYWRIGHT_BROWSERS_PATH", "NODE_PATH")


def child_env():
    """The environment of every child: the allowlist, plus AWS_EC2_METADATA_DISABLED=true."""
    env = {k: os.environ[k] for k in ALLOW if k in os.environ}
    env["AWS_EC2_METADATA_DISABLED"] = "true"
    return env


def run(cmd, timeout, cwd=None):
    """Run `cmd` (a list of strings) without a shell; return a CompletedProcess with text stdout and stderr.

    On timeout the child's process group is killed and subprocess.TimeoutExpired is raised.
    """
    if not isinstance(cmd, (list, tuple)) or not cmd or not all(isinstance(c, str) for c in cmd):
        raise TypeError("cmd must be a non-empty list of strings")
    with subprocess.Popen(list(cmd), cwd=cwd, env=child_env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True, errors="replace", start_new_session=True) as p:
        try:
            out, err = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            p.communicate()
            raise
        return subprocess.CompletedProcess(p.args, p.returncode, out, err)
