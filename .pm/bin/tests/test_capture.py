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
            held = holding(FIRST_FREE)  # None: something else holds 8090 already, which is the same condition
            if held:
                self.addCleanup(held.close)
            self.assertExit(self.structure("--serve", PAGES / "full"), 0)
            self.assertGreaterEqual(used_port(), FIRST_FREE + 1)

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

    def test_empty_slot_matches(self):
        site = self.site([])
        p = self.structure("--serve", site, "--port", free_port(), "--state", "empty", spec=self.SPEC)
        self.assertIn(p.returncode, (0, 1), f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")
        s = statuses(self.result("empty", self.SCREEN))
        self.assertEqual(s["table.empty.title"], "matched")
        self.assertEqual(s["table.empty.action"], "matched")


if __name__ == "__main__":
    unittest.main()
