"""harness.emulator-telemetry, the scans: every aws-emulator this repository starts as a server runs with `-t off`
(issue #5). Moved, every case and assertion as it was, from test_emulator_telemetry.py (issue 328).

Two parts:

- scan of the repository: the checkout's tracked non-Markdown files are searched for starts of the aws-emulator
  image as a server; each one must pass `-t off`.
- scan rules: the same scan on the fixture tree fixtures/emulator-telemetry/scan/, one fixture per rule.

A compose file's render needs the Docker CLI with Compose. Without it a case raises CheckError, which
unittest reports as an error with the reason: never a pass, a failure or a skip.
"""
import dataclasses
import pathlib
import re
import shlex
import unittest

from _emulator_telemetry import TIMEOUT, CheckError, child_env, render, run, telemetry_off

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
FIXTURES = HERE / "fixtures" / "emulator-telemetry"
SCAN_FIXTURES = FIXTURES / "scan"

REPO_SCAN_EXCLUDED = (".pm/bin/tests/test_emulator_scan.py", ".pm/bin/tests/test_emulator_telemetry.py",
                      ".pm/bin/tests/_emulator_telemetry.py", ".pm/bin/tests/fixtures/emulator-telemetry/")
FINDING = "{path}:{line}: starts aws-emulator without -t off"


# ---------------------------------------------------------------------------------------------- scan

QUOTES = "\"'`"
DELIMITERS = set(QUOTES) | set("$,;()[]{}&|<>")
BRACKET_SUFFIXES = (".rs", ".ts", ".tsx", ".js", ".mjs", ".cjs")  # an argument list ends at `]`
ONE_SHOT = ("--version", "-v", "--help", "-h")
END = object()  # end of an argument list in a Rust or TypeScript file
IMAGE_LINE = re.compile(r"^(\s*)image:\s*(\S+)\s*(#.*)?$")
KEY_LINE = re.compile(r"^(\s*)([A-Za-z0-9._-]+):\s*(#.*)?$")


@dataclasses.dataclass
class Site:
    path: str
    line: int
    kind: str  # "start" or "compose"
    passed: bool


def runs(text):
    """Runs of characters other than whitespace, the three quotes, `$` and `,;()[]{}&|<>`."""
    out, buf = [], []
    for c in text:
        if c.isspace() or c in DELIMITERS:
            if buf:
                out.append("".join(buf))
                buf = []
        else:
            buf.append(c)
    if buf:
        out.append("".join(buf))
    return out


def line_tokens(line, brackets):
    """A quoted string without whitespace is one token without its quotes; the inside of one with whitespace and
    everything else splits into runs. In bracket mode an unquoted `]` yields END."""
    out, buf = [], []

    def flush():
        if buf:
            out.append("".join(buf))
            buf.clear()

    i = 0
    while i < len(line):
        c = line[i]
        if c in QUOTES:
            j = line.find(c, i + 1)
            if j != -1:
                flush()
                inner = line[i + 1:j]
                if inner and not any(ch.isspace() for ch in inner):
                    out.append(inner)
                else:
                    out.extend(runs(inner))
                i = j + 1
                continue
        if c.isspace() or c in DELIMITERS:
            flush()
            if brackets and c == "]":
                out.append(END)
        else:
            buf.append(c)
        i += 1
    flush()
    return out


def statements(text, brackets):
    """The file's statements as lists of (token, line number). A shell statement ends with a line that has no
    trailing backslash; a Rust or TypeScript argument list ends at `]`."""
    out, cur = [], []
    for number, line in enumerate(text.split("\n"), 1):
        continued = not brackets and line.rstrip().endswith("\\")
        if continued:
            line = line.rstrip()[:-1]
        for tok in line_tokens(line, brackets):
            if tok is END:
                if cur:
                    out.append(cur)
                cur = []
            else:
                cur.append((tok, number))
        if not brackets and not continued:
            if cur:
                out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def is_image(token):
    """`aws-emulator`, with an optional `:<tag>` or `@<digest>` and a leading path whose first part is a registry
    host (contains `.` or `:`, or is `localhost`)."""
    name = token.split("@", 1)[0]
    if name.rfind(":") > name.rfind("/"):
        name = name[:name.rfind(":")]
    if "/" in name:
        first = name.split("/", 1)[0]
        if not ("." in first or ":" in first or first == "localhost"):
            return False
        name = name.rsplit("/", 1)[1]
    return name == "aws-emulator"


def is_build(tokens):
    return any(t == "docker" and "build" in tokens[i + 1:] for i, t in enumerate(tokens))


def start_sites(rel, text):
    dockerfile = pathlib.PurePosixPath(rel).name == "Dockerfile"
    sites = []
    for stmt in statements(text, rel.endswith(BRACKET_SUFFIXES)):
        tokens = [t for t, _ in stmt]
        for k, (tok, number) in enumerate(stmt):
            if not is_image(tok):
                continue
            prev = tokens[k - 1] if k else None
            nxt = tokens[k + 1] if k + 1 < len(tokens) else None
            if dockerfile and prev in ("ENTRYPOINT", "CMD"):
                continue  # the image's program; its arguments join each start site's own
            if prev == "--entrypoint":
                continue
            if prev in ("-t", "--tag") and is_build(tokens[:k]):
                continue  # a build tag; in `docker run -t aws-emulator`, -t is the TTY flag
            if nxt is None or nxt in ONE_SHOT or not nxt.startswith("-"):
                continue
            sites.append(Site(rel, number, "start", telemetry_off(tokens[k + 1:])))
    return sites


def is_compose_file(rel):
    name = pathlib.PurePosixPath(rel).name
    return "compose" in name and name.endswith((".yml", ".yaml"))


def compose_sites(root, rel, text):
    """A Compose service whose `image:` is the aws-emulator image passes when the file's render shows `-t off`
    in that service's command."""
    lines = text.split("\n")
    sites, rendered = [], None
    for number, line in enumerate(lines, 1):
        m = IMAGE_LINE.match(line)
        if not m or not is_image(m.group(2).strip("\"'")):
            continue
        indent = len(m.group(1))
        service = None
        for above in reversed(lines[:number - 1]):
            key = KEY_LINE.match(above)
            if key and len(key.group(1)) < indent:
                service = key.group(2)
                break
        if rendered is None:
            rendered = render(root / rel, child_env())
        command = (rendered.get("services", {}).get(service) or {}).get("command") or []
        if isinstance(command, str):
            command = shlex.split(command)
        sites.append(Site(rel, number, "compose", telemetry_off(command)))
    return sites


def tracked_files(root):
    p = run(["git", "-C", str(root), "ls-files", "-z", "--", "."], TIMEOUT["git"], child_env())
    if p.returncode != 0:
        raise CheckError(f"git ls-files in {root} failed (exit {p.returncode}): {p.stderr.strip()}")
    return [f for f in p.stdout.split("\0") if f]


def excluded(rel, extra):
    if rel.lower().endswith(".md") or rel.startswith(("issues/", ".pm/archive/")):
        return True
    return any(rel == e or (e.endswith("/") and rel.startswith(e)) for e in extra)


def scan(root, paths, extra_excluded=()):
    """Start sites in `paths` (relative to `root`), skipping symlinks, files that are not UTF-8, `*.md`, `issues/`,
    `.pm/archive/` and `extra_excluded`. Returns (sites, the paths scanned)."""
    sites, scanned = [], []
    for rel in paths:
        full = root / rel
        if excluded(rel, extra_excluded) or full.is_symlink() or not full.is_file():
            continue
        try:
            text = full.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            continue
        scanned.append(rel)
        found = start_sites(rel, text)
        if is_compose_file(rel):
            found += compose_sites(root, rel, text)
        sites.extend(sorted(found, key=lambda s: s.line))
    return sites, scanned


def findings(sites):
    return [FINDING.format(path=s.path, line=s.line) for s in sites if not s.passed]


# ---------------------------------------------------------------------------------------------- tests: scan


class RepositoryScan(unittest.TestCase):
    def test_every_start_site_passes_t_off(self):
        sites, _ = scan(CHECKOUT, tracked_files(CHECKOUT), REPO_SCAN_EXCLUDED)
        found = {(s.path, s.kind) for s in sites}
        for expected in (("infra/aws-emulator/docker-compose.yml", "compose"), ("tests/integration/run", "start"),
                         ("tests/integration/engine/support/emulator.rs", "start"),
                         ("tests/integration/studio/support/emulator.ts", "start")):
            self.assertIn(expected, found, f"start site not found: {expected}")
        failing = findings(sites)
        self.assertEqual(failing, [], "\n".join(failing))


class ScanRules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tracked = tracked_files(SCAN_FIXTURES)

    def scan_case(self, name):
        paths = [p for p in self.tracked if p == name or p.startswith(name + "/")]
        self.assertTrue(paths, f"fixture {name} is not tracked under {SCAN_FIXTURES}")
        return scan(SCAN_FIXTURES, paths)

    def assert_reported(self, name, lines):
        sites, scanned = self.scan_case(name)
        self.assertEqual(scanned, [name])
        self.assertEqual(findings(sites), [FINDING.format(path=name, line=n) for n in lines])

    def assert_passing_start(self, name):
        """One start site, which passes: nothing is reported."""
        sites, scanned = self.scan_case(name)
        self.assertEqual(scanned, [name])
        self.assertEqual([s.passed for s in sites], [True], sites)
        self.assertEqual(findings(sites), [])

    def assert_no_start(self, name):
        """Scanned, and no start site found."""
        sites, scanned = self.scan_case(name)
        self.assertEqual(scanned, [name])
        self.assertEqual(sites, [])

    def assert_not_scanned(self, name):
        sites, scanned = self.scan_case(name)
        self.assertEqual(scanned, [])
        self.assertEqual(findings(sites), [])

    def test_shell_without_flag(self):
        self.assert_reported("shell-unflagged.sh", [1])

    def test_shell_flag_t_off(self):
        self.assert_passing_start("shell-flag-t-off.sh")

    def test_shell_flag_telemetry_off(self):
        self.assert_passing_start("shell-flag-telemetry-off.sh")

    def test_shell_flag_telemetry_equals_off(self):
        self.assert_passing_start("shell-flag-telemetry-equals-off.sh")

    def test_flag_on_continuation_line(self):
        self.assert_passing_start("continuation-flag-on-next-line.sh")

    def test_flag_after_the_statement_ended(self):
        self.assert_reported("flag-after-statement.sh", [1])

    def test_rust_array_without_flag(self):
        self.assert_reported("rust-unflagged.rs", [3])

    def test_rust_array_with_flag(self):
        self.assert_passing_start("rust-flagged.rs")

    def test_typescript_array_without_flag(self):
        self.assert_reported("typescript-unflagged.ts", [4])

    def test_typescript_array_with_flag(self):
        self.assert_passing_start("typescript-flagged.ts")

    def test_inside_command_substitution(self):
        self.assert_reported("subshell-unflagged.sh", [1])

    def test_image_with_tag(self):
        self.assert_reported("image-tag.sh", [1])

    def test_image_with_registry_path(self):
        self.assert_reported("image-registry-path.sh", [1])

    def test_run_with_tty_flag(self):
        self.assert_reported("run-tty-flag.sh", [1])

    def test_compose_without_flag(self):
        self.assert_reported("compose-unflagged.compose.yml", [4])

    def test_compose_with_flag(self):
        self.assert_passing_start("compose-flagged.compose.yml")

    def test_two_starts_in_file_order(self):
        self.assert_reported("two-unflagged.sh", [2, 4])

    def test_ignored_entrypoint_option(self):
        self.assert_no_start("ignored-entrypoint-option.sh")

    def test_ignored_one_shot_version(self):
        self.assert_no_start("ignored-one-shot-version.sh")

    def test_ignored_one_shot_help(self):
        self.assert_no_start("ignored-one-shot-help.sh")

    def test_ignored_dockerfile_entrypoint(self):
        self.assert_no_start("dockerfile-entrypoint/Dockerfile")

    def test_ignored_build_tag(self):
        self.assert_no_start("ignored-build-tag.sh")

    def test_ignored_image_inspect(self):
        self.assert_no_start("ignored-image-inspect.sh")

    def test_ignored_prose_comment(self):
        self.assert_no_start("ignored-prose-comment.sh")

    def test_ignored_path(self):
        self.assert_no_start("ignored-path.sh")

    def test_not_scanned_markdown(self):
        self.assert_not_scanned("not-scanned-markdown.md")

    def test_not_scanned_under_issues(self):
        self.assert_not_scanned("issues/not-scanned-start.sh")

    def test_not_scanned_symlink(self):
        self.assert_not_scanned("not-scanned-symlink.sh")

    def test_not_scanned_not_utf8(self):
        self.assert_not_scanned("not-scanned-not-utf8.sh")


if __name__ == "__main__":
    unittest.main()
