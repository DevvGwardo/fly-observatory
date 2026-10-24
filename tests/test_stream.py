import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from server import stream


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_unchanged_paused_frames_send_visible_heartbeats(self):
        frame = {"status": "ready", "seq": 42, "paused": True}
        owner = SimpleNamespace(latest=Mock(return_value=frame))
        request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
        with patch("server.runner", owner), \
                patch("server.monotonic", side_effect=[10, 10.05, 11.1]), \
                patch("server.asyncio.sleep", new_callable=AsyncMock):
            response = await stream(request)
            events = response.body_iterator
            first = await anext(events)
            quiet = await anext(events)
            heartbeat = await anext(events)
            await events.aclose()
        self.assertTrue(first.startswith("data: "))
        self.assertEqual(quiet, ": keepalive\n\n")
        self.assertEqual(heartbeat, first)
        self.assertEqual(frame["seq"], 42)
        self.assertEqual(owner.latest.call_count, 3)
