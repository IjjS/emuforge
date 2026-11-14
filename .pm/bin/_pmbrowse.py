"""The browser side of pm-structure: the loopback URL check, the static server, the run lock and the capture run.
Not a command.

  check_url(url)                           refuse a URL whose host is not a loopback IP address
  serve(dir, port[, log=, tries=])         context manager: a static server on 127.0.0.1, yields the server
  lock(out_dir, screen, state)             context manager: one run per screen and state in a worktree
  check_toolchain(wt), check_storage_state(path)
  capture(wt, url, out, job, storage_state)   run _pmstructure_capture.mjs with node; the snapshot lands at `out`

Every child process is started through _pmproc (argument list, no shell, the allowlisted environment, a timeout).
Errors are BrowseError with the one-line message of requirement 6; a held lock is Busy.
"""
import contextlib
import http.server
import ipaddress
import json
import os
import shutil
import stat
import subprocess
import threading
import time
import urllib.parse

import _pmproc

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "_pmstructure_capture.mjs")
MAX_STORAGE_STATE = 1024 * 1024
MAX_IN_FLIGHT = 16
RUN_TIMEOUT = 120
VIEWPORT = {"width": 1280, "height": 800}
SETTLE_MS, SETTLE_MAX, NAV_TIMEOUT = 250, 10000, 60000
# the capture script's exit codes (design 2.3)
LAUNCH, OPEN, SETTLE = 10, 11, 12
PREFIX = "pm-structure-capture: "
TYPES = {".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript",
         ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json",
         ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff",
         ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm"}


class BrowseError(Exception):
    pass


class Busy(Exception):
    """Another live run holds the lock of this screen and state."""


# ---------------------------------------------------------------------------------------------------- URL

def check_url(url):
    """Accept only http(s) URLs whose host is an IP literal in 127.0.0.0/8 or ::1; names, localhost included,
    are refused (requirement 6 and 7, design 6 N2)."""
    refused = BrowseError(f"refused: {url} is not a loopback address")
    try:
        parts = urllib.parse.urlsplit(url)
        parts.port  # noqa: B018 - raises ValueError on a malformed port
        host = parts.hostname
    except ValueError:
        raise refused from None
    if parts.scheme not in ("http", "https") or not host or parts.username is not None:
        raise refused
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        raise refused from None
    if not (ip.version == 4 and ip in ipaddress.ip_network("127.0.0.0/8")) and ip != ipaddress.ip_address("::1"):
        raise refused


def page_url(base, route):
    """The page opened for a spec: the base without its trailing / plus the spec's route."""
    return base.rstrip("/") + route


# ---------------------------------------------------------------------------------------------------- server

def _inside(root, path):
    return path == root or path.startswith(root + os.sep)


class _Handler(http.server.BaseHTTPRequestHandler):
    """GET and HEAD of files under the served directory, with the single-page fallback to index.html. Any other
    method is answered 501 by BaseHTTPRequestHandler. No CORS header is ever sent."""
    server_version = "pm-structure"
    sys_version = ""

    def _file(self):
        root = self.server.root
        try:
            rel = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
            path = os.path.realpath(os.path.join(root, rel.lstrip("/")))
            if _inside(root, path) and os.path.isfile(path):
                return path
        except (ValueError, OSError):
            pass
        index = os.path.realpath(os.path.join(root, "index.html"))
        return index if _inside(root, index) and os.path.isfile(index) else None

    def _send(self, body):
        path = self._file()
        if path is None:
            self.send_error(404)
            return
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404)
            return
        with f:
            self.send_response(200)
            self.send_header("Content-Type", TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream"))
            self.send_header("Content-Length", str(os.fstat(f.fileno()).st_size))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if body:
                shutil.copyfileobj(f, self.wfile)

    def do_GET(self):
        self._send(True)

    def do_HEAD(self):
        self._send(False)

    def log_message(self, fmt, *args):
        self.server.log(f"{self.command or '-'} {fmt % args}")


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def __init__(self, port, root, log):
        self.root = root
        self._log_file = log
        self._log_lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(MAX_IN_FLIGHT)
        super().__init__(("127.0.0.1", port), _Handler)

    def log(self, line):
        if self._log_file is None:
            return
        with self._log_lock:
            self._log_file.write(f"{time.strftime('%H:%M:%S')} {line}\n")
            self._log_file.flush()

    def process_request(self, request, client_address):
        self._slots.acquire()  # at most 16 requests in flight; the next waits here, in the listen backlog
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


@contextlib.contextmanager
def serve(directory, port, log=None, tries=1):
    """Serve `directory` on 127.0.0.1, on `port` or, with `tries` > 1, the first of `tries` ports from `port` that
    can be bound. Yields the running server (`.server_address[1]` is its port); stopped on exit. `log` is the path
    of the server log; a server that does not start raises BrowseError naming it."""
    logf = None
    if log is not None:
        os.makedirs(os.path.dirname(log), exist_ok=True)
        logf = open(log, "w", encoding="utf-8")
    try:
        def failed(n, why):
            if logf is not None:
                logf.write(f"static server did not start on port {n}: {why}\n")
                logf.flush()
            return BrowseError(f"static server did not start on port {n}: {log or 'no log'}")

        root = os.path.realpath(directory)
        if not os.path.isdir(root):
            raise failed(port, f"{directory} is not a directory")
        server = None
        for n in range(port, port + max(1, tries)):
            try:
                server = _Server(n, root, logf)
                break
            except OSError as e:
                last = e
        if server is None:
            raise failed(port, last.strerror or str(last))
        server.log(f"serving {root} on 127.0.0.1:{server.server_address[1]}")
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        thread.start()
        try:
            yield server
        finally:
            server.shutdown()
            server.server_close()
            thread.join(5)
    finally:
        if logf is not None:
            logf.close()


# ---------------------------------------------------------------------------------------------------- lock

def _alive(pid):
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _holder(path):
    """The PID in a lock file, None when the file is gone, 0 when it holds no PID."""
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read(32).strip()
    except FileNotFoundError:
        return None
    except OSError:
        return 0
    return int(text) if text.isdigit() else 0


@contextlib.contextmanager
def lock(out_dir, screen, state):
    """Hold <out_dir>/<screen>-<state>.lock for the run (design 2.4): created exclusively with this PID, removed
    at the end. A lock whose PID is alive raises Busy; one whose PID is gone is replaced."""
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{screen}-{state}.lock")
    busy = Busy(f"another run of {screen} state={state} is in progress")
    for _ in range(5):
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            pid = _holder(path)
            if pid is None:
                continue
            if pid == 0:  # just created by another run that has not written its PID yet
                try:
                    if time.time() - os.stat(path).st_mtime < 5:
                        raise busy
                except FileNotFoundError:
                    continue
            elif _alive(pid):
                raise busy
            if _holder(path) == pid:
                with contextlib.suppress(FileNotFoundError):
                    os.unlink(path)
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(f"{os.getpid()}\n")
        break
    else:
        raise busy
    try:
        yield path
    finally:
        if _holder(path) == os.getpid():
            with contextlib.suppress(FileNotFoundError):
                os.unlink(path)


# ---------------------------------------------------------------------------------------------------- capture

def check_toolchain(wt):
    studio = os.path.join(wt, "studio")
    if not os.path.isdir(os.path.join(studio, "node_modules", "@playwright", "test")):
        raise BrowseError(f"@playwright/test is not installed in {studio}; run bun install there first")


def check_storage_state(path):
    """A regular file of at most 1 MiB that can be opened; only its path is passed on, never its content."""
    def bad(why):
        return BrowseError(f"cannot read storage state {path}: {why}")
    try:
        st = os.stat(path)
    except OSError as e:
        raise bad(e.strerror or str(e)) from None
    if not stat.S_ISREG(st.st_mode):
        raise bad("not a regular file")
    if st.st_size > MAX_STORAGE_STATE:
        raise bad(f"larger than {MAX_STORAGE_STATE} bytes")
    try:
        with open(path, "rb"):
            pass
    except OSError as e:
        raise bad(e.strerror or str(e)) from None


def _message(stderr):
    """The capture script's own one-line message, else the first non-empty stderr line."""
    lines = [ln.strip() for ln in stderr.splitlines() if ln.strip()]
    own = [ln[len(PREFIX):] for ln in lines if ln.startswith(PREFIX)]
    return (own[-1] if own else lines[0] if lines else "no message").strip()


def capture(wt, url, out, job, storage_state=None, log=None):
    """Take the settled accessibility snapshot of `url` into `out` (design 2.3, 2.4). `job` is the job file's
    path; the job file and the script copy are removed afterwards, also on failure. `log` receives the child's
    stderr."""
    check_toolchain(wt)
    studio = os.path.join(wt, "studio")
    studio_out = os.path.join(studio, "output")
    os.makedirs(studio_out, exist_ok=True)
    script = os.path.join(studio_out, f".structure-capture-{os.getpid()}.mjs")
    spec = {"url": url, "out": os.path.abspath(out), "viewport": VIEWPORT, "settleMs": SETTLE_MS,
            "settleMax": SETTLE_MAX, "navTimeout": NAV_TIMEOUT}
    if storage_state is not None:
        spec["storageState"] = os.path.abspath(storage_state)
    try:
        shutil.copyfile(SCRIPT, script)
        with open(job, "w", encoding="utf-8") as f:
            json.dump(spec, f)
        try:
            p = _pmproc.run(["node", script, os.path.abspath(job)], timeout=RUN_TIMEOUT, cwd=studio)
        except subprocess.TimeoutExpired:
            raise BrowseError(f"browser run timed out after {RUN_TIMEOUT} s") from None
        except OSError as e:
            raise BrowseError(f"browser run failed: node: {e.strerror or e}") from None
    finally:
        for path in (job, script):
            with contextlib.suppress(FileNotFoundError):
                os.unlink(path)
    if log is not None:
        os.makedirs(os.path.dirname(log), exist_ok=True)
        with open(log, "w", encoding="utf-8") as f:
            f.write(p.stderr)
    if p.returncode == 0 and os.path.isfile(out):
        return
    if p.returncode == LAUNCH:
        raise BrowseError(f"browser did not start: {_message(p.stderr)}")
    if p.returncode == OPEN:
        raise BrowseError(f"cannot open {url}: {_message(p.stderr)}")
    if p.returncode == SETTLE:
        raise BrowseError(f"{url} did not settle within {SETTLE_MAX // 1000} s")
    raise BrowseError(f"browser run failed: {_message(p.stderr)}")
