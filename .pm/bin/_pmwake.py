"""What wakes pm-watchd between two looks: herdr's event socket, a signal, or the fallback timeout. Not a command.

herdr serves newline-delimited JSON on a unix socket (HERDR_SOCKET_PATH, else ~/.config/herdr/herdr.sock). One
request, `events.subscribe`, turns the connection into a stream: an acknowledgement line, then one line per event.
`pane.agent_status_changed` is subscribed per pane id, so the subscription is rebuilt whenever the set of watched
panes changes. The events only say "look now"; what happened is still judged from `herdr agent list` and the report
files, so a missed or duplicated event changes nothing but the delay.

Other scripts wake the daemon with SIGUSR1 (`_pmlib.wake_watchd`) after appending a report or an inbox line.

When the socket cannot be reached or drops, `wait` degrades to the timeout alone and the next `watch` tries again;
the daemon then behaves exactly as the polling version did.
"""
import json
import os
import pathlib
import select
import signal
import socket

GLOBAL = ("pane.closed", "pane.exited", "pane.created", "pane.agent_detected")
SETTLE = 0.3  # seconds to let a burst of events arrive before the daemon looks once


def socket_path():
    return os.environ.get("HERDR_SOCKET_PATH") or str(pathlib.Path.home() / ".config" / "herdr" / "herdr.sock")


def subscriptions(pane_ids):
    subs = [{"type": t} for t in GLOBAL]
    subs += [{"type": "pane.agent_status_changed", "pane_id": p} for p in sorted(pane_ids)]
    return subs


class Waker:
    def __init__(self, path=None):
        self.path = path or socket_path()
        self.sock = None
        self.watched = None
        self.buf = b""
        self.error = None  # why the socket is not in use, for the log (reported once per change by the caller)
        self._r, self._w = os.pipe()
        os.set_blocking(self._r, False)
        os.set_blocking(self._w, False)

    def install_signal(self, signum=signal.SIGUSR1):
        """Make `signum` wake `wait`. Call from the main thread."""
        signal.signal(signum, lambda *_: None)
        signal.set_wakeup_fd(self._w, warn_on_full_buffer=False)

    def close(self):
        if self.sock is not None:
            try:
                self.sock.close()
            except OSError:
                pass
        self.sock, self.watched, self.buf = None, None, b""

    def watch(self, pane_ids):
        """Subscribe to these panes' status changes (and to panes opening, closing and exiting). Reconnects only
        when the set changed or the connection is down. Returns True when the socket is in use."""
        want = frozenset(pane_ids)
        if self.sock is not None and want == self.watched:
            return True
        self.close()
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(5)
            s.connect(self.path)
            req = {"id": "pm-watchd", "method": "events.subscribe", "params": {"subscriptions": subscriptions(want)}}
            s.sendall((json.dumps(req) + "\n").encode())
            ack = b""
            while b"\n" not in ack:
                chunk = s.recv(65536)
                if not chunk:
                    raise OSError("closed before the acknowledgement")
                ack += chunk
            line, _, rest = ack.partition(b"\n")
            reply = json.loads(line)
            if "error" in reply:
                raise OSError(f"subscribe refused: {reply['error'].get('message', reply['error'])}")
            s.setblocking(False)
            self.sock, self.watched, self.buf, self.error = s, want, rest, None
            return True
        except (OSError, ValueError) as e:
            self.error = f"{type(e).__name__}: {e}"
            self.close()
            return False

    def _drain_pipe(self):
        try:
            while os.read(self._r, 4096):
                pass
        except BlockingIOError:
            pass

    def _read_events(self):
        """Read what the socket has; return the event names seen. Drops the connection on EOF or error."""
        try:
            while True:
                chunk = self.sock.recv(65536)
                if not chunk:
                    self.error = "herdr closed the event stream"
                    self.close()
                    break
                self.buf += chunk
        except BlockingIOError:
            pass
        except OSError as e:
            self.error = f"{type(e).__name__}: {e}"
            self.close()
        names = []
        *lines, self.buf = self.buf.split(b"\n")
        for line in lines:
            try:
                names.append(str(json.loads(line).get("event", "?")))
            except ValueError:
                continue
        return names

    def wait(self, timeout):
        """Block until an event, a signal or the timeout. Returns a short reason: 'event <names>', 'signal' or
        'timeout'. Events already buffered count."""
        if b"\n" in self.buf and self.sock is not None:
            return "event " + ",".join(sorted(set(self._read_events())))
        fds = [self._r] + ([self.sock] if self.sock is not None else [])
        try:
            ready, _, _ = select.select(fds, [], [], timeout)
        except InterruptedError:
            ready = [self._r]
        if not ready:
            return "timeout"
        select.select([], [], [], SETTLE)  # let the rest of a burst arrive
        reasons = []
        if self._r in ready:
            reasons.append("signal")
        self._drain_pipe()
        if self.sock is not None:
            names = self._read_events()
            if names:
                reasons.append("event " + ",".join(sorted(set(names))))
            elif self.sock is None:
                reasons.append("socket lost")
        return " ".join(reasons) or "timeout"
