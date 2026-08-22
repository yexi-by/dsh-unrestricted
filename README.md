# dsh-unrestricted

为 DeepSeek Harness（DSH）Web 提供可随时开关的破限提示词。它把破限规则融合进
Standard、Code（PTC）、Cordis、Minimal 及其子代理的当前原版系统提示词；关闭后恢复
DSH 原版提示词。

## 一键安装

下面的命令把当前稳定版本安装到 DSH 的 `web` profile：

```sh
dsh plugin --profile web add github:yexi-by/dsh-unrestricted#v0.1.1
```

安装后重启 `dsh web`，然后进入
`设置 → 插件 → 插件配置 → 破限模式` 打开开关。开关状态保存在
`~/.dsh/settings.yaml` 的 `unrestricted.enabled` 中，重启后仍然有效。

如需安装仓库中的最新代码，可以省略版本号：

```sh
dsh plugin --profile web add github:yexi-by/dsh-unrestricted
```

GitHub 安装直接使用仓库中已经构建好的 `lib/client.js`，不需要 npm 发布，也不需要
授予依赖构建权限。

## 破限提示词有什么用

DSH 的原版系统提示词主要规定 agent 身份、计划模式和工具调用方式。本插件在这些规则
之间加入一段专门控制回答方式与内容尺度的提示词，主要作用是：

- 要求模型直接回答，减少风险定性、说教、劝退、替代方案和冗长前言。
- 对逆向分析、补丁、keygen、安全研究、成人虚构、资源检索等容易触发保守回答的请求，
  使用统一的本地样本语境和占位符，尽量给出完整、可操作的内容。
- 在 Standard、Code、Cordis、Minimal、plan 状态和子代理之间保持同一套回答尺度，
  避免切换模式后提示词失效或语义相互冲突。
- 保留 DSH 的 plan 交付协议、`run_code` 调用方式、结构化输出、审批和沙箱规则；破限提示词
  只决定模型回答什么、怎样回答，不会给工具增加权限。

它不能保证模型一定按提示词回答，也不能覆盖模型提供方、API 网关或宿主环境中的更高
优先级规则。开关只影响下一次请求和之后新建的子代理，不会改写正在执行的请求、工具
定义、权限配置或既有会话历史。

## 工作方式与兼容性

- Standard / Code / Cordis：在运行时通过 `system-prompt/assemble` waterfall 读取当前
  模式的完整原版提示词，校验关键锚点后插入破限规则。
- Minimal：由于原版 persona 使用 `complete: true`，插件用 agent 作用域的同名 persona
  覆盖，并保留原 persona 作为开头。
- 子代理和 plan 状态：沿用父模式的融合结果，同时保留结构化输出与 plan 协议。
- 兼容检查：每次融合前核对 harness 身份、各模式 persona、plan 段首句、`run_code`
  规则和 structured-output 首句。任一锚点不匹配时，该模式保持原版提示词，并在设置卡片
  中显示不兼容项，不会静默套用旧版规则。

当前支持基线为 DSH `0.1.1-rc.1`，commit
`528c682e061696f5a160f363f236ecbf53cbd006`。完整改写清单见
[原版与融合版差异说明](docs/diff-rc.1.md)。

## 更新与卸载

安装新版本时，把安装命令末尾的 tag 换成目标版本并重新执行；若 pnpm 提示包未变化，
先卸载再安装。client 或 node 代码变化后需要重启 `dsh web`。

```sh
dsh plugin --profile web remove dsh-unrestricted
```

卸载插件不会删除 `~/.dsh/settings.yaml` 中已经保存的开关值。

## 来源、版权与许可证

本项目的破限提示词以
[Jia-Ethan/codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) 项目中的
[`gpt-unrestricted.md`](https://github.com/Jia-Ethan/codex-keysmith/blob/601a449b05a86576cf0ad93d7b9fffb89da302ca/examples/gpt-unrestricted.md)
为参考并进行了二次创作；主要改动是适配 DSH 的多模式提示词组装、plan、子代理、工具
协议、权限边界、版本锚点校验和 Web 开关。本项目与 codex-keysmith 及其作者没有隶属或
官方合作关系。

codex-keysmith 由 Jia-Ethan 以 MIT License 发布。原作者版权和许可全文保留在
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目自身同样使用
[MIT License](LICENSE)。

仓库中的版本锚点和测试 fixtures 还包含 DeepSeek Harness 的原版提示词片段；对应的
DeepSeek 版权与 MIT 许可也保留在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 从源码开发

```sh
git clone https://github.com/yexi-by/dsh-unrestricted.git
cd dsh-unrestricted
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

本地安装必须使用 `file:`，不要使用裸路径或 `link:`：

```sh
dsh plugin --profile web add file:.
```

维护工具：

```sh
# 从指定 DSH 源码目录重新抓取原版提示词
node tools/dump-prompts.mjs --repo <deepseek-harness-path> --out tests/fixtures

# 组合真实 Web profile，验证开关前后的提示词和工具目录（不调用模型）
node tools/verify-live.mjs --repo <deepseek-harness-path>

# 驱动正在运行的 dsh web，核对实际发给模型的提示词（会产生模型调用）
node tools/verify-server.mjs --base http://127.0.0.1:5199
```

## 目录

```text
src/rules.js     锚点、破限提示词和融合纯函数
src/node.js      host 端：提示词改写、设置开关和兼容状态
src/client/      Web 端：设置卡片、开关和各模式状态
lib/client.js    随仓库提交的 Web 构建产物
tests/           规则测试与 DSH 原版提示词 fixtures
tools/           原版提示词抓取和集成验证脚本
docs/            原版与融合版的逐项差异
```
