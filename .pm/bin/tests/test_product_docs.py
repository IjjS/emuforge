"""The product guide of issue 483, read as text like test_docs.py.

Root `PRODUCT.md` holds the owner's product plan of 2026-11-18 in English, with the owner's Korean quoted where a
sentence decides something; root `AGENTS.md` names it once; `README.md` and `studio/PRODUCT.md` point to it and name
the issues that bring what they describe to it. Every case fails on the guides as they were before the issue: there
was no root `PRODUCT.md` and no guide named one.
"""
import pathlib
import re
import unittest

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[2]
PRODUCT = CHECKOUT / "PRODUCT.md"
ROOT = CHECKOUT / "AGENTS.md"
README = CHECKOUT / "README.md"
STUDIO = CHECKOUT / "studio" / "PRODUCT.md"
HANGUL = re.compile(r"[가-힣]")

# The parts the issue names, as the headings of the guide.
PARTS = ["Overview", "Parts and ports", "Roadmap", "Phase 1: Studio", "Phase 2: the CLI, as planned",
         "Delivery: two ways", "The two compared", "Release and versions", "Non-functional requirements",
         "Out of scope for phases 1 and 2", "Where the repository stands"]


def headings(text):
    return [ln[3:].strip() for ln in text.splitlines() if ln.startswith("## ")]


def part(text, heading):
    """The body under `## heading`, up to the next heading of level 2."""
    out, inside = [], False
    for ln in text.splitlines():
        if ln.startswith("## "):
            inside = ln[3:].strip() == heading
            continue
        if inside:
            out.append(ln)
    return "\n".join(out)


def flat(text):
    return " ".join(text.split())


class Product(unittest.TestCase):
    def test_has_the_parts_of_the_plan(self):
        found = headings(PRODUCT.read_text())
        for name in PARTS:
            self.assertIn(name, found)

    def test_says_it_is_the_owners_plan_and_quotes_korean(self):
        text = PRODUCT.read_text()
        self.assertIn("the owner's product plan of 2026-11-18", flat(text))
        quoted = [ln for ln in text.splitlines() if ln.startswith("> ") and HANGUL.search(ln)]
        self.assertGreaterEqual(len(quoted), 5, quoted)

    def test_the_roadmap_order(self):
        roadmap = part(PRODUCT.read_text(), "Roadmap")
        order = [roadmap.find(w) for w in ("**Studio**", "**CLI.**", "**IAM simulator**", "**IaC integration")]
        self.assertNotIn(-1, order, order)
        self.assertEqual(order, sorted(order))

    def test_the_ports(self):
        ports = flat(part(PRODUCT.read_text(), "Parts and ports"))
        for port in ("8296", "8297", "9297"):
            self.assertIn(port, ports)

    def test_the_repository_part_names_the_issues_and_the_upstream_sentence(self):
        stands = flat(part(PRODUCT.read_text(), "Where the repository stands"))
        for issue in ("issue 484", "issues 485 and 486"):
            self.assertIn(issue, stands)
        self.assertIn("only upstream", stands)
        self.assertIn("TLS verified", stands)


class Guides(unittest.TestCase):
    def test_root_agents_names_the_product_guide_once(self):
        self.assertEqual(ROOT.read_text().count("`PRODUCT.md`"), 1)

    def test_root_agents_keeps_the_upstream_sentence(self):
        self.assertIn("The only upstream is the local emulator on loopback.", flat(ROOT.read_text()))

    def test_readme_links_the_guide_and_names_the_issues(self):
        text = flat(README.read_text())
        self.assertIn("[PRODUCT.md](PRODUCT.md)", text)
        self.assertIn("Issues 484 to 486", text)
        self.assertNotIn("installed with a shell command", text)

    def test_studio_product_names_the_plan_and_the_issues(self):
        text = flat(STUDIO.read_text())
        self.assertIn("the root `PRODUCT.md`", text)
        for issue in ("issue 484", "issues 485 and 486"):
            self.assertIn(issue, text)


if __name__ == "__main__":
    unittest.main()
