import os, pty, select, subprocess, sys, tempfile, time, fcntl, termios, struct, json
with tempfile.TemporaryDirectory() as root:
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
    before = termios.tcgetattr(slave)
    trace = root + '/trace'
    process = subprocess.Popen([sys.argv[1], sys.argv[2]], stdin=slave, stdout=slave, stderr=slave, env={**os.environ, 'XDG_STATE_HOME': root, 'ROOM_TEST_TRACE': trace})
    output = bytearray()
    def wait_for(text, timeout=8):
        end=time.monotonic()+timeout
        while text.encode() not in output:
            if time.monotonic()>end: raise AssertionError('missing terminal state: '+text)
            if select.select([master],[],[],.05)[0]: output.extend(os.read(master,65536))
    def send(text):
        output.clear();os.write(master,text.encode())
    try:
        wait_for('Ready')
        send('/model\r');wait_for('First model')
        send('\x1b[B\r');wait_for('选择思考强度')
        send('\x1b[B\r');wait_for('high')
        send('@all first\r');wait_for('TURN_STARTED_codex')
        send('@claude queued\r');wait_for('排队')
        send('\x1b');wait_for('已停止')
        time.sleep(.15)
        events=[json.loads(line) for line in open(trace)]
        assert [e['member'] for e in events if e['type']=='run']==['codex'],events
        assert any(e.get('name')=='model' and e.get('arg')=='second-model' for e in events)
        assert any(e.get('name')=='effort' and e.get('arg')=='high' for e in events)
        send('@codex manual after stop\r');wait_for('TURN_STARTED_codex')
        wait_for('Ready')
        send('/queue resume\r');wait_for('TURN_STARTED_claude')
        wait_for('Ready')
        send('\x14');wait_for('output-59')
        send('\x1b[<64;10;5M');wait_for('阅读历史')
        send('/exit\r');wait_for('TUI_EXITED')
        assert process.wait(timeout=3)==0
        assert termios.tcgetattr(slave)==before
        events=[json.loads(line) for line in open(trace)]
        assert [e['member'] for e in events if e['type']=='run']==['codex','codex','claude']
        print('PTY model, effort, recipient, queue, Escape, tool expansion and wheel passed')
    finally:
        if process.poll() is None: process.terminate();process.wait(timeout=3)
        os.close(master);os.close(slave)
