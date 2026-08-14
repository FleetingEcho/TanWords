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
//! `I`/`D` payloads are raw bytes, `R` is four `u32 LE` values (cols, rows,
//! pixel width, pixel height), and `H`/`X` payloads are JSON.
//!
//! A real PTY (rather than a plain pipe) is what makes the tool feel like a
//! terminal: the shell gets a full tty line discipline, so Ctrl-C sends
//! SIGINT, arrow keys move the cursor, and full-screen apps (vim, htop, top)
//! render correctly. It lives as a separate, small binary instead of a core
//! sidecar feature so Electron can start/stop it independently and the core
//! sidecar stays free of terminal concern. Being a `[[bin]]` gated behind the
//! desktop `pty` feature, web/server builds never compile it.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{self, Read, Write};
use std::sync::mpsc;

const PTY_READ_CHUNK_BYTES: usize = 64 * 1024;
const PTY_EVENT_QUEUE_SLOTS: usize = 16;
const MAX_HOST_FRAME_BYTES: usize = 2 * 1024 * 1024;

enum Event {
    HostFrame(Frame),
    HostClosed,
    PtyData(Vec<u8>),
    PtyClosed,
}

fn main() {
    // Settings uses this probe so its empty/default state can show the exact
    // executable this same helper would launch. Keeping the answer here avoids
    // duplicating the Windows Git Bash preference in Electron or the renderer.
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--print-default-shell"))
    {
        let (_, shell) = shell_command();
        println!("{shell}");
        return;
    }

    let initial_cols = env_u16("PTY_COLS", 80);
    let initial_rows = env_u16("PTY_ROWS", 24);
    let initial_pixel_width = env_u16("PTY_PIXEL_WIDTH", 0);
    let initial_pixel_height = env_u16("PTY_PIXEL_HEIGHT", 0);

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: initial_rows,
        cols: initial_cols,
        pixel_width: initial_pixel_width,
        pixel_height: initial_pixel_height,
    }) {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("[tanwords-pty] openpty failed: {e}");
            std::process::exit(1);
        }
    };

    // Unix follows the user's login shell. Windows prefers Git Bash when Git
    // for Windows is installed, then falls back to the regular system shell.
    let (mut cmd, shell) = shell_command();
    // A genuine xterm-compatible terminal: colour programmes key off TERM to
    // decide whether to emit ANSI colour/box-drawing sequences. Honour the
    // ambient TERM if set (the Electron host deliberately supplies
    // `xterm-256color`; a test/alternate host can choose e.g. `dumb` to get a
    // quiet, non-querying shell).
    let term = std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string());
    cmd.env("TERM", &term);
    // TERM only advertises 256 colours. Tools that can emit 24-bit colour
    // (neovim, delta, bat, eza, starship, ...) gate that on COLORTERM and
    // otherwise quantise into the 256-colour cube, which bands gradients and
    // approximates theme colours. xterm.js renders truecolor natively, so the
    // renderer is already able to show what those programmes would emit.
    // `dumb` means the caller asked for a quiet terminal; promising colour
    // there would contradict it. Any ambient COLORTERM still wins.
    if term != "dumb" {
        let colorterm = std::env::var("COLORTERM").unwrap_or_else(|_| "truecolor".to_string());
        cmd.env("COLORTERM", colorterm);
    }
    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(child) => child,
        Err(e) => {
            eprintln!("[tanwords-pty] spawn_command failed: {e}");
            std::process::exit(1);
        }
    };

    let master = pair.master;
    let reader = match master.try_clone_reader() {
        Ok(reader) => reader,
        Err(e) => {
            eprintln!("[tanwords-pty] try_clone_reader failed: {e}");
            std::process::exit(1);
        }
    };
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
    // serde_json is important on Windows: both shell and cwd normally contain
    // backslashes, which cannot safely be interpolated into JSON by hand.
    let handshake = serde_json::json!({ "shell": shell, "cwd": cwd, "pid": pid }).to_string();
    if write_frame(&mut out, b'H', handshake.as_bytes())
        .and_then(|_| out.flush())
        .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return;
    }

    // Unix PTYs and Windows ConPTY pipes both expose portable blocking readers.
    // Read the host and PTY on separate threads, then serialize mutations and
    // output here. This replaces the old Unix-only poll(2) loop.
    // Bound the reader-to-writer queue. When Electron or its renderer cannot
    // consume output quickly enough, backpressure now reaches the PTY instead of
    // allowing an unbounded Vec queue to grow until the helper is OOM-killed.
    // 16 × 64 KiB reader chunks caps queued payload near 1 MiB per terminal.
    // A larger read buffer still returns interactive output immediately, while
    // reducing framing, pipe and Electron IPC overhead for sustained output.
    let (tx, rx) = mpsc::sync_channel(PTY_EVENT_QUEUE_SLOTS);
    spawn_host_reader(tx.clone());
    spawn_pty_reader(reader, tx);

    let mut running = true;

    while running {
        match rx.recv() {
            // ── stdin: host commands ────────────────────────────────
            Ok(Event::HostFrame(frame)) => match frame.op {
                b'I' => {
                    let _ = writer.write_all(&frame.payload);
                    let _ = writer.flush();
                }
                b'R' if frame.payload.len() >= 8 => {
                    let cols = u32::from_le_bytes(frame.payload[0..4].try_into().unwrap()) as u16;
                    let rows = u32::from_le_bytes(frame.payload[4..8].try_into().unwrap()) as u16;
                    let pixel_width = frame
                        .payload
                        .get(8..12)
                        .map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()) as u16)
                        .unwrap_or(0);
                    let pixel_height = frame
                        .payload
                        .get(12..16)
                        .map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()) as u16)
                        .unwrap_or(0);
                    let _ = master.resize(PtySize {
                        rows,
                        cols,
                        pixel_width,
                        pixel_height,
                    });
                }
                b'C' => running = false,
                _ => eprintln!("[tanwords-pty] unknown opcode {}", frame.op),
            },

            // ── pty: shell output ──────────────────────────────────
            Ok(Event::PtyData(data)) => {
                if write_frame(&mut out, b'D', &data)
                    .and_then(|_| out.flush())
                    .is_err()
                {
                    running = false;
                }
            }
            Ok(Event::HostClosed | Event::PtyClosed) | Err(_) => running = false,
        }
    }

    // Teardown. Ensure nothing lingers, then tell the host the shell ended.
    let _ = child.kill();
    drop(writer);
    let _ = write_frame(&mut out, b'X', b"{\"code\":0}");
    let _ = out.flush();
    let _ = child.wait();
}

fn spawn_host_reader(tx: mpsc::SyncSender<Event>) {
    std::thread::spawn(move || {
        let mut input = io::stdin().lock();
        let mut decoder = FramedDecoder::new();
        let mut buf = [0u8; 8192];
        loop {
            match input.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => match decoder.ingest(&buf[..n]) {
                    Ok(frames) => {
                        for frame in frames {
                            if tx.send(Event::HostFrame(frame)).is_err() {
                                return;
                            }
                        }
                    }
                    Err(error) => {
                        eprintln!("[tanwords-pty] {error}");
                        break;
                    }
                },
            }
        }
        let _ = tx.send(Event::HostClosed);
    });
}

fn spawn_pty_reader(mut reader: Box<dyn Read + Send>, tx: mpsc::SyncSender<Event>) {
    std::thread::spawn(move || {
        let mut buf = vec![0u8; PTY_READ_CHUNK_BYTES];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) if tx.send(Event::PtyData(buf[..n].to_vec())).is_err() => return,
                Ok(_) => {}
            }
        }
        let _ = tx.send(Event::PtyClosed);
    });
}

#[cfg(not(windows))]
fn shell_command() -> (CommandBuilder, String) {
    if let Some(path) = configured_shell() {
        let shell = path.to_string_lossy().into_owned();
        return (CommandBuilder::new(path), shell);
    }
    let cmd = CommandBuilder::new_default_prog();
    let shell = cmd.get_shell();
    (cmd, shell)
}

#[cfg(windows)]
fn shell_command() -> (CommandBuilder, String) {
    if let Some(path) = configured_shell() {
        return windows_shell_command(path);
    }
    if let Some(path) = find_git_bash() {
        return windows_shell_command(path);
    }

    let cmd = CommandBuilder::new_default_prog();
    let shell = cmd.get_shell();
    (cmd, shell)
}

fn configured_shell() -> Option<std::path::PathBuf> {
    std::env::var_os("PTY_SHELL")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
}

#[cfg(windows)]
fn windows_shell_command(path: std::path::PathBuf) -> (CommandBuilder, String) {
    let shell = path.to_string_lossy().into_owned();
    let mut cmd = CommandBuilder::new(&path);
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("bash.exe"))
    {
        cmd.arg("--login");
        cmd.arg("-i");
        cmd.env("CHERE_INVOKING", "1");
    }
    (cmd, shell)
}

#[cfg(windows)]
fn find_git_bash() -> Option<std::path::PathBuf> {
    use std::path::{Path, PathBuf};

    let mut candidates = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(key) {
            candidates.push(PathBuf::from(base).join("Git").join("bin").join("bash.exe"));
        }
    }
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(base)
                .join("Programs")
                .join("Git")
                .join("bin")
                .join("bash.exe"),
        );
    }

    // git.exe is usually on PATH through Git's cmd directory while bash.exe
    // is not. Derive the installation root from every matching git.exe.
    if let Ok(output) = std::process::Command::new("where.exe")
        .arg("git.exe")
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let git = Path::new(line.trim());
                if let Some(root) = git.parent().and_then(Path::parent) {
                    candidates.push(root.join("bin").join("bash.exe"));
                }
            }
        }
    }

    candidates.into_iter().find(|path| path.is_file())
}

/// Length-prefixed frame: `[op][len u32 LE][payload]`.
fn write_frame<W: Write>(out: &mut W, op: u8, payload: &[u8]) -> io::Result<()> {
    let len = payload.len() as u32;
    let header = [
        op,
        (len & 0xff) as u8,
        ((len >> 8) & 0xff) as u8,
        ((len >> 16) & 0xff) as u8,
        ((len >> 24) & 0xff) as u8,
    ];
    out.write_all(&header)?;
    out.write_all(payload)
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

    /// Feed bytes and return any whole frames they complete. Incomplete frames
    /// are buffered until the next call. Reject an oversized declared payload
    /// before retaining it so a malformed host cannot grow this process without
    /// bound while waiting for bytes that should never be accepted.
    fn ingest(&mut self, chunk: &[u8]) -> Result<Vec<Frame>, String> {
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
                    self.payload[1],
                    self.payload[2],
                    self.payload[3],
                    self.payload[4],
                ]) as usize;
                self.payload.drain(..5);
                if self.payload_len > MAX_HOST_FRAME_BYTES {
                    self.op = None;
                    self.payload.clear();
                    return Err(format!("host frame exceeds {MAX_HOST_FRAME_BYTES} bytes"));
                }
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
        Ok(frames)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framed_decoder_rejects_oversized_host_frames_before_buffering_payload() {
        let mut decoder = FramedDecoder::new();
        let mut header = [0u8; 5];
        header[0] = b'I';
        header[1..].copy_from_slice(&((MAX_HOST_FRAME_BYTES + 1) as u32).to_le_bytes());

        let error = decoder
            .ingest(&header)
            .err()
            .expect("oversized frame must fail");

        assert!(error.contains("host frame exceeds"));
        assert!(decoder.payload.is_empty());
        assert!(decoder.op.is_none());
    }

    #[test]
    fn framed_decoder_keeps_split_valid_frames() {
        let mut decoder = FramedDecoder::new();
        let payload = b"hello";
        let mut encoded = vec![b'I'];
        encoded.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        encoded.extend_from_slice(payload);

        assert!(decoder.ingest(&encoded[..7]).unwrap().is_empty());
        let frames = decoder.ingest(&encoded[7..]).unwrap();

        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].op, b'I');
        assert_eq!(frames[0].payload, payload);
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
