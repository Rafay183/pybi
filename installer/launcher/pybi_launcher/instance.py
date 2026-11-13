"""Single instance: a second click on the PyBI icon brings the running one forward."""
from __future__ import annotations

import logging
import socket
import threading
from typing import Callable

log = logging.getLogger("pybi.instance")
_HELLO = b"PYBI-SHOW\n"


class SingleInstance:
    def __init__(self, port: int):
        self.port = port
        self._sock: socket.socket | None = None

    def acquire(self) -> bool:
        """True if this process is the only launcher. Otherwise pokes the running one."""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows: no port sharing
            s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            s.bind(("127.0.0.1", self.port))
            s.listen(4)
            self._sock = s
            return True
        except OSError:
            s.close()
            self._poke()
            return False

    def _poke(self) -> None:
        try:
            with socket.create_connection(("127.0.0.1", self.port), timeout=2) as c:
                c.sendall(_HELLO)
        except OSError:
            log.warning("Another launcher holds port %s but did not answer", self.port)

    def serve(self, on_show: Callable[[], None]) -> None:
        sock = self._sock
        if sock is None:
            return

        def loop():
            while True:
                try:
                    conn, _ = sock.accept()
                except OSError:
                    return
                with conn:
                    conn.settimeout(2)
                    try:
                        if conn.recv(64).startswith(_HELLO.strip()):
                            on_show()
                    except OSError:
                        pass
        threading.Thread(target=loop, name="single-instance", daemon=True).start()

    def release(self) -> None:
        if self._sock:
            try:
                self._sock.close()
            finally:
                self._sock = None
