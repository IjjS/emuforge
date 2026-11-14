"""Copied as test_fail.py next to a copy of tests/run: one test fails."""
import unittest


class FixtureFail(unittest.TestCase):
    def test_fixture_fails_on_purpose(self):
        self.assertEqual(1, 2)
