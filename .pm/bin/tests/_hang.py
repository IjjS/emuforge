"""The sampler of a pm-structure run that passed its bound in test_terminate.py (issue 37). Not a test.

`sample(proc, name, text, recorded=None)` is called where a case gives up on a run that is still unreaped, before
the case kills it. It runs `PS` once and writes `LOGS/hang-<name>-<pid>.ps`: `text`, the header, the lines of the
run and of every process that descends from it, the line `recorded, no longer descendants:` and the line of each
PID of `recorded` ({pid: command}) that `ps` still lists with that command and that is no longer a descendant.
It then runs `SAMPLE <pid> SAMPLE_SECONDS -file LOGS/hang-<name>-<pid>.sample`, polls the run once and returns the
text the caller appends to its failure message: the two paths (or why a file is absent), whether the run ended
while it was sampled, the `.ps` file's lines and the `.sample` file from its `Call graph:` line to the line before
`Binary Images:`, at most MAX_EXCERPT lines, the leaf counts from `Sort by top of stack` on always whole.

Both programs are started with an argument list, an absolute path, the fixed environment CHILD_ENV and a timeout;
`ps` is run without `-E`. The sampler sends no signal and raises nothing: any failure becomes a line of the text.
The module attributes are read when `sample` runs, so a case can point them elsewhere and restore them.
"""
import os
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]

LOGS = CHECKOUT / "output" / "logs"
PS = "/bin/ps"
SAMPLE = "/usr/bin/sample"
PS_TIMEOUT = 10        # seconds
SAMPLE_TIMEOUT = 60    # seconds, of which SAMPLE_SECONDS are sampled
SAMPLE_SECONDS = 3
MAX_EXCERPT = 300      # lines of the .sample file in the returned text
COLUMNS = "pid,ppid,pgid,stat,wchan,time,command"
CHILD_ENV = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
RECORDED = "recorded, no longer descendants:"


class Failed(Exception):
    """A program or a file that failed; its message is the one-line reason."""


def run(program, args, timeout, **kwargs):
    """Run `program` with `args` (bounded); return the CompletedProcess or raise Failed with the reason."""
    try:
        done = subprocess.run([program, *args], stdin=subprocess.DEVNULL, env=CHILD_ENV, timeout=timeout,
                              **kwargs)
    except subprocess.TimeoutExpired:  # subprocess.run has killed and reaped the child
        raise Failed(f"{program} passed its {timeout} s timeout") from None
    except FileNotFoundError:
        raise Failed(f"{program} is missing") from None
    except OSError as e:
        raise Failed(f"{program} could not be run: {e.strerror}") from None
    if done.returncode != 0:
        raise Failed(f"{program} exited {done.returncode}")
    return done


def table(out, pid, recorded):
    """(header, tree lines, recorded lines) from the output of `ps -o COLUMNS`."""
    lines = out.splitlines()
    rows = {}  # pid: (ppid, command, line), in the order ps listed them
    for line in lines[1:]:
        parts = line.split(None, 6)
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            rows[int(parts[0])] = (int(parts[1]), parts[6] if len(parts) == 7 else "", line)
    children = {}
    for p, (ppid, _, _) in rows.items():
        children.setdefault(ppid, []).append(p)
    tree, todo = set(), [pid] if pid in rows else []
    while todo:
        p = todo.pop()
        if p not in tree:
            tree.add(p)
            todo.extend(children.get(p, []))
    left = {p for p, command in (recorded or {}).items()
            if p in rows and p not in tree and rows[p][1].strip() == command.strip()}
    return (lines[:1], [rows[p][2] for p in rows if p in tree], [rows[p][2] for p in rows if p in left])


def write(path, lines):
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(line + "\n" for line in lines)
    except OSError as e:
        remove(path)
        raise Failed(f"cannot write {path}: {e.strerror}") from None


def remove(path):
    try:
        os.unlink(path)
    except OSError:
        pass


def excerpt(path):
    """(lines left out, block) of the .sample file: Call graph to Binary Images, at most MAX_EXCERPT lines."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError as e:
        return 0, [f"cannot read {path}: {e.strerror}"]
    start = next((i for i, line in enumerate(lines) if line.startswith("Call graph:")), None)
    if start is None:
        return 0, ["no call graph in the file"]
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("Binary Images:")), len(lines))
    part = lines[start:end]
    at = next((i for i, line in enumerate(part) if line.startswith("Sort by top of stack")), len(part))
    graph, tail = part[:at], part[at:]
    if len(part) <= MAX_EXCERPT:
        return 0, part
    keep = max(0, MAX_EXCERPT - len(tail))
    return len(graph) - keep, graph[:keep] + tail


def sample(proc, name, text, recorded=None):
    """Sample the run `proc` that passed its bound; return the text to append to the failure message."""
    try:
        return "\n" + "\n".join(_sample(proc, name, text, recorded))
    except Exception as e:  # the sampler never fails the test by itself
        message = " ".join(str(e).split())
        return f"\nhang sample: failed: {type(e).__name__}: {message}"


def _sample(proc, name, text, recorded):
    pid = proc.pid
    try:  # the first thing done: nothing is waited for between the bound and this ps run
        listed = run(PS, ["-A", "-o", COLUMNS], PS_TIMEOUT, capture_output=True)
    except Failed as e:
        listed = e
    logs = os.fspath(LOGS)
    base = f"hang-{name}-{pid}"
    ps_path, sample_path = os.path.join(logs, base + ".ps"), os.path.join(logs, base + ".sample")
    out, blocks = [], []
    try:
        os.makedirs(logs, exist_ok=True)
    except OSError as e:
        unwritable = Failed(f"cannot write {logs}: {e.strerror}")
    else:
        unwritable = None

    try:
        if unwritable:
            raise unwritable
        if isinstance(listed, Failed):
            remove(ps_path)
            raise listed
        header, tree, left = table(listed.stdout.decode("utf-8", errors="replace"), pid, recorded)
        ps_lines = [text, *header, *tree, RECORDED, *left]
        write(ps_path, ps_lines)
    except Failed as e:
        out.append(f"hang sample: no .ps file: {e}")
    else:
        out.append(f"hang sample: {ps_path}")
        blocks += [f"--- {base}.ps", *ps_lines]

    try:
        if unwritable:
            raise unwritable
        remove(sample_path)  # so that the file, when there is one, is this run's
        try:
            run(SAMPLE, [str(pid), str(SAMPLE_SECONDS), "-file", sample_path], SAMPLE_TIMEOUT,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Failed:
            remove(sample_path)
            raise
        if not os.path.exists(sample_path):
            raise Failed(f"{SAMPLE} wrote no file")
    except Failed as e:
        out.append(f"hang sample: no .sample file: {e}")
    else:
        out.append(f"hang sample: {sample_path}")
        cut, block = excerpt(sample_path)
        left_out = f", {cut} lines of the call graph left out" if cut else ""
        blocks += [f"--- {base}.sample, Call graph to Binary Images{left_out}", *block]

    code = proc.poll()
    out.append("hang sample: the run was still unreaped after the sampling" if code is None
               else f"hang sample: the run ended while it was sampled: exit {code}")
    return out + blocks
