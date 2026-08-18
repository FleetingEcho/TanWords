import type { Dict } from "../types";

export const dsh: Dict = {
    "dsh.starting": "正在启动 DeepSeek Harness…",
    "dsh.startingHint": "正在启动本地 DSH Web 服务，首次启动需要几秒钟。",
    "dsh.failed": "无法启动 DeepSeek Harness",
    "dsh.reconnecting": "DSH 服务已停止，重新打开本页面即可重启。",
    "dsh.viewReconnecting": "正在重新连接 DSH 界面——你的会话和正在运行的任务不受影响。",
    "dsh.retry": "重试",
    "dsh.reload": "重新加载",
    "dsh.restart": "重启服务",
    "dsh.restartHint": "停止并重新启动 DSH 服务。用于应用端口更改，或恢复卡住的服务。",
    "dsh.openExternal": "在浏览器中打开",
    "dsh.appearance": "背景外观",
    "dsh.blurLabel": "模糊",
    "dsh.opacityLabel": "不透明度",
    "dsh.configure": "配置",
    "dsh.dismiss": "关闭",
    "dsh.applyAndRestart": "应用并重启",
    "dsh.portHint": "填 0 表示使用或复用 DSH 标准端口（3080），也可填写自定义固定端口。",
    "dsh.systemErrorHint":
        "这是系统级错误（例如打开文件数 / inotify 监视数过多、内存不足，或服务已停止）。改端口无法解决——请重试，或先解除系统限制后再重试。",

    // ── 未安装引导面板 ─────────────────────────────────────────────────────────
    // 当服务报告 `dsh` 不在 PATH 上时显示（替代改端口的模态框）。这是一份
    // 安装指引而非报错：用户尚未安装 DSH，所以我们指向官方源及安装/升级命令。
    "dsh.notInstalledTitle": "尚未安装 DeepSeek Harness",
    "dsh.notInstalledLead":
        "本页面运行 DeepSeek Harness（DSH）智能体工作台。TanWords 嵌入的是 DSH 的官方 Web UI，但需要本机已安装 `dsh` 命令——TanWords 并不内置它。",
    "dsh.notInstalledSteps": "安装",
    "dsh.notInstalledStep1": "打开终端，安装官方 DSH 命令行：",
    "dsh.notInstalledStep2": "验证安装：",
    "dsh.notInstalledStep3": "重新打开本页面——TanWords 会自动找到 `dsh`。",
    "dsh.notInstalledUpgrade": "升级",
    "dsh.notInstalledUpgradeText": "已经装过？更新到最新版以匹配本界面：",
    "dsh.notInstalledPrereq": "前置条件",
    "dsh.notInstalledPrereqText":
        "Node.js 22.19 及以上，或 24 及以上（不支持 23.x）。可用 `node --version` 检查；如缺失请到 nodejs.org 下载。",
    "dsh.notInstalledOfficial": "官方项目",
    "dsh.notInstalledOfficialText":
        "源码、发布与文档都在 GitHub。本页面嵌入的是官方 Web UI，并非修改或捆绑版本。",
    "dsh.notInstalledOpenGitHub": "在 GitHub 打开",
    "dsh.notInstalledCopy": "复制",
    "dsh.notInstalledCopied": "已复制",
    "dsh.notInstalledRetry": "我已安装 — 重试",
    "dsh.notInstalledPathHint":
        "装完还是不行？如果你用 nvm 等版本管理工具，请确认 `dsh` 装在终端默认使用的 Node 版本下——TanWords 查找 `dsh` 用的是你终端的同一个 PATH。",

    "settings.dshPort": "DeepSeek Harness 端口",
    "settings.dshPortSub":
        "DSH Web 服务的本地回环端口。填 0 使用 3080，并复用该端口上已有的 `dsh web` 进程，以避免多个进程同时写入会话。仅在需要时填写自定义固定端口，修改后请重启 DSH。",
    "settings.dshPortAuto": "默认（3080）",
    "settings.dshBackgroundOpacity": "DSH 背景不透明度",
    "settings.dshBackgroundOpacitySub":
        "调整 DSH 主画布和侧边栏的背景。0% 完全透明，100% 保留 DSH 原始背景。",
    "settings.dshBackgroundBlur": "DSH 背景模糊",
    "settings.dshBackgroundBlurSub":
        "模糊透过 DSH 显示的 TanWords 壁纸，调节范围为 0 到 100。",
    "settings.dshToolbar": "显示 DSH 工具栏",
    "settings.dshToolbarSub":
        "显示 DSH 页面自带的工具栏（DeepSeek Harness 标签、重启、重新加载、在浏览器中打开）。默认隐藏，让嵌入的智能体界面占据完整高度。",
    "settings.dshIdleStop": "空闲自动停止",
    "settings.dshIdleStopSub":
        "DSH 页面隐藏且没有任务在跑超过这个时长后，自动停掉 DSH 服务，释放它占用的 Node/pnpm 进程；下次打开页面会立即重新拉起。只要有会话在运行就绝不会停止。",
    "settings.dshIdleStopNever": "从不",
    "settings.dshIdleStopAfter": "{minutes} 分钟后",
    "settings.dshGlobalShortcut": "全局快捷键",
    "settings.dshGlobalShortcutSub": "无论在哪个页面，甚至 TanWords 在后台，按下快捷键直接跳到 DSH 页面。",
    "settings.dshGlobalShortcutNotSet": "未设置",
    "settings.dshGlobalShortcutRecording": "请按下按键组合…",
    "settings.dshGlobalShortcutClear": "清除",
    "settings.dshRestart": "重启 DSH 服务",
    "settings.dshRestartSub":
        "停止并重新启动受监管的 DSH Web 服务。用于恢复卡住的服务，或应用更改后的端口。",
    "dsh.restartConfirmTitle": "要重启 DSH 服务吗？",
    "dsh.restartConfirmHint":
        "当前服务将被停止并启动新的实例。DSH 上的进行中任务由外部服务承载时不受影响；仅 TanWords 启动的服务受影响。",
    "dsh.restarting": "正在重启…",
    "dsh.restarted": "DSH 服务已重启。",
    "dsh.restartFailed": "重启 DSH 服务失败。",
};
