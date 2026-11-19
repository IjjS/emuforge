"""pm-probe-services: the probe of the emulator for every service of the board (issue 517).

The table (.pm/bin/probe-services.json) holds every key of the board once and only read operations that need no
argument but a filled integer limit or enum (the pm's decision, Q1 b); its requests are signed with SigV4 as the
AWS signature test suite says; an answer is read as answered (2xx), not implemented (501 or the emulator's
UnknownService refusal) or an error; and `run` starts an emulator of its own, talks to 127.0.0.1 only over TLS
verified against the emulator's ca.pem, never shows the key, and removes the container and the folder (through
pm-emulator-dir) whatever happened. The run cases use a fixture checkout, a stand-in `docker` that starts a local
TLS server in the emulator's place, and stand-ins of pm-mem and pm-emulator-dir.
"""
import datetime
import json
import os
import pathlib
import re
import shutil
import signal
import socket
import subprocess
import sys
import unittest

from _fixture import BIN, CHECKOUT, clean_env, make, run

sys.path.insert(0, str(BIN))
import _pmprobe as probe  # noqa: E402

SKILL = CHECKOUT / ".agents" / "skills" / "pm" / "SKILL.md"
WORK = CHECKOUT / "output" / "tests" / "probe-services"
ACCESS, SECRET = "AKIDPROBETESTKEY0001", "probe-test-secret-value-0001"
PREFIX = "pm-probe-services: "


# ------------------------------------------------------------------------------------------------- pure parts

class Signing(unittest.TestCase):
    def test_get_vanilla_of_the_aws_signature_test_suite(self):
        when = datetime.datetime(2015, 8, 30, 12, 36, 0, tzinfo=datetime.timezone.utc)
        h = probe.sign("GET", "example.amazonaws.com", "/", [], {}, b"", "AKIDEXAMPLE",
                       "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "service", when=when, content_sha=False)
        self.assertEqual(h["Authorization"],
                         "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, "
                         "SignedHeaders=host;x-amz-date, "
                         "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31")
        self.assertEqual(h["X-Amz-Date"], "20150830T123600Z")

    def test_the_signing_name_and_payload_hash_are_signed(self):
        h = probe.sign("POST", "127.0.0.1:1", "/", [], {"X-Amz-Target": "A.B"}, b"{}", "AK", "SK", "sqs")
        self.assertIn("/us-east-1/sqs/aws4_request", h["Authorization"])
        self.assertIn("SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-target", h["Authorization"])
        self.assertEqual(h["X-Amz-Content-Sha256"],
                         "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a")


class Requests(unittest.TestCase):
    def test_json(self):
        m = dict(protocol="json", json_version="1.1", target_prefix="DynamoDB_20120810", api_version="2012-08-10")
        method, path, query, headers, body = probe.request_of(m, dict(name="ListTables", method="POST", uri="/",
                                                                       fill=[]))
        self.assertEqual((method, path, query, body), ("POST", "/", [], b"{}"))
        self.assertEqual(headers, {"Content-Type": "application/x-amz-json-1.1",
                                   "X-Amz-Target": "DynamoDB_20120810.ListTables"})

    def test_json_with_a_filled_limit(self):
        m = dict(protocol="json", json_version="1.1", target_prefix="AWSCognitoIdentityProviderService")
        fill = [dict(member="MaxResults", location="body", name="MaxResults", value=10)]
        body = probe.request_of(m, dict(name="ListUserPools", method="POST", uri="/", fill=fill))[4]
        self.assertEqual(json.loads(body), {"MaxResults": 10})

    def test_query_and_ec2(self):
        for protocol in ("query", "ec2"):
            m = dict(protocol=protocol, api_version="2016-11-15")
            method, path, query, headers, body = probe.request_of(
                m, dict(name="DescribeVpcs", method="POST", uri="/",
                        fill=[dict(member="x", location="body", name="Kind", value="a b")]))
            self.assertEqual((method, path, query), ("POST", "/", []))
            self.assertEqual(body, b"Action=DescribeVpcs&Version=2016-11-15&Kind=a%20b")
            self.assertTrue(headers["Content-Type"].startswith("application/x-www-form-urlencoded"))

    def test_rest_json_keeps_the_literal_query_and_fills_the_uri(self):
        m = dict(protocol="rest-json")
        op = dict(name="GetSettings", method="GET", uri="/settings/{attribute}?view=all",
                  fill=[dict(member="attribute", location="uri", name="attribute", value="ALL"),
                        dict(member="t", location="querystring", name="type", value="Standard")])
        method, path, query, headers, body = probe.request_of(m, op)
        self.assertEqual((method, path, body), ("GET", "/settings/ALL", b""))
        self.assertEqual(query, [("view", "all"), ("type", "Standard")])
        self.assertNotIn("Content-Type", headers)

    def test_rest_json_post_sends_an_object(self):
        op = dict(name="ListThings", method="POST", uri="/things", fill=[])
        self.assertEqual(probe.request_of(dict(protocol="rest-json"), op)[4], b"{}")

    def test_rest_xml(self):
        op = dict(name="ListObjectsV2", method="GET", uri="/?list-type=2", fill=[])
        method, path, query, headers, body = probe.request_of(dict(protocol="rest-xml"), op)
        self.assertEqual((method, path, query, body), ("GET", "/", [("list-type", "2")], b""))


def model(ops, shapes, protocol="rest-json", **meta):
    return dict(metadata=dict(protocol=protocol, apiVersion="2020-01-01", signingName="svc", **meta),
                operations=ops, shapes=shapes)


class TableBuild(unittest.TestCase):
    def setUp(self):
        self.dir = WORK / "models"
        if self.dir.exists():
            shutil.rmtree(self.dir)
        shapes = {
            "Int": dict(type="integer", min=1, max=5), "Kind": dict(type="string", enum=["ACTIVE", "GONE"]),
            "Str": dict(type="string"),
            "NoArgs": dict(type="structure", members={"Next": dict(shape="Str")}),
            "LimitIn": dict(type="structure", required=["Max"], members={"Max": dict(shape="Int",
                                                                                      location="querystring",
                                                                                      locationName="max")}),
            "EnumIn": dict(type="structure", required=["kind"], members={"kind": dict(shape="Kind", location="uri",
                                                                                       locationName="kind")}),
            "NameIn": dict(type="structure", required=["Name"], members={"Name": dict(shape="Str")}),
            "YearIn": dict(type="structure", required=["year"], members={"year": dict(shape="Int")}),
        }
        ops = {
            "ListThings": dict(http=dict(method="GET", requestUri="/things"), input=dict(shape="NoArgs")),
            "DescribeAll": dict(http=dict(method="GET", requestUri="/all")),
            "ListLimited": dict(http=dict(method="GET", requestUri="/limited"), input=dict(shape="LimitIn")),
            "GetByKind": dict(http=dict(method="GET", requestUri="/kind/{kind}"), input=dict(shape="EnumIn")),
            "GetByName": dict(http=dict(method="GET", requestUri="/name"), input=dict(shape="NameIn")),
            "GetByYear": dict(http=dict(method="GET", requestUri="/year"), input=dict(shape="YearIn")),
            "CreateThing": dict(http=dict(method="POST", requestUri="/things"), input=dict(shape="NoArgs")),
            "DeleteThing": dict(http=dict(method="DELETE", requestUri="/things")),
            "UpdateThing": dict(http=dict(method="PUT", requestUri="/things")),
        }
        for name, m in {"alpha": model(ops, shapes),
                        "beta": model({}, {}, protocol="smithy-rpc-v2-cbor", protocols=["smithy-rpc-v2-cbor"])}.items():
            for version in ("2019-01-01", "2020-01-01"):
                d = self.dir / name / version
                d.mkdir(parents=True)
                (d / "service-2.json").write_text(json.dumps(m if version == "2020-01-01" else model({}, {})))

    def test_only_reads_with_no_argument_or_a_filled_limit_or_enum(self):
        t = probe.build(dict(services=[dict(key="a", name="A", models=["alpha", "beta", "gamma"])]), self.dir,
                        str(self.dir))
        alpha = t["models"]["alpha"]
        self.assertEqual(alpha["api_version"], "2020-01-01")
        self.assertEqual(alpha["signing_name"], "svc")
        self.assertEqual(alpha["protocol"], "rest-json")
        ops = {o["name"]: o for o in alpha["ops"]}
        self.assertEqual(sorted(ops), ["DescribeAll", "GetByKind", "ListLimited", "ListThings"])
        self.assertEqual(ops["ListLimited"]["fill"], [dict(member="Max", location="querystring", name="max", value=5)])
        self.assertEqual(ops["GetByKind"]["fill"][0]["value"], "ACTIVE")
        self.assertEqual(t["models"]["beta"]["ops"], [])
        self.assertIsNone(t["models"]["beta"]["protocol"])
        self.assertIn("missing", t["models"]["gamma"])
        self.assertEqual(t["models_from"]["folder"], str(self.dir))
        self.assertRegex(t["models_from"]["sha256"], "^[0-9a-f]{64}$")

    def test_the_written_text_reads_back_as_the_table(self):
        t = probe.build(dict(about="x", services=[dict(key="a", name="A", models=["alpha"]),
                                                   dict(key="b", name="B", models=[], none="why")]),
                        self.dir, str(self.dir))
        path = WORK / "table.json"
        probe.write_table(t, path)
        self.assertEqual(json.loads(path.read_text()), t)


class Table(unittest.TestCase):
    """The tracked table itself."""

    @classmethod
    def setUpClass(cls):
        cls.text = probe.TABLE.read_text()
        cls.t = json.loads(cls.text)

    def test_keys_once_each(self):
        keys = [s["key"] for s in self.t["services"]]
        self.assertTrue(keys, "the table has no service")
        self.assertEqual(sorted({k for k in keys if keys.count(k) > 1}), [])

    def test_every_key_has_models_or_says_why_not(self):
        for s in self.t["services"]:
            self.assertTrue(s["name"], s)
            if s["models"]:
                self.assertNotIn("none", s)
                for m in s["models"]:
                    self.assertIn(m, self.t["models"], s["key"])
            else:
                self.assertTrue(s.get("none"), s["key"])

    def test_only_read_verbs_and_only_filled_kinds(self):
        for name, m in self.t["models"].items():
            self.assertNotIn("missing", m, name)
            self.assertTrue(m["signing_name"], name)
            if m["ops"]:
                self.assertIn(m["protocol"], probe.PROTOCOLS, name)
            if m["protocol"] == "json":
                self.assertTrue(m.get("target_prefix"), name)
            for o in m["ops"]:
                self.assertRegex(o["name"], r"^(List|Describe|Get)[A-Z0-9]", name)
                for f in o["fill"]:
                    self.assertIsInstance(f["value"], (int, str), (name, o["name"]))
                    if isinstance(f["value"], int):
                        self.assertLessEqual(f["value"], probe.LIMIT)

    def test_the_file_is_in_its_written_form(self):
        self.assertEqual(probe.table_text(self.t), self.text)

    def test_known_mappings(self):
        by = {s["key"]: s for s in self.t["services"]}
        self.assertEqual(by["vpc"]["models"], ["ec2"])
        self.assertEqual(by["cognito"]["models"], ["cognito-idp", "cognito-identity"])
        self.assertEqual(by["states"]["models"], ["stepfunctions"])
        self.assertEqual(by["console"]["models"], [])


class Answers(unittest.TestCase):
    def test_outcomes(self):
        self.assertEqual(probe.outcome_of(200, {}, b"{}")["outcome"], "answered")
        o = probe.outcome_of(501, {"x-amzn-errortype": "NotImplemented"},
                             b'{"message":"ListFleets is scaffolded but not implemented in this emulator"}')
        self.assertEqual((o["outcome"], o["code"]), ("not implemented", "NotImplemented"))
        o = probe.outcome_of(404, {"content-type": "x"}, b'{"__type":"UnknownService","message":"no emulated service"}')
        self.assertEqual(o["outcome"], "refused")
        o = probe.outcome_of(404, {}, b'{"__type":"com.amazon#ResourceNotFoundException"}')
        self.assertEqual((o["outcome"], o["code"]), ("error", "ResourceNotFoundException"))
        o = probe.outcome_of(400, {}, b"<Response><Errors><Error><Code>MissingParameter</Code><Message>m  x</Message>"
                                      b"</Error></Errors></Response>")
        self.assertEqual((o["code"], o["message"]), ("MissingParameter", "m x"))
        self.assertLessEqual(len(probe.outcome_of(400, {}, b'{"message":"' + b"a" * 900 + b'"}')["message"]), 200)

    def test_service_results(self):
        def ops(*outcomes):
            return [dict(op=f"Op{i}", outcome=o, status=s, code=c) for i, (o, s, c) in enumerate(outcomes)]
        e = dict(key="k", name="K", models=["m"])
        ok = ("answered", 200, None)
        five = ("not implemented", 501, "NotImplemented")
        refused = ("refused", 404, "UnknownService")
        err = ("error", 403, "AccessDeniedException")
        r, s = probe.service_result(e, [dict(model="m", signing_name="m", ops=ops(ok, five, err))])
        self.assertEqual(r, "answered")
        self.assertIn("answered 1/3 reads", s)
        self.assertIn("501: Op1", s)
        self.assertIn("Op2 403 AccessDeniedException", s)
        self.assertEqual(probe.service_result(e, [dict(model="m", signing_name="m", ops=ops(five, five))])[0],
                         "not implemented")
        r, s = probe.service_result(e, [dict(model="m", signing_name="sig", ops=ops(refused))])
        self.assertEqual(r, "not implemented")
        self.assertIn("no service registered for sig", s)
        self.assertEqual(probe.service_result(e, [dict(model="m", signing_name="m", ops=ops(err, five))])[0], "failed")
        self.assertEqual(probe.service_result(e, [dict(model="m", result="no read call", ops=[])])[0], "no read call")
        self.assertEqual(probe.service_result(dict(key="c", name="C", models=[], none="why"), []),
                         ("no API", "no API: why"))

    def test_board_keys(self):
        text = "| # | Service | Key |\n|---|---|---|\n| 1 | S3 | `s3` | #256 |\n| 2 | Lambda | `lambda` | #84 |\n"
        self.assertEqual(probe.board_keys(text), ["s3", "lambda"])


class Guide(unittest.TestCase):
    def test_the_scripts_table_names_the_probe(self):
        text = SKILL.read_text()
        section = text.split("\n## Scripts\n", 1)[1].split("\n## ", 1)[0]
        row = next(ln for ln in section.splitlines() if ln.startswith("| `pm-probe-services` |"))
        for word in ("`run`", "by hand", "`.pm/bin/probe-services.json`", "`.pm/run/probe-services-<stamp>.json`",
                     "version", "`Emulator`", "`table`", "`--board`"):
            self.assertIn(word, row)


# ------------------------------------------------------------------------------------------------- the run

SERVER = r'''
import http.server, json, os, ssl, sys
sys.path.insert(0, sys.argv[4])
import _pmprobe as probe
port, cert, key, log_path = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[5]
ACCESS, SECRET = sys.argv[6], sys.argv[7]
ANSWERS = {"answers": (200, {}, b"{}"),
           "scaffold": (501, {"x-amzn-errortype": "NotImplemented"}, b'{"message":"scaffolded but not implemented"}'),
           "denied": (403, {"x-amzn-errortype": "AccessDeniedException"}, b'{"message":"not enabled"}')}

class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a):
        pass
    def answer(self, status, headers, body):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def handle_one(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path == "/__admin/health":
            return self.answer(200, {}, b"ok")
        auth = self.headers.get("Authorization", "")
        service = auth.split("Credential=")[1].split("/")[3] if "Credential=" in auth else ""
        path, _, q = self.path.partition("?")
        query = [tuple(p.split("=", 1)) for p in q.split("&")] if q else []
        names = auth.split("SignedHeaders=")[1].split(",")[0].split(";") if auth else []
        given = {n: self.headers[n] for n in names if n not in ("host", "x-amz-date", "x-amz-content-sha256")}
        import datetime
        when = datetime.datetime.strptime(self.headers.get("X-Amz-Date", "20000101T000000Z"),
                                          "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
        again = probe.sign(self.command, self.headers["Host"], path, query, given, body, ACCESS, SECRET, service,
                           when=when, double_encode=service != "s3")
        with open(log_path, "a") as f:
            f.write(json.dumps(dict(method=self.command, path=self.path, service=service, host=self.headers["Host"],
                                    valid=again["Authorization"] == auth)) + "\n")
        if service in ANSWERS:
            return self.answer(*ANSWERS[service])
        return self.answer(404, {"x-amzn-errortype": "UnknownService"},
                           b'{"__type":"UnknownService","message":"no emulated service is registered"}')
    do_GET = do_POST = do_PUT = do_DELETE = handle_one

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)
s = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
s.socket = ctx.wrap_socket(s.socket, server_side=True)
s.serve_forever()
'''

DOCKER = r'''#!/usr/bin/env python3
import json, os, pathlib, signal, subprocess, sys
conf = json.loads((pathlib.Path(__file__).resolve().parent / "probe.json").read_text())
os.environ.update(conf)
w = pathlib.Path(os.environ["PROBE_WORK"])
with open(w / "docker.log", "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\n")
a = sys.argv[1:]
if a[:2] == ["image", "inspect"]:
    print("sha256:" + "ab" * 32)
elif a[0] == "run" and "--rm" in a:
    print("Version: 9.9.9\nRelease date: 2026.01.01\nCommit: " + "c0ffee" * 6 + "abcd")
elif a[0] == "run" and "-d" in a:
    port = a[a.index("-p", a.index("--pull")) + 1].split(":")[1]
    home = next(x for x in a if x.startswith("HOME=")).split("=", 1)[1]
    d = pathlib.Path(home) / ".aws" / "emulator" / port
    d.mkdir(parents=True)
    (d / "ca.pem").write_text((w / "ca.pem").read_text())
    if os.environ.get("PROBE_NO_KEYS") != "1":
        (d / "emulator_credentials").write_text("[default]\naws_access_key_id = %s\naws_secret_access_key = %s\n"
                                                % (os.environ["PROBE_ACCESS"], os.environ["PROBE_SECRET"]))
    p = subprocess.Popen([sys.executable, str(w / "server.py"), port, str(w / "server.pem"), str(w / "server.key"),
                          os.environ["PROBE_BIN"], str(w / "requests.log"), os.environ["PROBE_ACCESS"],
                          os.environ["PROBE_SECRET"]], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=open(w / "server.err", "a"), start_new_session=True)
    (w / "server.pid").write_text(str(p.pid))
    print("f" * 64)
elif a[:2] == ["rm", "-f"]:
    pid = w / "server.pid"
    if pid.exists():
        try:
            os.kill(int(pid.read_text()), signal.SIGTERM)
        except ProcessLookupError:
            pass
        pid.unlink()
    print(a[2])
else:
    sys.exit(3)
'''

EMULATOR_DIR = r'''#!/usr/bin/env python3
import os, pathlib, shutil, sys
w = pathlib.Path(os.environ["PROBE_WORK"])
with open(w / "emulator-dir.log", "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")
d = pathlib.Path.home() / ".aws" / "emulator" / sys.argv[3]
shutil.rmtree(d, ignore_errors=True)
print(f"pm-emulator-dir: removed {d}")
'''

SMALL_TABLE = dict(
    about="fixture", services=[
        dict(key="good", name="Good", models=["answers"]),
        dict(key="half", name="Half", models=["answers", "scaffold"]),
        dict(key="scaffolded", name="Scaffolded", models=["scaffold"]),
        dict(key="unknown", name="Unknown", models=["nosuch"]),
        dict(key="locked", name="Locked", models=["denied"]),
        dict(key="argful", name="Argful", models=["argful"]),
        dict(key="page", name="Page", models=[], none="a console page"),
    ],
    models=dict(
        answers=dict(api_version="2020-01-01", signing_name="answers", protocol="json", target_prefix="Answers",
                     json_version="1.1", ops=[dict(name="ListA", method="POST", uri="/", fill=[]),
                                              dict(name="DescribeB", method="POST", uri="/", fill=[])]),
        scaffold=dict(api_version="2020-01-01", signing_name="scaffold", protocol="rest-json",
                      ops=[dict(name="ListC", method="GET", uri="/c?view=all",
                                fill=[dict(member="Max", location="querystring", name="max", value=10)])]),
        nosuch=dict(api_version="2020-01-01", signing_name="nosuchsvc", protocol="query",
                    ops=[dict(name="DescribeD", method="POST", uri="/", fill=[])]),
        denied=dict(api_version="2020-01-01", signing_name="denied", protocol="rest-xml",
                    ops=[dict(name="GetE", method="GET", uri="/e", fill=[])]),
        argful=dict(api_version="2020-01-01", signing_name="argful", protocol="json", target_prefix="Argful",
                    ops=[]),
    ))


def openssl(*args):
    subprocess.run(["openssl", *args], check=True, capture_output=True, stdin=subprocess.DEVNULL)


CA_CONF = """[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no
[dn]
CN = probe test ca
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
"""
LEAF_EXT = """basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:127.0.0.1
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
"""


def certificates(d):
    """A CA and a server certificate for 127.0.0.1 signed by it, with the extensions a strict X.509 check asks
    for (Python 3.13 on)."""
    d.mkdir(parents=True, exist_ok=True)
    (d / "ca.cnf").write_text(CA_CONF)
    (d / "leaf.cnf").write_text(LEAF_EXT)
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(d / "ca.key"), "-out", str(d / "ca.pem"),
            "-days", "2", "-config", str(d / "ca.cnf"))
    openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", str(d / "server.key"), "-out", str(d / "server.csr"),
            "-subj", "/CN=127.0.0.1")
    openssl("x509", "-req", "-in", str(d / "server.csr"), "-CA", str(d / "ca.pem"), "-CAkey", str(d / "ca.key"),
            "-CAcreateserial", "-out", str(d / "server.pem"), "-days", "2", "-extfile", str(d / "leaf.cnf"))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Run(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        shutil.rmtree(WORK / "certs", ignore_errors=True)
        certificates(WORK / "certs")

    def setUp(self):
        case = self.id().rsplit(".", 1)[-1]
        self.co = make("probe-services", case, ["pm-probe-services"], files={
            ".pm/bin/probe-services.json": probe.table_text(SMALL_TABLE),
            ".pm/bin/pm-mem": "#!/bin/sh\necho 'used 1GB'\n",
            ".pm/bin/pm-emulator-dir": EMULATOR_DIR,
        })
        self.w = self.co / "output" / "work"
        self.stub = self.co / "output" / "stub"
        self.w.mkdir(parents=True)
        self.stub.mkdir(parents=True)
        for f in ("ca.pem", "server.pem", "server.key"):
            shutil.copy(WORK / "certs" / f, self.w / f)
        (self.w / "server.py").write_text(SERVER)
        (self.stub / "docker").write_text(DOCKER)
        (self.stub / "docker").chmod(0o755)
        self.home = self.co / "home"
        (self.home / ".aws" / "emulator").mkdir(parents=True)
        self.port = free_port()

    def tearDown(self):
        pid = self.w / "server.pid"
        if pid.exists():
            try:
                os.kill(int(pid.read_text()), signal.SIGTERM)
            except ProcessLookupError:
                pass

    def env(self, **extra):
        """The run's environment; what the stand-ins need goes to output/stub/probe.json, since the probe gives
        Docker only Docker's own variables."""
        conf = dict(PROBE_WORK=str(self.w), PROBE_ACCESS=ACCESS, PROBE_SECRET=SECRET,
                    PROBE_BIN=str(self.co / ".pm" / "bin"), **extra)
        (self.stub / "probe.json").write_text(json.dumps(conf))
        env = clean_env()
        env.update(HOME=str(self.home), PATH=f"{self.stub}{os.pathsep}{env['PATH']}", PROBE_WORK=str(self.w))
        return env

    def probe(self, *args, **extra):
        return run(self.co, "pm-probe-services", "run", *args, env=self.env(**extra), timeout=120)

    def docker_calls(self):
        f = self.w / "docker.log"
        return [json.loads(ln) for ln in f.read_text().splitlines()] if f.exists() else []

    def requests(self):
        f = self.w / "requests.log"
        return [json.loads(ln) for ln in f.read_text().splitlines()] if f.exists() else []

    def test_a_run_reads_every_service_and_removes_what_it_started(self):
        r = self.probe("--port", self.port)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        last = r.stdout.strip().splitlines()[-1]
        m = re.fullmatch(PREFIX + r"7 services: answered 2, not implemented 2, failed 1, no read call 1, no API 1; "
                                  r"result (.+)", last)
        self.assertIsNotNone(m, r.stdout)
        result = json.loads(pathlib.Path(m.group(1)).read_text())
        self.assertEqual(pathlib.Path(m.group(1)).parent, self.co / ".pm" / "run")
        self.assertEqual(result["emulator"]["version"], "9.9.9")
        self.assertEqual(result["emulator"]["image_id"], "sha256:" + "ab" * 32)
        self.assertTrue(result["emulator"]["healthy_after"])
        by = {s["key"]: s for s in result["services"]}
        self.assertEqual({k: s["result"] for k, s in by.items()},
                         dict(good="answered", half="answered", scaffolded="not implemented",
                              unknown="not implemented", locked="failed", argful="no read call", page="no API"))
        self.assertEqual(by["good"]["summary"], "answered 2/2 reads")
        self.assertIn("501: scaffold:ListC", by["half"]["summary"])
        self.assertIn("no service registered for nosuchsvc", by["unknown"]["summary"])
        self.assertIn("GetE 403 AccessDeniedException", by["locked"]["summary"])

        # Every request went to 127.0.0.1:<port>, signed with the emulator's key, and every one was a table read.
        reqs = self.requests()
        self.assertEqual(len(reqs), 2 + 2 + 1 + 1 + 1 + 1)
        for q in reqs:
            self.assertEqual(q["host"], f"127.0.0.1:{self.port}")
            self.assertTrue(q["valid"], q)
        self.assertIn(dict(method="GET", path="/c?max=10&view=all", service="scaffold",
                           host=f"127.0.0.1:{self.port}", valid=True), reqs)

        # The pinned image, loopback only, no pull, telemetry off; then the container and the folder removed.
        calls = self.docker_calls()
        start = next(c for c in calls if c[:2] == ["run", "-d"])
        self.assertIn(f"127.0.0.1:{self.port}:{self.port}", start)
        self.assertEqual(start[start.index("--pull") + 1], "never")
        self.assertEqual(start[-5:], ["sha256:" + "ab" * 32, "-p", str(self.port), "-t", "off"])
        version = next(c for c in calls if c[0] == "run" and "--rm" in c)
        self.assertEqual(version[version.index("--network") + 1], "none")
        name = start[start.index("--name") + 1]
        self.assertEqual(calls[-1], ["rm", "-f", name])
        self.assertEqual((self.w / "emulator-dir.log").read_text(), f"rm --port {self.port}\n")
        self.assertFalse((self.home / ".aws" / "emulator" / str(self.port)).exists())
        self.assertFalse((self.co / ".pm" / "run" / "probe-services.lock").exists())

        # The key is shown nowhere.
        events = (self.co / ".pm" / "run" / "events.log").read_text()
        for text in (r.stdout, r.stderr, pathlib.Path(m.group(1)).read_text(), events):
            self.assertNotIn(ACCESS, text)
            self.assertNotIn(SECRET, text)

    def test_a_failed_run_still_removes_the_container_and_the_folder(self):
        r = self.probe("--port", self.port, PROBE_NO_KEYS="1")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn(PREFIX + "refused: the emulator's emulator_credentials holds no key pair", r.stdout)
        self.assertEqual(self.docker_calls()[-1][:2], ["rm", "-f"])
        self.assertEqual((self.w / "emulator-dir.log").read_text(), f"rm --port {self.port}\n")
        self.assertFalse((self.home / ".aws" / "emulator" / str(self.port)).exists())
        self.assertEqual(list((self.co / ".pm" / "run").glob("probe-services-*.json")), [])

    def test_refusals_start_nothing(self):
        (self.home / ".aws" / "emulator" / str(self.port)).mkdir()
        cases = [("9297", "9297 is the owner's emulator port"),
                 (str(self.port), f"~/.aws/emulator/{self.port} already exists")]
        for port, why in cases:
            r = self.probe("--port", port)
            self.assertEqual(r.returncode, 1, r.stdout)
            self.assertIn(PREFIX + "refused: " + why, r.stdout)
        busy = socket.socket()
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        try:
            r = self.probe("--port", busy.getsockname()[1])
            self.assertIn(f"something accepts on 127.0.0.1:{busy.getsockname()[1]}", r.stdout)
        finally:
            busy.close()
        (self.co / ".pm" / "run" / "probe-services.lock").write_text(str(os.getpid()))
        r = self.probe()
        self.assertIn(PREFIX + f"refused: another run is going on (pid {os.getpid()})", r.stdout)
        self.assertEqual(self.docker_calls(), [])
        self.assertFalse((self.w / "emulator-dir.log").exists())

    def test_table_refuses_a_board_that_differs(self):
        board = self.co / "output" / "board.md"
        board.write_text("| # | Service | Key |\n|---|---|---|\n| 1 | Good | `good` |\n| 2 | Other | `other` |\n")
        before = (self.co / ".pm" / "bin" / "probe-services.json").read_text()
        r = run(self.co, "pm-probe-services", "table", "--models", str(self.w), "--board", board, env=self.env())
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("not in the table ['other']", r.stdout)
        self.assertIn("not on the board ['argful', 'half', 'locked', 'page', 'scaffolded', 'unknown']", r.stdout)
        self.assertEqual((self.co / ".pm" / "bin" / "probe-services.json").read_text(), before)


if __name__ == "__main__":
    unittest.main()
