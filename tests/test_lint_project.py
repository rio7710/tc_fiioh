import unittest
from unittest import mock

from tools import lint_project


class LintProjectTests(unittest.TestCase):
    def test_javascript_gate_always_checks_external_app_bootstrap(self):
        calls = []

        with mock.patch.object(lint_project.shutil, "which", return_value="/usr/bin/node"):
            with mock.patch.object(lint_project, "run", side_effect=lambda label, command: calls.append((label, command))):
                lint_project.check_inline_javascript()

        bootstrap_calls = [call for call in calls if call[0] == "app bootstrap JavaScript"]
        self.assertEqual(len(bootstrap_calls), 1)
        self.assertEqual(
            bootstrap_calls[0][1],
            ["/usr/bin/node", "--check", str(lint_project.APP_BOOTSTRAP_PATH)],
        )


if __name__ == "__main__":
    unittest.main()
