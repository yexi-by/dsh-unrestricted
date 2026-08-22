# dsh-unrestricted

可开关的 DSH 破限插件。开启后，每个模式的系统提示词整体替换为**以当前实际安装的
DSH 原版提示词为底稿、融合破限规则的完整版本**；关闭即逐字恢复原版。

- 支持 Standard / Code(PTC) / Cordis / Minimal 与它们的子代理（含 plan 状态）。
- 覆盖方式：运行时以 `system-prompt/assemble` waterfall 读取当前模式的完整原版组装，
  做锚定改写后整体替换；Minimal 因其 `complete: true` persona 在 waterfall 之后恢复，
  改用 agent 作用域同名 persona 遮蔽。两种方式都以真实原版为底稿，不携带任何静态副本。
- 锚定校验：改写前逐项核对 harness 身份行、各模式 persona 全文、plan 段首句、
  run_code 规则句、structured_output 首句。任一不匹配（如 DSH 更新改了提示词）→
  该模式自动保持原版透传，设置卡片中显示"版本不兼容"及缺失项。**不会静默使用旧版提示词。**
- 开关：`设置 → 插件 → 插件配置 → 破限模式`，持久化在 `~/.dsh/settings.yaml`
  （`unrestricted.enabled`），重启后继续生效；切换从下一次请求和新建子代理开始生效，
  不改动正在执行的请求、工具定义、权限配置与会话历史。

差异说明（逐条列出保留/追加/改写的规则）：[docs/diff-rc.1.md](docs/diff-rc.1.md)。

## 支持基线

DSH `0.1.1-rc.1`（commit `528c682e061696f5a160f363f236ecbf53cbd006`）。
锚点文本抓取自该版本；DSH 更新后插件会对变化的模式自动回退原版并在设置中提示，
此时请重新运行 `pnpm dump-prompts` 抓取新原版并更新 `src/rules.js` 的锚点。

## 安装

```sh
# 本工作区（file: 会拷贝进 profile，node 半裸导入才能经 healed junctions 解析）
dsh plugin --profile web add file:./plugin/unrestricted

# 分发后（构建产物 lib/client.js 随仓库提交，git 安装免构建）
dsh plugin --profile web add github:<owner>/dsh-unrestricted#<commit>
```

安装后重启 `dsh web`（client 半变更必须重启）。卸载：
`dsh plugin --profile web remove dsh-unrestricted`。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build           # 产出 lib/client.js（浏览器半）
pnpm test            # 规则单测（对 tests/fixtures 中的真实原版重放）
```

维护工具（都只读 deepseek-harness，不落盘到仓库）：

```sh
# 重新抓取本机安装的各模式原版提示词（更新 tests/fixtures）
node tools/dump-prompts.mjs --repo ../../deepseek-harness --out tests/fixtures

# 集成验收：引导真实 Web 组合 + 本插件，逐模式比对开/关提示词与工具目录（无需 API key）
node tools/verify-live.mjs --repo ../../deepseek-harness

# 真实服务器验收：驱动运行中的 dsh web，按会话日志中的 request/header 核对
# 实际发给模型的提示词，并跑代表性效果用例（会消耗少量真实模型调用）
node tools/verify-server.mjs --base http://127.0.0.1:5199
```

## 结构

```text
src/rules.js     锚点与融合规则（纯函数，单测直接重放 fixtures）
src/node.js      host 半：waterfall 改写、minimal persona 遮蔽、设置开关、兼容状态 RPC
src/client/      浏览器半：设置卡片（开关 + 各模式状态 + 重新校验）
tools/           抓取与验收脚本（均不修改 deepseek-harness）
tests/fixtures/  本机实际组装的原版提示词抓取（含提交号 meta.json）
docs/            原版与魔改版差异说明
```

## 边界

插件只能修改 DSH 自己生成的提示词；模型平台或宿主环境中更高优先级的规则
（如提供方侧的对齐训练、网关策略）不在覆盖范围内。
