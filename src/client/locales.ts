/** Copy dictionaries for the unrestricted settings card. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  title: '破限模式',
  summaryEnabled: '已开启',
  summaryDisabled: '已关闭',
  summaryLoading: '读取中',
  summaryUnavailable: '设置不可用',
  summaryIncompatible: '部分模式不兼容',
  description: '开启后，各模式的系统提示词整体替换为以当前原版为底稿、融合破限规则的完整版本；关闭即恢复 DSH 原版提示词。从下一次请求和新建子代理开始生效，不改动正在执行的请求、工具定义、权限配置与会话历史。',
  toggle: '启用破限',
  scopeNote: '提示词仅由 DSH 生成时才受本插件控制；模型平台或宿主环境中更高优先级的规则不在覆盖范围内。',
  statusTitle: '各模式状态',
  modeStandard: 'Standard 标准模式',
  modePtc: 'PTC 模式',
  modeCordis: 'Cordis 创造模式',
  modeMinimal: 'Minimal 极简模式',
  subagentNote: '子代理随所属模式一并生效。',
  stateActive: '已生效',
  stateOff: '已关闭',
  stateChecking: '校验中',
  stateIncompatible: '版本不兼容，已保持原版',
  supported: '锚点校验基线（DSH 更新导致原版提示词变化时，对应模式自动回退原版并在此提示）：',
  recheck: '重新校验',
  refresh: '刷新',
  settingsUnavailable: '当前连接不可写设置（远程浏览器只读）。',
  settingsLoading: '正在读取设置…',
  operationFailed: '操作失败：',
} satisfies Record<string, string>

/** Unrestricted card locale key union. */
export type UnrestrictedLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  title: 'Unrestricted mode',
  summaryEnabled: 'Enabled',
  summaryDisabled: 'Disabled',
  summaryLoading: 'Loading',
  summaryUnavailable: 'Settings unavailable',
  summaryIncompatible: 'Some modes incompatible',
  description: 'When enabled, each mode\'s system prompt is replaced wholesale by a fused prompt built on its current original; disabling restores the stock DSH prompt. Applies from the next request and new subagents; in-flight requests, tool definitions, permissions, and session history are never touched.',
  toggle: 'Enable unrestricted mode',
  scopeNote: 'This plugin can only rewrite prompts DSH generates itself; higher-priority rules from the model platform or host environment are out of scope.',
  statusTitle: 'Per-mode status',
  modeStandard: 'Standard',
  modePtc: 'PTC',
  modeCordis: 'Cordis',
  modeMinimal: 'Minimal',
  subagentNote: 'Subagents follow their parent\'s mode.',
  stateActive: 'Active',
  stateOff: 'Off',
  stateChecking: 'Checking',
  stateIncompatible: 'Incompatible — stock prompt kept',
  supported: 'Anchor-check baseline (when a DSH update changes an original prompt, that mode falls back to the stock prompt and reports here):',
  recheck: 'Re-check',
  refresh: 'Refresh',
  settingsUnavailable: 'This connection cannot write settings (remote browser is read-only).',
  settingsLoading: 'Reading settings…',
  operationFailed: 'Operation failed: ',
} satisfies Record<UnrestrictedLocaleKey, string>

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.unrestricted'
