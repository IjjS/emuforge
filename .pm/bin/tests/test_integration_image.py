"""tests/integration/run: the run builds its own emulator image from the checkout, compares it with the machine's
image and with the product build's emulator, uses only it and removes it (issue 68, R2; issue 473).

The fixture is the one of test_integration_build_bound.py: a fixture checkout with copies of tests/integration/run
and of tests/integration/manifest.jsonl (no studio/services), a root docker-compose.yml, an engine/Cargo.toml, a
studio/package.json with a stand-in studio/node_modules/.bin/playwright, a made-up HOME and stand-ins for cargo,
bun, node, curl and shasum (that file's STANDIN, which writes `passed` for every manifest check of its kind) first on
PATH. Here the checkout also holds a committed infra/aws-emulator/, and its docker is the stand-in DOCKER below.

The stand-in docker keeps its images in <case>/images.json (name -> id; id -> version, commit, labels) and does
what <case>/docker.json says (Fixture's arguments). It appends every call to <case>/calls.jsonl with its arguments,
its working directory, the names of its environment variables, the values of EMUFORGE_IMAGE and
EMUFORGE_EMULATOR_IMAGE, and the number of lines the run's output had at that moment. It answers `info`,
`compose version`, `image inspect` (`-f '{{.Id}}'`, and without `-f` as Docker's JSON array, in which an image
without labels has no `Labels` key at all), `build` (a new id of the "package" version and commit, labelled from
its `--label` arguments), `compose ... build` (writes EMUFORGE_EMULATOR_IMAGE as an image of the product build's
version, by default left as it is), `run ... --version` and `run -d` (an image that is not there fails, as with
`--pull never`), `tag` and `image rm`; everything else exits 0 with no output. A build that does not return records
its pid and the pid of its child in <case>/builds.jsonl, as that file's stand-in does.

"The name" is `aws-emulator` without a tag; the stand-in stores names with Docker's default tag, so
`aws-emulator` and `aws-emulator:latest` are one name. No case calls the real Docker, builds a real image or uses
the network. Every run ends within its own bound; each case ends what it started.
"""
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import time
import unittest

from _fixture import CHECKOUT, clean_env, git, make
from test_emulator_scan import REPO_SCAN_EXCLUDED, findings, is_image, scan, tracked_files
from test_integration_build_bound import LISTED, ON_REQUEST, STANDIN, alive, left, ps

RUN = CHECKOUT / "tests" / "integration" / "run"
MANIFEST = CHECKOUT / "tests" / "integration" / "manifest.jsonl"
README = CHECKOUT / "tests" / "integration" / "README.md"
SUPPORT = CHECKOUT / "tests" / "integration" / "engine" / "support"
STUDIO_SUPPORT = CHECKOUT / "tests" / "integration" / "studio" / "support"
GROUP = "integration-image"
TOOLS = ("cargo", "bun", "node", "curl", "shasum")
SHIPPED = 600     # seconds, emulator_build_bound as shipped (design, section 1.2)
LOWERED = 3       # seconds, the bound of a fixture's copy in a case about the bound
SLACK = 30        # seconds after the bound within which the run has ended
RUN_WAIT = 120    # seconds a run that ends by itself may take
START_WAIT = 120  # seconds a case waits for a stand-in build to start
STOP_WITHIN = 30  # seconds after the SIGTERM within which the run has ended
NAME = "aws-emulator"
PACKAGE = ("1.0.2", "c2")
BAD_VERSION = "1.0.2~zz"  # a character outside [0-9A-Za-z._+-]
BUILD_LINE = "#1 [internal] load build definition from Dockerfile"
TREE = object()   # a label value: the fixture's tree id of infra/aws-emulator
SOURCE_TREE = "emuforge.source-tree"
EMULATOR_BOUND_SETTING = re.compile(r"(?m)^[ \t]*(?:readonly[ \t]+)?emulator_build_bound=(\S*)")

DOCKER = f"""#!{sys.executable} -I
import hashlib, json, os, pathlib, subprocess, sys, time
case = pathlib.Path(os.environ["STANDIN_DIR"])
args = sys.argv[1:]
out = case / "run.out"
with open(case / "calls.jsonl", "a") as f:
    f.write(json.dumps(dict(
        tool="docker", args=args, pid=os.getpid(), cwd=os.getcwd(), env=sorted(os.environ),
        images={{k: os.environ[k] for k in ("EMUFORGE_IMAGE", "EMUFORGE_EMULATOR_IMAGE") if k in os.environ}},
        out_lines=len(out.read_text().splitlines()) if out.exists() else 0)) + "\\n")
conf = json.loads((case / "docker.json").read_text())
store_path = case / "images.json"
store = json.loads(store_path.read_text())
CHILD = "import time\\ntime.sleep(3600)\\n"


def save():
    store_path.write_text(json.dumps(store, indent=1))


def norm(ref):
    if ref.startswith("sha256:") or ":" in ref.rsplit("/", 1)[-1]:
        return ref
    return ref + ":latest"


def resolve(ref):
    if ref in store["images"]:
        return ref
    return store["names"].get(norm(ref))


def new_image(spec, labels=None):
    store["n"] += 1
    image_id = "sha256:" + hashlib.sha256(f"standin-{{store['n']}}".encode()).hexdigest()
    store["images"][image_id] = dict(version=spec.get("version"), commit=spec.get("commit"),
                                     labels=labels, fails=bool(spec.get("fails")))
    return image_id


def build(kind, how):
    child = None
    if how == "hang":
        print({BUILD_LINE!r}, flush=True)
        child = subprocess.Popen([sys.executable, "-I", "-c", CHILD, str(case)])
    with open(case / "builds.jsonl", "a") as f:
        f.write(json.dumps(dict(kind=kind, pid=os.getpid(), child=child and child.pid, started=time.time())) + "\\n")
    if how == "hang":
        while True:
            child.wait()
    print({BUILD_LINE!r})
    if how == "fail":
        print("ERROR: failed to solve: standin", flush=True)
        sys.exit(1)
    if how == "exit124":
        sys.exit(124)


def version(ref):
    image_id = resolve(ref)
    if image_id is None:
        print(f"Unable to find image '{{ref}}' locally", file=sys.stderr)
        sys.exit(125)
    image = store["images"][image_id]
    if image["fails"]:
        print("aws-emulator: cannot start", file=sys.stderr)
        sys.exit(1)
    if image["version"] is not None:
        print(f"Version: {{image['version']}}")
    print(f"Commit: {{image['commit']}}")


if args[:1] == ["build"]:
    build("emulator", conf["emulator_build"])
    tag = args[args.index("--tag") + 1] if "--tag" in args else args[args.index("-t") + 1]
    labels = {{}}
    for i, a in enumerate(args):
        if a == "--label":
            k, _, v = args[i + 1].partition("=")
            labels[k] = v
    store["names"][norm(tag)] = new_image(conf["package"], labels or None)
    save()
elif args[:1] == ["compose"] and args[-1:] == ["build"]:
    build("product", conf["product_build"])
    name = os.environ.get("EMUFORGE_EMULATOR_IMAGE")
    if name and (conf["product"] is not None or resolve(name) is None):
        store["names"][norm(name)] = new_image(conf["product"] or conf["package"])
        save()
elif args[:2] == ["image", "inspect"]:
    rest = args[2:]
    fmt = None
    for flag in ("-f", "--format"):
        if flag in rest:
            fmt = rest[rest.index(flag) + 1]
    ref = rest[-1]
    image_id = resolve(ref)
    if image_id is None:
        print("[]")
        print(f"Error response from daemon: No such image: {{ref}}", file=sys.stderr)
        sys.exit(1)
    if fmt is not None:
        print(image_id)
    else:
        image = store["images"][image_id]
        config = {{"Cmd": None}}
        if image["labels"] is not None:
            config["Labels"] = image["labels"]
        tags = sorted(n for n, i in store["names"].items() if i == image_id)
        print(json.dumps([{{"Id": image_id, "RepoTags": tags, "Config": config}}], indent=4))
    if norm(ref) == "aws-emulator:latest" and conf["move"] is not None and not store.get("moved"):
        store["names"]["aws-emulator:latest"] = new_image(conf["move"])
        store["moved"] = True
        save()
elif args[:1] == ["tag"]:
    image_id = resolve(args[1])
    if image_id is None:
        print(f"Error response from daemon: No such image: {{args[1]}}", file=sys.stderr)
        sys.exit(1)
    store["names"][norm(args[2])] = image_id
    save()
elif args[:2] == ["image", "rm"]:
    for ref in args[2:]:
        if not ref.startswith("-"):
            store["names"].pop(norm(ref), None)
    save()
elif args[:1] == ["run"] and "--version" in args:
    version(args[args.index("--version") - 1])
elif args[:1] == ["run"] and "-d" in args:
    at = len(args) - 1 - args[::-1].index("-p")
    ref = args[at - 1]
    if resolve(ref) is None:
        print(f"Unable to find image '{{ref}}' locally", file=sys.stderr)
        sys.exit(125)
    print("0123456789ab")
"""


def run_id_of(output):
    m = re.search(r"(?m)^integration: run (\S+), emulator port", output)
    return m.group(1) if m else None


class Fixture:
    """One fixture checkout. `machine` is the machine's image `aws-emulator` (None: there is none) as a dict of
    version (None: no `Version:` line), commit and labels (None: no `Labels` key); `package` and `product` are what
    the run's build and the product build give, a dict of version, commit and fails (its `--version` read exits 1),
    `package` None the default PACKAGE and `product` None a product build that leaves the name as it is;
    `emulator_build` and `product_build` say what each build does (ok, fail, exit124, hang); `move` is the image the
    name `aws-emulator` is moved to right after its first `image inspect`; `bound` lowers emulator_build_bound in
    the copy of `run` (None: as shipped); `compose` False leaves out the root docker-compose.yml; `dirty` leaves an
    uncommitted change in infra/aws-emulator/Dockerfile. A label value TREE is the tree id of infra/aws-emulator at
    the fixture's HEAD."""

    def __init__(self, name, machine=None, package=None, product=None, emulator_build="ok", product_build="ok",
                 move=None, bound=None, compose=True, dirty=False):
        text = RUN.read_text()
        self.lowered = None
        if bound is not None:
            text, n = re.subn(r"(?m)^([ \t]*(?:readonly[ \t]+)?emulator_build_bound=)600\b", rf"\g<1>{bound}", text)
            self.lowered = n == 1
        files = {
            "tests/integration/run": text,
            "tests/integration/manifest.jsonl": MANIFEST.read_text(),
            "engine/Cargo.toml": '[package]\nname = "fixture"\nversion = "0.0.0"\n',
            "studio/package.json": "{}\n",
            "studio/node_modules/.bin/playwright": STANDIN,
            "infra/aws-emulator/Dockerfile": "FROM standin/base:1\nRUN install the package\n",
            "infra/aws-emulator/entrypoint.sh": "#!/bin/sh\nexec aws-emulator \"$@\"\n",
        }
        if compose:
            files["docker-compose.yml"] = "services: {}\n"
        self.co = make(GROUP, name, (), files)
        self.case = self.co / "output" / "case"
        self.bin = self.case / "bin"
        self.bin.mkdir(parents=True)
        for tool, body in [(t, STANDIN) for t in TOOLS] + [("docker", DOCKER)]:
            p = self.bin / tool
            p.write_text(body)
            p.chmod(0o755)
        (self.co / "home").mkdir()
        self.tree = git(self.co, "rev-parse", "HEAD:infra/aws-emulator")
        if dirty:
            p = self.co / "infra" / "aws-emulator" / "Dockerfile"
            p.write_text(p.read_text() + "RUN another step\n")
        (self.case / "docker.json").write_text(json.dumps(dict(
            package=package or dict(version=PACKAGE[0], commit=PACKAGE[1]), product=product,
            emulator_build=emulator_build,
            product_build=product_build, move=move)))
        store = dict(n=0, names={}, images={})
        self.machine_id = None
        if machine is not None:
            self.machine_id = "sha256:" + "a" * 64
            store["images"][self.machine_id] = dict(version=machine.get("version"), commit=machine.get("commit"),
                                                    labels=self.labels(machine.get("labels")),
                                                    fails=False)
            store["names"]["aws-emulator:latest"] = self.machine_id
        (self.case / "images.json").write_text(json.dumps(store, indent=1))
        self.proc = None
        self.code = None
        self.out_path = self.case / "run.out"

    def labels(self, labels):
        return None if labels is None else {k: self.tree if v is TREE else v for k, v in labels.items()}

    def env(self):
        e = {k: v for k, v in clean_env().items() if not k.startswith(("AWS_", "EMUFORGE_"))}
        e.pop("EMULATOR_PORT", None)
        e.update(PATH=f"{self.bin}{os.pathsep}/usr/bin:/bin", HOME=str(self.co / "home"), STANDIN_DIR=str(self.case),
                 STANDIN_MANIFEST=str(self.co / "tests" / "integration" / "manifest.jsonl"))
        return e

    def start(self, *args):
        with open(self.out_path, "w") as f:
            self.proc = subprocess.Popen([str(self.co / "tests" / "integration" / "run"), *map(str, args)],
                                         stdout=f, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                         env=self.env(), cwd=str(self.co), start_new_session=True)

    def wait(self, until):
        try:
            self.code = self.proc.wait(timeout=max(0.0, until - time.time()))
        except subprocess.TimeoutExpired:
            self.code = None
        return self.code

    def run(self, *args):
        """Runs `run` to its end (or RUN_WAIT); returns self."""
        self.start(*args)
        self.wait(time.time() + RUN_WAIT)
        return self

    def wait_build(self, kind, seconds=START_WAIT):
        """The first build record of `kind` once that stand-in build has started; None when the run ended first."""
        end = time.time() + seconds
        while time.time() < end:
            b = [x for x in self.builds() if x["kind"] == kind]
            if b:
                return b[0]
            if self.proc.poll() is not None:
                b = [x for x in self.builds() if x["kind"] == kind]
                return b[0] if b else None
            time.sleep(0.05)
        return None

    def builds(self):
        f = self.case / "builds.jsonl"
        return [json.loads(x) for x in f.read_text().splitlines() if x.strip()] if f.exists() else []

    def build_pids(self):
        return [p for b in self.builds() for p in (b["pid"], b["child"]) if p]

    def calls(self, tool=None):
        f = self.case / "calls.jsonl"
        rows = [json.loads(x) for x in f.read_text().splitlines() if x.strip()] if f.exists() else []
        for n, r in enumerate(rows):
            r["n"] = n
        return [r for r in rows if tool is None or r["tool"] == tool]

    def docker(self):
        return self.calls("docker")

    def emulator_builds(self):
        return [c for c in self.docker() if c["args"][:1] == ["build"]]

    def compose_builds(self):
        return [c for c in self.docker() if c["args"][:1] == ["compose"] and c["args"][-1:] == ["build"]]

    def detached(self):
        return [c for c in self.docker() if c["args"][:1] == ["run"] and "-d" in c["args"]]

    def version_reads(self):
        return [c for c in self.docker() if c["args"][:1] == ["run"] and "--version" in c["args"]]

    def machine_reads(self):
        """The `image inspect` calls of the name `aws-emulator` (either form)."""
        return [c for c in self.docker() if c["args"][:2] == ["image", "inspect"]
                and c["args"][-1] in (NAME, NAME + ":latest")]

    def cargo_tests(self):
        return [c for c in self.calls("cargo") if c["args"][:1] == ["test"]]

    def output(self):
        return self.out_path.read_text() if self.out_path.exists() else ""

    def lines(self):
        return [line.rstrip() for line in self.output().splitlines()]

    @property
    def run_id(self):
        return run_id_of(self.output())

    @property
    def pin(self):
        return f"aws-emulator:it-{self.run_id}"

    @property
    def product_name(self):
        return f"emuforge-it-emulator-{self.run_id}"

    @property
    def build_log(self):
        return self.co / "output" / "logs" / "integration-emulator-build.log"

    @property
    def report_path(self):
        return self.co / "output" / "integration" / "report.json"

    def raw(self):
        return json.loads(self.report_path.read_text()) if self.report_path.exists() else None

    def report(self):
        r = self.raw()
        return None if r is None else {c["check_id"]: c for c in r["checks"]}

    def why(self):
        tail = "\n".join(self.lines()[-14:])
        return f"\n[exit {self.code}; builds {self.builds()}]\n{tail}"

    def end(self):
        if self.proc is not None and self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            self.proc.wait(timeout=30)
        for pid in self.build_pids():
            if alive(pid) and str(self.case) in ps("-o", "command=", "-p", str(pid)):
                os.kill(pid, signal.SIGKILL)


def unlabelled(version="1.0.1", commit="c1"):
    return dict(version=version, commit=commit, labels=None)


def tree_labelled(version, commit):
    return dict(version=version, commit=commit, labels={SOURCE_TREE: TREE})


# Runs shared by several cases: each is made and run once, and ended at the end of the module.
_RUNS = {}


def shared(key, **kw):
    if key not in _RUNS:
        _RUNS[key] = Fixture(key, **kw).run()
    return _RUNS[key]


def tearDownModule():
    for fx in _RUNS.values():
        fx.end()


def default_run():
    """A machine image 1.0.1 (c1) without a `Labels` key, the package 1.0.2 (c2), every build passing."""
    return shared("default", machine=unlabelled())


def machine_older():
    return shared("machine-older", machine=tree_labelled("1.0.1", "c1"))


def product_newer():
    return shared("product-newer", machine=unlabelled(), product=dict(version="1.0.3", commit="c3"))


def build_failed():
    return shared("build-fail", machine=unlabelled(), emulator_build="fail")


def machine_refusal(version, commit):
    return (f"the emulator built for this run is 1.0.2 (c2), the machine's image aws-emulator is {version} "
            f"({commit}); run .pm/bin/pm-emulator-image refresh")


class Case(unittest.TestCase):
    """Assertions shared by the classes below."""

    def ended(self, fx, code):
        self.assertIsNotNone(fx.code, f"the run had not ended within {RUN_WAIT} s{fx.why()}")
        self.assertEqual(fx.code, code, fx.why())

    def counted(self, fx):
        """{id: (verdict, message)} of every check the run did not leave out (the on-request rows)."""
        report = fx.report()
        self.assertIsNotNone(report, f"no report.json{fx.why()}")
        return {i: (c["verdict"], c["message"]) for i, c in report.items() if i not in ON_REQUEST}

    def every_check(self, fx, verdict, message, but=()):
        wrong = {i: v for i, v in self.counted(fx).items() if i not in but and v != (verdict, message)}
        self.assertEqual(wrong, {}, f"checks not {verdict} with {message!r}{fx.why()}")

    def all_passed(self, fx):
        self.assertEqual({i: v for i, v in self.counted(fx).items() if v[0] != "passed"}, {}, fx.why())

    def image(self, fx):
        raw = fx.raw()
        self.assertIsNotNone(raw, f"no report.json{fx.why()}")
        self.assertIn("emulator_image", raw, f"report.json has no emulator_image{fx.why()}")
        return raw["emulator_image"]

    def image_line(self, fx):
        self.assertIsNotNone(fx.run_id, fx.why())
        found = [line for line in fx.lines() if line.startswith(f"integration: emulator image {fx.pin} ")]
        self.assertEqual(len(found), 1, f"the emulator image line{fx.why()}")
        return found[0]

    def nothing_started(self, fx):
        self.assertEqual([c["args"] for c in fx.detached()], [], "a docker run -d was made")
        self.assertEqual(fx.cargo_tests(), [], "cargo test was started")
        self.assertEqual(fx.calls("playwright"), [], "Playwright was started")

    def went_on(self, fx):
        self.assertTrue(fx.cargo_tests(), f"cargo test was not started{fx.why()}")
        self.assertTrue(fx.calls("playwright"), f"Playwright was not started{fx.why()}")

    def pin_removed(self, fx):
        self.assertIsNotNone(fx.run_id, fx.why())
        removals = [c["args"] for c in fx.docker() if c["args"][:2] == ["image", "rm"]]
        self.assertTrue([a for a in removals if fx.pin in a], f"no docker image rm of {fx.pin}: {removals}")


class Build(Case):
    """The run's own image: its build, its version, the machine's image beside it."""

    def test_one_docker_build_of_the_runs_tag_from_infra_after_the_builds_and_before_every_start(self):
        fx = default_run()
        self.assertIsNotNone(fx.run_id, fx.why())
        builds = fx.emulator_builds()
        self.assertEqual(len(builds), 1, f"docker build calls: {[c['args'] for c in builds]}{fx.why()}")
        b = builds[0]
        args = b["args"]
        self.assertIn("--tag", args, args)
        self.assertEqual(args[args.index("--tag") + 1], fx.pin, args)
        self.assertEqual(pathlib.Path(b["cwd"], args[-1]).resolve(), (fx.co / "infra" / "aws-emulator").resolve(),
                         f"the build context of {args} in {b['cwd']}")
        self.assertNotIn("--no-cache", args)
        self.assertEqual([a for a in args if a == "--pull" or a.startswith("--pull=")], [], args)
        cargo_build = [c["n"] for c in fx.calls("cargo") if c["args"][:1] == ["build"]]
        studio_build = [c["n"] for c in fx.calls("bun") if c["args"][:2] == ["run", "build"]]
        self.assertTrue(cargo_build and studio_build, "the engine and Studio builds were not made")
        self.assertLess(max(cargo_build + studio_build), b["n"], "the image was built before the engine or Studio")
        later = [c["n"] for c in fx.compose_builds()] + [c["n"] for c in fx.docker() if c["args"][:1] == ["run"]]
        self.assertTrue(later, fx.why())
        self.assertLess(b["n"], min(later), "a docker run or the product build came before the image's build")

    def test_the_report_and_the_line_say_the_runs_version_and_the_machines_not_compared(self):
        fx = default_run()
        raw = fx.raw()
        self.assertIsNotNone(raw, fx.why())
        self.assertEqual((raw["emulator_version"], raw["emulator_commit"]), PACKAGE, fx.why())
        image = self.image(fx)
        built = json.loads((fx.case / "images.json").read_text())["images"]
        ids = [i for i, img in built.items() if (img["version"], img["commit"]) == PACKAGE]
        self.assertEqual(len(ids), 1, built)
        self.assertEqual(image, {"id": ids[0], "machine": {"version": "1.0.1", "commit": "c1"}, "compared": False})
        line = f"integration: emulator image {fx.pin} 1.0.2 (c2); machine image 1.0.1 (not compared)"
        lines = fx.lines()
        self.assertIn(line, lines, fx.why())
        compose = fx.compose_builds()
        self.assertTrue(compose, fx.why())
        self.assertLess(lines.index(line), compose[0]["out_lines"], "the line came after the product build")

    def test_the_emulator_and_fidelity_lines_say_the_runs_version_and_the_run_exits_0(self):
        fx = default_run()
        self.ended(fx, 0)
        self.assertTrue([line for line in fx.lines()
                         if line.startswith("integration: emulator 1.0.2 (c2) answers on 127.0.0.1:")], fx.why())
        last = [line for line in fx.lines() if line.strip()][-1]
        self.assertRegex(last, r"^relay fidelity \d+/\d+ emulator 1\.0\.2 commit \S+$")
        self.all_passed(fx)

    def test_a_version_read_of_the_runs_image_that_fails_is_an_error_before_anything_starts(self):
        fx = shared("version-fails", machine=unlabelled(), package=dict(version="1.0.2", commit="c2", fails=True))
        self.ended(fx, 127)
        self.every_check(fx, "error", "aws-emulator --version failed")
        self.assertEqual([c["args"] for c in fx.machine_reads()], [], "the name aws-emulator was inspected")
        self.assertEqual(fx.compose_builds(), [], "the product compose ... build was started")
        self.assertEqual([c["args"] for c in fx.detached()], [], "a docker run -d was made")

    def test_no_machine_image_is_none_not_compared_and_the_run_goes_on(self):
        fx = shared("no-machine")
        self.ended(fx, 0)
        image = self.image(fx)
        self.assertIsNone(image["machine"], image)
        self.assertIs(image["compared"], False, image)
        self.assertTrue(self.image_line(fx).endswith("machine image none (not compared)"), fx.why())
        self.assertEqual({i: v for i, v in self.counted(fx).items() if v[0] == "error"}, {})

    def test_a_version_out_of_shape_is_unknown_and_is_in_no_line_and_not_in_the_report(self):
        fx = shared("bad-version", machine=unlabelled(), package=dict(version=BAD_VERSION, commit="c2"))
        raw = fx.raw()
        self.assertIsNotNone(raw, fx.why())
        self.assertEqual(raw["emulator_version"], "unknown", fx.why())
        self.assertEqual([line for line in fx.lines() if BAD_VERSION in line], [])
        self.assertNotIn(BAD_VERSION, fx.report_path.read_text())


class Machine(Case):
    """The comparison with the machine's image `aws-emulator`, when it is labelled for these files."""

    def test_a_labelled_image_of_the_same_version_is_compared_and_the_run_goes_on(self):
        fx = shared("machine-same", machine=tree_labelled("1.0.2", "c2"))
        self.ended(fx, 0)
        self.assertIs(self.image(fx)["compared"], True, self.image(fx))
        self.assertTrue(self.image_line(fx).endswith("(compared)"), fx.why())
        self.went_on(fx)

    def test_a_labelled_image_of_an_older_version_refuses_the_run_before_anything_starts(self):
        fx = machine_older()
        self.ended(fx, 127)
        self.every_check(fx, "error", machine_refusal("1.0.1", "c1"))
        image = self.image(fx)
        self.assertEqual((image["machine"], image["compared"]), ({"version": "1.0.1", "commit": "c1"}, True), image)
        self.assertEqual(fx.compose_builds(), [], "the product compose ... build was started")
        self.nothing_started(fx)

    def test_a_labelled_image_of_the_same_version_and_another_commit_is_refused_too(self):
        fx = shared("machine-commit", machine=tree_labelled("1.0.2", "c1"))
        self.ended(fx, 127)
        self.every_check(fx, "error", machine_refusal("1.0.2", "c1"))

    def test_an_uncommitted_change_under_infra_is_not_compared(self):
        fx = shared("machine-dirty", machine=tree_labelled("1.0.1", "c1"), dirty=True)
        self.ended(fx, 0)
        self.assertIs(self.image(fx)["compared"], False, self.image(fx))

    def test_an_image_labelled_for_other_files_is_not_compared(self):
        fx = shared("machine-other-tree", machine=dict(version="1.0.1", commit="c1", labels={SOURCE_TREE: "0" * 40}))
        self.ended(fx, 0)
        self.assertIs(self.image(fx)["compared"], False, self.image(fx))

    def test_an_image_whose_inspect_has_no_labels_key_is_read_and_not_compared(self):
        fx = default_run()
        self.ended(fx, 0)
        image = self.image(fx)
        self.assertIs(image["compared"], False, image)
        self.assertEqual(image["machine"], {"version": "1.0.1", "commit": "c1"}, image)

    def test_an_image_whose_version_has_no_version_line_is_none(self):
        fx = shared("machine-no-version", machine=dict(version=None, commit="c1", labels=None))
        self.ended(fx, 0)
        image = self.image(fx)
        self.assertIsNone(image["machine"], image)
        self.assertIs(image["compared"], False, image)

    def test_the_version_read_names_the_id_inspect_returned_when_the_name_moves_between(self):
        fx = shared("machine-moves", machine=unlabelled(), move=dict(version="1.0.3", commit="c3"))
        self.ended(fx, 0)
        reads = [c["args"] for c in fx.version_reads() if fx.machine_id in c["args"]]
        self.assertEqual(len(reads), 1, f"--version reads: {[c['args'] for c in fx.version_reads()]}")
        self.assertEqual(reads[0][reads[0].index("--version") - 1], fx.machine_id, reads[0])
        self.assertEqual(self.image(fx)["machine"], {"version": "1.0.1", "commit": "c1"}, self.image(fx))


class Product(Case):
    """The comparison with the emulator the product build writes under the run's product name."""

    def test_the_runs_image_is_tagged_for_the_product_build_and_its_emulator_read_before_the_run_starts(self):
        fx = default_run()
        self.ended(fx, 0)
        docker = fx.docker()
        compose = fx.compose_builds()
        self.assertEqual(len(compose), 1, fx.why())
        tags = [c for c in docker if c["args"] == ["tag", fx.pin, fx.product_name]]
        self.assertTrue(tags, f"no docker tag {fx.pin} {fx.product_name}: "
                              f"{[c['args'] for c in docker if c['args'][:1] == ['tag']]}")
        self.assertLess(tags[0]["n"], compose[0]["n"])
        self.assertEqual(compose[0]["images"].get("EMUFORGE_EMULATOR_IMAGE"), fx.product_name, compose[0])
        reads = [c for c in fx.version_reads() if fx.product_name in c["args"] and c["n"] > compose[0]["n"]]
        self.assertTrue(reads, f"no --version read of {fx.product_name} after the product build")
        detached = fx.detached()
        self.assertEqual(len(detached), 1, fx.why())
        self.assertLess(reads[0]["n"], detached[0]["n"])

    def test_a_product_emulator_of_another_version_refuses_the_run(self):
        fx = product_newer()
        self.ended(fx, 127)
        self.every_check(fx, "error", "the product build's emulator is 1.0.3 (c3), the run's image is 1.0.2 (c2)")
        self.nothing_started(fx)

    def test_a_product_emulator_whose_version_read_fails_is_unknown_and_refused(self):
        fx = shared("product-read-fails", machine=unlabelled(),
                    product=dict(version="1.0.2", commit="c2", fails=True))
        self.ended(fx, 127)
        self.every_check(fx, "error",
                         "the product build's emulator is unknown (unknown), the run's image is 1.0.2 (c2)")
        self.assertEqual([c["args"] for c in fx.detached()], [], "a docker run -d was made")

    def test_a_failed_product_build_reads_nothing_and_the_checks_run(self):
        fx = shared("product-fail", machine=unlabelled(), product_build="fail")
        self.ended(fx, 0)
        self.assertIsNotNone(fx.run_id, fx.why())
        self.assertEqual([c["args"] for c in fx.version_reads() if fx.product_name in c["args"]], [])
        self.went_on(fx)

    def test_no_compose_file_reads_nothing_and_the_checks_run(self):
        fx = shared("product-absent", machine=unlabelled(), compose=False)
        self.ended(fx, 0)
        self.assertIsNotNone(fx.run_id, fx.why())
        self.assertEqual([c["args"] for c in fx.version_reads() if fx.product_name in c["args"]], [])
        self.went_on(fx)


def code_text(path):
    """The file's text without its whole-line comments (`//`, `///`, `//!`, `/*`, `*`)."""
    return "\n".join("" if line.strip().startswith(("//", "/*", "*")) else line
                     for line in path.read_text().splitlines())


QUOTED = {".rs": re.compile(r'"((?:[^"\\\n]|\\.)*)"'),
          ".ts": re.compile(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'|`([^`]*)`')}


def arguments(path):
    """The quoted strings without whitespace of the file's code, in file order, as (text, line number)."""
    text = code_text(path)
    out = []
    for m in QUOTED[path.suffix].finditer(text):
        s = next(g for g in m.groups() if g is not None) if any(g is not None for g in m.groups()) else ""
        if s and not any(c.isspace() for c in s):
            out.append((s, text.count("\n", 0, m.start()) + 1))
    return out


def tag_maker(text):
    """The lines of check.rs's statement that holds the literal "latest", and the name it binds, or (None, None)."""
    lines = text.splitlines()
    at = next((n for n, line in enumerate(lines) if '"latest"' in line), None)
    if at is None:
        return None, None
    start = next((n for n in range(at, -1, -1)
                  if re.match(r"\s*(let\s|(pub(\([a-z]+\))?\s+)?fn\s)", lines[n])), None)
    if start is None:
        return None, None
    indent = len(lines[start]) - len(lines[start].lstrip())
    end = next((n for n in range(at, len(lines))
                if lines[n].strip().endswith(";") or (lines[n].strip() == "}"
                                                      and len(lines[n]) - len(lines[n].lstrip()) <= indent)),
               len(lines) - 1)
    m = re.match(r"\s*(?:let\s+(?:mut\s+)?|(?:pub(?:\([a-z]+\))?\s+)?fn\s+)([a-z_][a-z0-9_]*)", lines[start])
    return "\n".join(lines[start:end + 1]), m.group(1) if m else None


class Only_that_name(Case):
    """After its read of the machine's image the run and its checks use only the run's own names.

    The text cases of the support code accept these shapes, as the telemetry scan needs the literal at each site:
    - a start site's image is one quoted string without whitespace that starts `aws-emulator:` and interpolates its
      tag: `format!("aws-emulator:{…}", …)` in Rust, a template literal `aws-emulator:${…}` in TypeScript (a literal
      tag, or a name joined with `+`, is not accepted);
    - each `docker run` holds `--pull never` (or `--pull=never`) between its `"run"` and the image, or the next
      `"run"` where its image is added later;
    - check.rs makes the tag in one `let` or `fn` statement that holds the literal `"latest"`, the variable name as
      the literal `"EMUFORGE_IT_RUN_ID"` and a format string starting `"it-{`, and no `process::id`; a const for the
      variable name, or a second helper the statement calls, is not accepted;
    - emulator.rs and volume.rs name that statement's binding (or a struct field set from it, `field: binding`)
      within two lines before or one after each image string, and neither reads `EMUFORGE_IT_RUN_ID`;
    - env.ts: exactly one field of what `runEnv()` returns is `it-<run id>`, and that field is `latest` without the
      variable.
    """

    @classmethod
    def setUpClass(cls):
        cls.fx = shared("only-that-name", machine=tree_labelled("1.0.2", "c2"), move=dict(version="1.0.3", commit="c3"))

    def after_read(self):
        reads = self.fx.machine_reads()
        self.assertTrue(reads, f"the machine's image was never read{self.fx.why()}")
        return [c for c in self.fx.docker() if c["n"] > reads[0]["n"]]

    def test_the_version_stays_the_runs_when_the_name_moves(self):
        fx = self.fx
        self.ended(fx, 0)
        self.assertEqual(fx.raw()["emulator_version"], "1.0.2", fx.why())
        self.assertTrue([line for line in fx.lines() if line.startswith("integration: emulator 1.0.2 (")], fx.why())
        last = [line for line in fx.lines() if line.strip()][-1]
        self.assertRegex(last, r"^relay fidelity \d+/\d+ emulator 1\.0\.2 commit \S+$")

    def test_no_call_after_the_read_names_the_bare_name(self):
        fx = self.fx
        later = self.after_read()
        bare = [c["args"] for c in later
                if [a for i, a in enumerate(c["args"]) if a in (NAME, NAME + ":latest")
                    and (i == 0 or c["args"][i - 1] != "--entrypoint")]]
        self.assertEqual(bare, [], "calls naming the image aws-emulator after its read")
        self.assertIsNotNone(fx.run_id, fx.why())
        # the image of `docker run -d ... <image> -p <port> -t off` is the argument before its last -p
        self.assertEqual([a[len(a) - 2 - a[::-1].index("-p")] for a in (c["args"] for c in fx.detached())],
                         [fx.pin], f"the run's emulator start: {[c['args'] for c in fx.detached()]}")
        own = {fx.pin, fx.product_name}
        named = [a[a.index("--version") - 1] for a in (c["args"] for c in fx.version_reads())]
        self.assertTrue(named, fx.why())
        self.assertEqual([n for n in named if n not in own and not n.startswith("sha256:")], [], named)

    def test_every_docker_run_has_pull_never_and_every_version_read_network_none(self):
        fx = self.fx
        runs = [c["args"] for c in fx.docker() if c["args"][:1] == ["run"]]
        self.assertTrue(runs, fx.why())

        def has(args, flag, value):
            return any(a == f"{flag}={value}" or (a == flag and i + 1 < len(args) and args[i + 1] == value)
                       for i, a in enumerate(args))

        self.assertEqual([a for a in runs if not has(a, "--pull", "never")], [], "docker run without --pull never")
        self.assertEqual([a for a in runs if "--version" in a and not has(a, "--network", "none")], [],
                         "--version read without --network none")

    def test_no_call_tags_or_builds_the_bare_name(self):
        def bare(a):
            return a in (NAME, NAME + ":latest")

        found = []
        for c in self.fx.docker():
            a = c["args"]
            if a[:1] == ["tag"] and len(a) >= 3 and bare(a[2]):
                found.append(a)
            if a[:1] == ["build"] and any(bare(a[i + 1]) for i, x in enumerate(a[:-1]) if x in ("--tag", "-t")):
                found.append(a)
            if a[:1] == ["compose"] and bare(c["images"].get("EMUFORGE_EMULATOR_IMAGE", "")):
                found.append(a)
        self.assertEqual(found, [])

    def test_the_support_codes_starts_name_a_tag_that_is_not_a_literal_and_have_pull_never(self):
        for path in (SUPPORT / "emulator.rs", SUPPORT / "volume.rs", STUDIO_SUPPORT / "emulator.ts"):
            with self.subTest(path=path.name):
                args = arguments(path)
                runs = [k for k, (s, _) in enumerate(args) if s == "run"]
                images = [k for k, (s, _) in enumerate(args) if is_image(s)]
                self.assertTrue(runs and images, f"{path}: no docker run of the image found")
                for k in images:
                    s, line = args[k]
                    self.assertRegex(s, r"^aws-emulator:[^\s]*\{", f"{path}:{line}: {s!r} is not aws-emulator:<tag>")
                for r in runs:
                    stop = next((k for k in images + runs if k > r), len(args))
                    window = [s for s, _ in args[r + 1:stop + 1]]
                    ok = "--pull=never" in window or any(window[i:i + 2] == ["--pull", "never"]
                                                         for i in range(len(window)))
                    self.assertTrue(ok, f"{path}:{args[r][1]}: docker run without --pull never: {window}")

    def test_the_telemetry_scan_still_finds_the_start_sites_and_reports_nothing(self):
        sites, _ = scan(CHECKOUT, tracked_files(CHECKOUT), REPO_SCAN_EXCLUDED)
        found = {(s.path, s.kind) for s in sites}
        for path in ("tests/integration/run", "tests/integration/engine/support/emulator.rs",
                     "tests/integration/studio/support/emulator.ts", "tests/integration/engine/support/volume.rs"):
            self.assertIn((path, "start"), found, f"start site not found in {path}")
        self.assertEqual(findings(sites), [])

    def run_env(self, run_id):
        """What runEnv() of the checkout's env.ts returns in a bun process, EMUFORGE_IT_RUN_ID set to `run_id`."""
        bun = shutil.which("bun")
        self.assertTrue(bun, "bun is not on PATH: the runEnv() cases need it")
        d = CHECKOUT / "output" / "tests" / GROUP / "env-ts"
        d.mkdir(parents=True, exist_ok=True)
        script = d / "print-run-env.ts"
        env_ts = STUDIO_SUPPORT / "env.ts"
        script.write_text(f"import {{ runEnv }} from {json.dumps(str(env_ts))};\n"
                          "console.log(JSON.stringify(runEnv()));\n")
        env = {"PATH": f"{os.path.dirname(bun)}{os.pathsep}/usr/bin:/bin", "HOME": str(d),
               "EMUFORGE_IT_VERDICTS": str(d / "verdicts"), "EMULATOR_PORT": "40001",
               "EMUFORGE_ENGINE_PORT": "40002", "EMUFORGE_STUDIO_PORT": "40003",
               "EMUFORGE_IT_ENGINE_BIN": str(d / "emuforge-server")}
        if run_id is not None:
            env["EMUFORGE_IT_RUN_ID"] = run_id
        p = subprocess.run([bun, str(script)], capture_output=True, text=True, env=env, cwd=str(d), timeout=60,
                           stdin=subprocess.DEVNULL)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout.strip().splitlines()[-1]), p

    def test_run_env_returns_the_tag_of_the_run_id_and_latest_without_one(self):
        with_id, _ = self.run_env("123-45")
        keys = [k for k, v in with_id.items() if v == "it-123-45"]
        self.assertEqual(len(keys), 1, f"runEnv() fields equal to it-123-45: {keys} in {with_id}")
        without, _ = self.run_env(None)
        self.assertEqual(without[keys[0]], "latest", without)
        self.assertNotEqual(without["runId"], "latest")

    def test_check_rs_makes_the_tag_from_the_variable_itself_with_latest_without_it(self):
        text = code_text(SUPPORT / "check.rs")
        statement, name = tag_maker(text)
        self.assertIsNotNone(statement, 'check.rs makes no image tag: no statement holds the literal "latest"')
        self.assertIn('"EMUFORGE_IT_RUN_ID"', statement, statement)
        self.assertRegex(statement, r'"it-\{', statement)
        self.assertNotIn("process::id", statement, statement)
        self.assertIsNotNone(name, statement)

    def test_emulator_rs_and_volume_rs_take_the_tag_check_rs_makes(self):
        text = code_text(SUPPORT / "check.rs")
        statement, name = tag_maker(text)
        self.assertIsNotNone(name, 'check.rs makes no image tag: no statement holds the literal "latest"')
        names = {name} | set(re.findall(rf"\b([a-z_][a-z0-9_]*)\s*:\s*{name}\b", text))
        for path in (SUPPORT / "emulator.rs", SUPPORT / "volume.rs"):
            with self.subTest(path=path.name):
                code = code_text(path)
                self.assertNotIn("EMUFORGE_IT_RUN_ID", code)
                lines = code.splitlines()
                for s, line in [a for a in arguments(path) if is_image(a[0])]:
                    near = "\n".join(lines[max(0, line - 3):line + 2])
                    self.assertTrue(any(re.search(rf"\b{n}\b", near) for n in names),
                                    f"{path}:{line}: the image {s!r} does not take {sorted(names)} of check.rs")
                    self.assertNotIn("process::id", near, f"{path}:{line}")

    def test_the_readme_product_stage_names_the_runs_image_its_comparisons_and_a_failed_build(self):
        text = README.read_text()
        m = re.search(r"(?ms)^## Product stage\n(.*?)(?=^## )", text)
        self.assertIsNotNone(m, "README.md has no ## Product stage")
        section = " ".join(m.group(1).split())
        self.assertIn("aws-emulator:it-<run id>", section)
        self.assertRegex(section, r"(?i)machine's image")
        self.assertRegex(section, r"(?i)product build's emulator")
        sentences = re.split(r"(?<=\.) ", section)
        failed = [s for s in sentences if re.search(r"(?i)emulator image", s)
                  and re.search(r"(?i)(does not|did not|fails to|cannot|not) build|build (fails|failed)", s)
                  and re.search(r"(?i)before any check", s)]
        self.assertTrue(failed, "no sentence says a failed emulator image build ends the run before any check")


class Failure_and_cleanup(Case):
    """A build that fails or does not end, and the run's image removed however the run ends."""

    def test_a_build_that_exits_1_fails_every_check_and_nothing_starts(self):
        fx = build_failed()
        self.ended(fx, 1)
        self.every_check(fx, "failed", f"the emulator image did not build (exit 1), see {fx.build_log}")
        self.assertIsNone(self.image(fx))
        self.assertEqual(fx.compose_builds(), [], "the product compose ... build was started")
        self.nothing_started(fx)

    def test_with_a_not_run_list_the_listed_checks_are_not_run_and_the_rest_failed(self):
        fx = Fixture("build-fail-not-run", machine=unlabelled(), emulator_build="fail")
        self.addCleanup(fx.end)
        listing = fx.case / "list.json"
        listing.write_text(json.dumps(dict(checks=[dict(id=i, reason=r, issue=54) for i, r in LISTED.items()])))
        fx.run("--not-run", listing)
        self.ended(fx, 1)
        report = fx.report()
        self.assertIsNotNone(report, fx.why())
        for check_id, why in LISTED.items():
            self.assertEqual((report[check_id]["verdict"], report[check_id]["message"]), ("not-run", why))
        self.every_check(fx, "failed", f"the emulator image did not build (exit 1), see {fx.build_log}",
                         but=set(LISTED))

    def test_a_build_that_does_not_end_within_its_bound_is_an_error_and_is_ended(self):
        fx = Fixture("build-hang", machine=unlabelled(), emulator_build="hang", bound=LOWERED)
        self.addCleanup(fx.end)
        self.assertTrue(fx.lowered, "no emulator_build_bound=600 in run to lower")
        fx.start()
        build = fx.wait_build("emulator")
        self.assertIsNotNone(build, f"the stand-in emulator build never started{fx.why()}")
        fx.wait(build["started"] + LOWERED + SLACK)
        self.ended(fx, 127)
        self.every_check(fx, "error", f"the emulator image build did not end within {LOWERED} s, see {fx.build_log}")
        self.assertEqual(len(fx.build_pids()), 2, fx.why())
        self.assertEqual(left(fx.build_pids()), [], f"alive after the run ended{fx.why()}")

    def test_a_build_that_exits_124_by_itself_is_the_bound(self):
        fx = shared("build-exit124", machine=unlabelled(), emulator_build="exit124")
        self.ended(fx, 127)
        self.every_check(fx, "error", f"the emulator image build did not end within {SHIPPED} s, see {fx.build_log}")

    def test_the_shipped_bound_is_600(self):
        self.assertEqual(EMULATOR_BOUND_SETTING.findall(RUN.read_text()), [str(SHIPPED)],
                         f"emulator_build_bound settings in {RUN}")

    def test_a_run_that_ends_normally_removes_its_image_with_the_two_names_last(self):
        fx = default_run()
        self.ended(fx, 0)
        last = fx.docker()[-1]["args"]
        self.assertEqual(last[:2], ["image", "rm"], last)
        self.assertEqual(sorted(last[2:]), sorted([fx.pin, f"emuforge-it-product-{fx.run_id}", fx.product_name]),
                         last)
        self.assertEqual([c["args"] for c in fx.docker() if c["args"][:2] == ["image", "rm"]
                          and [a for a in c["args"][2:] if a in (NAME, NAME + ":latest")]], [])

    def test_the_image_is_removed_after_the_machine_refusal(self):
        self.pin_removed(machine_older())

    def test_the_image_is_removed_after_the_product_refusal(self):
        self.pin_removed(product_newer())

    def test_the_image_is_removed_after_a_failed_build(self):
        self.pin_removed(build_failed())

    def test_the_image_is_removed_after_a_sigterm_during_the_product_build(self):
        fx = Fixture("sigterm", machine=unlabelled(), product_build="hang")
        self.addCleanup(fx.end)
        fx.start()
        build = fx.wait_build("product")
        self.assertIsNotNone(build, f"the stand-in product build never started{fx.why()}")
        try:
            os.killpg(fx.proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        fx.wait(time.time() + STOP_WITHIN)
        self.assertIsNotNone(fx.code, f"the run had not ended {STOP_WITHIN} s after the SIGTERM{fx.why()}")
        self.pin_removed(fx)


if __name__ == "__main__":
    unittest.main()
