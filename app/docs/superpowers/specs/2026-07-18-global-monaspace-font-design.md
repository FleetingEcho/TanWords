# 全局 Monaspace 字体设计

应用加载 `src/static/MonaspaceNeonNF-Regular.woff`，将 Monaspace Neon NF 设为全局正文与等宽字体。按钮、输入框、编辑器、Markdown 和弹窗通过继承使用同一字体。

字体栈在 Monaspace 后保留系统中文字体与通用 `sans-serif`、`monospace` 回退。Monaspace 缺少的中文字形由操作系统字体显示，不影响中英文混排。字体使用本地资源，不依赖网络。

验证生产构建、字体资源打包，以及现有 `font-mono` 场景仍使用 Monaspace。
