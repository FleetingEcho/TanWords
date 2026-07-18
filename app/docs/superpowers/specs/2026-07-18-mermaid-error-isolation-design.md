# Mermaid 错误隔离设计

Mermaid 初始化启用 `suppressErrorRendering`。无效 Mermaid 源码不得向 `document.body` 注入库自带的大型错误 SVG；渲染 Promise 仍然失败，由 `MermaidBlock` 捕获并在文档块内部显示现有紧凑错误状态和原始代码。有效图表行为不变。
