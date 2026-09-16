import os, pty, select, subprocess, sys, tempfile, time, fcntl, termios, struct
with tempfile.TemporaryDirectory() as state:
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
    before = termios.tcgetattr(slave)
    process = subprocess.Popen([sys.argv[1], sys.argv[2]], stdin=slave, stdout=slave, stderr=slave, env={**os.environ, 'XDG_STATE_HOME': state})
    output = bytearray()
    def wait_for(text, timeout=10):
        deadline = time.monotonic() + timeout
        while text.encode() not in output:
            if time.monotonic() > deadline: raise AssertionError('missing terminal state: ' + text)
            if select.select([master], [], [], .1)[0]: output.extend(os.read(master, 65536))
    try:
        wait_for('Ready')
        output.clear()
        os.write(master, b'\x1b[200~/exit\nnot a command\x1b[201~')
        time.sleep(.1)
        assert process.poll() is None, 'paste executed an exit command'
        os.write(master, b'\x15test\r')
        wait_for('Codex 请求授权')
        output.clear()
        os.write(master, b'\r')
        time.sleep(.1)
        assert process.poll() is None
        os.write(master, b'\x1b[B\x1b[B\x1b[B\r')
        wait_for('Ready')
        output.clear()
        os.write(master, b'/exit\r')
        wait_for('TUI_EXITED')
        assert process.wait(timeout=3) == 0
        assert termios.tcgetattr(slave) == before, 'terminal mode was not restored'
        assert b'\x1b[?1049l' in output and b'\x1b[?2004l' in output
        print('PTY paste, approval decline, exit and terminal restoration passed')
    finally:
        if process.poll() is None: process.terminate(); process.wait(timeout=3)
        os.close(master); os.close(slave)
