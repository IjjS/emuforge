"""_pmbrowse without a browser: the loopback URL check, the static server, and the checks pm-structure makes
before (or instead of) driving the browser: Playwright present, the storage state, the lock, no files left behind.

Interface used (design 2.4): `_pmbrowse.check_url(url)` returns normally when the URL is accepted and raises an
exception whose `str()` is `refused: <url> is not a loopback address` when it is not. `_pmbrowse.serve(dir, port)`
is a context manager: on enter the server listens on 127.0.0.1:<port> and the value it yields is the
`http.server` server (its `.socket` is the listening socket); on exit it is stopped.

The pm-structure cases run this checkout's `.pm/bin/pm-structure` on a fixture worktree under
<checkout>/output/tests/browse-<case>-<pid>/wt, whose `studio/node_modules` is a symlink to this checkout's (unless
the case is about it being missing) and whose `.git` file points nowhere, so git never finds this checkout. The
directory is removed when the case ends. Requests go to 127.0.0.1 only.

"No browser" (the criteria heading) holds for `check_url` and `serve`. Of the `Structure` cases, the stale lock
(`cannot open`) and the files-left-behind case (`browser did not start`, `cannot open`, two scored `--serve` runs)
start the capture child, node with Playwright, so they need the checkout's Chromium like `test_capture.py`.
"""
import http.client
import json
import os
import pathlib
import shutil
import socket
import subprocess
import threading
import unittest

try:
    import _pmbrowse
except ImportError as e:  # every case fails on its own when the module does not exist
    _pmbrowse, IMPORT_ERROR = None, e

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]
FIXTURES = HERE / "fixtures" / "structure"
BUCKET_LIST = FIXTURES / "specs" / "bucket-list.yaml"
SNAPS = FIXTURES / "snapshots"
PAGES = FIXTURES / "pages"
NODE_MODULES = CHECKOUT / "studio" / "node_modules"
MIB = 1024 * 1024


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def dead_pid():
    """The PID of a process that has exited (and was reaped)."""
    p = subprocess.Popen(["/bin/sh", "-c", "exit 0"])
    p.wait()
    return p.pid


def clean_env(**extra):
    """The caller's environment without git variables that would point git at another repository."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(extra)
    return env


class BrowseCase(unittest.TestCase):
    def need_module(self):
        if _pmbrowse is None:
            self.fail(f"_pmbrowse cannot be imported: {IMPORT_ERROR}")

    def work_dir(self):
        d = CHECKOUT / "output" / "tests" / f"browse-{self._testMethodName}-{os.getpid()}"
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, d, True)
        return d


class CheckUrl(BrowseCase):
    def test_loopback_urls_accepted(self):
        self.need_module()
        for url in ("http://127.0.0.1:8100", "http://127.5.6.7:1", "http://[::1]:8100", "https://127.0.0.1:8443"):
            with self.subTest(url=url):
                _pmbrowse.check_url(url)

    def test_other_urls_refused(self):
        self.need_module()
        for url in ("http://localhost:8100", "http://10.0.0.1", "http://example.com", "http://127.0.0.1.nip.io",
                    "file:///x", "ftp://127.0.0.1"):
            with self.subTest(url=url):
                with self.assertRaises(Exception) as cm:
                    _pmbrowse.check_url(url)
                self.assertEqual(str(cm.exception), f"refused: {url} is not a loopback address")


class Serve(BrowseCase):
    def setUp(self):
        self.need_module()
        self.root = self.work_dir()
        self.site = self.root / "site"
        self.site.mkdir()
        self.index = b"<!doctype html><title>index</title>fixture index\n"
        (self.site / "index.html").write_bytes(self.index)
        (self.site / "assets").mkdir()
        self.asset = bytes(range(256)) * 4
        (self.site / "assets" / "app.bin").write_bytes(self.asset)
        self.secret = b"OUTSIDE-THE-SERVED-DIRECTORY\n"
        (self.root / "outside.txt").write_bytes(self.secret)
        os.symlink(self.root / "outside.txt", self.site / "link.txt")

    def serving(self, directory=None):
        port = free_port()
        cm = _pmbrowse.serve(str(directory or self.site), port)
        server = cm.__enter__()
        self.addCleanup(cm.__exit__, None, None, None)
        return port, server

    def request(self, port, method, path):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            c.request(method, path)
            r = c.getresponse()
            return r.status, r.read(), r.getheaders()
        finally:
            c.close()

    def test_files_fallback_and_confinement(self):
        port, _ = self.serving()
        status, body, _ = self.request(port, "GET", "/assets/app.bin")
        self.assertEqual((status, body), (200, self.asset))
        status, body, _ = self.request(port, "GET", "/s3/buckets")
        self.assertEqual((status, body), (200, self.index))
        for path in ("/../outside.txt", "/%2e%2e/outside.txt", "/assets/../../outside.txt", "/link.txt"):
            with self.subTest(path=path):
                status, body, _ = self.request(port, "GET", path)
                self.assertEqual(status, 200)
                self.assertEqual(body, self.index)
                self.assertNotIn(self.secret.strip(), body)

    def test_no_index_is_404(self):
        bare = self.root / "bare"
        bare.mkdir()
        (bare / "a.txt").write_text("a\n")
        port, _ = self.serving(bare)
        status, _, _ = self.request(port, "GET", "/unknown/route")
        self.assertEqual(status, 404)

    def test_binds_loopback_only(self):
        port, server = self.serving()
        self.assertEqual(server.socket.getsockname()[0], "127.0.0.1")
        try:  # a UDP connect sends no packet; it only asks the kernel which local address it would use
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as u:
                u.connect(("192.0.2.1", 9))
                address = u.getsockname()[0]
        except OSError:
            address = None
        if not address or address.startswith("127."):
            print("\n  not run: the machine has no non-loopback IPv4 address, only the bound address was checked")
            return
        with self.assertRaises(ConnectionRefusedError):
            socket.create_connection((address, port), timeout=5).close()

    def test_post_refused_and_no_cors(self):
        port, _ = self.serving()
        status, _, _ = self.request(port, "POST", "/index.html")
        self.assertIn(status, (405, 501))
        for method in ("GET", "HEAD", "POST", "OPTIONS"):
            with self.subTest(method=method):
                _, _, headers = self.request(port, method, "/index.html")
                self.assertNotIn("access-control-allow-origin", [k.lower() for k, _ in headers])

    def test_seventeen_clients_at_once(self):
        port, _ = self.serving()
        n = 17
        barrier = threading.Barrier(n)
        results = [None] * n

        def client(i):
            barrier.wait(timeout=10)
            try:
                results[i] = self.request(port, "GET", "/assets/app.bin")[:2]
            except OSError as e:
                results[i] = e

        threads = [threading.Thread(target=client, args=(i,)) for i in range(n)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        self.assertEqual(results, [(200, self.asset)] * n)


class Structure(BrowseCase):
    """pm-structure's own checks around the browser run."""

    def setUp(self):
        self.root = self.work_dir()
        self.wt = self.root / "wt"
        (self.wt / "studio").mkdir(parents=True)
        (self.wt / ".git").write_text("gitdir: ./missing-gitdir\n")  # git stops here instead of finding the checkout
        self.out = self.wt / "output" / "structure"

    def link_node_modules(self):
        if not (NODE_MODULES / "@playwright" / "test").exists():
            self.fail(f"@playwright/test is not installed in {CHECKOUT / 'studio'}")
        os.symlink(NODE_MODULES, self.wt / "studio" / "node_modules")

    def structure(self, *args, env=None):
        cmd = [str(BIN / "pm-structure"), str(self.wt), *[str(a) for a in args]]
        return subprocess.run(cmd, capture_output=True, text=True, env=env or clean_env(), timeout=180)

    def assertExit(self, p, code):
        self.assertEqual(p.returncode, code, f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")

    def assertOneErrorLine(self, p, contains):
        lines = p.stderr.splitlines()
        self.assertEqual(len(lines), 1, p.stderr)
        self.assertTrue(lines[0].startswith("pm-structure: "), lines[0])
        self.assertIn(contains, lines[0])

    def leftovers(self):
        found = []
        if self.out.exists():
            found += [p.name for p in self.out.iterdir() if p.name.endswith((".lock", ".job.json"))]
        studio_out = self.wt / "studio" / "output"
        if studio_out.exists():
            found += [p.name for p in studio_out.iterdir() if p.name.startswith(".structure-capture")]
        return found

    def test_url_refused_before_any_process(self):
        self.link_node_modules()
        p = self.structure(BUCKET_LIST, "--url", "http://localhost:1")
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, "refused: http://localhost:1 is not a loopback address")
        self.assertEqual(list(self.out.glob("*.ax.json")) if self.out.exists() else [], [])
        self.assertEqual(list(self.out.glob("*.job.json")) if self.out.exists() else [], [])
        self.assertFalse((self.wt / "studio" / "output").exists(), "no capture script was copied")

    def test_playwright_missing(self):
        p = self.structure(BUCKET_LIST, "--url", f"http://127.0.0.1:{free_port()}")
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, f"@playwright/test is not installed in {self.wt}/studio; run bun install there first")

    def test_storage_state_unreadable(self):
        self.link_node_modules()
        big = self.root / "big-state.json"
        big.write_bytes(b"{" + b" " * MIB + b"}")  # 1 MiB + 2 bytes
        cases = {"missing": self.root / "missing-state.json", "directory": self.root, "larger than 1 MiB": big}
        for name, path in cases.items():
            with self.subTest(case=name):
                p = self.structure(BUCKET_LIST, "--url", f"http://127.0.0.1:{free_port()}", "--storage-state", path)
                self.assertExit(p, 2)
                self.assertOneErrorLine(p, "storage state")
                self.assertIn(str(path), p.stderr)

    def test_lock_held_by_live_pid(self):
        self.link_node_modules()
        self.out.mkdir(parents=True)
        (self.out / "s3.bucket-list-seeded.lock").write_text(f"{os.getpid()}\n")
        p = self.structure(BUCKET_LIST, "--url", f"http://127.0.0.1:{free_port()}")
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, "another run of s3.bucket-list state=seeded is in progress")

    def test_stale_lock_is_replaced(self):
        self.link_node_modules()
        self.out.mkdir(parents=True)
        lock = self.out / "s3.bucket-list-seeded.lock"
        lock.write_text(f"{dead_pid()}\n")
        url = f"http://127.0.0.1:{free_port()}"  # nothing listens: the run gets past the lock and cannot open it
        p = self.structure(BUCKET_LIST, "--url", url)
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, f"cannot open {url}")
        self.assertNotIn("another run", p.stderr)
        self.assertFalse(lock.exists(), "the replaced lock is removed when the run ends")

    def test_nothing_left_behind(self):
        self.link_node_modules()
        empty_browsers = self.root / "no-browsers"
        empty_browsers.mkdir()
        port = free_port()
        runs = {
            "refused url": (["--url", "http://localhost:1"], None, 2, "refused:"),
            "storage state missing": (["--url", f"http://127.0.0.1:{port}", "--storage-state",
                                       self.root / "missing-state.json"], None, 2, "storage state"),
            "browser did not start": (["--url", f"http://127.0.0.1:{port}"],
                                      clean_env(PLAYWRIGHT_BROWSERS_PATH=str(empty_browsers)), 2,
                                      "browser did not start: "),
            "cannot open": (["--url", f"http://127.0.0.1:{port}"], None, 2, f"cannot open http://127.0.0.1:{port}"),
            "browser run scored pass": (["--serve", PAGES / "full", "--port", free_port()], None, 0, None),
            "browser run scored fail": (["--serve", PAGES / "no-region", "--port", free_port()], None, 1, None),
            "scored pass": (["--snapshot", SNAPS / "full-seeded.json"], None, 0, None),
            "scored fail": (["--snapshot", SNAPS / "missing-aws-region.json"], None, 1, None),
        }
        for name, (args, env, code, message) in runs.items():
            with self.subTest(run=name):
                p = self.structure(BUCKET_LIST, *args, env=env)
                self.assertExit(p, code)
                if message:
                    self.assertOneErrorLine(p, message)
                self.assertEqual(self.leftovers(), [])


if __name__ == "__main__":
    unittest.main()
