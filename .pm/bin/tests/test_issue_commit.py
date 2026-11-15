"""pm-issue commit: the new issue files, all of them and nothing else, under a message that names each id."""
import unittest

from _fixture import git, make, run

KEEP = {"issues/things-that-do-not-work/.gitkeep": "", "issues/things-that-now-work/.gitkeep": ""}


def new_issue(co, subject, fill=True):
    p = run(co, "pm-issue", "new", "--module", "engine", "--kind", "bug", "--severity", "LOW", "--source", "plan",
            "--key", f"engine|{subject}|x", "--title", f"Fix {subject}")
    path = p.stdout.split(" ", 1)[1].strip()
    if fill:
        text = open(path).read().replace("## Description\n", "## Description\n\nIt breaks.\n").replace("## Evidence\n", "## Evidence\n\n`log`\n")
        open(path, "w").write(text)
    return path


class IssueCommit(unittest.TestCase):
    def test_two_files_one_commit_both_ids(self):
        co = make("issue-commit", "two", ("pm-issue", "_pmlib.py"), KEEP)
        new_issue(co, "a"); new_issue(co, "b")
        (co / "stray.txt").write_text("x\n")
        git(co, "add", "stray.txt")  # staged by someone else: must stay out of the commit
        p = run(co, "pm-issue", "commit")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(git(co, "log", "-1", "--format=%s"), "issue: file #1 #2")
        self.assertEqual(len(git(co, "show", "--name-only", "--format=", "HEAD").splitlines()), 2)
        self.assertIn("A  stray.txt", git(co, "status", "--porcelain"))

    def test_empty_evidence_is_refused_and_nothing_is_committed(self):
        co = make("issue-commit", "empty", ("pm-issue", "_pmlib.py"), KEEP)
        new_issue(co, "a"); new_issue(co, "b", fill=False)
        p = run(co, "pm-issue", "commit")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("(#2): the Evidence section is empty", p.stderr)
        self.assertEqual(git(co, "log", "-1", "--format=%s"), "fixture")

    def test_nothing_new(self):
        co = make("issue-commit", "none", ("pm-issue", "_pmlib.py"), KEEP)
        self.assertIn("no new issue file", run(co, "pm-issue", "commit").stderr)

    def test_dry_run_commits_nothing(self):
        co = make("issue-commit", "dry", ("pm-issue", "_pmlib.py"), KEEP)
        new_issue(co, "a")
        self.assertIn("issue: file #1", run(co, "pm-issue", "commit", "--dry-run").stdout)
        self.assertEqual(git(co, "log", "-1", "--format=%s"), "fixture")
