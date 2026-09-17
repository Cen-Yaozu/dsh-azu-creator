#!/usr/bin/env python3
"""PTY bridge for pinned biliup 1.2.4. Only emits fixed, non-secret events."""
import json
import os
import pty
import select
import signal
import sys
import time
from pathlib import Path


def emit(event):
    print(json.dumps({"event": event}), flush=True)


def main():
    binary, directory = sys.argv[1:3]
    os.umask(0o077)
    os.chdir(directory)
    parent = os.getppid()
    pid, master = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        os.execv(binary, [binary, '--rust-log', 'error', '-u', str(Path(directory) / 'credentials.json'), 'login'])
    def stop(*_args):
        raise InterruptedError()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    pending = b''
    selected = False
    sent_qr = False
    started = time.monotonic()
    exited = False
    try:
        while time.monotonic() - started < 180:
            if os.getppid() != parent:
                raise InterruptedError()
            readable, _, _ = select.select([master], [], [], 0.2)
            if readable:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    chunk = b''
                pending = (pending + chunk)[-16000:]
                # Pinned CLI defaults to SMS (index 1). Select QR (index 2).
                if not selected and '网页Cookie登录2'.encode() in pending:
                    time.sleep(0.1)
                    os.write(master, b'\x1b[B\r')
                    selected = True
            qr = Path('qrcode.png')
            if not sent_qr and qr.exists() and qr.stat().st_size > 8:
                emit('qr_ready')
                sent_qr = True
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                exited = True
                if os.waitstatus_to_exitcode(status) == 0:
                    emit('completed')
                    return 0
                expired = b'86038' in pending
                emit('expired' if expired else 'failed')
                return 2 if expired else 1
        emit('expired')
        return 2
    except InterruptedError:
        emit('cancelled')
        return 3
    finally:
        if not exited:
            try:
                os.kill(pid, signal.SIGTERM)
                for _ in range(20):
                    done, _ = os.waitpid(pid, os.WNOHANG)
                    if done:
                        break
                    time.sleep(0.05)
                else:
                    os.kill(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        os.close(master)


if __name__ == '__main__':
    sys.exit(main())
