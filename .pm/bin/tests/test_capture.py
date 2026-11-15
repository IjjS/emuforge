"""pm-structure browser runs: real headless Chromium from @playwright/test against fixture pages served on loopback.

Needs `@playwright/test` (and its Chromium) in this checkout's `studio/node_modules`; every case fails, never
skips, without it. Each case runs this checkout's `.pm/bin/pm-structure` on a fixture worktree under
<checkout>/output/tests/capture-<case>-<pid>/wt whose `studio/node_modules` is a symlink to this checkout's and
whose `.git` file points nowhere (git never finds this checkout); the directory is removed when the case ends.

Pages: `fixtures/structure/pages/<case>/index.html`, served with `--serve` (the spec's route falls back to
`index.html`), each scored against `specs/bucket-list.yaml`. The Cloudscape fixture (`fixtures/structure/cloudscape/`,
its spec beside it) is copied into <checkout>/studio/output/structure-cloudscape-<pid>/, built there with the
checkout's Studio Vite, and served from two copies of the build: one whose `data.json` holds three buckets
(state seeded) and one whose `data.json` holds none (state empty).

Result fields read (design 2.2, 2.5): the snapshot `<screen>-<state>.ax.json` (`url`, `viewport`, `browser`,
`nodes`), the result `<screen>-<state>.json` (`items[]` with `id` and `status`, `url`, `viewport`, `browser`,
and the blocked URLs among its values).

Issue 8: the wizard pages `fixtures/structure/pages/wizard-<case>/index.html` read `?step=<k>` and render that
step; they are scored against `specs/wizard.yaml` (screen `iam.create-role`). A wizard run writes the steps file
`<screen>-<state>.ax.json` (`pm-structure-steps/1`) and the result's `step_urls`; a file of a single step left under
`<wt>/output/structure/` is any file there whose name holds `step` (the screen's name holds none). The
Cloudscape wizard fixture (`fixtures/structure/cloudscape-wizard/`, its spec beside it) is built like the
Cloudscape fixture, into <checkout>/studio/output/structure-cloudscape-wizard-<pid>/.

Issue 21: every page is an AWS area screen, so each fixture page holds its content in one `<div class="aws-area">`
(decisions.md R9.2 a). "The frame" is markup before the area in `<body>`: a `<header>` with the link `Skip to
content`, the buttons `Empty` and `Frame only` and the navigation `Studio` with the link `Home`. The pages
`frame-around`, `no-area`, `two-areas`, `area-hidden`, `area-empty`, `area-late`, `area-too-late`, `area-replaced`,
`wizard-frame` and `wizard-no-area-step2` are described in their own comment. `cloudscape-frame/index.html` is put
over a copy of `cloudscape/` and built like the Cloudscape fixture, into
<checkout>/studio/output/structure-cloudscape-frame-<pid>/. `CaptureChild` runs the capture script itself with
node, as `_pmbrowse.capture` does, on a job written by the case.
"""
import http.server
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import threading
import unittest
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]
FIXTURES = HERE / "fixtures" / "structure"
PAGES = FIXTURES / "pages"
CLOUDSCAPE = FIXTURES / "cloudscape"
BUCKET_LIST = FIXTURES / "specs" / "bucket-list.yaml"
STUDIO = CHECKOUT / "studio"
NODE_MODULES = STUDIO / "node_modules"
ROUTE = "/s3/buckets"
FIRST_FREE = 8090

BUCKETS = [{"name": "bucket-a", "region": "us-east-1", "created": "November 14, 2026"},
           {"name": "bucket-b", "region": "eu-west-1", "created": "November 13, 2026"},
           {"name": "bucket-c", "region": "ap-northeast-2", "created": "November 12, 2026"}]


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def clean_env(**extra):
    """The caller's environment without git variables that would point git at another repository."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(extra)
    return env


def browsers_path():
    """Where Playwright finds its browsers for this user: PLAYWRIGHT_BROWSERS_PATH, else the default cache."""
    if os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
        return os.environ["PLAYWRIGHT_BROWSERS_PATH"]
    home = pathlib.Path.home()
    if sys.platform == "darwin":
        return str(home / "Library" / "Caches" / "ms-playwright")
    return str(pathlib.Path(os.environ.get("XDG_CACHE_HOME", home / ".cache")) / "ms-playwright")


def holding(port):
    """A listening socket on 127.0.0.1:port, or None when something else already holds the port."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        s.listen(1)
    except OSError:
        s.close()
        return None
    return s


def statuses(result):
    return {i["id"]: i["status"] for i in result["items"]}


def values(obj):
    """Every string inside a JSON value."""
    if isinstance(obj, dict):
        for v in obj.values():
            yield from values(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from values(v)
    elif isinstance(obj, str):
        yield obj


class CaptureCase(unittest.TestCase):
    def setUp(self):
        if not (NODE_MODULES / "@playwright" / "test").exists():
            self.fail(f"@playwright/test is not installed in {STUDIO}; the browser cases need it")
        self.root = CHECKOUT / "output" / "tests" / f"capture-{self._testMethodName}-{os.getpid()}"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.root, True)
        self.wt = self.root / "wt"
        (self.wt / "studio").mkdir(parents=True)
        os.symlink(NODE_MODULES, self.wt / "studio" / "node_modules")
        (self.wt / ".git").write_text("gitdir: ./missing-gitdir\n")  # git stops here instead of finding the checkout
        self.out = self.wt / "output" / "structure"

    def structure(self, *args, spec=BUCKET_LIST, env=None):
        cmd = [str(BIN / "pm-structure"), str(self.wt), str(spec), *[str(a) for a in args]]
        return subprocess.run(cmd, capture_output=True, text=True, env=env or clean_env(), timeout=180)

    def serve(self, case, *args, port=None, **kw):
        return self.structure("--serve", PAGES / case, "--port", port or free_port(), *args, **kw)

    def result(self, state="seeded", screen="s3.bucket-list"):
        return json.loads((self.out / f"{screen}-{state}.json").read_text())

    def snapshot(self, state="seeded", screen="s3.bucket-list"):
        return json.loads((self.out / f"{screen}-{state}.ax.json").read_text())

    def assertExit(self, p, code):
        self.assertEqual(p.returncode, code, f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")

    def assertOneErrorLine(self, p, contains):
        lines = p.stderr.splitlines()
        self.assertEqual(len(lines), 1, p.stderr)
        self.assertTrue(lines[0].startswith("pm-structure: "), lines[0])
        self.assertIn(contains, lines[0])
        return lines[0]

    def reasons(self, p):
        return [ln for ln in p.stdout.splitlines() if ln.startswith("reason: ")]

    def blocked_lines(self, p):
        lines = p.stdout.splitlines()
        start = next(i for i, ln in enumerate(lines) if ln.startswith("blocked requests ("))
        return lines[start], lines[start + 1:-1]

    def files_under_output(self):
        base = self.wt / "output"
        return [p for p in base.rglob("*") if p.is_file()] if base.exists() else []

    def assertNowhere(self, markers, runs):
        for marker in markers:
            for p in runs:
                self.assertNotIn(marker, p.stdout)
                self.assertNotIn(marker, p.stderr)
            for f in self.files_under_output():
                self.assertNotIn(marker.encode(), f.read_bytes(), f"{marker!r} found in {f}")


class Pages(CaptureCase):
    def test_full_match_and_rescore(self):
        p = self.serve("full")
        self.assertExit(p, 0)
        self.assertIn(" score=100.0 ", p.stdout.splitlines()[0])
        ax = self.out / "s3.bucket-list-seeded.ax.json"
        again = self.structure("--snapshot", ax)
        self.assertExit(again, 0)
        self.assertEqual(again.stdout.encode(), p.stdout.encode())

    def test_missing_region_column(self):
        p = self.serve("no-region")
        self.assertExit(p, 1)
        self.assertTrue(any("table.columns[AWS Region]" in r for r in self.reasons(p)), p.stdout)

    def test_primary_action_renamed(self):
        p = self.serve("primary-renamed")
        self.assertExit(p, 1)
        self.assertTrue(any("header.primary_action" in r for r in self.reasons(p)), p.stdout)

    def test_title_missing(self):
        p = self.serve("no-title")
        self.assertExit(p, 1)
        self.assertTrue(any("header.title" in r for r in self.reasons(p)), p.stdout)

    def test_hidden_elements_unmatched(self):
        p = self.serve("hidden")  # Empty: display: none; Delete: aria-hidden="true"
        self.assertIn(p.returncode, (0, 1), p.stderr)
        s = statuses(self.result())
        self.assertEqual(s["header.actions[Empty]"], "unmatched")
        self.assertEqual(s["header.actions[Delete]"], "unmatched")
        self.assertEqual(s["header.actions[Create bucket]"], "matched")

    def test_same_page_twice(self):
        port = free_port()
        first = self.serve("full", port=port)
        self.assertExit(first, 0)
        snap1 = self.snapshot()
        second = self.serve("full", port=port)
        self.assertExit(second, 0)
        snap2 = self.snapshot()
        self.assertEqual(snap1, snap2)
        self.assertEqual(first.stdout.encode(), second.stdout.encode())

    def test_content_after_one_second_is_matched(self):
        p = self.serve("delayed")
        self.assertExit(p, 0)
        s = statuses(self.result())
        for item in ("header.title", "table.columns[Name]", "table.columns[AWS Region]", "table.columns[Creation date]"):
            self.assertEqual(s[item], "matched", item)

    def test_never_settles(self):
        port = free_port()
        p = self.serve("restless", port=port)
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, f"http://127.0.0.1:{port}{ROUTE} did not settle within 10 s")

    def test_foreign_request_blocked(self):
        p = self.serve("foreign")
        self.assertExit(p, 0)  # decided by the items alone
        header, listed = self.blocked_lines(p)
        self.assertEqual(header, "blocked requests (1)")
        self.assertTrue(any("http://example.com/x.js" in ln for ln in listed), p.stdout)
        self.assertFalse(any("ok.js" in ln for ln in listed), p.stdout)
        self.assertIn("http://example.com/x.js", list(values(self.result())))
        names = [n["name"] for n in self.snapshot()["nodes"]]
        self.assertIn("ok.js loaded", names)  # the loopback script was served and ran

    def test_redirect_to_foreign_host_blocked(self):
        port = free_port()
        p = self.serve("redirect", port=port)
        self.assertExit(p, 0)
        header, listed = self.blocked_lines(p)
        self.assertEqual(header, "blocked requests (1)")
        self.assertTrue(any("http://example.com/elsewhere" in ln for ln in listed), p.stdout)
        snap = self.snapshot()
        self.assertEqual(snap["url"], f"http://127.0.0.1:{port}{ROUTE}")
        self.assertEqual(statuses(self.result())["header.title"], "matched")

    def test_no_browser_installed(self):
        empty = self.root / "no-browsers"
        empty.mkdir()
        p = self.serve("full", env=clean_env(PLAYWRIGHT_BROWSERS_PATH=str(empty)))
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, "browser did not start: ")
        self.assertEqual(os.listdir(empty), [])

    def test_serve_port_in_use(self):
        port = free_port()
        held = holding(port)
        self.assertIsNotNone(held)
        self.addCleanup(held.close)
        p = self.serve("full", port=port)
        self.assertExit(p, 2)
        line = self.assertOneErrorLine(p, f"static server did not start on port {port}: ")
        log = line.split(f"static server did not start on port {port}: ", 1)[1]
        self.assertTrue(os.path.isfile(log), log)

    def test_serve_missing_directory(self):
        p = self.structure("--serve", self.root / "missing-build", "--port", free_port())
        self.assertExit(p, 2)
        line = self.assertOneErrorLine(p, "static server did not start on port ")
        m = re.search(r"static server did not start on port (\d+): (.+)$", line)
        self.assertIsNotNone(m, line)
        self.assertTrue(os.path.isfile(m.group(2)), m.group(2))

    def test_serve_port_choice(self):
        def used_port():
            return urllib.parse.urlsplit(self.result()["url"]).port

        with self.subTest(case="--port"):
            port = free_port()
            self.assertExit(self.serve("full", port=port), 0)
            self.assertEqual(used_port(), port)
        with self.subTest(case="ports.json"):
            port = free_port()
            ports = self.wt / "output" / "ports.json"
            ports.parent.mkdir(parents=True, exist_ok=True)
            ports.write_text(json.dumps({"studio": port, "engine": 1, "emulator": 2}))
            self.assertExit(self.structure("--serve", PAGES / "full"), 0)
            self.assertEqual(used_port(), port)
            ports.unlink()
        with self.subTest(case="first free from 8090"):
            # hold the first port this process can bind from 8090 up (8090 itself unless another process has it),
            # so another worktree releasing 8090 meanwhile cannot hand the run a port at or below the held one
            held_port, held = next((n, h) for n in range(FIRST_FREE, FIRST_FREE + 200) if (h := holding(n)))
            self.addCleanup(held.close)
            self.assertExit(self.structure("--serve", PAGES / "full"), 0)
            self.assertGreater(used_port(), held_port)

    def test_url_nothing_listening(self):
        port = free_port()
        p = self.structure("--url", f"http://127.0.0.1:{port}")
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, f"cannot open http://127.0.0.1:{port}")

    def test_url_answers_404(self):
        class NotFound(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", "10")
                self.end_headers()
                self.wfile.write(b"not found\n")

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), NotFound)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        port = server.server_address[1]
        p = self.structure("--url", f"http://127.0.0.1:{port}")
        self.assertExit(p, 2)
        line = self.assertOneErrorLine(p, f"cannot open http://127.0.0.1:{port}")
        self.assertTrue(line.endswith(": 404"), line)

    def test_viewport_and_browser_recorded(self):
        self.assertExit(self.serve("full"), 0)
        for name, record in (("snapshot", self.snapshot()), ("result", self.result())):
            with self.subTest(file=name):
                self.assertEqual(record["viewport"], {"width": 1280, "height": 800})
                self.assertIsInstance(record["browser"], str)
                self.assertRegex(record["browser"], r"\d+\.\d+")

    def test_storage_state(self):
        """The job file named by the criteria line is deleted when the run ends (test_browse requires it), so the
        scan of <wt>/output/ cannot see it; that it holds the storage state's path and never its content is kept
        by code read (design 2.4) and recorded in decisions.md, Review decisions."""
        marker = "cookie-value-6f1d2c9a-never-in-output"
        state = self.root / "storage-state.json"
        state.write_text(json.dumps({"cookies": [{
            "name": "emuforge_fixture_session", "value": marker, "domain": "127.0.0.1", "path": "/",
            "expires": -1, "httpOnly": False, "secure": False, "sameSite": "Lax"}], "origins": []}))
        port = free_port()
        with_state = self.serve("cookie-title", "--storage-state", state, port=port)
        self.assertExit(with_state, 0)
        self.assertEqual(statuses(self.result())["header.title"], "matched")
        self.assertNowhere([marker], [with_state])
        without = self.serve("cookie-title", port=port)
        self.assertExit(without, 1)
        self.assertEqual(statuses(self.result())["header.title"], "unmatched")
        self.assertNowhere([marker], [with_state, without])

    def test_caller_secrets_never_reach_output(self):
        home = self.root / "home"
        (home / ".aws").mkdir(parents=True)
        file_marker = "decoy-credentials-marker-3b7e"
        (home / ".aws" / "credentials").write_text(
            f"[default]\naws_access_key_id = {file_marker}\naws_secret_access_key = {file_marker}\n")
        profile, secret = "decoy-profile-9c41", "decoy-secret-a52f"
        env = clean_env(AWS_PROFILE=profile, AWS_SECRET_ACCESS_KEY=secret, HOME=str(home),
                        PLAYWRIGHT_BROWSERS_PATH=browsers_path())
        p = self.serve("full", env=env)
        self.assertExit(p, 0)
        self.assertNowhere([file_marker, profile, secret], [p])

    def test_empty_state(self):
        p = self.serve("empty", "--state", "empty")
        self.assertExit(p, 0)
        self.assertTrue((self.out / "s3.bucket-list-empty.json").is_file())
        s = statuses(self.result("empty"))
        self.assertEqual(s["table.empty.title"], "matched")
        self.assertEqual(s["table.empty.action"], "matched")
        self.assertEqual(s["table.selection"], "not-applicable")


class Cloudscape(CaptureCase):
    """The page built from real Cloudscape components scores 100 against its spec (requirement 8)."""

    SPEC = CLOUDSCAPE / "spec.yaml"
    SCREEN = "s3.cloudscape-fixture"
    _build = None

    @classmethod
    def tearDownClass(cls):
        if cls._build is not None:
            shutil.rmtree(cls._build[0], True)

    def build(self):
        """Build the fixture once per run with the checkout's Studio Vite; returns its dist directory."""
        cls = type(self)
        if cls._build is None:
            work = STUDIO / "output" / f"structure-cloudscape-{os.getpid()}"
            if work.exists():
                shutil.rmtree(work)
            shutil.copytree(CLOUDSCAPE, work, ignore=shutil.ignore_patterns("spec.yaml"))
            vite = NODE_MODULES / ".bin" / "vite"
            env = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "LANG") if k in os.environ}
            p = subprocess.run([str(vite), "build", str(work), "--outDir", "dist", "--emptyOutDir", "--logLevel",
                                "warn"], cwd=work, capture_output=True, text=True, env=env, timeout=300)
            cls._build = (work, p)
        work, p = cls._build
        if p.returncode != 0 or not (work / "dist" / "index.html").is_file():
            self.fail(f"vite build of the Cloudscape fixture failed ({p.returncode}):\n{p.stdout}\n{p.stderr}")
        return work / "dist"

    def site(self, items):
        site = self.root / "site"
        shutil.copytree(self.build(), site)
        (site / "data.json").write_text(json.dumps({"items": items}))
        return site

    def test_seeded_scores_100(self):
        site = self.site(BUCKETS)
        p = self.structure("--serve", site, "--port", free_port(), spec=self.SPEC)
        self.assertExit(p, 0)
        lines = p.stdout.splitlines()
        self.assertIn(" score=100.0 ", lines[0])
        self.assertIn("unmatched (0)", lines)

    def test_seeded_snapshot_is_the_areas_tree(self):
        """Issue 21: the snapshot is the area's tree; the score is test_seeded_scores_100's."""
        site = self.site(BUCKETS)
        p = self.structure("--serve", site, "--port", free_port(), spec=self.SPEC)
        self.assertIn(p.returncode, (0, 1), f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")
        nodes = self.snapshot(screen=self.SCREEN)["nodes"]
        self.assertEqual([n for n in nodes if n["role"] == "RootWebArea"], [])
        self.assertIsNone(nodes[0]["parent"], nodes[0])

    def test_empty_slot_matches(self):
        site = self.site([])
        p = self.structure("--serve", site, "--port", free_port(), "--state", "empty", spec=self.SPEC)
        self.assertIn(p.returncode, (0, 1), f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")
        s = statuses(self.result("empty", self.SCREEN))
        self.assertEqual(s["table.empty.title"], "matched")
        self.assertEqual(s["table.empty.action"], "matched")


# ---------------------------------------------------------------------------------------------------- issue 8

WIZARD = FIXTURES / "specs" / "wizard.yaml"
WIZARD_SCREEN = "iam.create-role"
WIZARD_ROUTE = "/aws/iam/roles/create"
CLOUDSCAPE_WIZARD = FIXTURES / "cloudscape-wizard"


class WizardCaptureCase(CaptureCase):
    def wizard(self, case, *args, spec=WIZARD, port=None, **kw):
        return self.structure("--serve", PAGES / case, "--port", port or free_port(), *args, spec=spec, **kw)

    def wizard_result(self):
        return self.result(screen=WIZARD_SCREEN)

    def steps_file(self):
        return self.out / f"{WIZARD_SCREEN}-seeded.ax.json"

    def step_files(self):
        """Files of a single step left under <wt>/output/structure/."""
        return sorted(p.name for p in self.out.iterdir() if "step" in p.name) if self.out.exists() else []

    def step_logs(self):
        logs = self.wt / "output" / "logs"
        return sorted(p.name for p in logs.glob(f"structure-capture-{WIZARD_SCREEN}-seeded-step*.log")) \
            if logs.exists() else []


class WizardPages(WizardCaptureCase):
    def test_full_steps_file_and_rescore(self):
        p = self.wizard("wizard-full")
        self.assertExit(p, 0)
        self.assertIn(" score=100.0 ", p.stdout.splitlines()[0])
        steps = json.loads(self.steps_file().read_text())
        self.assertEqual(steps["format"], "pm-structure-steps/1")
        self.assertEqual(len(steps["steps"]), 3)
        for k, entry in enumerate(steps["steps"], 1):
            self.assertEqual(entry["format"], "pm-structure-snapshot/1")
            self.assertTrue(entry["url"].endswith(f"{WIZARD_ROUTE}?step={k}"), entry["url"])
        again = self.structure("--snapshot", self.steps_file(), spec=WIZARD)
        self.assertExit(again, 0)
        self.assertEqual(again.stdout.encode(), p.stdout.encode())
        self.assertEqual(list(self.out.glob("*.step*.tmp.json")), [])

    def test_page_ignoring_the_step(self):
        p = self.wizard("wizard-ignores-step")
        self.assertExit(p, 1)
        reasons = " ".join(self.reasons(p))
        for item in ("steps[Add permissions].title", "steps[Name, review, and create].title", "submit"):
            self.assertIn(item, reasons, p.stdout)

    def test_page_validating_on_next(self):
        p = self.wizard("wizard-validates")
        self.assertExit(p, 0)
        self.assertIn(" score=100.0 ", p.stdout.splitlines()[0])
        # a click on Next would add the alert "Use case is required." to step 1's tree
        step1 = json.loads(self.steps_file().read_text())["steps"][0]["nodes"]
        self.assertEqual([n for n in step1 if n["role"] == "alert" or "is required" in n["name"]], [])

    def test_step_answering_404(self):
        index = (PAGES / "wizard-full" / "index.html").read_bytes()

        class StepTwoMissing(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                body, status, kind = (b"not found\n", 404, "text/plain") if query.get("step") == ["2"] \
                    else (index, 200, "text/html; charset=utf-8")
                self.send_response(status)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), StepTwoMissing)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_address[1]}"
        p = self.structure("--url", base, spec=WIZARD)
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, f"cannot open {base}{WIZARD_ROUTE}?step=2: 404")
        self.assertFalse(self.steps_file().exists())
        self.assertEqual(self.step_files(), [])
        self.assertEqual(self.wizard_result()["verdict"], "error")
        self.assertEqual(self.wizard_result()["url"], f"{base}{WIZARD_ROUTE}?step=1")

    def test_step_never_settling(self):
        port = free_port()
        p = self.wizard("wizard-restless-step3", port=port)
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, f"http://127.0.0.1:{port}{WIZARD_ROUTE}?step=3 did not settle within 10 s")
        self.assertEqual(list(self.out.glob("*.ax.json")), [])
        self.assertEqual(self.step_files(), [])

    def test_foreign_request_on_one_step(self):
        p = self.wizard("wizard-foreign-step2")
        self.assertExit(p, 0)  # decided by the items alone
        header, listed = self.blocked_lines(p)
        self.assertEqual(header, "blocked requests (1)")
        self.assertEqual(len([ln for ln in listed if "http://example.com/x.js" in ln]), 1, p.stdout)

    def test_one_capture_log_per_step_one_server(self):
        port = free_port()
        self.assertExit(self.wizard("wizard-full", port=port), 0)
        self.assertEqual(self.step_logs(), [f"structure-capture-{WIZARD_SCREEN}-seeded-step{k}.log" for k in (1, 2, 3)])
        urls = self.wizard_result()["step_urls"]
        self.assertEqual(len(urls), 3)
        self.assertEqual({urllib.parse.urlsplit(u).port for u in urls}, {port})

    def test_same_wizard_page_twice(self):
        port = free_port()
        first = self.wizard("wizard-full", port=port)
        self.assertExit(first, 0)
        steps1 = json.loads(self.steps_file().read_text())
        second = self.wizard("wizard-full", port=port)
        self.assertExit(second, 0)
        steps2 = json.loads(self.steps_file().read_text())
        self.assertEqual(steps1, steps2)
        self.assertEqual(first.stdout.encode(), second.stdout.encode())

    def test_omitted_step_is_not_opened(self):
        p = self.wizard("wizard-full", spec=FIXTURES / "specs" / "wizard-omit-step.yaml")
        self.assertIn(p.returncode, (0, 1), f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")
        log = (self.wt / "output" / "logs" / "structure-server.log").read_text()
        self.assertIn(f"{WIZARD_ROUTE}?step=1 ", log)
        self.assertIn(f"{WIZARD_ROUTE}?step=2 ", log)
        self.assertNotIn("step=3", log)

    def test_url_not_loopback_refused_before_any_step(self):
        port = free_port()
        p = self.structure("--url", f"http://10.0.0.1:{port}", spec=WIZARD)
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, f"refused: http://10.0.0.1:{port} is not a loopback address")
        self.assertEqual(self.step_logs(), [])
        self.assertEqual(self.step_files(), [])

    def test_caller_secrets_never_reach_a_wizard_run(self):
        profile, secret = "decoy-profile-wizard-5d2e", "decoy-secret-wizard-81c7"
        p = self.wizard("wizard-full", env=clean_env(AWS_PROFILE=profile, AWS_SECRET_ACCESS_KEY=secret))
        self.assertExit(p, 0)
        self.assertTrue(self.steps_file().is_file())
        self.assertNowhere([profile, secret], [p])


class CloudscapeWizard(CaptureCase):
    """The page built from real Cloudscape Wizard, opened at ?step=<k>, scores 100 against its spec (requirement 8)."""

    SPEC = CLOUDSCAPE_WIZARD / "spec.yaml"
    _build = None

    @classmethod
    def tearDownClass(cls):
        if cls._build is not None:
            shutil.rmtree(cls._build[0], True)

    def build(self):
        """Build the fixture once per run with the checkout's Studio Vite; returns its dist directory."""
        cls = type(self)
        if cls._build is None:
            work = STUDIO / "output" / f"structure-cloudscape-wizard-{os.getpid()}"
            if work.exists():
                shutil.rmtree(work)
            shutil.copytree(CLOUDSCAPE_WIZARD, work, ignore=shutil.ignore_patterns("spec.yaml"))
            vite = NODE_MODULES / ".bin" / "vite"
            env = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "LANG") if k in os.environ}
            p = subprocess.run([str(vite), "build", str(work), "--outDir", "dist", "--emptyOutDir", "--logLevel",
                                "warn"], cwd=work, capture_output=True, text=True, env=env, timeout=300)
            cls._build = (work, p)
        work, p = cls._build
        if p.returncode != 0 or not (work / "dist" / "index.html").is_file():
            self.fail(f"vite build of the Cloudscape wizard fixture failed ({p.returncode}):\n{p.stdout}\n{p.stderr}")
        return work / "dist"

    def test_cloudscape_wizard_scores_100(self):
        p = self.structure("--serve", self.build(), "--port", free_port(), spec=self.SPEC)
        self.assertExit(p, 0)
        lines = p.stdout.splitlines()
        self.assertIn(" score=100.0 ", lines[0])
        self.assertIn("unmatched (0)", lines)

    def test_steps_hold_no_root_web_area(self):
        """Issue 21: each step's snapshot is the area's tree; the score is test_cloudscape_wizard_scores_100's."""
        p = self.structure("--serve", self.build(), "--port", free_port(), spec=self.SPEC)
        self.assertIn(p.returncode, (0, 1), f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")
        steps = json.loads((self.out / "iam.cloudscape-wizard-fixture-seeded.ax.json").read_text())["steps"]
        self.assertTrue(steps)
        for k, entry in enumerate(steps, 1):
            self.assertEqual([n for n in entry["nodes"] if n["role"] == "RootWebArea"], [], f"step {k}")


# ---------------------------------------------------------------------------------------------------- issue 21

FRAME_NAMES = ("Frame only", "Home", "Skip to content")  # the frame's own names; its Empty is named in each case
FRAME_ROLES = ("RootWebArea", "banner")


def group(stdout, title):
    """The rows of one group of the standard output (`<title> (<n>)` then indented rows)."""
    lines = stdout.splitlines()
    start = next(i for i, ln in enumerate(lines) if re.fullmatch(re.escape(title) + r" \(\d+\)", ln))
    rows = []
    for ln in lines[start + 1:]:
        if not ln.startswith("  "):
            break
        rows.append(ln[2:])
    return rows


class AreaCase(CaptureCase):
    def scored_items(self, result):
        return {i["id"]: i["status"] for i in result["items"] if i["status"] in ("matched", "unmatched")}

    def assertOnlyUnmatched(self, result, unmatched):
        s = self.scored_items(result)
        self.assertEqual(sorted(k for k, v in s.items() if v == "unmatched"), sorted(unmatched), s)

    def assertAreaError(self, p, port, message, screen="s3.bucket-list"):
        self.assertExit(p, 2)
        line = self.assertOneErrorLine(p, message)
        self.assertEqual(line, f"pm-structure: {message}")
        result = self.result(screen=screen)
        self.assertEqual(result["verdict"], "error")
        self.assertEqual(result["error"], message)
        self.assertEqual(list(self.out.glob("*.ax.json")), [])


class AreaPages(AreaCase):
    def test_frame_button_never_matches(self):
        """The regression of the issue: on main the frame's Empty matches header.actions[Empty] (score 100.0)."""
        p = self.serve("frame-around")
        self.assertExit(p, 0)
        self.assertIn(" score=94.1 (16/17) ", p.stdout.splitlines()[0])
        self.assertEqual(group(p.stdout, "unmatched"), ['header.actions[Empty]    button|link "Empty"'])
        result = self.result()
        self.assertOnlyUnmatched(result, ["header.actions[Empty]"])
        self.assertEqual(len(self.scored_items(result)), 17)
        detail = next(i["detail"] for i in result["items"] if i["id"] == "header.actions[Empty]")
        self.assertEqual(detail, 'button|link "Empty"')

    def test_frame_never_an_extra(self):
        """The page has no main, so every node is considered for extras (#4 R5.6); none of the frame's is one."""
        p = self.serve("frame-around")
        self.assertIn(p.returncode, (0, 1), f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")
        rows = group(p.stdout, "extra")
        for name in FRAME_NAMES + ("Empty",):
            self.assertFalse(any(json.dumps(name) in r for r in rows), rows)
            self.assertNotIn(name, [e["name"] for e in self.result()["extras"]])

    def test_snapshot_holds_the_area_only(self):
        port = free_port()
        p = self.serve("frame-around", port=port)
        self.assertIn(p.returncode, (0, 1), f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")
        snap = self.snapshot()
        self.assertEqual(snap["format"], "pm-structure-snapshot/1")
        nodes = snap["nodes"]
        for name in FRAME_NAMES + ("Empty",):
            self.assertEqual([n for n in nodes if n["name"] == name], [], name)
        for role in FRAME_ROLES:
            self.assertEqual([n for n in nodes if n["role"] == role], [], role)
        self.assertEqual(snap["url"], f"http://127.0.0.1:{port}{ROUTE}")
        self.assertEqual(snap["viewport"], {"width": 1280, "height": 800})
        self.assertTrue(snap["browser"].startswith("chromium "), snap["browser"])

    def test_area_snapshot_rescored(self):
        p = self.serve("frame-around")
        self.assertExit(p, 0)
        self.assertIn(" score=94.1 (16/17) ", p.stdout.splitlines()[0])  # the run scored the area's tree
        again = self.structure("--snapshot", self.out / "s3.bucket-list-seeded.ax.json")
        self.assertEqual(again.returncode, p.returncode, f"stdout:\n{again.stdout}\nstderr:\n{again.stderr}")
        self.assertEqual(again.stdout.encode(), p.stdout.encode())

    def test_no_area_root(self):
        port = free_port()
        p = self.serve("no-area", port=port)
        self.assertAreaError(p, port, f"http://127.0.0.1:{port}{ROUTE} has no AWS area root (class aws-area)")

    def test_two_area_roots(self):
        port = free_port()
        p = self.serve("two-areas", port=port)
        self.assertAreaError(p, port, f"http://127.0.0.1:{port}{ROUTE} has 2 AWS area roots (class aws-area)")

    def test_hidden_area_root(self):
        port = free_port()
        p = self.serve("area-hidden", port=port)
        self.assertAreaError(p, port,
                             f"http://127.0.0.1:{port}{ROUTE}: the AWS area root is not in the accessibility tree")

    def test_empty_area_is_scored(self):
        p = self.serve("area-empty")
        self.assertExit(p, 1)
        self.assertIn(" score=17.6 (3/17) ", p.stdout.splitlines()[0])
        result = self.result()
        s = self.scored_items(result)
        self.assertEqual(sorted(k for k, v in s.items() if v == "matched"),
                         ["breadcrumbs.order", "header.actions.order", "table.columns.order"], s)
        self.assertEqual(len(s), 17)
        self.assertIn("reason: critical item unmatched: header.title, header.primary_action, table.columns[Name], "
                      "table.columns[AWS Region], table.columns[Creation date]", self.reasons(p))

    def test_area_after_load_while_changing(self):
        p = self.serve("area-late")
        self.assertExit(p, 0)
        self.assertIn(" score=94.1 (16/17) ", p.stdout.splitlines()[0])
        self.assertOnlyUnmatched(self.result(), ["header.actions[Empty]"])

    def test_area_after_settling(self):
        port = free_port()
        p = self.serve("area-too-late", port=port)
        self.assertExit(p, 2)
        line = self.assertOneErrorLine(p, f"{ROUTE} has no AWS area root (class aws-area)")
        self.assertEqual(line, f"pm-structure: http://127.0.0.1:{port}{ROUTE} has no AWS area root (class aws-area)")

    def test_area_root_replaced_never_settles(self):
        """The tree stays the same while the root element changes: the roots are part of settling (R3.3)."""
        port = free_port()
        p = self.serve("area-replaced", port=port)
        self.assertExit(p, 2)
        line = self.assertOneErrorLine(p, f"http://127.0.0.1:{port}{ROUTE} did not settle within 10 s")
        self.assertEqual(line, f"pm-structure: http://127.0.0.1:{port}{ROUTE} did not settle within 10 s")


class AreaWizardPages(AreaCase, WizardCaptureCase):
    def test_frame_button_never_submits(self):
        p = self.wizard("wizard-frame")
        self.assertExit(p, 1)
        self.assertIn("critical item unmatched: submit", " ".join(self.reasons(p)))
        self.assertEqual(self.reasons(p), ["reason: critical item unmatched: submit"])
        self.assertOnlyUnmatched(self.wizard_result(), ["submit"])
        steps = json.loads(self.steps_file().read_text())["steps"]
        for k, entry in enumerate(steps, 1):
            nodes = entry["nodes"]
            # decisions.md, PM decisions (wizard-frame, option a): the breadcrumb link "Create role" is the area's and
            # is matched, so the frame's "Create role" is told by its role, a button
            self.assertEqual([n for n in nodes if n["role"] == "button" and n["name"] == "Create role"], [],
                             f"step {k}")
            for name in ("Frame only", "Home"):
                self.assertEqual([n for n in nodes if n["name"] == name], [], f"step {k}: {name}")

    def test_step_without_area(self):
        port = free_port()
        p = self.wizard("wizard-no-area-step2", port=port)
        message = f"http://127.0.0.1:{port}{WIZARD_ROUTE}?step=2 has no AWS area root (class aws-area)"
        self.assertExit(p, 2)
        self.assertEqual(self.assertOneErrorLine(p, message), f"pm-structure: {message}")
        self.assertFalse(self.steps_file().exists())
        self.assertEqual(self.step_files(), [])


class CloudscapeFrame(AreaCase):
    """The real Cloudscape fixture with the frame before its area (requirement 7)."""

    SPEC = CLOUDSCAPE / "spec.yaml"
    SCREEN = "s3.cloudscape-fixture"
    PAGE = FIXTURES / "cloudscape-frame" / "index.html"
    _build = None

    @classmethod
    def tearDownClass(cls):
        if cls._build is not None:
            shutil.rmtree(cls._build[0], True)

    def build(self):
        """A copy of cloudscape/ with cloudscape-frame/index.html over its index.html, built once per run with the
        checkout's Studio Vite as the Cloudscape fixture is; returns its dist directory."""
        cls = type(self)
        if cls._build is None:
            work = STUDIO / "output" / f"structure-cloudscape-frame-{os.getpid()}"
            if work.exists():
                shutil.rmtree(work)
            shutil.copytree(CLOUDSCAPE, work, ignore=shutil.ignore_patterns("spec.yaml"))
            shutil.copyfile(self.PAGE, work / "index.html")
            vite = NODE_MODULES / ".bin" / "vite"
            env = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "LANG") if k in os.environ}
            p = subprocess.run([str(vite), "build", str(work), "--outDir", "dist", "--emptyOutDir", "--logLevel",
                                "warn"], cwd=work, capture_output=True, text=True, env=env, timeout=300)
            cls._build = (work, p)
        work, p = cls._build
        if p.returncode != 0 or not (work / "dist" / "index.html").is_file():
            self.fail(f"vite build of the Cloudscape frame fixture failed ({p.returncode}):\n{p.stdout}\n{p.stderr}")
        return work / "dist"

    def test_frame_around_cloudscape(self):
        site = self.root / "site"
        shutil.copytree(self.build(), site)
        (site / "data.json").write_text(json.dumps({"items": BUCKETS}))
        p = self.structure("--serve", site, "--port", free_port(), spec=self.SPEC)
        self.assertExit(p, 0)
        self.assertIn(" score=100.0 ", p.stdout.splitlines()[0])
        result = self.result(screen=self.SCREEN)
        nodes = self.snapshot(screen=self.SCREEN)["nodes"]
        for name in FRAME_NAMES:
            self.assertEqual([n for n in nodes if n["name"] == name], [], name)
        for role in FRAME_ROLES:
            self.assertEqual([n for n in nodes if n["role"] == role], [], role)
        for item in result["items"]:
            if item["node"] is not None:
                self.assertNotIn(item["node"]["name"], FRAME_NAMES, item)
        for extra in result["extras"]:
            self.assertNotIn(extra["name"], FRAME_NAMES + ("Empty",), extra)
        empties = [i for i, n in enumerate(nodes) if n["role"] == "button" and n["name"] == "Empty"]
        self.assertEqual(len(empties), 1, empties)
        empty = next(i for i in result["items"] if i["id"] == "header.actions[Empty]")
        self.assertEqual(empty["status"], "matched")
        self.assertEqual(empty["node"]["index"], empties[0])


class CaptureChild(unittest.TestCase):
    """The capture script run by itself, as `_pmbrowse.capture` runs it: `node <copy under studio/output/> <job>`."""

    def setUp(self):
        if not (NODE_MODULES / "@playwright" / "test").exists():
            self.fail(f"@playwright/test is not installed in {STUDIO}; the capture child needs it")
        self.root = CHECKOUT / "output" / "tests" / f"capture-{self._testMethodName}-{os.getpid()}"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.root, True)
        self.wt = self.root / "wt"
        (self.wt / "studio" / "output").mkdir(parents=True)
        os.symlink(NODE_MODULES, self.wt / "studio" / "node_modules")
        self.script = self.wt / "studio" / "output" / f".structure-capture-{os.getpid()}.mjs"
        shutil.copyfile(BIN / "_pmstructure_capture.mjs", self.script)
        self.out = self.wt / "output" / "structure" / "s3.bucket-list-seeded.ax.json"
        self.out.parent.mkdir(parents=True)
        refuse = socket.socket(socket.AF_INET, socket.SOCK_STREAM)  # bound, never listening, as _pmbrowse does
        refuse.bind(("127.0.0.1", 0))
        self.addCleanup(refuse.close)
        self.job = {"url": f"http://127.0.0.1:{free_port()}{ROUTE}", "out": str(self.out),
                    "viewport": {"width": 1280, "height": 800}, "settleMs": 250, "settleMax": 10000,
                    "navTimeout": 60000, "refuse": refuse.getsockname()[1]}

    def run_child(self, job):
        path = self.root / "job.json"
        path.write_text(json.dumps(job))
        return subprocess.run(["node", str(self.script), str(path)], cwd=self.wt / "studio", capture_output=True,
                              text=True, env=clean_env(PLAYWRIGHT_BROWSERS_PATH=browsers_path()), timeout=180)

    def test_job_without_valid_area_class_refused(self):
        """The job's url points at a loopback port nothing listens on: a child that opened it would exit 11."""
        for name, job in (("missing", dict(self.job)), ("not a class name", {**self.job, "areaClass": "aws area"})):
            with self.subTest(job=name):
                p = self.run_child(job)
                self.assertEqual(p.returncode, 13, f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")
                self.assertEqual(p.stderr.splitlines(), ["pm-structure-capture: job has no valid areaClass"])
                self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
