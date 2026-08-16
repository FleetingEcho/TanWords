import type { Dict } from "../types";

export const dsh: Dict = {
    "dsh.starting": "Starting DeepSeek Harness…",
    "dsh.startingHint": "Booting the local DSH Web host. This takes a few seconds on first launch.",
    "dsh.failed": "Couldn't start DeepSeek Harness",
    "dsh.reconnecting": "The DSH host stopped. Reopen the page to restart it.",
    "dsh.notInstalled":
        "DeepSeek Harness (`dsh`) isn't installed on this machine. Install it with `npm i -g @deepseek-ai/dsh`, then reopen this page.",
    "dsh.retry": "Retry",
    "dsh.reload": "Reload",
    "dsh.restart": "Restart host",
    "dsh.restartHint":
        "Stop and relaunch the DSH host. Use this to apply a changed port, or to recover a stuck host.",
    "dsh.openExternal": "Open in browser",
    "dsh.configure": "Configure",
    "dsh.dismiss": "Dismiss",
    "dsh.applyAndRestart": "Apply & Restart",
    "dsh.portHint":
        "Set 0 to use or reuse DSH's standard port (3080), or enter a custom fixed port.",

    // ── Not-installed guidance panel ─────────────────────────────────────────
    // Shown in place of the port-fix modal when the supervisor reports `dsh`
    // wasn't found on PATH. This is a setup guide, not an error: the user has
    // not installed DSH yet, so we point them at the official source and the
    // install/upgrade commands.
    "dsh.notInstalledTitle": "DeepSeek Harness isn't installed",
    "dsh.notInstalledLead":
        "This page runs the DeepSeek Harness (DSH) agent workspace. TanWords embeds DSH's official Web UI, but it needs the `dsh` command on this machine — TanWords does not bundle it.",
    "dsh.notInstalledSteps": "Install",
    "dsh.notInstalledStep1":
        "Open a terminal and install the official DSH CLI (requires Node.js 22+):",
    "dsh.notInstalledStep2": "Verify the install:",
    "dsh.notInstalledStep3": "Reopen this page — TanWords will find `dsh` automatically.",
    "dsh.notInstalledUpgrade": "Upgrade",
    "dsh.notInstalledUpgradeText":
        "Already installed? Update to the latest release to match this UI:",
    "dsh.notInstalledPrereq": "Prerequisites",
    "dsh.notInstalledPrereqText":
        "Node.js 22 or newer. Check with `node --version`. Get it from nodejs.org if missing.",
    "dsh.notInstalledOfficial": "Official project",
    "dsh.notInstalledOfficialText":
        "Source, releases, and docs live on GitHub. This page embeds the official Web UI — it is not a modified or bundled copy.",
    "dsh.notInstalledOpenGitHub": "Open on GitHub",
    "dsh.notInstalledCopy": "Copy",
    "dsh.notInstalledCopied": "Copied",
    "dsh.notInstalledRetry": "I've installed it — retry",

    "settings.dshPort": "DeepSeek Harness port",
    "settings.dshPortSub":
        "Loopback port for the DSH Web host. 0 uses port 3080 and reuses an existing `dsh web` process there, preventing concurrent session writers. Enter a custom fixed port only when needed, then restart DSH to apply.",
    "settings.dshPortAuto": "Default (3080)",
    "settings.dshBackgroundOpacity": "DSH background opacity",
    "settings.dshBackgroundOpacitySub":
        "Adjust the background of both the DSH canvas and sidebar. 0% is fully transparent; 100% preserves DSH's original background.",
    "settings.dshBackgroundBlur": "DSH background blur",
    "settings.dshBackgroundBlurSub":
        "Blur the TanWords wallpaper visible behind DSH. The scale runs from 0 to 100.",
    "settings.dshToolbar": "Show DSH toolbar",
    "settings.dshToolbarSub":
        "Show the DSH page's own toolbar (DeepSeek Harness label, Restart, Reload, Open in browser). Hidden by default so the embedded agent UI gets the full height.",
};
