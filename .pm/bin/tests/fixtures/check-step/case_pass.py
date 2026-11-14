"""Copied as test_pass.py next to a copy of tests/run: every test passes."""
import unittest


class FixturePass(unittest.TestCase):
    def test_fixture_passes(self):
        self.assertEqual(1 + 1, 2)

    def test_fixture_passes_too(self):
        self.assertTrue(True)
