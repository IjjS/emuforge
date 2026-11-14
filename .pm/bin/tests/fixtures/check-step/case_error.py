"""Copied as test_error.py next to a copy of tests/run: one test errors."""
import unittest


class FixtureError(unittest.TestCase):
    def test_fixture_errors_on_purpose(self):
        raise RuntimeError("fixture error")
