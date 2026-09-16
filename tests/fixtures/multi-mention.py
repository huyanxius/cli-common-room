import os, pty, select, subprocess, sys, tempfile, time, fcntl, termios, struct, json
with tempfile.TemporaryDirectory() as root:
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
    trace = root + '/trace'
    process = subprocess.Popen([sys.argv[1], sys.argv[2]], stdin=slave, stdout=slave, stderr=slave, env={**os.environ, 'XDG_STATE_HOME': root, 'ROOM_TEST_TRACE': trace})
    output = bytearray()
    def wait_for(text):
        end = time.monotonic() + 8
        while text.encode() not in output:
            if time.monotonic() > end: raise AssertionError('missing: ' + text)
            if select.select([master], [], [], .05)[0]: output.extend(os.read(master, 65536))
    def send(text):
        output.clear(); os.write(master, text.encode())
    try:
        wait_for('Ready')
        send('@ag\t'); wait_for('@agy ')
        assert not os.path.exists(trace)
        send('@cod\t'); wait_for('@agy @codex ')
        assert not os.path.exists(trace)
        send('一起看看\r'); wait_for('ANSWER_codex'); wait_for('Ready')
        events = [json.loads(line) for line in open(trace)]
        assert [e['member'] for e in events] == ['agy', 'codex'], events
        assert events[0]['text'] == events[1]['text'], events
        assert b'\x1b[0;38;5;108m' in output
        send('@all 全部看看\r'); wait_for('ANSWER_claude'); wait_for('Ready')
        events = [json.loads(line) for line in open(trace)]
        assert [e['member'] for e in events] == ['agy', 'codex', 'codex', 'claude', 'agy'], events
        send('/exit\r'); wait_for('TUI_EXITED')
        assert process.wait(timeout=3) == 0
        print('multi mention PTY passed')
    finally:
        if process.poll() is None: process.terminate(); process.wait(timeout=3)
        os.close(master); os.close(slave)
