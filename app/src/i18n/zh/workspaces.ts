import type { Dict } from "../types";

/** Workspace (custom dashboard) strings — Chinese, mirroring the English keys
 *  in en/workspaces.ts. */
export const workspaces: Dict = {
  // Sidebar / navigation
  "workspaces.section": "工作区",
  "workspaces.new": "新建工作区",
  "workspaces.empty.title": "尚无工作区",
  "workspaces.empty.hint": "创建一个工作区",
  "workspaces.untitled": "未命名工作区",
  "workspaces.create": "创建工作区",
  "workspaces.rename": "重命名",
  "workspaces.duplicate": "复制",
  "workspaces.delete": "删除",
  "workspaces.reset": "重置布局",
  "workspaces.undo": "撤销",
  "workspaces.deleteConfirm": "删除此工作区？其布局将被丢弃；页面本身不受影响。",
  "workspaces.resetConfirm": "将此工作区的布局重置为一个空白窗格？页面本身不受影响。",
  "workspaces.recoveredNotice": "已保存的工作区无法读取，已重置为干净的列表。页面本身不受影响。",
  "workspaces.recoveredDismiss": "知道了",
  "workspaces.edit": "编辑",
  "workspaces.done": "完成",
  "workspaces.appearance": "小组件外观",
  "workspaces.appearance.blur": "模糊",
  "workspaces.appearance.opacity": "不透明度",
  // Pane header
  "workspaces.pane.splitRight": "向右拆分",
  "workspaces.pane.splitBelow": "向下拆分",
  "workspaces.pane.maximize": "最大化窗格",
  "workspaces.pane.restore": "还原窗格",
  "workspaces.pane.close": "关闭窗格",
  "workspaces.pane.closeConfirm": "关闭此小组件？页面数据会保留，但它将从此工作区中移除。",
  "workspaces.pane.replace": "替换页面",
  // Blank workspace screen
  "workspaces.blank.title": "空白工作区",
  "workspaces.blank.hint": "添加一个页面开始使用。",
  "workspaces.blank.addPage": "添加页面",
  "workspaces.back": "返回",
  // Picker (Phase 3)
  "workspaces.picker.title": "添加页面",
  "workspaces.picker.search": "搜索页面…",
  "workspaces.picker.empty": "没有匹配的页面。",
  "workspaces.picker.disabled.host": "在此设备上不可用。",
  "workspaces.picker.disabled.singleton": "已在使用中 — 可改为移动到此处。",
  "workspaces.picker.moveHere": "移动到此处",
  "workspaces.picker.group.pages": "页面",
  "workspaces.picker.group.tools": "工具",
  "workspaces.picker.group.native": "原生",
  "workspaces.picker.moveHereHint": "将{page}页面从当前位置移动到此处",
};
