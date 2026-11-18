"""The real tree and the guides hold a service's checks in its own folder (issue 402, requirement R1, R3, R5 and R6.1;
test criteria `test_service_tree`).

Check id `harness.service-tree`. One class per heading of the test criteria.

`T` is `tests/integration/studio/`. "The manifest" is requirement R3.2's: the rows of the main manifest
`tests/integration/manifest.jsonl`, in its order, then the rows of each service's manifest
`T/services/<s>/manifest.jsonl`, the services in name order; a folder whose name is not of the form of a service,
or that holds no `manifest.jsonl` file, adds no row. This file reads it itself, as text, and imports no script.

- `Tree` reads this checkout's main manifest, `T/services/`, `T/support/` and the `*.spec.ts` files under `T`.
- `Guides` reads `tests/integration/AGENTS.md`, `tests/integration/references/services-and-manifest.md` and
  `tests/integration/README.md`.

On a checkout before the move every case fails on its own, not at import: S3's, Lambda's and IAM's support files
are in `T/support/` and exported by its `index.ts`, their rows are in the main manifest with their `service`,
`T/services/` and `T/support/service-screens.ts` do not exist, and the guides know `support/` and one manifest.
The case whose name says `guard` holds a behavior of today and passes there already: the manifest's `studio` ids
are the check titles, so no row is lost in the move.
"""
import json
import pathlib
import re
import unittest

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
INTEGRATION = CHECKOUT / "tests" / "integration"
MAIN = INTEGRATION / "manifest.jsonl"
T = INTEGRATION / "studio"
SERVICES = T / "services"
SUPPORT = T / "support"
AGENTS = INTEGRATION / "AGENTS.md"
SERVICES_REF = INTEGRATION / "references" / "services-and-manifest.md"  # issue 478: moved out of AGENTS.md
README = INTEGRATION / "README.md"

SERVICE = re.compile(r"[a-z][a-z0-9]*(-[a-z0-9]+)*")  # requirement, "Words": matched with fullmatch
MOVED = ("iam", "lambda", "s3")
# Shared by checks of more than one service, or of no service (requirement R5.2, evidence 2).
SHARED = ("checkPrefix", "SEOUL", "creationDateText", "watchText", "appeared", "scrollsSideways", "isListBuckets")
# The twelve rows of issue 56 that get `service` `s3` and move with S3's rows (requirement R5.3).
BUCKET_LIST = (
    "studio.s3-bucket-list-shows-what-the-emulator-holds",
    "studio.s3-bucket-list-empty-emulator-says-no-buckets",
    "studio.s3-bucket-list-rereads-on-open-and-refresh",
    "studio.s3-bucket-list-pages-follow-the-emulator",
    "studio.s3-bucket-list-filter-matches-the-start-of-a-name",
    "studio.s3-bucket-list-actions-lead-to-their-routes",
    "studio.s3-bucket-list-copy-arn-copies-the-emulators-arn",
    "studio.s3-bucket-list-follows-emulator-stop-and-restart",
    "studio.s3-bucket-list-says-when-the-engine-stops-answering",
    "studio.s3-bucket-list-shows-loading-until-the-answer",
    "studio.s3-bucket-list-help-and-notice",
    "studio.s3-bucket-list-keyboard-and-layout",
)
FOLDER = "services/<service>/"


# ---------------------------------------------------------------------------------------------------- the tree

def rows_of(path):
    """The rows of one manifest file, each a JSON object, in the file's order."""
    rows = []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        r = json.loads(line)
        if not isinstance(r, dict):
            raise AssertionError(f"{path.relative_to(CHECKOUT)}:{n} is not a JSON object")
        rows.append(r)
    return rows


def service_manifests():
    """(service, path) of each service's manifest, in name order: a folder of the form of a service under
    `T/services/` that holds a file `manifest.jsonl`. A symbolic link, as the folder `services/`, a service's folder or
    its manifest, adds none: every reader takes it for a manifest that cannot be read."""
    if SERVICES.is_symlink() or not SERVICES.is_dir():
        return []
    found = []
    for d in sorted(SERVICES.iterdir(), key=lambda d: d.name):
        m = d / "manifest.jsonl"
        if (SERVICE.fullmatch(d.name) and not d.is_symlink() and d.is_dir()
                and not m.is_symlink() and m.is_file()):
            found.append((d.name, m))
    return found


def manifest():
    """The manifest of requirement R3.2: the main manifest's rows, then each service's, the services in name order."""
    rows = rows_of(MAIN)
    for _, path in service_manifests():
        rows.extend(rows_of(path))
    return rows


def specifiers(text):
    """The module specifiers of a TypeScript file's import and export lines (`from '<x>'`, `import '<x>'`)."""
    return re.findall(r"""\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]""", text)


def exported(text):
    """The names a TypeScript file exports: the first name of each declaration (`export const x`, `export function x`,
    …) and the names of `export { … }` lists, with `a as b` giving `b`."""
    names = set(re.findall(
        r"^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?"
        r"(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)", text, re.M))
    for body in re.findall(r"\bexport\s+(?:type\s+)?\{([^}]*)\}", text):
        for item in body.split(","):
            words = item.split()
            if words and words[0] == "type":
                words = words[1:]
            if words:
                names.add(words[-1])
    return names


class Tree(unittest.TestCase):
    def test_no_row_of_the_main_manifest_has_a_service(self):
        held = [(r.get("check_id"), r["service"]) for r in rows_of(MAIN) if "service" in r]
        self.assertEqual(held, [], f"{len(held)} rows of tests/integration/manifest.jsonl have a service")

    def test_each_service_folder_holds_the_rows_of_its_service(self):
        found = dict(service_manifests())
        for s in MOVED:
            with self.subTest(service=s):
                self.assertIn(s, found, f"tests/integration/studio/services/{s}/manifest.jsonl")
                self.assertGreaterEqual(len(rows_of(found[s])), 1, found[s])
        for s, path in found.items():
            for r in rows_of(path):
                with self.subTest(service=s, check_id=r.get("check_id")):
                    self.assertEqual(r.get("service"), s)
                    self.assertEqual(r.get("module"), "studio")
                    self.assertRegex(r.get("path", ""), r"\Atests/integration/studio/[^/]+\.spec\.ts\Z")

    def test_s3_manifest_holds_the_twelve_bucket_list_rows(self):
        path = SERVICES / "s3" / "manifest.jsonl"
        self.assertTrue(path.is_file(), path)
        ids = [r.get("check_id") for r in rows_of(path)]
        self.assertEqual([i for i in BUCKET_LIST if i not in ids], [])

    def test_support_holds_no_service_file_and_each_folder_its_own(self):
        left = sorted(p.name for p in SUPPORT.iterdir()
                      if p.is_file() and re.fullmatch(r"(s3|iam|lambda).*\.ts", p.name))
        self.assertEqual(left, [], "files of a service directly under tests/integration/studio/support/")
        for s in MOVED:
            for name in (f"{s}.ts", f"{s}-seed-structure.ts"):
                with self.subTest(file=f"services/{s}/{name}"):
                    self.assertTrue((SERVICES / s / name).is_file(), SERVICES / s / name)

    def test_support_index_names_no_service_file(self):
        named = [x for pair in specifiers((SUPPORT / "index.ts").read_text()) for x in pair if x]
        self.assertTrue(named, "support/index.ts names no module")
        bad = [x for x in named
               if re.match(r"\./(s3|iam|lambda)", x) or "services" in x.split("/")]
        self.assertEqual(bad, [], "specifiers of tests/integration/studio/support/index.ts")

    def test_service_screens_exports_the_shared_names(self):
        path = SUPPORT / "service-screens.ts"
        self.assertTrue(path.is_file(), path)
        self.assertEqual(sorted(set(SHARED) - exported(path.read_text())), [], path)
        for f in sorted(SERVICES.rglob("*.ts")):
            with self.subTest(file=str(f.relative_to(CHECKOUT))):
                self.assertEqual(sorted(set(SHARED) & exported(f.read_text())), [])

    def test_guard_the_studio_ids_are_the_check_titles(self):
        rows = manifest()
        ids = [r.get("check_id") for r in rows]
        self.assertEqual(sorted({i for i in ids if ids.count(i) > 1}), [], "ids held twice in the manifest")
        studio = sorted(r.get("check_id") for r in rows if r.get("module") == "studio")
        titles = sorted(t for p in sorted(T.rglob("*.spec.ts"))
                        for t in re.findall(r"""\btest\(\s*['"`](studio\.[^'"`]+)['"`]""", p.read_text()))
        self.assertGreater(len(titles), 0)
        self.assertEqual(studio, titles)


# ---------------------------------------------------------------------------------------------------- the guides

def part(text, heading):
    """The body under the heading line `heading`, up to the next heading of the same or a higher level."""
    lines = text.splitlines()
    start = lines.index(heading)  # ValueError names the missing heading
    level = len(heading) - len(heading.lstrip("#"))
    body = []
    for line in lines[start + 1:]:
        m = re.match(r"(#+) ", line)
        if m and len(m.group(1)) <= level:
            break
        body.append(line)
    return "\n".join(body)


def sentences(text):
    """The sentences of `text` outside fenced blocks, each on one line: a blank line or a list item ends one, and so
    does `.`, `!` or `?` before a space."""
    blocks, cur, fenced = [], [], False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            fenced = not fenced
            continue
        if fenced:
            continue
        if not line.strip() or re.match(r"\s*(\d+\.|-) ", line):
            if cur:
                blocks.append(" ".join(cur))
            cur = [line.strip()] if line.strip() else []
        else:
            cur.append(line.strip())
    if cur:
        blocks.append(" ".join(cur))
    return [s for b in blocks for s in re.split(r"(?<=[.!?])\s+", b) if s]


def tree_paths(text):
    """The paths of the first fenced block of `text`, read as a tree: each line's first word is a name, joined to
    the name of the nearest line above it that is indented less and ends with `/`."""
    m = re.search(r"^```[^\n]*\n(.*?)^```", text, re.M | re.S)
    if not m:
        return []
    paths, stack = [], []  # stack of (indent, path)
    for line in m.group(1).splitlines():
        start = re.search(r"[^\s│├└─]", line)
        if not start:
            continue
        indent, name = start.start(), line[start.start():].split()[0]
        while stack and stack[-1][0] >= indent:
            stack.pop()
        path = stack[-1][1] + name if stack and stack[-1][1].endswith("/") else name
        paths.append(path)
        stack.append((indent, path))
    return paths


class Guides(unittest.TestCase):
    def setUp(self):
        self.agents = AGENTS.read_text()
        self.ref = SERVICES_REF.read_text()

    def assertSentence(self, text, *words, where=""):
        found = [s for s in sentences(text) if all(re.search(w, s, re.I) for w in words)]
        self.assertTrue(found, f"{where}: no sentence holds {words!r}")
        return found

    def test_agents_tree_lists_the_service_folder(self):
        paths = tree_paths(self.agents)
        self.assertTrue(any(p.endswith("studio/" + FOLDER) for p in paths), paths)

    def test_agents_service_checks_names_the_folder_and_what_it_calls_for(self):
        text = part(self.ref, "## Service checks")
        place = re.escape("tests/integration/studio/" + FOLDER)
        self.assertSentence(text, place, r"\bsupport\b", r"\bseed\b", r"manifest\.jsonl", where="Service checks")
        self.assertSentence(text, r"\bpaths?\b", re.escape(FOLDER) + r"|\bthere\b|\b(that|its|the) folder\b",
                            r"\bcalls? for\b", r"\b(alone|only)\b", r"\bservice'?s?\b", where="Service checks")
        self.assertSentence(text, r"`(tests/integration/studio/)?support/`", r"\bevery service",
                            where="Service checks")
        self.assertSentence(text, r"\brun\b", r"\brefuse", r"\bimport", r"\bcheck files?\b", where="Service checks")

    def test_agents_manifest_names_both_files_and_every_reader(self):
        text = part(self.ref, "## Manifest")
        self.assertSentence(text, r"\brows?\b", re.escape(FOLDER + "manifest.jsonl"), where="Manifest")
        main = r"(?<![/\w])`?manifest\.jsonl|tests/integration/manifest\.jsonl"
        self.assertSentence(text, r"\b(other|others|no service)\b", main, where="Manifest")
        self.assertSentence(text, r"\b(every|each) reader\b|\breaders\b", r"\b(both|each service'?s?)\b",
                            where="Manifest")

    def test_agents_who_edits_names_support_and_the_service_folder(self):
        said = self.assertSentence(part(self.agents, "## Who edits"), r"\bhelper code\b", where="Who edits")
        self.assertTrue(any("support/" in s and FOLDER in s for s in said), said)

    def test_readme_names_the_service_folder_and_its_manifest(self):
        text = README.read_text()
        self.assertTrue("studio/" + FOLDER in text, "README.md does not name studio/services/<service>/")
        both = "studio/" + FOLDER + "manifest.jsonl" in text or any(
            "studio/" + FOLDER in s and "manifest.jsonl" in s for s in sentences(text))
        self.assertTrue(both, "README.md names no manifest.jsonl of studio/services/<service>/")


if __name__ == "__main__":
    unittest.main()
