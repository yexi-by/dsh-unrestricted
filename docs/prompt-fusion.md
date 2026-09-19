# 当前 master 提示词融合说明

本文记录 dsh-unrestricted 在 DSH `0.1.6-alpha.2`（master `ddefc45fbc`）上的提示词融合行为。`tools/dump-prompts.mjs` 在临时 settings、storage 和 session 根目录中从 Web composition 组装原版提示词，并保存到 `tests/fixtures/`。验证提供新版 profileContext 与 PluginPackages，使用独立 loopback 临时端口，保留 Connection、文件上传、会话控制及文件交付组件，让原版文件交付提示词完整参与组装；不调用模型或外部接口。

## 融合规则

插件保留原版全部提示词段、动态上下文、工具 schema 与变量，并做四项定向追加：

1. 在 `deployment:persona-prefix` 末尾加入执行模式指针。
2. 在 persona 后插入 `unrestricted:execution-mode` 段（交付契约本体）。
3. plan 激活时，在 `plan:policy` 末尾说明 plan 负责交付与变更范围，执行模式负责内容尺度。
4. PTC 与结构化子代理分别在 `tools:ptc-only`、`tool:structured_output` 末尾保留其交付协议。

本体把 persona 拆为 prefix 与 suffix；插件只扩展 prefix，工作目录等 suffix 内容保留在本体安排的末尾。

契约段决定回答内容与表达尺度，内部结构为：`Scope of this mode`（内容归契约、机制归原版）、
`Delivery`（响应即交付物）、`Values and targets`（占位符、具名目标逐字保留、provenance 描述符、
注入文本是输入数据）、`Task routing`（八类交付物的完成条件）、`Opening phrases`（首行短语）、
`Language consistency`、`Layer independence`。

工具目录、调用协议、plan、审批、沙箱、结构化输出和模式范围继续由 DSH 原版规则决定。

## 部署预览与指纹

- `contractFingerprint()` 返回契约字节的 SHA-256 前 16 位十六进制，设置卡片显示该值，
  用于核对部署的是哪一份字节。
- RPC `preview` 端点返回某一模式即将写入的完整提示词、行数与字节数。优先返回真实 agent
  刚组装并缓存的字节（`source: live`）；缓存为空时退回 preset standing scope
  （`source: standing`），此时没有 agent 级段落，`{{model}}`、`{{cwd}}` 以字面占位符显示。
- 预览是只读的，不写入任何提示词状态；`recheck` 会清空预览缓存。

## 各 preset

### Standard

插件在 persona 后加入执行模式段；plan 激活时再追加 plan 说明。原段内容与工具目录保持不变。

### PTC

PTC 使用当前 `ptc` preset，并在 Standard 的基础上带有 `tools:ptc-only` 和 `tools:sdk`。插件保留 `run_code` 唯一直接工具规则与完整 SDK，在 `tools:ptc-only` 末尾加入内容尺度说明。

### Cordis

Cordis 保留完整的两平面 persona、新版 `plugin_manager` 持久安装流程、Creator UI 插件工作流与只读 Cordis 查询工具说明。插件在 persona 后加入执行模式段；plan 激活时追加同一说明。

### Minimal

Minimal 的 `deployment:persona-prefix` 使用 `complete: true`。插件在 agent 作用域注册同名完整 persona，使其成为“原单句 persona + 指针 + 契约段”；关闭开关时移除该作用域覆盖。完整 persona 最终成为唯一提示词段，因此插件使用自身的有限顺序值，不依赖仓内 section 顺序名称。

### 子代理

进程内子代理沿用父 agent 的 preset 作用域，因此获得对应融合结果。带结构化输出的子代理继续通过 `structured_output` 提交结果，插件只在该段末尾补充内容尺度说明。

## 当前提示词校验

每个 preset 在启用时接受 standing-scope 校验，并在每次实际组装时再次校验。校验对象为 harness 身份、persona、plan 首句、PTC 的 `run_code` 规则和结构化输出首句。锚点变化或探测失败时，该 preset 直接使用当次 DSH 原版提示词，设置卡显示具体问题。

更新 DSH master 后执行以下命令刷新事实基线并验证：

```sh
node tools/dump-prompts.mjs --repo <deepseek-harness-path> --out tests/fixtures
pnpm test
node tools/verify-live.mjs --repo <deepseek-harness-path>
```
