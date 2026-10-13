# 功能开关

功能开关基于 `v0.2.2`（`70008e2c54541f74eedf91cc20307dcd8d823b47`）
的原版提示词拆分，验证宿主为 macOS Desktop DSH `0.2.0-rc.2`。

在 DSH 的「插件 → 破限模式」中保留原总开关，并增加 10 个独立功能开关。
为兼容已有配置，所有功能默认开启；全选正文与原版逐字相同。
关闭的模块正文不再进入下一次系统提示词。全部功能关闭或总开关关闭时，
恢复原生提示词。设置通过官方 Config、Settings 和 volatile 更新机制保存到
当前 profile 的 `cordis.patch.yml`。

开关按“通用输出、专项任务、辅助规则”分组，每项分别说明“实际要求模型做什么”
和“建议使用的任务”，列出改文件、找资源、分析二进制、双语改写等具体场景，
便于根据当前任务选择模块。这些开关控制额外提示词；不启用或关闭 DSH 的工具能力。
使用场景依据原文作用整理，不表示每一种组合的模型效果都已验证；
兼容默认仍然是全部开启。

提供三个快捷按钮：

- 一键开启全部：开启全部 10 个功能项。
- 开启通用：开启通用交付、目标与输入数据。
- 开启辅助：开启多语言一致性、环境与指令层级、运行模式协调。

快捷按钮只打开对应组，保留其他模块和总开关的现有状态；一次操作通过
官方 Settings 原子修改完成，不逐项发送配置写入。

| 功能 | 配置字段 |
| --- | --- |
| 通用交付 | `delivery` |
| 目标与输入数据 | `targets` |
| 软件逆向与补丁 | `reverseEngineering` |
| 网络安全 | `networkSecurity` |
| 虚构创作 | `fiction` |
| 技术与实验指南 | `technicalGuides` |
| 资源检索 | `resources` |
| 多语言一致性 | `language` |
| 环境与指令层级 | `environment` |
| 运行模式协调 | `runtimeCoordination` |

其中运行模式协调开关还控制 Plan、PTC 和结构化输出段后面的插件附注；
原生审批条件、工具协议和结构化输出格式继续保留。
Minimal 模式在配置改变后会释放并重新注册当前选择对应的 persona。
预览缓存随开关选择更新；刷新和重新校验会清除旧预览，并自动重新加载已展开的预览。
旧请求返回的预览不能覆盖新选择后的内容。模式校验和字符统计继续保留。

“重新校验”和“刷新”按钮旁分别显示作用及适用情况：

- 重新校验：升级 DSH、更新插件或某模式校验未通过后，重新检查提示词兼容性，更新状态及预览。
- 刷新：其他窗口修改设置、页面显示未更新或需要最新预览时，重新读取模式状态和字符用量，加载展开中的预览。

## 提示词用量

面板显示每项正文字符数、当前选中正文和相比全选减少的字符数。
完整预览另外显示包含公共头、连接符及模式附注后的实际插件增量。
这些是字符和 UTF-8 字节统计，不是模型计费 token 数。

全选正文为 **9,407 字符**；只保留通用交付时为 **1,639 字符**，
正文减少 **7,768 字符（82.6%）**。本机隔离宿主组装验证中，
Standard 的完整插件增量由 **9,579** 降至 **1,811 字符**。
最终默认仍为全选，需要手动关闭无关模块才产生节省。

## 安装与恢复

使用桌面版自带 CLI，把本插件加入 `desktop` profile：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add github:yexi-by/dsh-unrestricted#master --ignore-scripts
```

也可安装已构建的本地 tarball：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "dsh-unrestricted@file:/absolute/path/dsh-unrestricted-0.2.2.tgz" --ignore-scripts
```

重新安装引入功能开关前的版本会覆盖这些功能。源码和 tarball 可用于重新安装；
部署前可备份当前插件及 profile 注册文件，以便恢复。

## 验证

```sh
npm install --ignore-scripts
npm run typecheck
npm run build
npm test
node tools/verify-installed.mjs --runtime /absolute/path/to/installed/dsh \
  --report /absolute/path/verification.json
```

`verify-installed.mjs` 使用指定的真实 DSH 运行组件，创建隔离 `DSH_HOME`，
验证原生 Settings 持久化和热更新后的提示词；不发起模型请求。
验证涵盖 Standard、PTC、Cordis、Minimal、Plan、子代理、逐模块关闭、
全部功能关闭和总开关回滚。它不修改正常桌面 profile。

官方规范参考：

- [插件配置与生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md)
- [打包、安装与配置层顺序](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [Settings 配置表单](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/settings/settings/README.md)

原提示词及其第三方版权声明保留在源码、LICENSE 和 THIRD_PARTY_NOTICES.md 中。
