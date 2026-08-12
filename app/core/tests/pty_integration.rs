//! Integration test for the `tanwords-pty` desktop Terminal bridge.
//!
//! Spawns the compiled binary and drives the framed stdio protocol: it reads
//! the `H` handshake, sends `I` input, watches for the echoed `D` output, then
//! closes with `C` and expects the `X` exit frame. This guards the wire
//! contract Electron main depends on, so the protocol cannot drift without a
//! failing test.
//!
//! The shell is forced to a `dumb` pty terminal so it neither emits colour
//! escape sequences nor blocks on terminal-response queries (a real xterm
//! frontend answers those; a test pipe can't). Reading happens on a worker
//! thread into an mpsc channel so no `read()` can ever hang the suite — every
//! step is bounded by `recv_timeout`.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Encode one frame: `[op][len u32 LE][payload]`.
fn frame(op: u8, payload: &[u8]) -> Vec<u8> {
    let len = payload.len() as u32;
    let mut out = vec![op];
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(payload);
    out
}

struct Frame {
    op: u8,
    payload: Vec<u8>,
}

/// Spawn a thread that frames the child's stdout and pushes one frame at a
/// time down the channel, so the test can poll with a hard timeout instead of
/// blocking forever.
fn spawn_reader<R: std::io::Read + Send + 'static>(mut r: R) -> mpsc::Receiver<Frame> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || loop {
        match next_frame(&mut r) {
            Some(f) => {
                if tx.send(f).is_err() {
                    break;
                }
            }
            None => break,
        }
    });
    rx
}

/// Read exactly one frame from `r` (blocking), or `None` on clean EOF.
fn next_frame<R: std::io::Read>(r: &mut R) -> Option<Frame> {
    let mut header = [0u8; 5];
    let mut filled = 0;
    while filled < 5 {
        let mut byte = [0u8; 1];
        let n = r.read(&mut byte).ok()?;
        if n == 0 {
            return None;
        }
        header[filled] = byte[0];
        filled += 1;
    }
    let len = u32::from_le_bytes([header[1], header[2], header[3], header[4]]) as usize;
    let mut payload = vec![0u8; len];
    r.read_exact(&mut payload).ok()?;
    Some(Frame {
        op: header[0],
        payload,
    })
}

#[test]
fn pty_echo_loop_roundtrip() {
    let bin = env!("CARGO_BIN_EXE_tanwords-pty");
    let mut child = Command::new(bin)
        .env("PTY_COLS", "80")
        .env("PTY_ROWS", "24")
        // A quiet, non-querying shell so the test doesn't depend on a real
        // xterm replying to bash/fish terminal queries.
        .env("TERM", "dumb")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn tanwords-pty");

    let mut stdin = child.stdin.take().expect("stdin");
    let rx = spawn_reader(child.stdout.take().expect("stdout"));
    let deadline = |s: u64| Duration::from_secs(s);
    let now = Instant::now;

    // 1) Handshake.
    let handshake = rx.recv_timeout(deadline(5)).expect("handshake frame");
    assert_eq!(handshake.op, b'H', "first frame must be the handshake");
    let hs: serde_json::Value = serde_json::from_slice(&handshake.payload)
        .expect("handshake payload must be valid JSON on every platform");
    assert!(
        hs.get("shell").is_some() && hs.get("cwd").is_some() && hs.get("pid").is_some(),
        "handshake should be {{shell,cwd,pid}} JSON: {hs}"
    );

    // 2) Send an echo command, then accumulate D frames until its text shows
    //    up elsewhere — bounded so a broken bridge fails fast.
    stdin
        .write_all(&frame(b'I', b"echo pty-test-123\r"))
        .expect("write input");
    stdin.flush().ok();

    let mut acc = String::new();
    let start = now();
    let echoed = loop {
        match rx.recv_timeout(deadline(5)) {
            Ok(fr) if fr.op == b'D' => {
                acc.push_str(&String::from_utf8_lossy(&fr.payload));
                if acc.contains("pty-test-123") {
                    break true;
                }
            }
            Ok(fr) if fr.op == b'X' => break false, // shell died before echoing
            Ok(_) => {}
            Err(_) => break acc.contains("pty-test-123"), // timeout: best guess
        }
        if now().duration_since(start) > deadline(10) {
            break acc.contains("pty-test-123");
        }
    };
    assert!(
        echoed,
        "expected echoed 'pty-test-123' in terminal output; saw: {acc}"
    );

    // 3) Close and expect the exit frame.
    stdin.write_all(&frame(b'C', &[])).expect("write close");
    stdin.flush().ok();

    let mut saw_exit = false;
    let start2 = now();
    while now().duration_since(start2) < deadline(5) {
        match rx.recv_timeout(deadline(5)) {
            Ok(fr) if fr.op == b'X' => {
                saw_exit = true;
                break;
            }
            Ok(_) => continue,
            Err(_) => break,
        }
    }
    assert!(saw_exit, "expected an X exit frame after closing");

    let _ = child.wait();
}

/// A colour-capable shell must be told so. `TERM=xterm-256color` alone caps
/// tools at the 256-colour cube; the truecolour path is gated on `COLORTERM`,
/// which the frontend (xterm.js) renders natively. `/bin/sh` keeps the check
/// deterministic: unlike an interactive login shell it emits no prompt escapes
/// and asks the terminal no questions.
#[test]
#[cfg(unix)]
fn pty_advertises_truecolor_to_the_shell() {
    let bin = env!("CARGO_BIN_EXE_tanwords-pty");
    let mut child = Command::new(bin)
        .env("PTY_COLS", "80")
        .env("PTY_ROWS", "24")
        .env("PTY_SHELL", "/bin/sh")
        .env_remove("TERM")
        .env_remove("COLORTERM")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn tanwords-pty");

    let mut stdin = child.stdin.take().expect("stdin");
    let rx = spawn_reader(child.stdout.take().expect("stdout"));

    let handshake = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("handshake frame");
    assert_eq!(handshake.op, b'H');

    stdin
        .write_all(&frame(b'I', b"echo \"ct=[$COLORTERM][$TERM]\"\r"))
        .expect("write input");
    stdin.flush().ok();

    let mut acc = String::new();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(10) {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(fr) if fr.op == b'D' => {
                acc.push_str(&String::from_utf8_lossy(&fr.payload));
                if acc.contains("ct=[truecolor]") {
                    break;
                }
            }
            Ok(fr) if fr.op == b'X' => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }

    assert!(
        acc.contains("ct=[truecolor][xterm-256color]"),
        "shell should see COLORTERM=truecolor and TERM=xterm-256color; saw: {acc}"
    );

    stdin.write_all(&frame(b'C', &[])).expect("write close");
    stdin.flush().ok();
    let _ = child.wait();
}

/// `TERM=dumb` is how a caller asks for a quiet terminal. Promising colour
/// there would contradict the request, so COLORTERM stays unset.
#[test]
#[cfg(unix)]
fn pty_leaves_colorterm_unset_for_a_dumb_terminal() {
    let bin = env!("CARGO_BIN_EXE_tanwords-pty");
    let mut child = Command::new(bin)
        .env("PTY_COLS", "80")
        .env("PTY_ROWS", "24")
        .env("PTY_SHELL", "/bin/sh")
        .env("TERM", "dumb")
        .env_remove("COLORTERM")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn tanwords-pty");

    let mut stdin = child.stdin.take().expect("stdin");
    let rx = spawn_reader(child.stdout.take().expect("stdout"));
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(5))
            .expect("handshake frame")
            .op,
        b'H'
    );

    stdin
        .write_all(&frame(b'I', b"echo \"ct=[$COLORTERM]\"\r"))
        .expect("write input");
    stdin.flush().ok();

    let mut acc = String::new();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(10) {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(fr) if fr.op == b'D' => {
                acc.push_str(&String::from_utf8_lossy(&fr.payload));
                if acc.contains("ct=[]") {
                    break;
                }
            }
            Ok(fr) if fr.op == b'X' => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }

    assert!(
        acc.contains("ct=[]"),
        "a dumb terminal must not advertise COLORTERM; saw: {acc}"
    );

    stdin.write_all(&frame(b'C', &[])).expect("write close");
    stdin.flush().ok();
    let _ = child.wait();
}
