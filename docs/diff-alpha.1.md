# 原版与融合版差异说明（DSH 0.1.2-alpha.1）

本文记录 dsh-unrestricted 在 DSH commit
`cd5ef8148158c3a752a658978873241fdf8e2bbc` 上的提示词融合行为。原版提示词由
`tools/dump-prompts.mjs` 从真实 Web composition 组装并保存到 `tests/fixtures/`。

## 融合规则

插件保留原版全部提示词段、动态上下文、工具 schema 与变量，并做四项定向追加：

1. 在 `deployment:persona` 末尾加入执行模式指针。
2. 在 persona 后插入 `unrestricted:execution-mode` 段。
3. plan 激活时，在 `plan:policy` 末尾说明 plan 负责交付与变更边界，执行模式负责内容尺度。
4. PTC 与结构化子代理分别在 `tools:ptc-only`、`tool:structured_output` 末尾保留其交付协议。

融合段只决定回答内容与表达尺度。工具目录、调用协议、plan、审批、沙箱、结构化输出和
模式边界继续由 DSH 原版规则决定。

## 各 preset

### Standard

原版由 `harness:identity`、`deployment:persona`、`plan:policy`、文件引用上下文、工具指导和
交付文件引用共 19 段组成。插件追加 persona 指针和执行模式段；plan 激活时再追加 plan
边界说明。原段内容与工具目录保持不变。

### PTC

PTC 使用官方 `ptc` preset，并在 Standard 的基础上带有 `tools:ptc-only` 和 `tools:sdk`。
插件保留 `run_code` 唯一直接工具规则与完整 SDK，在 `tools:ptc-only` 末尾加入内容尺度
说明。官方 `0.1.2-alpha.1` 已使用 `ptc` 和 `tools:ptc-only` 作为当前名称。

### Cordis

Cordis 保留完整的两平面 persona、动态 Cordis 工具说明和其余工具指导。插件在 persona
后加入执行模式段；plan 激活时追加同一边界说明。

### Minimal

Minimal 的 `deployment:persona` 使用 `complete: true`。插件在 agent 作用域注册同名完整
persona，使其成为“原单句 persona + 指针 + 执行模式段”；关闭开关时移除该作用域覆盖。

### 子代理

进程内子代理沿用父 agent 的 preset 作用域，因此自动获得对应融合结果。带结构化输出的
子代理继续通过 `structured_output` 提交结果，插件只在该段末尾补充内容尺度说明。

## 兼容校验

每个 preset 在启用时接受 standing-scope 校验，并在每次实际组装时再次校验。校验对象为
harness 身份、persona、plan 首句、PTC 的 `run_code` 规则和结构化输出首句。任一锚点变化
时，该 preset 直接使用当次 DSH 原版提示词，设置卡显示具体不兼容项。

更新 DSH 后执行以下命令刷新事实基线并验证：

```sh
node tools/dump-prompts.mjs --repo <deepseek-harness-path> --out tests/fixtures
pnpm test
node tools/verify-live.mjs --repo <deepseek-harness-path>
```
