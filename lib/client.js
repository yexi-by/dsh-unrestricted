window.__ModuleLoader__.load({
	id: "dsh-unrestricted",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/controller.ts
		const RPC_CHANNEL = "/dsh-unrestricted";
		const SETTINGS_NS = "unrestricted";
		/** Human-readable error text for the banner. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/**
		* Create the card controller bound to the calling plugin's context.
		* @param ctx - the browser plugin context (connection + remote + settingsScope injected).
		* @returns the controller whose face() feeds the slot inject share.
		*/
		function createUnrestrictedController(ctx) {
			const connection = ctx.get("connection");
			const settings = ctx.settingsScope.bind({ namespace: SETTINGS_NS });
			let snapshot = {
				enabled: false,
				writable: false,
				settingsStatus: "loading",
				status: null
			};
			const listeners = /* @__PURE__ */ new Set();
			const view = {
				getSnapshot: () => snapshot,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			};
			function publish() {
				const settingsSnapshot = settings.getSnapshot();
				snapshot = {
					enabled: settingsSnapshot.value?.enabled === true,
					writable: settingsSnapshot.writable,
					settingsStatus: settingsSnapshot.status,
					status: snapshot.status,
					message: snapshot.message
				};
				for (const listener of listeners) listener();
			}
			async function call(endpoint, payload) {
				const result = await connection.rpc.call(RPC_CHANNEL, endpoint, payload);
				if (!result.ok) throw new Error(result.error.message);
				return result.value;
			}
			async function refresh() {
				try {
					const status = await call("status", {});
					snapshot = {
						...snapshot,
						status,
						message: void 0
					};
					publish();
				} catch (error) {
					snapshot = {
						...snapshot,
						message: messageOf(error)
					};
					publish();
				}
			}
			async function setEnabled(enabled) {
				await settings.set("enabled", enabled);
				publish();
				setTimeout(() => void refresh(), 300);
			}
			async function recheck() {
				try {
					const status = await call("recheck", {});
					snapshot = {
						...snapshot,
						status,
						message: void 0
					};
					publish();
				} catch (error) {
					snapshot = {
						...snapshot,
						message: messageOf(error)
					};
					publish();
				}
			}
			ctx.effect(() => settings.subscribe(publish), "dsh-unrestricted: settings mirror");
			ctx.effect(() => ctx.remote.$on("settings/document-updated", (namespace) => {
				if (namespace === void 0 || namespace === SETTINGS_NS) refresh();
			}), "dsh-unrestricted: settings invalidations");
			publish();
			refresh();
			return { face: () => ({
				hooks: { view },
				setEnabled,
				recheck,
				refresh
			}) };
		}
		//#endregion
		//#region src/client/locales.ts
		/** Copy dictionaries for the unrestricted settings card. */
		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			title: "破限模式",
			summaryEnabled: "已开启",
			summaryDisabled: "已关闭",
			summaryLoading: "读取中",
			summaryUnavailable: "设置不可用",
			summaryIncompatible: "部分模式不兼容",
			description: "开启后，各模式的系统提示词整体替换为以当前原版为底稿、融合破限规则的完整版本；关闭即恢复 DSH 原版提示词。从下一次请求和新建子代理开始生效，不改动正在执行的请求、工具定义、权限配置与会话历史。",
			toggle: "启用破限",
			scopeNote: "提示词仅由 DSH 生成时才受本插件控制；模型平台或宿主环境中更高优先级的规则不在覆盖范围内。",
			statusTitle: "各模式状态",
			modeStandard: "Standard 标准模式",
			modeCode: "Code PTC 模式",
			modeCordis: "Cordis 创造模式",
			modeMinimal: "Minimal 极简模式",
			subagentNote: "子代理随所属模式一并生效。",
			stateActive: "已生效",
			stateOff: "已关闭",
			stateChecking: "校验中",
			stateIncompatible: "版本不兼容，已保持原版",
			supported: "锚点校验基线（DSH 更新导致原版提示词变化时，对应模式自动回退原版并在此提示）：",
			recheck: "重新校验",
			refresh: "刷新",
			settingsUnavailable: "当前连接不可写设置（远程浏览器只读）。",
			settingsLoading: "正在读取设置…",
			operationFailed: "操作失败："
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			title: "Unrestricted mode",
			summaryEnabled: "Enabled",
			summaryDisabled: "Disabled",
			summaryLoading: "Loading",
			summaryUnavailable: "Settings unavailable",
			summaryIncompatible: "Some modes incompatible",
			description: "When enabled, each mode's system prompt is replaced wholesale by a fused prompt built on its current original; disabling restores the stock DSH prompt. Applies from the next request and new subagents; in-flight requests, tool definitions, permissions, and session history are never touched.",
			toggle: "Enable unrestricted mode",
			scopeNote: "This plugin can only rewrite prompts DSH generates itself; higher-priority rules from the model platform or host environment are out of scope.",
			statusTitle: "Per-mode status",
			modeStandard: "Standard",
			modeCode: "Code (PTC)",
			modeCordis: "Cordis",
			modeMinimal: "Minimal",
			subagentNote: "Subagents follow their parent's mode.",
			stateActive: "Active",
			stateOff: "Off",
			stateChecking: "Checking",
			stateIncompatible: "Incompatible — stock prompt kept",
			supported: "Anchor-check baseline (when a DSH update changes an original prompt, that mode falls back to the stock prompt and reports here):",
			recheck: "Re-check",
			refresh: "Refresh",
			settingsUnavailable: "This connection cannot write settings (remote browser is read-only).",
			settingsLoading: "Reading settings…",
			operationFailed: "Operation failed: "
		};
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.unrestricted";
		//#endregion
		//#region src/client/styles.ts
		/**
		* Stylesheet for the unrestricted settings card. One hand-written stylesheet
		* injected as a single <style data-plugin> tag (the loader convention for
		* plugin-owned styles); colors come from the shared --dsw-* tokens.
		*/
		const CSS = `
.dsh-unrestricted-card {
  display: block;
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}

.dsh-unrestricted-summary {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-sizing: border-box;
  padding: 12px 14px;
  cursor: pointer;
  list-style: none;
  touch-action: manipulation;
  user-select: none;
}

.dsh-unrestricted-summary::-webkit-details-marker { display: none; }

.dsh-unrestricted-summary:hover { background: var(--dsw-alias-interactive-bg-hover); }

.dsh-unrestricted-summary:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}

.dsh-unrestricted-summary::after {
  width: 8px;
  height: 8px;
  flex: none;
  border-right: 2px solid var(--dsw-alias-label-tertiary);
  border-bottom: 2px solid var(--dsw-alias-label-tertiary);
  content: '';
  transform: rotate(45deg);
  transition: transform 160ms ease;
}

.dsh-unrestricted-card[open] > .dsh-unrestricted-summary {
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dsh-unrestricted-card[open] > .dsh-unrestricted-summary::after {
  transform: rotate(225deg);
}

.dsh-unrestricted-summaryText {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.dsh-unrestricted-summaryStatus {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dsh-unrestricted-summaryStatus[data-state='active'] {
  color: var(--dsw-alias-state-success-primary);
}

.dsh-unrestricted-summaryStatus[data-state='pending'] {
  color: var(--dsw-alias-state-business-primary);
}

.dsh-unrestricted-summaryStatus[data-state='error'] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-unrestricted-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}

.dsh-unrestricted-title {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.dsh-unrestricted-statusTitle {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
}

.dsh-unrestricted-description,
.dsh-unrestricted-note {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-unrestricted-note {
  font-size: 12px;
  line-height: 18px;
}

.dsh-unrestricted-error {
  margin: 0;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}

.dsh-unrestricted-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.dsh-unrestricted-toggle input {
  accent-color: var(--dsw-alias-state-business-primary);
}

.dsh-unrestricted-modes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-unrestricted-mode {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  line-height: 18px;
}

.dsh-unrestricted-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 999px;
  background: var(--dsw-alias-label-tertiary);
}

.dsh-unrestricted-dot[data-state='active'] {
  background: var(--dsw-alias-state-success-primary);
}

.dsh-unrestricted-dot[data-state='checking'] {
  background: var(--dsw-alias-state-business-primary);
}

.dsh-unrestricted-dot[data-state='incompatible'] {
  background: var(--dsw-alias-state-error-primary);
}

.dsh-unrestricted-modeName {
  color: var(--dsw-alias-label-primary);
}

.dsh-unrestricted-modeState {
  color: var(--dsw-alias-label-secondary);
}

.dsh-unrestricted-issues {
  flex-basis: 100%;
  padding-left: 15px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.dsh-unrestricted-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dsh-unrestricted-actions button {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 4px 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.dsh-unrestricted-actions button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-unrestricted-actions button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-unrestricted-summary::after { transition: none; }
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
		/** Mode rows in display order, with their locale label keys. */
		const MODE_ROWS = [
			{
				id: "standard",
				labelKey: "modeStandard"
			},
			{
				id: "code",
				labelKey: "modeCode"
			},
			{
				id: "cordis",
				labelKey: "modeCordis"
			},
			{
				id: "minimal",
				labelKey: "modeMinimal"
			}
		];
		/** Locale key for one mode state. */
		function stateKey(mode) {
			switch (mode?.state) {
				case "active": return "stateActive";
				case "checking": return "stateChecking";
				case "incompatible": return "stateIncompatible";
				default: return "stateOff";
			}
		}
		/**
		* Render the unrestricted card.
		* @param props - locale copy, the card snapshot, and its actions.
		* @returns the card.
		*/
		function UnrestrictedCard(props) {
			const { t } = props;
			const view = props.useView((snapshot) => snapshot);
			const status = view.status;
			const hasIncompatibleMode = status !== null && Object.values(status.modes).some((mode) => mode.state === "incompatible");
			const summaryKey = view.settingsStatus === "loading" ? "summaryLoading" : view.settingsStatus === "unavailable" ? "summaryUnavailable" : hasIncompatibleMode ? "summaryIncompatible" : view.enabled ? "summaryEnabled" : "summaryDisabled";
			const summaryState = view.settingsStatus === "ready" ? hasIncompatibleMode ? "error" : view.enabled ? "active" : "off" : "pending";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: "dsh-unrestricted-card",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
					className: "dsh-unrestricted-summary",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-unrestricted-summaryText",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-unrestricted-title",
							role: "heading",
							"aria-level": 3,
							children: t("title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-unrestricted-summaryStatus",
							"data-state": summaryState,
							children: t(summaryKey)
						})]
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-unrestricted-content",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-unrestricted-description",
							children: t("description")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-unrestricted-toggle",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: view.enabled,
								disabled: !view.writable || view.settingsStatus !== "ready",
								onChange: (event) => {
									props.setEnabled(event.target.checked);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("toggle") })]
						}),
						view.settingsStatus === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-unrestricted-note",
							children: t("settingsUnavailable")
						}),
						view.message !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dsh-unrestricted-error",
							children: [t("operationFailed"), view.message]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: "dsh-unrestricted-statusTitle",
							children: t("statusTitle")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "dsh-unrestricted-modes",
							children: MODE_ROWS.map((row) => {
								const mode = status?.modes[row.id];
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
									className: "dsh-unrestricted-mode",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-unrestricted-dot",
											"data-state": mode?.state ?? "off"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-unrestricted-modeName",
											children: t(row.labelKey)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-unrestricted-modeState",
											children: t(stateKey(mode))
										}),
										mode !== void 0 && mode.issues.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-unrestricted-issues",
											children: mode.issues.join("; ")
										})
									]
								}, row.id);
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-unrestricted-note",
							children: t("subagentNote")
						}),
						status !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dsh-unrestricted-note",
							children: [t("supported"), ` DSH ${status.supported.version}（${status.supported.commit.slice(0, 7)}）。`]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-unrestricted-note",
							children: t("scopeNote")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-unrestricted-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									props.recheck();
								},
								children: t("recheck")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									props.refresh();
								},
								children: t("refresh")
							})]
						})
					]
				})]
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
			"settingsScope"
		];
		/** Contribute the unrestricted card to the plugin-configuration tab. */
		function apply(ctx) {
			ensureStyles();
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-unrestricted: dictionaries");
			const controller = createUnrestrictedController(ctx);
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "unrestricted",
				locale: NS,
				inject: () => controller.face()
			}, UnrestrictedCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map