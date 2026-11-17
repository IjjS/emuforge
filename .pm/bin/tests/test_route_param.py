"""Issue 302: a route parameter in a spec (`{name}`, R1), its value given by `pm-structure --param` (R2), the page
opened at the filled route (R3), the route named in the report, the result and the row (R4), nothing changed for a
spec without a parameter (R5), and the guides' sentences (R6). One class per heading of the test criteria.

Interface used (design, section 2): `_pmspec.load(path).params` is the tuple of the route's parameter names in
route order, `()` without one; `_pmspec.fill_route(route, values)` takes the route and a mapping from each name to
its value and returns the filled route.

The `pm-structure` cases copy this checkout's .pm/bin (without tests/) into
<checkout>/output/tests/route-param-<case>-<pid>/, whose copied _pmlib.py takes that directory as its ROOT, so
--record writes there and never to the real .pm/. The fixture worktree beside it, wt/, holds an empty `studio/`
and a `.git` file that points nowhere, so git never finds this checkout. `Opened` and `Unchanged` link
`wt/studio/node_modules` to this checkout's and start headless Chromium against the fixture pages, the way
`test_browse.py` does; the other classes start no browser. Requests go to 127.0.0.1 only; no emulator is used.
The directory is removed when the case ends.

Fixtures (`fixtures/structure/`): `specs/param-detail.yaml` (route `/aws/apigateway/apis/{id}`) and
`param-detail-literal.yaml` (the same with `/aws/apigateway/apis/abc123`), `specs/param-two.yaml`
(`/aws/apigateway/apis/{api}/stages/{stage}`, needs both states), `specs/param-wizard.yaml`
(`/aws/apigateway/apis/{id}/edit`, three steps), the pages `pages/param-detail`, `param-two`, `param-wizard`, and
`snapshots/param-detail.json`, on which `param-detail.yaml` scores 100.
"""
import http.server
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import threading
import unittest

try:
    import _pmspec
except ImportError as e:  # every unit case fails on its own when the module cannot be imported
    _pmspec, IMPORT_ERROR = None, e

HERE = pathlib.Path(__file__).resolve().parent
BIN = HERE.parent
CHECKOUT = BIN.parents[1]
FIXTURES = HERE / "fixtures" / "structure"
SPECS = FIXTURES / "specs"
PAGES = FIXTURES / "pages"
SNAPS = FIXTURES / "snapshots"
PARAM_DETAIL = SPECS / "param-detail.yaml"
PARAM_LITERAL = SPECS / "param-detail-literal.yaml"
PARAM_TWO = SPECS / "param-two.yaml"
PARAM_WIZARD = SPECS / "param-wizard.yaml"
BUCKET_LIST = SPECS / "bucket-list.yaml"
STUDIO_BUCKET_LIST = CHECKOUT / "studio" / "references" / "console" / "s3" / "bucket-list.yaml"
PARAM_SNAPSHOT = SNAPS / "param-detail.json"
NODE_MODULES = CHECKOUT / "studio" / "node_modules"
CONSOLE = CHECKOUT / "studio" / "references" / "console-reference.md"
CRIT = CHECKOUT / ".agents" / "skills" / "pm" / "references" / "briefs" / "crit.md"

DETAIL = "apigateway.rest-api"
TWO = "apigateway.stage-list"
WIZARD = "apigateway.edit-api"
ISSUE = "302"
SEGMENT_ERROR = "route: { and } are only for a whole path segment {name}"
TWICE_ERROR = "route: parameter {id} is used twice"
BAD_VALUE = "--param id: the value must be 1 to 256 printable characters and not . or .."
REFUSED = "refused: http://localhost:1 is not a loopback address"


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def clean_env():
    """The caller's environment without git variables that would point git at another repository."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def with_route(text, route):
    """`text` (a spec) with its one `route:` line replaced by `route: <route>`."""
    new, n = re.subn(r"(?m)^route: .*$", lambda _: f"route: {route}", text)
    if n != 1:
        raise AssertionError(f"the spec has {n} route lines, not one")
    return new


def status_map(result):
    return {i["id"]: i["status"] for i in result["items"]}


# ---------------------------------------------------------------------------------------------------- unit

class UnitCase(unittest.TestCase):
    def setUp(self):
        if _pmspec is None:
            self.fail(f"_pmspec cannot be imported: {IMPORT_ERROR}")
        self.root = CHECKOUT / "output" / "tests" / f"route-param-{self._testMethodName}-{os.getpid()}"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.root, True)

    def spec(self, route, base=PARAM_DETAIL, name="spec.yaml"):
        p = self.root / name
        p.write_text(with_route(base.read_text(), route))
        return p

    def params(self, spec):
        if not hasattr(spec, "params"):
            self.fail("the loaded Spec has no attribute params")
        return spec.params

    def fill_route(self, route, values):
        if not hasattr(_pmspec, "fill_route"):
            self.fail("_pmspec has no fill_route")
        return _pmspec.fill_route(route, values)

    def assertSpecError(self, route, ending):
        path = self.spec(route)
        with self.assertRaises(_pmspec.SpecError) as cm:
            _pmspec.load(str(path))
        self.assertTrue(str(cm.exception).endswith(ending), str(cm.exception))
        return cm.exception


class SpecRoute(UnitCase):
    """`_pmspec.load` reads the route's parameters (R1)."""

    def test_one_parameter(self):
        spec = _pmspec.load(str(self.spec("/aws/apigateway/apis/{id}")))
        self.assertEqual(self.params(spec), ("id",))
        self.assertEqual(spec.route, "/aws/apigateway/apis/{id}")

    def test_two_parameters_in_route_order(self):
        spec = _pmspec.load(str(self.spec("/aws/apigateway/apis/{api}/stages/{stage}")))
        self.assertEqual(self.params(spec), ("api", "stage"))

    def test_names_of_1_and_32_characters(self):
        long = "a" + ("b0_" * 11)[:31]
        self.assertEqual(len(long), 32)
        for name in ("a", long):
            with self.subTest(name=name):
                spec = _pmspec.load(str(self.spec(f"/aws/apigateway/apis/{{{name}}}")))
                self.assertEqual(self.params(spec), (name,))

    def test_name_of_33_characters(self):
        e = self.assertSpecError("/aws/apigateway/apis/{" + "a" * 33 + "}", SEGMENT_ERROR)
        self.assertEqual(e.screen, DETAIL)

    def test_brace_not_a_whole_segment(self):
        for route in ("/apis/x{id}", "/apis/{id}s", "/apis/{}", "/apis/{Id}", "/apis/{1a}", "/apis/{a-b}",
                      "/apis/{id", "/apis/id}", "/apis?x={id}", "/apis#{id}"):
            with self.subTest(route=route):
                self.assertSpecError(route, SEGMENT_ERROR)

    def test_name_twice(self):
        self.assertSpecError("/apis/{id}/stages/{id}", TWICE_ERROR)

    def test_route_without_braces(self):
        for route in ("/s3/buckets", "/s3/buckets/create?tab=general"):
            with self.subTest(route=route):
                spec = _pmspec.load(str(self.spec(route)))
                self.assertEqual(self.params(spec), ())
                self.assertEqual(spec.route, route)

    def test_wizard_fixture(self):
        self.assertEqual(self.params(_pmspec.load(str(PARAM_WIZARD))), ("id",))

    def test_specs_on_main_have_no_parameter(self):
        # dashboard.yaml is left out: it is the fixture of a refused kind (test_records.py), so it never loads
        paths = [p for p in sorted(SPECS.glob("*.yaml")) if not p.name.startswith("param-")
                 and p.name != "dashboard.yaml"] + [STUDIO_BUCKET_LIST]
        for path in paths:
            with self.subTest(spec=str(path)):
                self.assertEqual(self.params(_pmspec.load(str(path))), ())


class FillRoute(UnitCase):
    """`_pmspec.fill_route` puts each value into its segment percent-encoded (R3.1)."""

    ROUTE = "/aws/apigateway/apis/{id}"

    def test_unreserved_characters_stay(self):
        self.assertEqual(self.fill_route(self.ROUTE, {"id": "abc-123_X.y~z"}), "/aws/apigateway/apis/abc-123_X.y~z")

    def test_slashes_encoded(self):
        self.assertEqual(self.fill_route(self.ROUTE, {"id": "/p302/group/a"}),
                         "/aws/apigateway/apis/%2Fp302%2Fgroup%2Fa")

    def test_arn_encoded(self):
        self.assertEqual(self.fill_route(self.ROUTE, {"id": "arn:aws:sns:us-east-1:000000000000:p302-topic"}),
                         "/aws/apigateway/apis/arn%3Aaws%3Asns%3Aus-east-1%3A000000000000%3Ap302-topic")

    def test_every_other_byte_encoded_into_one_segment(self):
        cases = {"a b": "a%20b", "%41": "%2541", "a?b": "a%3Fb", "a#b": "a%23b", "a@b": "a%40b", "a\\b": "a%5Cb",
                 "//evil.example/x": "%2F%2Fevil.example%2Fx", "é": "%C3%A9"}
        for value, ending in cases.items():
            with self.subTest(value=value):
                got = self.fill_route(self.ROUTE, {"id": value})
                self.assertTrue(got.endswith(ending), got)
                self.assertEqual(got.count("/"), 4, got)
                self.assertNotIn("?", got)
                self.assertNotIn("#", got)

    def test_two_parameters(self):
        self.assertEqual(self.fill_route("/aws/apigateway/apis/{api}/stages/{stage}", {"api": "a1", "stage": "s/2"}),
                         "/aws/apigateway/apis/a1/stages/s%2F2")

    def test_query_kept_as_written(self):
        self.assertEqual(self.fill_route("/x/{id}?tab=a", {"id": "v"}), "/x/v?tab=a")

    def test_route_without_parameter(self):
        self.assertEqual(self.fill_route("/s3/buckets", {}), "/s3/buckets")


# ---------------------------------------------------------------------------------------------------- pm-structure

class StructureCase(unittest.TestCase):
    def setUp(self):
        self.root = CHECKOUT / "output" / "tests" / f"route-param-{self._testMethodName}-{os.getpid()}"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.addCleanup(shutil.rmtree, self.root, True)
        shutil.copytree(BIN, self.root / ".pm" / "bin", ignore=shutil.ignore_patterns("tests", "__pycache__"))
        self.bin = self.root / ".pm" / "bin"
        self.wt = self.root / "wt"
        (self.wt / "studio").mkdir(parents=True)
        (self.wt / ".git").write_text("gitdir: ./missing-gitdir\n")  # git stops here instead of finding the checkout
        self.out = self.wt / "output" / "structure"

    def link_node_modules(self):
        if not (NODE_MODULES / "@playwright" / "test").exists():
            self.fail(f"@playwright/test is not installed in {CHECKOUT / 'studio'}")
        os.symlink(NODE_MODULES, self.wt / "studio" / "node_modules")

    def structure(self, *args):
        cmd = [str(self.bin / "pm-structure"), str(self.wt), *[str(a) for a in args]]
        return subprocess.run(cmd, capture_output=True, text=True, env=clean_env(), timeout=180)

    def spec(self, route, base=PARAM_DETAIL, name="spec.yaml"):
        p = self.root / name
        p.write_text(with_route(base.read_text(), route))
        return p

    def result(self, screen=DETAIL, state="seeded"):
        return json.loads((self.out / f"{screen}-{state}.json").read_text())

    def result_path(self, screen=DETAIL, state="seeded"):
        return self.out / f"{screen}-{state}.json"

    def issue(self):
        (self.root / ".pm" / f"issue-{ISSUE}").mkdir(parents=True, exist_ok=True)

    def rows(self):
        return json.loads((self.root / ".pm" / f"issue-{ISSUE}" / "structure-scores.json").read_text())

    def assertExit(self, p, code):
        self.assertEqual(p.returncode, code, f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")

    def assertOneErrorLine(self, p, contains):
        lines = p.stderr.splitlines()
        self.assertEqual(len(lines), 1, p.stderr)
        self.assertTrue(lines[0].startswith("pm-structure: "), lines[0])
        self.assertIn(contains, lines[0])

    def assertUsageError(self, p, ending):
        self.assertExit(p, 2)
        self.assertIn("usage:", p.stderr)
        last = p.stderr.splitlines()[-1]
        self.assertTrue(last.startswith("pm-structure: error: "), last)
        self.assertTrue(last.endswith(ending), last)

    def assertNoRunFile(self):
        """No snapshot, lock or job file, and <wt>/studio/output was not made."""
        found = [f.name for f in self.out.iterdir() if f.name.endswith((".ax.json", ".lock", ".job.json"))] \
            if self.out.exists() else []
        self.assertEqual(found, [])
        self.assertFalse((self.wt / "studio" / "output").exists(), "no capture script was copied")

    def assertNoFile(self):
        """No result, snapshot, lock or job file, and <wt>/studio/output was not made."""
        self.assertEqual(sorted(f.name for f in self.out.iterdir()) if self.out.exists() else [], [])
        self.assertFalse((self.wt / "studio" / "output").exists(), "no capture script was copied")


class Usage(StructureCase):
    """`--param` on the command line (R2.1, R2.2) and the help text (R6.5). The BASE `http://localhost:1` is
    refused, so an accepted `--param` ends in the `refused:` line and no browser is needed."""

    def run_param(self, *params):
        args = [PARAM_DETAIL, "--url", "http://localhost:1"]
        for v in params:
            args += ["--param", v]
        return self.structure(*args)

    def assertAccepted(self, p):
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, REFUSED)

    def test_accepted_param_reaches_the_refused_base(self):
        self.assertAccepted(self.run_param("id=abc123"))

    def test_not_name_equals_value(self):
        for arg in ("id", "=abc", "Id=abc", "1d=abc", "a-b=abc", "a" * 33 + "=abc"):
            with self.subTest(arg=arg):
                p = self.run_param(arg)
                self.assertUsageError(p, f"--param must be <name>=<value>, not {arg!r}")
                self.assertNoFile()

    def test_split_at_the_first_equals(self):
        self.assertAccepted(self.run_param("id=a=b"))

    def test_name_of_32_letters(self):
        self.assertAccepted(self.run_param("a" * 32 + "=abc"))

    def test_bad_values(self):
        for arg in ("id=", "id=.", "id=..", "id=a\tb"):
            with self.subTest(arg=arg):
                p = self.run_param(arg)
                self.assertUsageError(p, BAD_VALUE)
                self.assertNoFile()

    def test_value_of_256(self):
        self.assertAccepted(self.run_param("id=" + "v" * 256))

    def test_value_of_257_not_echoed(self):
        value = "v" * 257
        p = self.run_param("id=" + value)
        self.assertUsageError(p, BAD_VALUE)
        self.assertNotIn(value, p.stderr)
        self.assertNoFile()

    def test_name_twice(self):
        p = self.run_param("id=a", "id=b")
        self.assertUsageError(p, "--param id is given twice")
        self.assertNoFile()

    def test_param_with_snapshot(self):
        p = self.structure(PARAM_DETAIL, "--snapshot", PARAM_SNAPSHOT, "--param", "id=abc123")
        self.assertUsageError(p, "--param needs --url or --serve")
        self.assertNoFile()

    def test_help(self):
        p = subprocess.run([str(self.bin / "pm-structure"), "--help"], capture_output=True, text=True,
                           env=clean_env(), timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        usage = p.stdout.split("\n\n", 1)[0]
        self.assertIn("--param NAME=VALUE", usage)
        flat = " ".join(p.stdout.split())
        sentences = re.split(r"(?<=[.;])\s", flat)
        self.assertTrue(any("{NAME}" in s and "percent-encoded" in s for s in sentences), p.stdout)
        self.assertTrue(any("--param" in s and "--url or --serve" in s for s in sentences), p.stdout)
        self.assertTrue(any("parameter without a value" in s and "value without a parameter" in s and "exit 2" in s
                            for s in sentences), p.stdout)
        self.assertIn("route: <filled route>", flat)


class Pairing(StructureCase):
    """Parameters and values pair up before anything is started (R2.3), the order of the errors, the invalid route
    (R1.2) and the snapshot run (R2.4). The worktree has no `studio/node_modules`: a run that came as far as the
    browser would end in `@playwright/test is not installed`."""

    def setUp(self):
        super().setUp()
        self.base = f"http://127.0.0.1:{free_port()}"

    def no_value_line(self, spec, names):
        return f"pm-structure: spec {spec}: route parameter without a value: {names} (give --param <name>=<value>)"

    def no_param_line(self, spec, names):
        return f"pm-structure: spec {spec}: the route has no parameter {names}"

    def assertPairingError(self, p, line, screen=DETAIL):
        self.assertExit(p, 2)
        self.assertEqual(p.stderr.splitlines(), [line])
        self.assertEqual(p.stdout, f"result: {self.result_path(screen)}\n")
        r = self.result(screen)
        self.assertEqual(r["verdict"], "error")
        self.assertIn("url", r)
        self.assertIsNone(r["url"])
        self.assertNotIn("route", r)
        self.assertNotIn("params", r)
        self.assertNoRunFile()

    def test_parameter_without_value(self):
        p = self.structure(PARAM_DETAIL, "--url", self.base)
        self.assertPairingError(p, self.no_value_line(PARAM_DETAIL, "{id}"))

    def test_two_without_value_in_route_order(self):
        p = self.structure(PARAM_TWO, "--url", self.base)
        self.assertPairingError(p, self.no_value_line(PARAM_TWO, "{api} {stage}"), TWO)

    def test_one_of_two_without_value(self):
        p = self.structure(PARAM_TWO, "--url", self.base, "--param", "stage=s1")
        self.assertPairingError(p, self.no_value_line(PARAM_TWO, "{api}"), TWO)

    def test_value_without_parameter(self):
        p = self.structure(PARAM_DETAIL, "--url", self.base, "--param", "id=a", "--param", "other=b")
        self.assertPairingError(p, self.no_param_line(PARAM_DETAIL, "{other}"))

    def test_values_without_parameter_in_order_given(self):
        p = self.structure(PARAM_DETAIL, "--url", self.base, "--param", "id=a", "--param", "zz=1", "--param", "aa=2")
        self.assertPairingError(p, self.no_param_line(PARAM_DETAIL, "{zz} {aa}"))

    def test_route_without_parameter_given_a_value(self):
        p = self.structure(BUCKET_LIST, "--url", self.base, "--param", "id=a")
        self.assertPairingError(p, self.no_param_line(BUCKET_LIST, "{id}"), "s3.bucket-list")

    def test_missing_value_reported_first(self):
        p = self.structure(PARAM_TWO, "--url", self.base, "--param", "api=a", "--param", "other=b")
        self.assertPairingError(p, self.no_value_line(PARAM_TWO, "{stage}"), TWO)

    def test_error_row_has_no_route(self):
        self.issue()
        p = self.structure(PARAM_DETAIL, "--url", self.base, "--record", ISSUE, "final")
        self.assertExit(p, 2)
        self.assertEqual(p.stderr.splitlines(), [self.no_value_line(PARAM_DETAIL, "{id}")])
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["verdict"], "error")
        self.assertNotIn("route", rows[0])

    def test_serve_starts_no_server(self):
        p = self.structure(PARAM_DETAIL, "--serve", PAGES / "param-detail")
        self.assertPairingError(p, self.no_value_line(PARAM_DETAIL, "{id}"))
        self.assertFalse((self.wt / "output" / "logs" / "structure-server.log").exists(), "a server log was written")

    def test_refused_base_before_pairing(self):
        p = self.structure(PARAM_DETAIL, "--url", "http://localhost:1")
        self.assertExit(p, 2)
        self.assertEqual(p.stderr.splitlines(), [f"pm-structure: {REFUSED}"])

    def test_invalid_spec_before_refused_base(self):
        spec = self.spec("/apis/{id}/stages/{id}")
        p = self.structure(spec, "--url", "http://localhost:1")
        self.assertExit(p, 2)
        lines = p.stderr.splitlines()
        self.assertEqual(len(lines), 1, p.stderr)
        self.assertTrue(lines[0].startswith(f"pm-structure: spec {spec}"), lines[0])
        self.assertTrue(lines[0].endswith(TWICE_ERROR), lines[0])

    def test_invalid_route_with_snapshot(self):
        self.issue()
        spec = self.spec("/apis/x{id}")
        p = self.structure(spec, "--snapshot", PARAM_SNAPSHOT, "--record", ISSUE, "final")
        self.assertExit(p, 2)
        lines = p.stderr.splitlines()
        self.assertEqual(len(lines), 1, p.stderr)
        self.assertTrue(lines[0].endswith(SEGMENT_ERROR), lines[0])
        r = self.result()
        self.assertEqual(r["verdict"], "error")
        self.assertIsNone(r["url"])
        self.assertNotIn("route", r)
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertNotIn("route", rows[0])

    def test_snapshot_needs_no_value(self):
        p = self.structure(PARAM_DETAIL, "--snapshot", PARAM_SNAPSHOT)
        self.assertExit(p, 0)
        lines = p.stdout.splitlines()
        self.assertIn(" score=100.0 ", lines[0])
        self.assertFalse(any(ln.startswith("route:") for ln in lines), p.stdout)
        r = self.result()
        self.assertNotIn("route", r)
        self.assertNotIn("params", r)


class _Pages(http.server.BaseHTTPRequestHandler):
    """Answers every GET with the index.html of `directory` (set on the subclass)."""
    directory = None

    def do_GET(self):
        body = (pathlib.Path(self.directory) / "index.html").read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class BrowserCase(StructureCase):
    def setUp(self):
        super().setUp()
        self.link_node_modules()

    def serve_run(self, spec, pages, *args, port=None):
        """A `--serve` run on its own port; returns (the process, the server's origin)."""
        port = port or free_port()
        p = self.structure(spec, "--serve", pages, "--port", port, *args)
        return p, f"http://127.0.0.1:{port}"


class Opened(BrowserCase):
    """The page opened at the filled route, and the route in the report, the result and the row (R3, R4)."""

    ROUTE = "/aws/apigateway/apis/abc123"

    def detail(self, *args, pages=PAGES / "param-detail", port=None):
        return self.serve_run(PARAM_DETAIL, pages, *args, port=port)

    def test_filled_route_opened_and_named(self):
        p, origin = self.detail("--param", "id=abc123")
        self.assertExit(p, 0)
        self.assertEqual(p.stdout.splitlines()[1], f"route: {self.ROUTE}")
        r = self.result()
        self.assertEqual(r.get("route"), self.ROUTE)
        self.assertEqual(r.get("params"), {"id": "abc123"})
        self.assertEqual(r["url"], origin + self.ROUTE)

    def test_same_as_the_route_written_out(self):
        p, _ = self.detail("--param", "id=abc123")
        self.assertExit(p, 0)
        filled = status_map(self.result())
        q, _ = self.serve_run(PARAM_LITERAL, PAGES / "param-detail")
        self.assertExit(q, 0)
        self.assertEqual(p.stdout.splitlines()[0], q.stdout.splitlines()[0])
        self.assertEqual(filled, status_map(self.result()))

    def test_slashes_in_one_segment(self):
        p, _ = self.detail("--param", "id=/p302/group/a")
        self.assertExit(p, 0)
        route = "/aws/apigateway/apis/%2Fp302%2Fgroup%2Fa"
        self.assertEqual(p.stdout.splitlines()[1], f"route: {route}")
        r = self.result()
        self.assertEqual(r.get("route"), route)
        self.assertEqual(r.get("params"), {"id": "/p302/group/a"})

    def test_origin_kept(self):
        p, origin = self.detail("--param", "id=//evil.example/x?y#z@w")
        self.assertExit(p, 0)
        r = self.result()
        self.assertTrue(r["url"].startswith(origin + "/"), r["url"])
        self.assertEqual(r["blocked"], [])

    def test_served_directory_not_left(self):
        served = self.wt / "served"
        shutil.copytree(PAGES / "param-detail", served)
        (self.wt / "outside.html").write_text(
            '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>outside</title></head>\n'
            '<body><div class="aws-area"><main><h1>Not found</h1></main></div></body>\n</html>\n')
        p, _ = self.serve_run(PARAM_DETAIL, served, "--param", "id=../../../../outside.html")
        self.assertExit(p, 0)  # outside.html would leave the title unmatched: exit 1
        r = self.result()
        self.assertEqual(set(status_map(r).values()), {"matched"}, r["items"])
        self.assertEqual(r.get("route"), "/aws/apigateway/apis/..%2F..%2F..%2F..%2Foutside.html")

    def test_value_naming_nothing(self):
        p, _ = self.detail("--param", "id=missing")
        self.assertExit(p, 1)
        self.assertEqual(status_map(self.result())["header.title"], "unmatched")
        self.assertEqual(p.stdout.splitlines()[1], "route: /aws/apigateway/apis/missing")

    def test_twice_the_same(self):
        port = free_port()
        p, _ = self.detail("--param", "id=abc123", port=port)
        self.assertExit(p, 0)
        first = self.result()
        q, _ = self.detail("--param", "id=abc123", port=port)
        self.assertExit(q, 0)
        second = self.result()
        self.assertEqual(p.stdout, q.stdout)
        first.pop("at")
        second.pop("at")
        self.assertEqual(first, second)

    def test_two_values(self):
        port = free_port()
        p, _ = self.detail("--param", "id=abc123", port=port)
        self.assertExit(p, 0)
        first = self.result()
        q, _ = self.detail("--param", "id=def456", port=port)
        self.assertExit(q, 0)
        second = self.result()
        a, b = p.stdout.splitlines(), q.stdout.splitlines()
        self.assertEqual(len(a), len(b), f"{p.stdout}\n---\n{q.stdout}")
        self.assertEqual([i for i, (x, y) in enumerate(zip(a, b)) if x != y], [1])
        self.assertEqual((a[1], b[1]), (f"route: {self.ROUTE}", "route: /aws/apigateway/apis/def456"))
        self.assertEqual(set(first), set(second))
        differ = {k for k in first if first[k] != second[k]}
        self.assertEqual(differ - {"at"}, {"route", "params", "url"})

    def test_recorded_row(self):
        self.issue()
        p, _ = self.detail("--param", "id=abc123", "--record", ISSUE, "final")
        self.assertExit(p, 0)
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].get("route"), self.ROUTE)
        self.assertEqual(rows[0]["verdict"], "pass")
        self.assertNotIn("params", rows[0])

    def test_url_served_by_the_case(self):
        handler = type("Pages", (_Pages,), {"directory": str(PAGES / "param-detail")})
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 10)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        p = self.structure(PARAM_DETAIL, "--url", f"http://127.0.0.1:{server.server_address[1]}",
                           "--param", "id=abc123")
        self.assertExit(p, 0)
        self.assertEqual(p.stdout.splitlines()[1], f"route: {self.ROUTE}")

    def test_two_parameters_lines_in_order(self):
        p, _ = self.serve_run(PARAM_TWO, PAGES / "param-two", "--param", "api=a1", "--param", "stage=s/2")
        self.assertExit(p, 0)
        lines = p.stdout.splitlines()
        self.assertTrue(lines[0].startswith(f"structure {TWO} state=seeded "), lines[0])
        self.assertEqual(lines[1:3], ["route: /aws/apigateway/apis/a1/stages/s%2F2", "requires also: state=empty"])

    def test_two_parameters_order_given_does_not_matter(self):
        p, _ = self.serve_run(PARAM_TWO, PAGES / "param-two", "--param", "stage=s/2", "--param", "api=a1")
        self.assertExit(p, 0)
        self.assertEqual(p.stdout.splitlines()[1], "route: /aws/apigateway/apis/a1/stages/s%2F2")

    def test_two_parameters_empty_state(self):
        p, _ = self.serve_run(PARAM_TWO, PAGES / "param-two", "--state", "empty",
                              "--param", "api=a1", "--param", "stage=s/2")
        self.assertIn(p.returncode, (0, 1), f"stdout:\n{p.stdout}\nstderr:\n{p.stderr}")
        self.assertEqual(p.stdout.splitlines()[1], "route: /aws/apigateway/apis/a1/stages/s%2F2")
        r = self.result(TWO, "empty")
        self.assertEqual(r["state"], "empty")
        self.assertEqual(r.get("route"), "/aws/apigateway/apis/a1/stages/s%2F2")
        self.assertEqual(r.get("params"), {"api": "a1", "stage": "s/2"})

    def test_wizard_steps(self):
        p, origin = self.serve_run(PARAM_WIZARD, PAGES / "param-wizard", "--param", "id=abc123")
        self.assertExit(p, 0)
        self.assertEqual(p.stdout.splitlines()[1], "route: /aws/apigateway/apis/abc123/edit")
        self.assertEqual(self.result(WIZARD)["step_urls"],
                         [f"{origin}/aws/apigateway/apis/abc123/edit?step={k}" for k in (1, 2, 3)])

    def test_page_not_reachable(self):
        self.issue()
        port = free_port()  # nothing listens on it
        p = self.structure(PARAM_DETAIL, "--url", f"http://127.0.0.1:{port}", "--param", "id=abc123",
                           "--record", ISSUE, "final")
        self.assertExit(p, 2)
        self.assertOneErrorLine(p, f"http://127.0.0.1:{port}{self.ROUTE}")
        r = self.result()
        self.assertEqual(r["verdict"], "error")
        self.assertEqual(r.get("route"), self.ROUTE)
        self.assertEqual(r.get("params"), {"id": "abc123"})
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].get("route"), self.ROUTE)


class Unchanged(BrowserCase):
    """A spec without a parameter prints and writes what `main` does (R5)."""

    def test_no_route_line_or_key(self):
        self.issue()
        p, _ = self.serve_run(BUCKET_LIST, PAGES / "full", "--record", ISSUE, "final")
        self.assertExit(p, 0)
        self.assertFalse(any(ln.startswith("route:") for ln in p.stdout.splitlines()), p.stdout)
        r = self.result("s3.bucket-list")
        row = self.rows()[0]
        for d in (r, row):
            self.assertNotIn("route", d)
            self.assertNotIn("params", d)


# ---------------------------------------------------------------------------------------------------- guides

def section(text, heading):
    """The body of the markdown section whose heading line is `heading`, up to the next heading of any level."""
    lines = text.splitlines()
    start = lines.index(heading)  # ValueError names the missing heading
    body = []
    for line in lines[start + 1:]:
        if line.startswith("#"):
            break
        body.append(line)
    return "\n".join(body)


def blocks(text):
    """Paragraphs and list items: a blank line or a line starting a list item (`1.`, `-`) starts a new block."""
    out, cur = [], []
    for line in text.splitlines():
        if not line.strip() or re.match(r"(\d+\.|-) ", line):
            if cur:
                out.append("\n".join(cur))
            cur = [line] if line.strip() else []
        else:
            cur.append(line)
    if cur:
        out.append("\n".join(cur))
    return out


def flat(text):
    """`text` on one line, runs of white space as one space, without backticks."""
    return " ".join(text.replace("`", "").split())


def step_1(score):
    """The list item `1.` of "Structure score", up to the item `2.`, indented paragraphs included."""
    lines = score.splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith("1. "))
    end = next((i for i, ln in enumerate(lines) if i > start and ln.startswith("2. ")), len(lines))
    return flat("\n".join(lines[start:end]))


class Guides(unittest.TestCase):
    """The sentences of R6.1 to R6.4."""

    def setUp(self):
        text = CONSOLE.read_text()
        self.format = section(text, "## Format")
        self.score = section(text, "## Structure score")

    def test_format_names_the_parameter(self):
        said = [flat(b) for b in blocks(self.format)]
        self.assertTrue(any("whole path segment {<name>}" in b and "route: /aws/apigateway/apis/{id}" in b
                            and "brace anywhere else" in b and "invalid spec" in b for b in said), self.format)

    def test_step_1_names_param(self):
        step = step_1(self.score)
        for phrase in ("--param <name>=<value>", "the id the emulator answered when the seed created the resource",
                       "never looked up by name", "percent-encoded", "parameter without a value",
                       "a parameter the route does not have", "exit 2", "second line names the route"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, step)

    def test_step_1_empty_run_holds_the_resource(self):
        step = step_1(self.score)
        self.assertRegex(step, r"route holds a parameter, the emulator of the empty run .*holds the resource "
                               r"behind each parameter and nothing under it")

    def test_same_score_bullet(self):
        bullet = next((flat(b) for b in blocks(self.score) if b.startswith("- The same build, seed and spec")), None)
        self.assertIsNotNone(bullet, "no bullet starts with 'The same build, seed and spec'")
        self.assertIn("the ids the emulator assigned may differ", bullet)
        self.assertIn("the score does not depend on them", bullet)

    def test_crit_brief_step(self):
        step = next((flat(s) for s in blocks(CRIT.read_text()) if "pm-structure" in s and "--record" in s), None)
        self.assertIsNotNone(step, "no step of crit.md names pm-structure with --record")
        for phrase in ("--param <name>=<value>", "empty run", "holds the resource behind each parameter",
                       "console-reference.md"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, step)


if __name__ == "__main__":
    unittest.main()
