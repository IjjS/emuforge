"""What an integration run left: found by the run's id and removed (issue 342). Not a command; pm-check imports it.

tests/integration/run names its run on its own first line, `integration: run <id>, emulator port <port>, ...`, and
removes what it made in its EXIT trap. A run whose trap did not finish (pm-check --stop ended it in its checks, the
trap ran out of time, pm-check itself was killed) leaves its emulator container, the containers its checks started,
their volumes and networks, its folder ~/.aws/emulator/<port>/ and its three images. `sweep` removes those, and only
those: what carries the run's id, by Docker label (`emuforge-it-run=<id>`), by image (a container created from one of
the run's images: a product form) or by name (the run's images). The folders go through pm-emulator-dir alone, which
refuses one in use and never opens a file; nothing here opens, lists or removes a folder.

pm-check sweeps the run of each integration step when the step ends (by itself or stopped), and at its own start
each run an earlier log of the checkout names that is not yet in <checkout>/output/checks/swept.json. A sweep in
which Docker answered every call and pm-emulator-dir refused nothing is recorded there; any other is tried again at
the next start.
"""
import json
import os
import pathlib
import re
import subprocess
import time

RUN_LINE = re.compile(rb"^integration: run ([0-9]{1,12}-[0-9]{1,10}), emulator port ([1-9][0-9]{0,4}),", re.M)
READ_MAX = 64 * 1024  # bytes of a log read for the run line, which is among the run's first lines
LOGS = ("check-integration.log", "check-integration.attempt1.log", "checks-integration.log")  # pm-check's names
DOCKER_ENV = ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "TMPDIR")
DOCKER_TIMEOUT = 20  # seconds per Docker call
DIR_TIMEOUT = 60  # seconds per pm-emulator-dir call (it asks Docker twice at most)
KEEP = 20  # swept runs remembered
LABEL = "emuforge-it-run"
PROJECT = "com.docker.compose.project"
SWEEP_BOUND = 120  # seconds a sweep can take at most, about: what pm-check --stop waits for it beyond the step's grace


class NoAnswer(Exception):
    """Docker did not answer a call; the text says how."""


def run_of(log):
    """(run id, port) named by the run line of the log at `log`, or None (no file, no line, a port over 65535)."""
    try:
        with open(log, "rb") as f:
            head = f.read(READ_MAX)
    except OSError:
        return None
    m = RUN_LINE.search(head)
    if not m or int(m.group(2)) > 65535:
        return None
    return m.group(1).decode(), int(m.group(2))


def images_of(run_id):
    """The run's three image names, as `docker image ls` prints them (repository:tag)."""
    return [f"emuforge-it-product-{run_id}:latest", f"emuforge-it-emulator-{run_id}:latest",
            f"aws-emulator:it-{run_id}"]


def docker(*args):
    """A finished Docker call (any exit); NoAnswer when there is no docker or it did not end in time."""
    env = {k: os.environ[k] for k in DOCKER_ENV if k in os.environ}
    try:
        return subprocess.run(["docker", *args], capture_output=True, text=True, env=env, timeout=DOCKER_TIMEOUT,
                              stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise NoAnswer("not found")
    except subprocess.TimeoutExpired:
        raise NoAnswer(f"no answer within {DOCKER_TIMEOUT} s")
    except OSError as e:
        raise NoAnswer(type(e).__name__)


def listed(*args):
    """The words a listing call printed; NoAnswer when it failed."""
    r = docker(*args)
    if r.returncode != 0:
        raise NoAnswer(f"`docker {' '.join(args[:2])}` exit {r.returncode}")
    return r.stdout.split()


def emulator_port(co):
    """The worktree's emulator port from <co>/output/ports.json, or None."""
    try:
        port = json.loads((co / "output" / "ports.json").read_text()).get("emulator")
    except (OSError, ValueError, AttributeError):
        return None
    return port if type(port) is int else None


def folder(co, port, bin_dir):
    """(removed, refused): one pm-emulator-dir call for the port's folder, by worktree when it is the worktree's
    port. Its line is returned as it printed it."""
    args = ["rm", "--worktree", str(co)] if emulator_port(co) == port else ["rm", "--port", str(port)]
    try:
        r = subprocess.run([str(pathlib.Path(bin_dir) / "pm-emulator-dir"), *args], capture_output=True, text=True,
                           timeout=DIR_TIMEOUT, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, f"pm-emulator-dir {' '.join(args)} did not end: {type(e).__name__}"
    line = (r.stdout.strip().splitlines() or [f"pm-emulator-dir exit {r.returncode}"])[-1]
    if r.returncode == 0:
        return (line if "nothing to remove" not in line else None), None
    return None, line


def sweep(co, run_id, port, bin_dir):
    """Remove what run `run_id` (emulator port `port`) of checkout `co` left. Returns {id, at, removed: [what],
    refused: [line], docker: None or why it did not answer}; `removed` names containers, volumes, networks and
    images, and holds pm-emulator-dir's line of each folder it removed."""
    out = dict(id=run_id, at=time.strftime("%Y-%m-%dT%H:%M:%S"), removed=[], refused=[], docker=None)
    images = images_of(run_id)
    ports = {port}
    try:
        present = set(listed("image", "ls", "--format", "{{.Repository}}:{{.Tag}}",
                             *[a for i in images for a in ("--filter", f"reference={i}")])) & set(images)
        ids = set(listed("ps", "-aq", "--no-trunc", "--filter", f"label={LABEL}={run_id}"))
        for image in present:
            if not image.startswith("aws-emulator:"):  # the pin is the emulator image under a second name
                ids |= set(listed("ps", "-aq", "--no-trunc", "--filter", f"ancestor={image}"))
        projects, volumes = set(), set(listed("volume", "ls", "-q", "--filter", f"label={LABEL}={run_id}"))
        if ids:
            # Another run's container can share an image id with this run's (a build cache hit), so a container
            # found by image is the run's only when it was created under one of the run's image names.
            mine = {n for i in images for n in (i, i.removesuffix(":latest"))}
            r = docker("inspect", "-f", "{{.Id}}|{{.Name}}|{{.Config.Image}}|{{index .Config.Labels \"" + LABEL + "\"}}|"
                       "{{index .Config.Labels \"" + PROJECT + "\"}}|"
                       "{{range .Mounts}}{{if eq .Type \"volume\"}}{{.Name}} {{end}}{{end}}", *sorted(ids))
            found = {}
            for line in r.stdout.splitlines():  # a container gone in between is simply not listed
                parts = line.split("|")
                if len(parts) != 6 or (parts[3] != run_id and parts[2] not in mine):
                    continue
                cid, name = parts[0], parts[1].lstrip("/")
                found[cid] = name
                if parts[4] not in ("", "<no value>"):  # Docker prints `<no value>` for a label a container lacks
                    projects.add(parts[4])
                volumes |= set(parts[5].split())
                m = re.fullmatch(r"emuforge-it-([1-9][0-9]{0,4})-" + re.escape(run_id), name)
                if m and int(m.group(1)) <= 65535:
                    ports.add(int(m.group(1)))
            for cid, name in sorted(found.items(), key=lambda x: x[1]):
                if docker("rm", "-f", cid).returncode == 0:
                    out["removed"].append(f"container {name}")
                else:
                    out["refused"].append(f"container {name} was not removed")
        for v in sorted(volumes):
            if docker("volume", "rm", v).returncode == 0:  # one still in use is refused by Docker and kept
                out["removed"].append(f"volume {v}")
        for p in sorted(projects):
            for n in listed("network", "ls", "-q", "--filter", f"label={PROJECT}={p}"):
                if docker("network", "rm", n).returncode == 0:  # one still in use is refused and kept
                    out["removed"].append(f"network {n} of {p}")
        for image in sorted(present):
            if docker("image", "rm", image).returncode == 0:
                out["removed"].append(f"image {image}")
            else:
                out["refused"].append(f"image {image} is still in use")
    except NoAnswer as e:
        out["docker"] = str(e)
        return out
    for p in sorted(ports):
        removed, refused = folder(co, p, bin_dir)
        if removed:
            out["removed"].append(removed)
        if refused:
            out["refused"].append(refused)
    return out


def swept_file(co):
    return co / "output" / "checks" / "swept.json"


def swept(co):
    """{run id: entry} of the runs recorded as swept."""
    try:
        runs = json.loads(swept_file(co).read_text()).get("runs")
    except (OSError, ValueError, AttributeError):
        return {}
    return {r["id"]: r for r in runs if isinstance(r, dict) and isinstance(r.get("id"), str)} \
        if isinstance(runs, list) else {}


def note(co, entry):
    """Record a sweep in which Docker answered and nothing was refused; keep the last KEEP."""
    if entry["docker"] or entry["refused"]:
        return
    runs = [r for r in swept(co).values() if r["id"] != entry["id"]] + [entry]
    f = swept_file(co)
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f".swept.{os.getpid()}")
    tmp.write_text(json.dumps(dict(runs=runs[-KEEP:]), indent=1) + "\n")
    tmp.replace(f)


def lines(entry):
    """The lines pm-check prints for a sweep: none when nothing was left and nothing failed."""
    head = f"integration: leftovers of run {entry['id']}"
    if entry["docker"]:
        return [f"{head} not swept: docker {entry['docker']}"]
    out = []
    if entry["removed"]:
        out.append(f"{head} removed: {'; '.join(entry['removed'])}")
    out += [f"{head} kept: {r}" for r in entry["refused"]]
    return out


def sweep_log(co, log, bin_dir):
    """Sweep the run that the log at `log` names, record it, and return the lines to print ([] for no run)."""
    run = run_of(log)
    if run is None:
        return []
    entry = sweep(co, run[0], run[1], bin_dir)
    note(co, entry)
    return lines(entry)


def sweep_earlier(co, bin_dir):
    """At pm-check's start: sweep each run an earlier log of the checkout names that is not recorded as swept.
    The lines to print."""
    done, out, seen = swept(co), [], set()
    for name in LOGS:
        run = run_of(co / "output" / "logs" / name)
        if run is None or run[0] in done or run[0] in seen:
            continue
        seen.add(run[0])
        entry = sweep(co, run[0], run[1], bin_dir)
        note(co, entry)
        out += lines(entry)
    return out
