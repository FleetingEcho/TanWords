#!/usr/bin/env python3
"""Generates `src/rpc/dispatch.rs` — the name -> handler table that replaces
Tauri's `generate_handler!`.

Run from the crate root:  python3 scripts/gen_dispatch.py

Reads every `#[tauri::command]` / `#[shim::command]` function in src/, works out
its signature, and emits one match arm per command that:

  * deserializes the JSON body into the function's data parameters, converting
    camelCase keys to snake_case first (Tauri did this implicitly — see the
    migration plan, it is the #1 source of "missing field" bugs),
  * injects State/AppHandle parameters from the shared Ctx,
  * awaits the call if the fn is async, or spawn_blocking's it if it was
    `#[tauri::command(async)]`,
  * serializes the Ok value back to JSON.

Regenerate this instead of hand-editing dispatch.rs. If a command fails to
parse, the script prints it under UNPARSED and skips it rather than emitting
something that silently misbehaves — handle those by hand in rpc/manual.rs.
"""

import re
import pathlib
import sys

CRATE = pathlib.Path(__file__).resolve().parent.parent
SRC = CRATE / "src"

# Commands that do NOT move to Rust — they are reimplemented in the Electron
# main process and never reach the sidecar. See migration plan section 5.
SKIP_MODULES = {"browser_panel", "tray"}

CMD_ATTR = re.compile(r"#\[(?:tauri|shim|crate::shim)::command(?:\(([^)]*)\))?\]")
# Generic parameters exist only to carry `R: tauri::Runtime`; they disappear with
# the shim, but the regex has to tolerate them while they are still there.
FN_SIG = re.compile(r"pub\s+(async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(", re.S)


def split_params(text: str) -> list[str]:
    """Splits a parameter list on top-level commas (generics contain commas)."""
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch in "<([":
            depth += 1
        elif ch in ">)]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def read_params(body: str, start: int) -> tuple[str, int]:
    """Returns the text inside the parameter parens starting at `start` (the
    index of the opening paren) and the index just past the closing paren."""
    depth, i = 0, start
    while i < len(body):
        if body[i] == "(":
            depth += 1
        elif body[i] == ")":
            depth -= 1
            if depth == 0:
                return body[start + 1 : i], i + 1
        i += 1
    raise ValueError("unbalanced parens")


def classify(param: str) -> tuple[str, str]:
    """(kind, name) where kind is 'state', 'app', 'window' or 'data'."""
    name, _, ty = param.partition(":")
    name = name.strip()
    ty = ty.strip()
    if "State<" in ty:
        inner = ty[ty.index("State<") + 6 : ty.rindex(">")]
        inner = inner.split(",")[-1].strip()
        return ("state:" + inner, name)
    if "AppHandle" in ty:
        return ("app", name)
    if "Window" in ty or "Webview" in ty:
        return ("window", name)
    return ("data", name)


def snake(name: str) -> str:
    return re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), name)


def main() -> int:
    wanted = [
        line.strip()
        for line in (CRATE / "scripts" / "commands.txt").read_text().splitlines()
        if line.strip()
    ]
    by_name = {}
    for path in sorted(SRC.rglob("*.rs")):
        body = path.read_text()
        for m in CMD_ATTR.finditer(body):
            flags = (m.group(1) or "").strip()
            sig = FN_SIG.search(body, m.end())
            if not sig or sig.start() > m.end() + 400:
                continue
            params_text, _ = read_params(body, sig.end() - 1)
            by_name[sig.group(2)] = {
                "module": str(path.relative_to(SRC)).replace(".rs", "").replace("/mod", "").replace("/", "::"),
                "is_async": bool(sig.group(1)),
                "blocking": flags == "async",  # #[tauri::command(async)]
                "params": [classify(p) for p in split_params(params_text) if p.strip()],
            }

    arms, unparsed, skipped = [], [], []
    for entry in wanted:
        module, _, name = entry.rpartition("::")
        if module.split("::")[0] in SKIP_MODULES:
            skipped.append(entry)
            continue
        info = by_name.get(name)
        if not info:
            unparsed.append(entry)
            continue

        args, binds = [], []
        for kind, pname in info["params"]:
            if kind.startswith("state:"):
                args.append(f"ctx.state::<{kind[6:]}>()")
            elif kind == "app":
                args.append("ctx.app()")
            elif kind == "window":
                unparsed.append(entry + "  (takes a Window)")
                break
            else:
                binds.append(
                    f'        let {pname} = args.take("{pname}")'
                    f'.map_err(|e| format!("{name}: bad argument `{pname}`: {{e}}"))?;'
                )
                args.append(pname)
        else:
            call = f"{info['module']}::{name}({', '.join(args)})"
            if info["is_async"]:
                call += ".await"
            elif info["blocking"]:
                call = f"tokio::task::spawn_blocking(move || {call}).await.map_err(|e| e.to_string())?"
            body = "\n".join(binds)
            arms.append(
                f'    "{name}" => {{\n{body}\n'
                f"        let out = {call}?;\n"
                f"        Ok(serde_json::to_value(out).map_err(|e| e.to_string())?)\n"
                f"    }}"
            )

    header = '''//! GENERATED by scripts/gen_dispatch.py — do not edit by hand.
//! Regenerate after adding or changing a command.

use crate::rpc::{Args, Ctx};
use serde_json::Value;

pub async fn dispatch(ctx: &Ctx, command: &str, mut args: Args) -> Result<Value, String> {
    #[allow(unused_mut, unused_variables)]
    match command {
'''
    footer = '''
    other => Err(format!("unknown command `{other}`")),
    }
}
'''
    out = CRATE / "src" / "rpc" / "dispatch.rs"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(header + ",\n".join(arms) + footer)

    print(f"generated {len(arms)} commands -> {out.relative_to(CRATE)}")
    print(f"skipped {len(skipped)} (reimplemented in Electron main): {', '.join(skipped)}")
    if unparsed:
        print("\nUNPARSED — port these by hand into src/rpc/manual.rs:")
        for u in unparsed:
            print("  " + u)
    return 0


if __name__ == "__main__":
    sys.exit(main())
