# dsh-unrestricted（已退役）

本插件于 2026-09-29 随 DSH `0.2.0-rc.2`（`639ed01539`）升级退役，仓库归档保留历史源码。

插件通过逐字锚定各模式的官方提示词插入一套通用指令，并提供开关和预览。该实现持续依赖上游提示词措辞，效果受模型影响，维护成本超过当前用途，因此从本工作区及实际 Web profile 移除。

普通回答偏好和项目工作约定可写入工作区 `AGENTS.md`；部署级 persona 可使用官方 `@deepseek-ai/dsh-system-prompt` 的 `personaPrefix`、`personaSuffix` 配置。按实际需求编写简短、明确的指令即可，无需重新安装本插件。

已有安装可执行：

```powershell
dsh plugin --profile web remove dsh-unrestricted
```

随后删除 profile `cordis.patch.yml` 中遗留的 `id: unrestricted` 配置并重启 `dsh web`。会话日志保留原样。

历史发布版本和许可证仍保存在仓库历史中；归档后不再发布适配版本。
