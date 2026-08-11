//! tanwords-pty — a tiny PTY bridge for the desktop Terminal tool.
//!
//! Electron main spawns this binary (alongside the tanwords-core sidecar) and
//! talks to it over a length-prefixed, opcode-framed stdio protocol. It opens
//! a real pseudo-terminal, launches the user's login shell inside it, and
//! pumps bytes in both directions:
//!
//!   daemon → main  `H` handshake · `D` terminal output · `X` shell exited
//!   main → daemon  `I` input bytes · `R` resize · `C` close
//!
//! Frame layout (both directions): `[opcode: u8][len: u32 LE][payload…]`.
//! `I`/`D` payloads are raw bytes, `R` is two `u32 LE` (cols, rows), and
//! `H`/`X` payloads are JSON.
//!
//! A real PTY (rather than a plain pipe) is what makes the tool feel like a
//! terminal: the shell gets a full tty line discipline, so Ctrl-C sends
//! SIGINT, arrow keys move the cursor, and full-screen apps (vim, htop, top)
//! render correctly. It lives as a separate, small binary instead of a core
//! sidecar feature so Electron can start/stop it independently and the core
//! sidecar stays free of terminal concern. Being a `[[bin]]` gated behind the
//! desktop `pty` feature, web/server builds never compile it.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{self, Write};

fn main() {
    let initial_cols = env_u16("PTY_COLS", 80);
    let initial_rows = env_u16("PTY_ROWS", 24);

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: initial_rows,
        cols: initial_cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("[tanwords-pty] openpty failed: {e}");
            std::process::exit(1);
        }
    };

    // Build a default-prog command: portable-pty resolves the user's login
    // shell ($SHELL on unix, %ComSpec% / cmd.exe on Windows) and re-executes
    // it as a login shell, mirroring a fresh terminal session.
    let mut cmd = CommandBuilder::new_default_prog();
    // A genuine xterm-compatible terminal: colour programmes key off TERM to
    // decide whether to emit ANSI colour/box-drawing sequences. Honour the
    // ambient TERM if set (the Electron host sets none and lands on the
    // default; a test/alternate host can choose e.g. `dumb` to get a quiet,
    // non-querying shell).
    let term = std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string());
    cmd.env("TERM", &term);
    // Capture the resolved shell before the builder is consumed by spawn.
    let shell = cmd.get_shell();

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(child) => child,
        Err(e) => {
            eprintln!("[tanwords-pty] spawn_command failed: {e}");
            std::process::exit(1);
        }
    };

    // We need a real file descriptor for this pty so the event loop can poll
    // on it next to stdin. Unix PTYs expose one; Windows conpty does not (it
    // is a handle-based API), in which case we bail with a clear message. The
    // tanwords-pty desktop target today is Linux/macOS; Windows PTY support is
    // a follow-up and would replace this fd path rather than grow beside it.
    let master = pair.master;
    let pty_fd = match master.as_raw_fd() {
        Some(fd) => fd,
        None => {
            eprintln!("[tanwords-pty] conpty/as_raw_fd unsupported on this platform yet");
            std::process::exit(1);
        }
    };
    let stdin_fd = libc::STDIN_FILENO;

    // Split the pty into a writable handle (keyboard input) while keeping
    // `master` alive for resize + polling on pty_fd.
    let mut writer = match master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[tanwords-pty] take_writer failed: {e}");
            std::process::exit(1);
        }
    };

    let stdout = io::stdout();
    let mut out = stdout.lock();
    let cwd = home_dir();
    let pid = child.process_id().unwrap_or(0);
    let handshake = format!(
        "{{\"shell\":\"{}\",\"cwd\":\"{}\",\"pid\":{}}}",
        shell.replace('"', "\\\""),
        cwd.replace('"', "\\\""),
        pid
    );
    write_frame(&mut out, b'H', handshake.as_bytes());
    let _ = out.flush();

    let mut framed = FramedDecoder::new();
    let mut inbuf = vec![0u8; 8192];
    let mut ptybuf = vec![0u8; 8192];
    // Minimal state: we keep asking ourselves whether either side has closed.
    let mut running = true;

    while running {
        // Block until the user is typing or the pty has more than enough.
        let mut pfds = [
            libc::pollfd { fd: stdin_fd, events: libc::POLLIN, revents: 0 },
            libc::pollfd { fd: pty_fd, events: libc::POLLIN | libc::POLLHUP, revents: 0 },
        ];
        let rc = unsafe { libc::poll(pfds.as_mut_ptr(), 2, -1) };
        if rc < 0 {
            if io_error_would_block() {
                continue;
            }
            break; // poll() error: nothing sane to do but exit
        }
        if rc == 0 {
            continue; // timeout (only reachable with a non-negative timeout)
        }

        // ── stdin: host commands ────────────────────────────────
        if pfds[0].revents & (libc::POLLIN | libc::POLLHUP) != 0 {
            let n = unsafe { libc::read(stdin_fd, inbuf.as_mut_ptr() as *mut libc::c_void, inbuf.len()) };
            if n <= 0 {
                running = false; // parent closed our stdin -> session over
            } else {
                for frame in framed.ingest(&inbuf[..n as usize]) {
                    match frame.op {
                        b'I' => {
                            let _ = writer.write_all(&frame.payload);
                            let _ = writer.flush();
                        }
                        b'R' => {
                            if frame.payload.len() >= 8 {
                                let cols = u32::from_le_bytes([
                                    frame.payload[0], frame.payload[1], frame.payload[2], frame.payload[3],
                                ]) as u16;
                                let rows = u32::from_le_bytes([
                                    frame.payload[4], frame.payload[5], frame.payload[6], frame.payload[7],
                                ]) as u16;
                                let _ = master.resize(PtySize {
                                    rows,
                                    cols,
                                    pixel_width: 0,
                                    pixel_height: 0,
                                });
                            }
                        }
                        b'C' => {
                            // Requested shutdown: kill the shell so it can't
                            // linger, then wind down below.
                            let _ = child.kill();
                            running = false;
                        }
                        _ => eprintln!("[tanwords-pty] unknown opcode {}", frame.op),
                    }
                }
            }
        }

        // ── pty: shell output ──────────────────────────────────
        if pfds[1].revents != 0 {
            let n = unsafe { libc::read(pty_fd, ptybuf.as_mut_ptr() as *mut libc::c_void, ptybuf.len()) };
            if n > 0 {
                write_frame(&mut out, b'D', &ptybuf[..n as usize]);
                // stdout is piped (block-buffered); flush each frame or the
                // host would see output only on exit.
                let _ = out.flush();
            } else {
                // EOF / hangup: the shell is gone.
                running = false;
            }
        }
    }

    // Teardown. Ensure nothing lingers, then tell the host the shell ended.
    let _ = child.kill();
    drop(writer);
    write_frame(&mut out, b'X', b"{\"code\":0}");
    let _ = out.flush();
    let _ = child.wait();
}

/// True if the global errno indicates a spurious `poll` interruption.
fn io_error_would_block() -> bool {
    matches!(
        io_errno(),
        libc::EINTR | libc::EAGAIN
    )
}

fn io_errno() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
}

/// Length-prefixed frame: `[op][len u32 LE][payload]`.
fn write_frame<W: Write>(out: &mut W, op: u8, payload: &[u8]) {
    let len = payload.len() as u32;
    let header = [
        op,
        (len & 0xff) as u8,
        ((len >> 8) & 0xff) as u8,
        ((len >> 16) & 0xff) as u8,
        ((len >> 24) & 0xff) as u8,
    ];
    let _ = out.write_all(&header);
    let _ = out.write_all(payload);
}

/// Streaming decoder so one frame may be split across several reads. Feed
/// chunks of the byte stream via [`FramedDecoder::ingest`] and collect the
/// complete frames it yields (zero-length payloads are valid, e.g. a close).
pub struct FramedDecoder {
    op: Option<u8>,
    payload_len: usize,
    payload: Vec<u8>,
}

pub struct Frame {
    op: u8,
    payload: Vec<u8>,
}

impl FramedDecoder {
    fn new() -> Self {
        Self {
            op: None,
            payload_len: 0,
            payload: Vec::new(),
        }
    }

    /// Feed bytes; returns any whole frames they complete. Incomplete frames
    /// are buffered until the next call. Never returns an error — on EOF the
    /// caller decides whether to stop (this decoder has no EOF signal apart
    /// from the upstream byte stream itself).
    fn ingest(&mut self, chunk: &[u8]) -> Vec<Frame> {
        self.payload.extend_from_slice(chunk);
        let mut frames = Vec::new();
        loop {
            // Need at least the 5-byte header to proceed.
            if self.op.is_none() {
                if self.payload.len() < 5 {
                    break;
                }
                self.op = Some(self.payload[0]);
                self.payload_len = u32::from_le_bytes([
                    self.payload[1], self.payload[2], self.payload[3], self.payload[4],
                ]) as usize;
                self.payload.drain(..5);
            }
            if self.payload.len() < self.payload_len {
                break;
            }
            let payload = self.payload[..self.payload_len].to_vec();
            self.payload.drain(..self.payload_len);
            let frame = Frame {
                op: self.op.take().unwrap(),
                payload,
            };
            frames.push(frame);
        }
        frames
    }
}

fn env_u16(key: &str, default: u16) -> u16 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// Best-effort home directory; the shell defaults to it on launch.
fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string())
}