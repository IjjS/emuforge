"""The rules say that an issue's units are collected on one issue branch (issue 63, R8), read as text like
test_ci_docs.py, with its helpers' meaning.

A **part** is the body under a heading up to the next heading of the same or a higher level; a **block** is a
paragraph or a list item on one line; a **sentence** ends at a block's end or at `.`, `!` or `?` before a space.
Each case is one line of test-criteria.md; each thing the line asks is a subTest, so a run names every one that
fails. Every case failed on the rules as they were before issue 63, except the two marked `guard: passes on main`:
the one sentence that runs `pm-check .` on `main` by hand, and `pm-brief worker` filling the template.

Issue 478 moved the plan's steps out of SKILL.md into `references/lead.md` (the plan leads its issue), made the
`impl` review one stage of the whole, and left only `e` and `s` units (decisions.md of issue 478). The cases follow
each rule to where it now lives, in the class `Lead` for lead.md; what they ask of each rule is unchanged.
"""
import json
import re
import unittest

from _fixture import CHECKOUT, make, run

PM = CHECKOUT / ".agents" / "skills" / "pm"
SKILL = PM / "SKILL.md"
PANE_MODE = PM / "references" / "pane-mode.md"
REVIEW = PM / "references" / "review-protocol.md"
LEAD = PM / "references" / "lead.md"
ARCHIVE = PM / "references" / "archive.md"
BRIEFS = PM / "references" / "briefs"
WORKER = BRIEFS / "worker.md"
BRIEFS_README = BRIEFS / "README.md"
ROOT = CHECKOUT / "AGENTS.md"
ENGINE_WORKFLOW = CHECKOUT / "engine" / "references" / "workflow.md"
STUDIO_WORKFLOW = CHECKOUT / "studio" / "references" / "workflow.md"
GUIDES = (SKILL, LEAD, PANE_MODE, REVIEW, ARCHIVE, WORKER, ROOT, ENGINE_WORKFLOW, STUDIO_WORKFLOW)
PM_CHECK = "`pm-check .`"
LEAVES = r"\bleft to\b|\bleaves\b|\bdeferred\b"


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


def part_of(text, prefix):
    """The part whose heading line starts with `prefix` (`### 5.`); exactly one heading must."""
    heads = [ln for ln in text.splitlines() if ln.startswith(prefix + " ") or ln == prefix]
    if len(heads) != 1:
        raise AssertionError(f"{len(heads)} headings start with {prefix!r}: {heads}")
    return part(text, heads[0])


def blocks(text):
    """Paragraphs and list items, each on one line: a blank line or a line starting a list item starts a block."""
    out, cur = [], []
    for line in text.splitlines():
        if not line.strip() or re.match(r"\s*(\d+\.|-) ", line):
            if cur:
                out.append(" ".join(cur))
            cur = [line.strip()] if line.strip() else []
        else:
            cur.append(line.strip())
    if cur:
        out.append(" ".join(cur))
    return out


def sentences(text):
    """The sentences of `text`, each on one line: a block ends one, and so does `.`, `!` or `?` before a space."""
    out = []
    for b in blocks(text):
        out.extend(s for s in re.split(r"(?<=[.!?])\s+", b) if s)
    return out


def clauses(text):
    """The sentences of `text`, each split again at `; `: a list of clauses joined by semicolons says one thing per
    clause, so a clause on each unit and a clause on the collecting branch are read apart."""
    return [c for s in sentences(text) for c in s.split("; ") if c]


def flat(text):
    return " ".join(text.split())


def has(block, *patterns):
    """Every pattern is found in `block`: a regular expression, matched as written."""
    return all(re.search(p, block) for p in patterns)


def in_order(bs, steps):
    """Whether `steps` ((pattern, block predicate), …) occur in this order in the blocks `bs`: each pattern found in
    a block that satisfies its predicate, after where the step before it was found. Returns the steps not found."""
    offsets, o = [], 0
    for b in bs:
        offsets.append(o)
        o += len(b) + 1
    at = 0
    for i, (pattern, ok) in enumerate(steps):
        hit = None
        for b, start in zip(bs, offsets):
            if start + len(b) < at or not ok(b):
                continue
            m = re.compile(pattern).search(b, max(0, at - start))
            if m:
                hit = start + m.end()
                break
        if hit is None:
            return [p for p, _ in steps[i:]]
        at = hit
    return []


def template_block(text, name):
    """The text of a brief template's block `<!-- block: <name> … -->` up to the next block marker."""
    m = re.search(r"<!-- block: " + re.escape(name) + r"\b.*?-->(.*?)(?=<!-- block:|\Z)", text, re.S)
    if not m:
        raise AssertionError(f"no template block {name!r}")
    return flat(m.group(1))


def rows(text, start):
    return [ln for ln in text.splitlines() if ln.startswith(start)]


class Skill(unittest.TestCase):
    def setUp(self):
        self.text = SKILL.read_text()

    def test_close_merges_the_issue_branch_on_its_whole_check(self):
        close = blocks(part_of(self.text, "### 2."))
        self.assertTrue(any(has(b, r"`pm-merge <id>`", r"\bwhole check'?s?\b[^.]*\brecord\b") for b in close), close)

    def test_report_names_the_whole_checks_record(self):
        report = blocks(part_of(self.text, "### 3."))
        self.assertTrue(any(has(b, r"\bwhole check'?s?\b[^.]*\brecord\b|\brecord of the whole check\b")
                            for b in report), report)

    def test_low_batch_is_one_issue_branch_of_its_host(self):
        lines = part(self.text, "### Next issue").splitlines()
        start = next(i for i, ln in enumerate(lines) if ln.startswith("- `LOW`"))
        end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("- ")), len(lines))
        batch = blocks("\n".join(lines[start:end]))
        with self.subTest("pm-worktree new <host> and issue branch"):
            self.assertTrue(any(has(b, r"`pm-worktree new <host>`", r"\bissue branch\b") for b in batch), batch)
        with self.subTest("the block that finishes the batch names pm-merge <host>"):
            done = [b for b in batch if re.search(r"\bbatch is finished\b|\bfinish(es)? the batch\b", b)]
            self.assertTrue(done, batch)
            self.assertRegex(done[0], r"`pm-merge <host>`")

    def test_scripts_rows(self):
        scripts = part(self.text, "## Scripts")
        for name, words in (("pm-merge", ("issue branch", "--take-main")),
                            ("pm-check", ("--checks", "never a gate", "`integration` left to the issue branch")),
                            ("pm-worktree", ("issue branch",))):
            row = rows(scripts, f"| `{name}` |")
            with self.subTest(name):
                self.assertEqual(len(row), 1, row)
                for w in words:
                    self.assertIn(w, row[0])

    def test_guard_one_sentence_runs_the_full_check_on_main(self):  # guard: passes on main
        said = [s for s in sentences(self.text) if PM_CHECK in s and re.search(r"\bmain\b", s)]
        self.assertEqual(len(said), 1, said)


class Lead(unittest.TestCase):
    """The plan's steps that SKILL.md held before issue 478 (its flow steps 3 to 5) now live in `lead.md`, which the
    plan follows as the lead of its issue (decisions.md of issue 478); the cases follow the rules there."""

    def setUp(self):
        self.text = LEAD.read_text()
        self.build = blocks(part(self.text, "## Build"))

    def test_build_makes_the_issue_branch_first_even_for_one_unit(self):
        first = [b for b in self.build if b.startswith("1. ")]
        self.assertEqual(len(first), 1, self.build)
        self.assertTrue(has(first[0], r"`pm-worktree new <id>`", r"`feat/<id>`", r"`emuforge-<id>`",
                            r"\beven for an issue of one unit\b"), first[0])

    def test_merge_order_unit_take_main_whole_check(self):
        missing = in_order(blocks(self.text), [
            (r"`pm-merge <id> <unit>`", lambda b: "feat/<id>" in b),
            (r"pm-merge <id> --take-main", lambda b: True),
            (r"pm-check emuforge-<id>", lambda b: "whole check" in b),
            (r"ISSUE READY", lambda b: True),
        ])
        self.assertEqual(missing, [], blocks(self.text))

    def test_failed_whole_check_goes_to_the_owning_unit(self):
        whole = blocks(part(self.text, "## Whole check"))
        self.assertTrue(any(has(b, r"\bfailed\b", r"\bchecks?\b", r"\bunit\b", r"`breakdown\.md`",
                                r"\bmerged?\b[^.]*\bagain\b") for b in whole), whole)

    def test_prompt_after_a_units_merge_names_the_issue_branch(self):
        spans = [s for b in self.build for s in re.findall(r"`([^`]+)`", b)]
        with self.subTest("the prompt names the issue branch"):
            self.assertTrue(any("feat/<id> is at" in s for s in spans), spans)
        with self.subTest("no block tells every pane to merge main after a unit's merge into the issue branch"):
            told = [b for b in self.build
                    if has(b, r"`pm-merge <id> <unit>`|\binto `?feat/<id>`?", r"\bpanes?\b",
                           r"main is at|merge `main`|merge main\b")]
            self.assertEqual(told, [])

    def test_critique_captures_the_issues_worktree(self):
        crit = blocks(part(self.text, "## Critique"))
        self.assertTrue(any(has(b, r"--capture-wt", r"emuforge-<id>") for b in crit), crit)

    def test_critique_comes_before_the_whole_check_issue_497(self):
        """Owner, 2026-11-19 (issue 497, point 8): the whole check runs once, after the last `final` has no P0 or P1;
        a fix of the whole check that changes a screen has that screen critiqued once more."""
        lines = self.text.splitlines()
        self.assertLess(lines.index("## Critique"), lines.index("## Whole check"))
        self.assertNotIn("## End review and critique", lines)
        whole = " ".join(blocks(part(self.text, "## Whole check")))
        for wanted in (r"only when the last `final` has no P0 or P1", r"`pm-critique check <id>`",
                       r"that screen alone is critiqued once more"):
            with self.subTest(wanted):
                self.assertRegex(whole, wanted)
        crit = " ".join(blocks((BRIEFS / "crit.md").read_text()))
        self.assertIn("before its whole check", crit)
        self.assertNotIn("once its whole check has passed", crit)
        critique = " ".join((CHECKOUT / "studio" / "references" / "critique.md").read_text().split())
        self.assertIn("before the whole check, which runs only when the last `final` has no P0 or P1", critique)
        self.assertNotIn("after the whole check passes", critique)

    def test_no_t_unit(self):
        cut = blocks(part(self.text, "## The cut"))
        with self.subTest("a unit is e<n> or s<n>"):
            self.assertTrue(any(has(b, r"`e<n>`", r"`s<n>`") for b in cut), cut)
        with self.subTest("no t<n> unit"):
            self.assertEqual([b for b in cut if re.search(r"`t<n>`|`t` unit", b)], [])


class Panes_and_reviews(unittest.TestCase):
    def test_pane_mode(self):
        bs = blocks(PANE_MODE.read_text())
        with self.subTest("--checks with pm-check, never a gate"):
            self.assertTrue(any(has(b, r"--checks", r"pm-check", r"never a gate") for b in bs))
        with self.subTest("a unit's pm-check, the fast check, leaves integration to the issue branch"):
            self.assertTrue(any(has(b, r"\bunit\b", r"pm-check", r"\bfast check\b", r"`integration`",
                                    r"\bissue branch\b", LEAVES) for b in bs))
        with self.subTest("no block: git merge main when the PM tells you main moved"):
            self.assertEqual([b for b in bs if "`git merge main` when the PM tells you main moved" in b], [])
        with self.subTest("the block on filed issues does not say: when the unit merges"):
            filed = [b for b in bs if "pm-issue commit" in b]
            self.assertTrue(filed)
            self.assertEqual([b for b in filed if "when the unit merges" in b], [])

    def test_review_protocol_breakdown_green_into_main(self):
        found = [b for b in blocks(REVIEW.read_text()) if b.startswith("- **breakdown**")]
        self.assertEqual(len(found), 1, found)
        with self.subTest("the collecting branch is green when it merges into main"):
            self.assertRegex(found[0], r"\b(collecting|issue) branch green when it merges into `main`")
        with self.subTest("each unit is e<n> or s<n>"):
            self.assertRegex(found[0], r"`e<n>` or `s<n>`")

    def test_review_protocol_impl_is_the_whole(self):
        bs = blocks(REVIEW.read_text())
        with self.subTest("no per-unit stage"):
            self.assertEqual([b for b in bs if re.match(r"- \*\*(checks|impl)-<unit>\*\*", b)], [])
        found = [b for b in bs if b.startswith("- **impl** (the whole)")]
        self.assertEqual(len(found), 1, found)
        for words in ("`main...feat/<id>`", "whole check", "emuforge-<id>/output/checks/last.json",
                      "integration checks"):
            with self.subTest(words):
                self.assertIn(words, found[0])

    def test_archive_first_block(self):
        first = blocks(part(ARCHIVE.read_text(), "# Archive"))[0]
        self.assertIn("issue branch", first)
        self.assertNotIn(PM_CHECK, first)

    def test_worker_brief_and_placeholders(self):
        text = flat(WORKER.read_text())
        with self.subTest("the fast check, until PASSED, leaves integration to the issue branch"):
            self.assertIn("until it prints `PASSED`: your fast check, which leaves `integration` to the issue branch",
                          text)
        with self.subTest("the worker writes no integration test"):
            self.assertIn("You write no integration test", text)
        with self.subTest("the row of {{base}}"):
            row = [ln for ln in BRIEFS_README.read_text().splitlines()
                   if ln.startswith("|") and "`{{base}}`" in ln]
            self.assertEqual(len(row), 1, row)
            self.assertIn("issue branch", row[0])

    def test_guard_pm_brief_fills_the_worker_template(self):  # guard: passes on main
        """Only an `e` or `s` unit since issue 478 (`pm-brief worker` refuses `t<n>`)."""
        files = {f".agents/skills/pm/references/briefs/{n}.md": (BRIEFS / f"{n}.md").read_text()
                 for n in ("plan", "rev", "worker", "crit")}
        files["issues/things-that-do-not-work/1-engine.md"] = (
            "Issue-Id: 7\nIssue-Severity: LOW\nIssue-Module: engine\nIssue-Kind: bug\nIssue-Source: owner\n"
            "Issue-Key: engine|x|y\nIssue-Check-Ids:\nIssue-Commit: 0\n\n# Make the thing work\n\n## Description\n")
        files["engine/AGENTS.md"] = files["engine/references/workflow.md"] = "x\n"
        co = make("issue-branch-docs", "brief", ("pm-brief",), files)
        wts = [dict(issue="7", unit="e1", path=f"{co}-7-e1", branch="feat/7-e1", base="feat/7")]
        (co / ".pm" / "run").mkdir(parents=True, exist_ok=True)
        (co / ".pm" / "run" / "worktrees.json").write_text(json.dumps(wts))
        p = run(co, "pm-brief", "worker", 7, "e1", "--summary", "The unit.", "--close", "it-relay-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn("{{", (co / ".pm" / "issue-7" / "brief-e1.md").read_text())


class Root_and_modules(unittest.TestCase):
    def test_root_agents(self):
        text = ROOT.read_text()
        row = rows(text, "| `pm` |")
        with self.subTest("the pm row"):
            self.assertEqual(len(row), 1, row)
            self.assertIn("issue branch", row[0])
        branches = part(text, "## Branches and main")
        said = sentences(branches)
        with self.subTest("the issue branch, once, main"):
            self.assertTrue(any(has(s, r"\bissue branch\b", r"\bonce\b", r"\bmain\b") for s in said), said)
        with self.subTest("even an issue of one unit collects its unit on the issue branch"):
            self.assertTrue(any(has(s, r"\beven an issue of one unit\b", r"\bissue branch\b", r"\bmerges a unit's branch\b")
                                for s in said), said)
        with self.subTest("a harness issue has none: its unit's branch goes into main"):
            self.assertTrue(any(has(s, r"\bharness issue has no issue branch\b", r"\bunit's branch into local `main`")
                                for s in said), said)
        with self.subTest("GitHub Actions"):
            self.assertIn("GitHub Actions", flat(branches))

    def test_module_workflows(self):
        with self.subTest("engine"):
            self.assertIn("issue branch", flat(part(ENGINE_WORKFLOW.read_text(), "## 5. Verification")))
        with self.subTest("studio"):
            found = [b for b in blocks(STUDIO_WORKFLOW.read_text()) if b.startswith("Then: the commands")]
            self.assertEqual(len(found), 1, found)
            self.assertIn("issue branch", found[0])


class No_unit_does_it_alone(unittest.TestCase):
    def test_no_sentence_has_every_unit_run_integration_or_merge_into_main(self):
        for path in GUIDES:
            said = clauses(path.read_text())
            unit = [s for s in said if re.search(r"\b(each|every) unit\b", s)]
            with self.subTest(f"{path.name}: integration"):
                self.assertEqual([s for s in unit if has(s, r"integration", r"\bruns\b|\brun the\b")], [])
            with self.subTest(f"{path.name}: main"):
                self.assertEqual([s for s in unit if has(s, r"\bmerge", r"\bmain\b")
                                  and not re.search(r"\binto\b[^.]*\bissue branch\b", s)], [])

    def test_archive_and_report_do_not_merge_each_unit_into_main(self):
        for name, text in (("archive.md", blocks(part(ARCHIVE.read_text(), "# Archive"))[0]),
                           ("SKILL 3", part_of(SKILL.read_text(), "### 3."))):
            for words in ("every unit of the issue is merged into local `main`", "each was merged on a passing check"):
                with self.subTest(f"{name}: {words}"):
                    self.assertNotIn(words, flat(text))


if __name__ == "__main__":
    unittest.main()
