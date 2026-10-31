window.__ModuleLoader__.load({
	id: "dsh-unrestricted",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/controller.ts
		const RPC_CHANNEL = "/dsh-unrestricted";
		const SETTINGS_NS = "unrestricted";
		const DEFAULT_VERSION = "0.2.6";
		/** Human-readable error text for the banner. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* Create the card controller bound to the calling plugin's context.
		* @param ctx - the browser plugin context (connection + remote + configForms injected).
		* @returns the controller whose face() feeds the slot inject share.
		*/
		function createUnrestrictedController(ctx) {
			const connection = ctx.get("connection");
			const settings = ctx.configForms.get(SETTINGS_NS);
			let snapshot = {
				enabled: false,
				writable: false,
				settingsStatus: "loading",
				status: null,
				update: {
					state: "idle",
					currentVersion: DEFAULT_VERSION,
					restartRequired: false
				},
				previews: {},
				busy: false
			};
			const listeners = /* @__PURE__ */ new Set();
			const previewRequests = /* @__PURE__ */ new Map();
			let statusGeneration = 0;
			let pendingOperations = 0;
			const view = {
				getSnapshot: () => snapshot,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			};
			function publish() {
				const settingsSnapshot = settings.getSnapshot();
				const enabled = settingsSnapshot.value?.enabled === true;
				if (enabled !== snapshot.enabled) invalidatePreviews();
				snapshot = {
					enabled,
					writable: settingsSnapshot.writable,
					settingsStatus: settingsSnapshot.status,
					status: snapshot.status,
					update: snapshot.update,
					previews: snapshot.previews,
					busy: pendingOperations > 0,
					message: snapshot.message
				};
				for (const listener of listeners) listener();
			}
			function invalidatePreviews() {
				previewRequests.clear();
				snapshot = {
					...snapshot,
					previews: {}
				};
			}
			async function call(endpoint, payload) {
				const result = await connection.rpc.call(RPC_CHANNEL, endpoint, payload);
				if (!result.ok) throw new Error(result.error.message);
				return result.value;
			}
			async function whileBusy(action) {
				pendingOperations++;
				publish();
				try {
					await action();
				} finally {
					pendingOperations--;
					publish();
				}
			}
			function readStatus(endpoint, clearPreviews) {
				const generation = ++statusGeneration;
				return whileBusy(async () => {
					try {
						const status = await call(endpoint, {});
						if (generation !== statusGeneration) return;
						if (clearPreviews) invalidatePreviews();
						const nextUpdate = status.update !== void 0 && (snapshot.update.state === "idle" || status.update.state !== "idle") ? status.update : {
							...snapshot.update,
							currentVersion: status.version ?? snapshot.update.currentVersion
						};
						snapshot = {
							...snapshot,
							status,
							update: nextUpdate,
							message: void 0
						};
					} catch (error) {
						if (generation !== statusGeneration) return;
						snapshot = {
							...snapshot,
							message: messageOf(error)
						};
					}
				});
			}
			function refresh(clearPreviews = false) {
				return readStatus("status", clearPreviews);
			}
			function setEnabled(enabled) {
				return whileBusy(async () => {
					try {
						await settings.set("enabled", enabled);
						await refresh(true);
					} catch (error) {
						snapshot = {
							...snapshot,
							message: messageOf(error)
						};
					}
				});
			}
			function recheck() {
				return readStatus("recheck", true);
			}
			/**
			* Fetch one preset's deploy preview.
			* @param presetId - preset id from the card's row.
			*/
			async function loadPreview(presetId) {
				const request = Symbol(presetId);
				previewRequests.set(presetId, request);
				snapshot = {
					...snapshot,
					previews: {
						...snapshot.previews,
						[presetId]: { status: "loading" }
					}
				};
				publish();
				try {
					const preview = await call("preview", { presetId });
					if (previewRequests.get(presetId) !== request) return;
					snapshot = {
						...snapshot,
						previews: {
							...snapshot.previews,
							[presetId]: {
								status: "ready",
								preview
							}
						}
					};
				} catch (error) {
					if (previewRequests.get(presetId) !== request) return;
					snapshot = {
						...snapshot,
						previews: {
							...snapshot.previews,
							[presetId]: {
								status: "failed",
								errorCode: "preview-failed",
								message: messageOf(error)
							}
						}
					};
				}
				publish();
			}
			/**
			* Check whether a newer version is available from GitHub or the local source directory.
			* @param force - bypass in-flight reuse and force a fresh check.
			*/
			async function checkUpdate(force = false) {
				if (snapshot.update.state === "checking" || snapshot.update.state === "updating") return;
				snapshot = {
					...snapshot,
					update: {
						...snapshot.update,
						state: "checking",
						errorCode: void 0,
						errorDetail: void 0
					}
				};
				publish();
				try {
					const update = await call("check-update", { force });
					snapshot = {
						...snapshot,
						update
					};
				} catch (error) {
					snapshot = {
						...snapshot,
						update: {
							...snapshot.update,
							state: "failed",
							errorCode: "update-check-failed",
							errorDetail: messageOf(error)
						}
					};
				}
				publish();
			}
			/**
			* Download and install the latest version into the active profile.
			*/
			async function performUpdate() {
				if (snapshot.update.state === "updating") return;
				snapshot = {
					...snapshot,
					update: {
						...snapshot.update,
						state: "updating",
						errorCode: void 0,
						errorDetail: void 0
					}
				};
				publish();
				try {
					const update = await call("perform-update", { targetTag: snapshot.update.latestTag });
					snapshot = {
						...snapshot,
						update
					};
				} catch (error) {
					snapshot = {
						...snapshot,
						update: {
							...snapshot.update,
							state: "failed",
							errorCode: "update-install-failed",
							errorDetail: messageOf(error)
						}
					};
				}
				publish();
			}
			ctx.effect(() => settings.subscribe(publish), "dsh-unrestricted: settings mirror");
			ctx.effect(() => ctx.remote.$on("settings/document-updated", (namespace) => {
				if (namespace === void 0 || namespace === SETTINGS_NS) refresh(true);
			}), "dsh-unrestricted: settings invalidations");
			publish();
			refresh();
			return { face: () => ({
				hooks: { view },
				setEnabled,
				recheck,
				refresh: () => refresh(true),
				loadPreview,
				checkUpdate,
				performUpdate
			}) };
		}
		//#endregion
		//#region src/client/locales.ts
		/** Copy dictionaries for the unrestricted settings card and detail badge. */
		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			title: "破限模式",
			summaryEnabled: "已开启",
			summaryDisabled: "已关闭",
			summaryLoading: "读取中",
			summaryUnavailable: "只读模式",
			summaryValidationFailed: "部分模式未生效",
			description: "开启后，各运行模式与委派子代理的系统提示词将自动融合无限制本地执行契约；关闭即恢复 DSH 原版提示词。切换从下一次请求生效，不改动正在执行的请求、工具定义、权限配置与会话历史。",
			toggle: "启用破限模式",
			scopeNote: "仅作用于由 DSH 组装的系统提示词；模型平台或外部网关的远端策略不在本插件覆盖范围内。",
			statusTitle: "模式覆盖与提示词预览",
			statusSubtitle: "覆盖全部 4 种预设及委派子代理，可随时展开核对或复制融合后的完整提示词。",
			modeStandard: "Standard 标准模式",
			modeStandardDesc: "日常编码、逆向分析、脚本编写与综合问答",
			modePtc: "PTC 编程模式",
			modePtcDesc: "基于 run_code 工具链的程序化任务执行",
			modeCordis: "Cordis 创造模式",
			modeCordisDesc: "DSH 与 Cordis 插件生态开发调试",
			modeMinimal: "Minimal 极简模式",
			modeMinimalDesc: "零内置先验的纯净系统提示词与子代理基座",
			subagentNote: "子代理（含结构化输出子代理）随所属会话模式一并生效。",
			stateActive: "已生效",
			stateOff: "待命",
			stateValidationFailed: "已跳过（缺少角色段落）",
			refresh: "刷新状态",
			presetStandard: "standard",
			presetPtc: "ptc",
			presetCordis: "cordis",
			presetMinimal: "minimal",
			showPreview: "查看提示词",
			hidePreview: "收起预览",
			copyPreview: "复制全文",
			copiedPreview: "已复制",
			previewLoading: "正在生成当前模式的提示词预览…",
			previewUnavailable: "暂无法生成预览：",
			previewSize: "行",
			previewSourceLive: "当前会话实时组装",
			previewSourceStanding: "预设基准组装",
			settingsUnavailable: "当前连接处于只读模式，无法修改设置。",
			settingsLoading: "正在读取配置…",
			operationFailed: "操作失败：",
			issuePersona: "未检测到预设角色前缀段落，已自动保留原版提示词",
			updateTitle: "版本与更新",
			currentVersion: "当前版本",
			latestVersion: "最新版本",
			installSource: "安装方式",
			sourceGithub: "GitHub 仓库",
			sourceFile: "本地目录 (file:)",
			sourceRegistry: "软件包镜像",
			sourceUnknown: "当前 Profile",
			updateIdle: "尚未检查更新",
			updateChecking: "正在检查更新…",
			updateUpToDate: "已是最新版本",
			updateAvailable: "发现新版本",
			updateInstalling: "正在下载并安装更新，请稍候…",
			updateInstalled: "已安装新版本，重启 DSH Web 或桌面端后生效",
			updateBadge: "可更新",
			updateRestartBadge: "待重启生效",
			checkUpdate: "检查更新",
			installUpdate: "立即更新",
			viewRelease: "发布说明",
			errorRpcDisconnected: "无法连接宿主服务，请确认 DSH 正在运行后刷新重试。",
			errorUnsupportedPreset: "不支持该预设模式的提示词预览。",
			errorMissingPersona: "当前预设未包含角色前缀段落，已自动保留原版提示词。",
			errorPreviewFailed: "生成提示词预览失败，请稍后刷新重试。",
			errorUpdateCheckFailed: "检查更新失败，请确认网络连接正常后重试。",
			errorUpdateNoProfile: "当前运行环境未绑定可管理的 Profile 目录，无法执行自动更新。",
			errorUpdateFileOutdated: "当前通过本地目录 (file:) 安装，且本地目录版本低于远端最新版本，请先更新本地源码目录后再点更新。",
			errorUpdateInstallFailed: "安装更新失败："
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			title: "Unrestricted Mode",
			summaryEnabled: "Enabled",
			summaryDisabled: "Disabled",
			summaryLoading: "Loading",
			summaryUnavailable: "Read-only",
			summaryValidationFailed: "Partial mode coverage",
			description: "When enabled, system prompts across all modes and delegated subagents are fused with the unrestricted local execution contract; disabling restores the stock DSH prompt immediately. Takes effect from the next request without altering in-flight turns, tool schemas, permissions, or session history.",
			toggle: "Enable unrestricted mode",
			scopeNote: "Applies only to system prompts assembled by DSH; upstream model provider policies outside the prompt are out of scope.",
			statusTitle: "Mode Coverage & Prompt Preview",
			statusSubtitle: "Covers all 4 built-in presets and delegated subagents. Expand any mode to inspect or copy the full fused prompt.",
			modeStandard: "Standard",
			modeStandardDesc: "General coding, reverse engineering, scripting, and technical Q&A",
			modePtc: "PTC Mode",
			modePtcDesc: "Programmatic tool calling via the run_code execution environment",
			modeCordis: "Cordis Mode",
			modeCordisDesc: "DSH and Cordis plugin development and framework debugging",
			modeMinimal: "Minimal Mode",
			modeMinimalDesc: "Zero-prior minimal system prompt and subagent foundation",
			subagentNote: "Subagents (including structured-output subagents) automatically follow their parent mode.",
			stateActive: "Active",
			stateOff: "Standby",
			stateValidationFailed: "Skipped (missing persona section)",
			refresh: "Refresh",
			presetStandard: "standard",
			presetPtc: "ptc",
			presetCordis: "cordis",
			presetMinimal: "minimal",
			showPreview: "Preview prompt",
			hidePreview: "Hide preview",
			copyPreview: "Copy prompt",
			copiedPreview: "Copied",
			previewLoading: "Assembling prompt preview…",
			previewUnavailable: "Preview unavailable: ",
			previewSize: "lines",
			previewSourceLive: "Live session assembly",
			previewSourceStanding: "Preset baseline assembly",
			settingsUnavailable: "This connection is read-only and cannot modify settings.",
			settingsLoading: "Loading configuration…",
			operationFailed: "Operation failed: ",
			issuePersona: "Preset persona section not found — stock prompt kept",
			updateTitle: "Version & Updates",
			currentVersion: "Current version",
			latestVersion: "Latest version",
			installSource: "Install source",
			sourceGithub: "GitHub repository",
			sourceFile: "Local directory (file:)",
			sourceRegistry: "Package registry",
			sourceUnknown: "Active profile",
			updateIdle: "Not checked yet",
			updateChecking: "Checking for updates…",
			updateUpToDate: "Up to date",
			updateAvailable: "Update available",
			updateInstalling: "Downloading and installing update…",
			updateInstalled: "Update installed — restart DSH Web or Desktop to apply",
			updateBadge: "Update available",
			updateRestartBadge: "Restart to apply",
			checkUpdate: "Check for updates",
			installUpdate: "Update now",
			viewRelease: "Release notes",
			errorRpcDisconnected: "Cannot reach the host service. Please verify DSH is running and refresh.",
			errorUnsupportedPreset: "Prompt preview is not supported for this preset.",
			errorMissingPersona: "The preset is missing a persona prefix section; the stock prompt is kept.",
			errorPreviewFailed: "Could not assemble the prompt preview. Please try refreshing.",
			errorUpdateCheckFailed: "Could not check for updates. Please verify your network connection and try again.",
			errorUpdateNoProfile: "This runtime does not expose a managed profile directory for self-update.",
			errorUpdateFileOutdated: "Installed from a local file: directory whose version is older than the latest release. Update the local directory first.",
			errorUpdateInstallFailed: "Failed to install update: "
		};
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.unrestricted";
		//#endregion
		//#region src/client/styles.ts
		/**
		* Stylesheet for the unrestricted settings card. Injected once as a single
		* <style data-plugin="dsh-unrestricted"> tag; colors and geometry come from
		* DSH's shared --dsw-* design tokens so Web and Desktop (light & dark themes)
		* match native Settings cards.
		*/
		const CSS = `
.dsh-unrestricted-root {
  display: flex;
  flex-direction: column;
  gap: var(--dsw-space-3, 12px);
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
}

.dsh-unrestricted-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2));
  border-radius: var(--dsw-radius-xl, 12px);
  padding: 16px 18px;
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-3));
}

.dsh-unrestricted-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.dsh-unrestricted-headerTitle {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.dsh-unrestricted-headerControls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.dsh-unrestricted-switchLabel {
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 18px;
  user-select: none;
}

.dsh-unrestricted-title {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dsh-unrestricted-subtitle {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dsh-unrestricted-description {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-unrestricted-note {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-unrestricted-banner {
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 8px);
  padding: 9px 12px;
  font-size: 13px;
  line-height: 19px;
  overflow-wrap: anywhere;
}

.dsh-unrestricted-banner[data-tone='error'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

.dsh-unrestricted-banner[data-tone='success'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

.dsh-unrestricted-banner[data-tone='info'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent);
  color: var(--dsw-alias-label-secondary);
}

.dsh-unrestricted-modes {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
}

.dsh-unrestricted-mode {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
}

.dsh-unrestricted-mode + .dsh-unrestricted-mode {
  border-top: 1px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
}

.dsh-unrestricted-modeMain {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.dsh-unrestricted-modeInfo {
  display: flex;
  flex: 1;
  min-width: 200px;
  flex-direction: column;
  gap: 3px;
}

.dsh-unrestricted-modeHeading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.dsh-unrestricted-modeName {
  font-size: 13px;
  line-height: 19px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dsh-unrestricted-modeDesc {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-unrestricted-mono {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
}

.dsh-unrestricted-issues {
  margin: 6px 0 0;
  padding-left: 16px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.dsh-unrestricted-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--dsw-alias-border-l2);
}

.dsh-unrestricted-previewHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.dsh-unrestricted-previewMeta {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-unrestricted-previewText {
  max-height: 320px;
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 8px);
  padding: 10px 12px;
  background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-layer-3));
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 18px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dsh-unrestricted-metaGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px 14px;
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 10px);
  padding: 11px 14px;
  background: var(--dsw-alias-bg-layer-2);
}

.dsh-unrestricted-metaItem {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.dsh-unrestricted-metaItem dt {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-unrestricted-metaItem dd {
  margin: 0;
  font-size: 13px;
  line-height: 19px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}

.dsh-unrestricted-link {
  color: var(--dsw-alias-state-business-primary);
  font-size: 12px;
  line-height: 18px;
  text-decoration: none;
}

.dsh-unrestricted-link:hover {
  text-decoration: underline;
}

@media (max-width: 640px) {
  .dsh-unrestricted-card {
    padding: 14px;
  }

  .dsh-unrestricted-modeDesc,
  .dsh-unrestricted-issues {
    padding-left: 0;
  }
}
`;
		/** Inject the stylesheet once; the tag id doubles as the re-evaluation guard. */
		function ensureStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin=\"dsh-unrestricted\"]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-unrestricted";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/UnrestrictedCard.tsx
		/**
		* The unrestricted settings view and plugin-detail badge:
		* - Master toggle card with native Switch, status Tag, and scope boundary notes
		* - Per-preset coverage list with StateDot, Tag, preview drawer, and one-click copy
		* - Version & Updates card with automatic release check and one-click self-update
		*/
		/** Mode rows in display order, with their locale label and description keys. */
		const MODE_ROWS = [
			{
				id: "standard",
				labelKey: "modeStandard",
				descKey: "modeStandardDesc",
				presetKey: "presetStandard"
			},
			{
				id: "ptc",
				labelKey: "modePtc",
				descKey: "modePtcDesc",
				presetKey: "presetPtc"
			},
			{
				id: "cordis",
				labelKey: "modeCordis",
				descKey: "modeCordisDesc",
				presetKey: "presetCordis"
			},
			{
				id: "minimal",
				labelKey: "modeMinimal",
				descKey: "modeMinimalDesc",
				presetKey: "presetMinimal"
			}
		];
		/** Known host issue strings/codes mapped to localized dictionary keys. */
		const ISSUE_LOCALE_KEYS = {
			"missing-persona": "issuePersona",
			"preset persona changed": "issuePersona"
		};
		/** Locale key for one mode state. */
		function stateKey(mode) {
			switch (mode?.state) {
				case "active": return "stateActive";
				case "failed": return "stateValidationFailed";
				default: return "stateOff";
			}
		}
		/** Map mode state to native StateDot state. */
		function dotStateOf(mode) {
			switch (mode?.state) {
				case "active": return "done";
				case "failed": return "error";
				default: return "idle";
			}
		}
		/** Map mode state to native Tag tone. */
		function modeTagTone(mode) {
			switch (mode?.state) {
				case "active": return "success";
				case "failed": return "danger";
				default: return "neutral";
			}
		}
		/** Friendly localized text for top-level RPC or settings errors. */
		function localizeBannerError(message, t) {
			const lower = message.toLowerCase();
			if (lower.includes("disconnect") || lower.includes("closed") || lower.includes("network") || lower.includes("timeout")) return t("errorRpcDisconnected");
			return `${t("operationFailed")}${message}`;
		}
		/** Friendly localized text for preview failures. */
		function localizePreviewError(entry, t) {
			const code = entry.preview?.errorCode ?? entry.errorCode;
			if (code === "unsupported-preset") return t("errorUnsupportedPreset");
			if (code === "missing-persona") return t("errorMissingPersona");
			if (code === "preview-failed") return t("errorPreviewFailed");
			const detail = entry.preview?.reason ?? entry.message;
			return detail !== void 0 && detail.trim() !== "" ? `${t("previewUnavailable")}${detail}` : t("errorPreviewFailed");
		}
		/** Friendly localized text for update errors. */
		function localizeUpdateError(update, t) {
			switch (update.errorCode) {
				case "update-check-failed": return t("errorUpdateCheckFailed");
				case "update-no-profile": return t("errorUpdateNoProfile");
				case "update-file-source-outdated": return t("errorUpdateFileOutdated");
				case "update-install-failed": return `${t("errorUpdateInstallFailed")}${update.errorDetail ?? ""}`;
				default: return update.errorDetail !== void 0 && update.errorDetail !== "" ? `${t("operationFailed")}${update.errorDetail}` : t("errorUpdateCheckFailed");
			}
		}
		/** Friendly label for the installation source. */
		function installSourceLabel(source, t) {
			switch (source) {
				case "github": return t("sourceGithub");
				case "file": return t("sourceFile");
				case "registry": return t("sourceRegistry");
				default: return t("sourceUnknown");
			}
		}
		/**
		* Badge shown in the Plugin Manager detail header when an update is available
		* or waiting for a restart.
		*/
		function UnrestrictedDetailBadge(props) {
			const { subject, t, checkUpdate } = props;
			const update = props.useView((snapshot) => snapshot.update);
			const isTargetBundle = subject.kind === "bundle" && subject.pkg.name === "dsh-unrestricted";
			(0, react.useEffect)(() => {
				if (isTargetBundle && update.state === "idle") checkUpdate(false);
			}, [
				isTargetBundle,
				update.state,
				checkUpdate
			]);
			if (!isTargetBundle) return null;
			if (update.state === "available") {
				const versionSuffix = update.latestVersion !== void 0 ? ` v${update.latestVersion}` : "";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					tone: "info",
					children: `${t("updateBadge")}${versionSuffix}`
				});
			}
			if (update.state === "updated" || update.restartRequired === true) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				tone: "success",
				children: t("updateRestartBadge")
			});
			return null;
		}
		/**
		* Render the unrestricted configuration cards.
		*/
		function UnrestrictedCard(props) {
			const { t, loadPreview, checkUpdate } = props;
			const view = props.useView((snapshot) => snapshot);
			const status = view.status;
			const update = view.update;
			const [openPreview, setOpenPreview] = (0, react.useState)(null);
			const [copiedPreset, setCopiedPreset] = (0, react.useState)(null);
			const openEntry = openPreview === null ? void 0 : view.previews[openPreview];
			(0, react.useEffect)(() => {
				if (update.state === "idle") checkUpdate(false);
			}, [update.state, checkUpdate]);
			(0, react.useEffect)(() => {
				if (openPreview !== null && openEntry === void 0) loadPreview(openPreview);
			}, [
				openPreview,
				openEntry,
				loadPreview
			]);
			const hasFailedMode = status !== null && Object.values(status.modes).some((mode) => mode.state === "failed");
			const summaryKey = view.settingsStatus === "loading" ? "summaryLoading" : view.settingsStatus === "unavailable" ? "summaryUnavailable" : hasFailedMode ? "summaryValidationFailed" : view.enabled ? "summaryEnabled" : "summaryDisabled";
			const summaryTone = view.settingsStatus !== "ready" ? "neutral" : hasFailedMode ? "warning" : view.enabled ? "success" : "neutral";
			/** Toggle one preset's preview, fetching the current bytes on first open. */
			function togglePreview(presetId) {
				if (openPreview === presetId) {
					setOpenPreview(null);
					return;
				}
				setOpenPreview(presetId);
				const entry = view.previews[presetId];
				if (entry === void 0 || entry.status === "failed") props.loadPreview(presetId);
			}
			/** Copy one preset's preview prompt text to the clipboard. */
			async function handleCopyPreview(presetId, text) {
				if (text === void 0 || text === "") return;
				if (!await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(text)) return;
				setCopiedPreset(presetId);
				setTimeout(() => {
					setCopiedPreset((current) => current === presetId ? null : current);
				}, 1800);
			}
			/** Localize known issues; fall back gracefully. */
			function formatIssues(issues) {
				return issues.map((issue) => {
					const key = ISSUE_LOCALE_KEYS[issue];
					return key !== void 0 ? t(key) : issue;
				}).join("；");
			}
			const updateBusy = update.state === "checking" || update.state === "updating";
			const updateTagTone = update.state === "available" ? "info" : update.state === "updated" ? "success" : update.state === "failed" ? "danger" : "neutral";
			const updateTagKey = update.state === "checking" ? "updateChecking" : update.state === "updating" ? "updateInstalling" : update.state === "available" ? "updateAvailable" : update.state === "updated" ? "updateRestartBadge" : update.state === "up-to-date" ? "updateUpToDate" : "updateIdle";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-unrestricted-root",
				"aria-busy": view.busy || updateBusy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-unrestricted-card",
						"aria-labelledby": "dsh-unrestricted-main-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-unrestricted-header",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-unrestricted-headerTitle",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										id: "dsh-unrestricted-main-title",
										className: "dsh-unrestricted-title",
										children: t("title")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										tone: summaryTone,
										children: t(summaryKey)
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-unrestricted-headerControls",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-unrestricted-switchLabel",
										children: t("toggle")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
										checked: view.enabled,
										disabled: !view.writable || view.settingsStatus !== "ready" || view.busy,
										label: t("toggle"),
										onChange: (checked) => {
											props.setEnabled(checked);
										}
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-description",
								children: t("description")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-note",
								children: t("scopeNote")
							}),
							view.settingsStatus === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-note",
								role: "status",
								children: t("settingsLoading")
							}),
							view.settingsStatus === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-banner",
								"data-tone": "info",
								role: "status",
								children: t("settingsUnavailable")
							}),
							view.message !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-banner",
								"data-tone": "error",
								role: "alert",
								children: localizeBannerError(view.message, t)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-unrestricted-card",
						"aria-labelledby": "dsh-unrestricted-modes-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-unrestricted-header",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-unrestricted-headerTitle",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
										id: "dsh-unrestricted-modes-title",
										className: "dsh-unrestricted-subtitle",
										children: t("statusTitle")
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-unrestricted-headerControls",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "outline",
										size: "sm",
										disabled: view.busy,
										onClick: () => {
											props.refresh();
										},
										children: t("refresh")
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-note",
								children: t("statusSubtitle")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dsh-unrestricted-modes",
								children: MODE_ROWS.map((row) => {
									const mode = status?.modes[row.id];
									const entry = view.previews[row.id];
									const isOpen = openPreview === row.id;
									const previewText = entry?.preview?.text;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: "dsh-unrestricted-mode",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-unrestricted-modeMain",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-unrestricted-modeInfo",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-unrestricted-modeHeading",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: dotStateOf(mode) }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "dsh-unrestricted-modeName",
																children: t(row.labelKey)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
																tone: "outline",
																children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "dsh-unrestricted-mono",
																	children: t(row.presetKey)
																})
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
																tone: modeTagTone(mode),
																children: t(stateKey(mode))
															})
														]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "dsh-unrestricted-modeDesc",
														children: t(row.descKey)
													})]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "dsh-unrestricted-headerControls",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
														variant: isOpen ? "toolbar" : "outline",
														size: "sm",
														onClick: () => {
															togglePreview(row.id);
														},
														children: t(isOpen ? "hidePreview" : "showPreview")
													})
												})]
											}),
											mode !== void 0 && mode.issues.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "dsh-unrestricted-issues",
												children: formatIssues(mode.issues)
											}),
											isOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsh-unrestricted-preview",
												children: entry === void 0 || entry.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "dsh-unrestricted-note",
													role: "status",
													children: t("previewLoading")
												}) : entry.status === "failed" || entry.preview?.available === false ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "dsh-unrestricted-banner",
													"data-tone": "error",
													role: "alert",
													children: localizePreviewError(entry, t)
												}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-unrestricted-previewHeader",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														className: "dsh-unrestricted-previewMeta",
														children: [
															entry.preview?.lines,
															" ",
															t("previewSize"),
															entry.preview?.bytes !== void 0 && ` · ${(0, _deepseek_ai_dsh_client_ui_primitives.fileSizeText)(entry.preview.bytes)}`,
															entry.preview?.source !== void 0 && ` · ${t(entry.preview.source === "live" ? "previewSourceLive" : "previewSourceStanding")}`
														]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
														variant: "ghost",
														size: "sm",
														onClick: () => {
															handleCopyPreview(row.id, previewText);
														},
														children: t(copiedPreset === row.id ? "copiedPreview" : "copyPreview")
													})]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
													className: "dsh-unrestricted-previewText",
													children: previewText
												})] })
											})
										]
									}, row.id);
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-note",
								children: t("subagentNote")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-unrestricted-card",
						"aria-labelledby": "dsh-unrestricted-update-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-unrestricted-header",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-unrestricted-headerTitle",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
										id: "dsh-unrestricted-update-title",
										className: "dsh-unrestricted-subtitle",
										children: t("updateTitle")
									}), update.state !== "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										tone: updateTagTone,
										children: update.state === "available" && update.latestVersion !== void 0 ? `${t("updateAvailable")} v${update.latestVersion}` : t(updateTagKey)
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-unrestricted-headerControls",
									children: [
										update.releaseUrl !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
											className: "dsh-unrestricted-link",
											href: update.releaseUrl,
											target: "_blank",
											rel: "noreferrer",
											children: t("viewRelease")
										}),
										update.state === "available" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "primary",
											size: "sm",
											disabled: updateBusy,
											onClick: () => {
												props.performUpdate();
											},
											children: update.latestVersion !== void 0 ? `${t("installUpdate")} (v${update.latestVersion})` : t("installUpdate")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "outline",
											size: "sm",
											disabled: updateBusy,
											onClick: () => {
												props.checkUpdate(true);
											},
											children: t("checkUpdate")
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
								className: "dsh-unrestricted-metaGrid",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-unrestricted-metaItem",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("currentVersion") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											className: "dsh-unrestricted-mono",
											children: `v${update.currentVersion}`
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-unrestricted-metaItem",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("latestVersion") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											className: "dsh-unrestricted-mono",
											children: update.latestVersion !== void 0 ? `v${update.latestVersion}` : "—"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-unrestricted-metaItem",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("installSource") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
											title: update.dependencySpec,
											children: installSourceLabel(update.installSource, t)
										})]
									})
								]
							}),
							update.state === "updating" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-banner",
								"data-tone": "info",
								role: "status",
								children: t("updateInstalling")
							}),
							(update.state === "updated" || update.restartRequired === true) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-banner",
								"data-tone": "success",
								role: "status",
								children: t("updateInstalled")
							}),
							update.state === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-unrestricted-banner",
								"data-tone": "error",
								role: "alert",
								children: localizeUpdateError(update, t)
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** Services required by the registration and the controller. */
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"configForms"
		];
		/** 注册本插件的配置卡片与详情页更新徽标。 */
		function apply(ctx) {
			ensureStyles();
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-unrestricted: dictionaries");
			const controller = createUnrestrictedController(ctx);
			ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: "dsh-unrestricted",
				locale: NS,
				inject: () => controller.face()
			}, UnrestrictedCard));
			ctx.slots.inject("plugins.detail.badge", () => ctx.slots.register({
				name: "plugins.detail.badge",
				id: "dsh-unrestricted:update-badge",
				locale: NS,
				inject: () => controller.face()
			}, UnrestrictedDetailBadge));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map