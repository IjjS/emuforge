"""_pmwake.Waker: what wakes pm-watchd. A stand-in herdr serves the event socket's line protocol."""
import json
import os
import pathlib
import shutil
import signal
import socket
import threading
import time
import unittest

import _pmwake

WORK = pathlib.Path(__file__).resolve().parents[3] / "output" / "tests" / "wake"


class Herdr:
    """A unix socket server: reads one request line per connection, answers `reply`, then relays `send()` lines."""

    def __init__(self, path, reply=None):
        self.reply = reply or {"id": "pm-watchd", "result": {"type": "subscription_started"}}
        self.requests, self.conns = [], []
        self.srv = socket.socket(socket.AF_UNIX)
        self.srv.bind(str(path))
        self.srv.listen(4)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            try:
                c, _ = self.srv.accept()
            except OSError:
                return
            buf = b""
            while b"\n" not in buf:
                chunk = c.recv(65536)
                if not chunk:
                    break
                buf += chunk
            self.requests.append(json.loads(buf.split(b"\n")[0]))
            c.sendall((json.dumps(self.reply) + "\n").encode())
            self.conns.append(c)

    def send(self, event, **data):
        self.conns[-1].sendall((json.dumps({"event": event, "data": data}) + "\n").encode())

    def drop(self):
        self.conns[-1].close()

    def close(self):
        self.srv.close()
        for c in self.conns:
            c.close()


class WakerCase(unittest.TestCase):
    def setUp(self):
        d = WORK / self._testMethodName[:24]
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        self.path = d / "h.sock"
        self.herdr = Herdr(self.path)
        self.waker = _pmwake.Waker(str(self.path))
        self.addCleanup(self.herdr.close)
        self.addCleanup(self.waker.close)

    def test_subscribes_per_pane_and_globally(self):
        self.assertTrue(self.waker.watch({"w1:p2", "w1:p1"}))
        req = self.herdr.requests[0]
        self.assertEqual(req["method"], "events.subscribe")
        subs = req["params"]["subscriptions"]
        self.assertIn({"type": "pane.agent_status_changed", "pane_id": "w1:p1"}, subs)
        self.assertIn({"type": "pane.agent_status_changed", "pane_id": "w1:p2"}, subs)
        for t in ("pane.closed", "pane.exited"):
            self.assertIn({"type": t}, subs)

    def test_event_wakes_at_once(self):
        self.waker.watch({"w1:p1"})
        threading.Timer(0.2, lambda: self.herdr.send("pane.agent_status_changed", pane_id="w1:p1", agent_status="idle")).start()
        t = time.time()
        reason = self.waker.wait(20)
        self.assertLess(time.time() - t, 5)
        self.assertEqual(reason, "event pane.agent_status_changed")

    def test_nothing_happens_is_timeout(self):
        self.waker.watch({"w1:p1"})
        t = time.time()
        self.assertEqual(self.waker.wait(0.5), "timeout")
        self.assertGreaterEqual(time.time() - t, 0.4)

    def test_same_panes_keep_the_connection_new_panes_resubscribe(self):
        self.waker.watch({"w1:p1"})
        self.waker.watch({"w1:p1"})
        self.assertEqual(len(self.herdr.requests), 1)
        self.waker.watch({"w1:p1", "w1:p9"})
        self.assertEqual(len(self.herdr.requests), 2)

    def test_dropped_stream_is_noticed_and_reconnected(self):
        self.waker.watch({"w1:p1"})
        time.sleep(0.1)
        self.herdr.drop()
        self.assertEqual(self.waker.wait(5), "socket lost")
        self.assertIsNotNone(self.waker.error)
        self.assertEqual(self.waker.wait(0.2), "timeout")  # degraded: the timeout alone
        self.assertTrue(self.waker.watch({"w1:p1"}))
        self.assertEqual(len(self.herdr.requests), 2)

    def test_refused_subscription_degrades(self):
        self.herdr.reply = {"id": "pm-watchd", "error": {"code": "invalid_request", "message": "no"}}
        self.assertFalse(self.waker.watch({"w1:p1"}))
        self.assertIn("refused", self.waker.error)
        self.assertEqual(self.waker.wait(0.2), "timeout")

    def test_no_socket_degrades(self):
        w = _pmwake.Waker(str(self.path) + ".missing")
        self.assertFalse(w.watch(set()))
        self.assertEqual(w.wait(0.2), "timeout")

    def test_signal_wakes(self):
        old_handler = signal.getsignal(signal.SIGUSR1)
        self.waker.install_signal()
        self.addCleanup(signal.signal, signal.SIGUSR1, old_handler)
        self.addCleanup(signal.set_wakeup_fd, -1)
        self.waker.watch({"w1:p1"})
        threading.Timer(0.2, lambda: os.kill(os.getpid(), signal.SIGUSR1)).start()
        t = time.time()
        self.assertEqual(self.waker.wait(20), "signal")
        self.assertLess(time.time() - t, 5)
