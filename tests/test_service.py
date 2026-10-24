import io
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch

import service


class ServiceTests(unittest.TestCase):
    def test_disable_waits_for_asynchronous_bootout(self):
        ok = SimpleNamespace(returncode=0, stderr="")
        missing = SimpleNamespace(returncode=113, stderr="Service not found")
        with patch("sys.argv", ["service.py", "disable"]), \
                patch("service.launchctl", side_effect=[ok, ok, ok, ok, missing]) as ctl, \
                patch("service.time.sleep") as sleep, redirect_stdout(io.StringIO()):
            self.assertEqual(service.main(), 0)
        self.assertEqual([call.args[0] for call in ctl.call_args_list],
                         ["print", "disable", "bootout", "print", "print"])
        sleep.assert_called_once_with(.1)
