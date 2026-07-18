# RSS 阅读器字体设计

RSS 阅读器标题和正文移除 `font-serif` 覆盖，并让 `.reader-article-content` 的所有后代元素继承全局 `--app-font`。标题、段落、列表、引用、表格和代码统一使用 Monaspace；中文继续使用全局字体栈中的系统回退字体。
