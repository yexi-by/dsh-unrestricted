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

.dsh-unrestricted-head {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  padding: 12px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
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

.dsh-unrestricted-dot[data-state='failed'] {
  background: var(--dsw-alias-state-error-primary);
}

.dsh-unrestricted-modeName {
  color: var(--dsw-alias-label-primary);
}

.dsh-unrestricted-modeState {
  color: var(--dsw-alias-label-secondary);
}

.dsh-unrestricted-presetId,
.dsh-unrestricted-fingerprint {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  padding: 1px 5px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 16px;
}

.dsh-unrestricted-fingerprint {
  color: var(--dsw-alias-label-primary);
  letter-spacing: 0.4px;
}

.dsh-unrestricted-inlineAction {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 1px 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dsh-unrestricted-inlineAction:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-unrestricted-inlineAction:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-unrestricted-preview {
  display: flex;
  flex-basis: 100%;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  padding-left: 15px;
}

.dsh-unrestricted-previewText {
  max-height: 320px;
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 17px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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

.dsh-unrestricted-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dsh-unrestricted-actions button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-unrestricted-dockButton { transition: none; }
}

.dsh-unrestricted-dock {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 2px 4px 0;
}

.dsh-unrestricted-dockButton {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  padding: 2px 10px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}

.dsh-unrestricted-dockButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dsh-unrestricted-dockButton:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-unrestricted-dockButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dsh-unrestricted-dockButton[data-state='active'] {
  border-color: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-state-success-primary);
}

.dsh-unrestricted-dockDot {
  display: inline-block;
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 999px;
  background: var(--dsw-alias-label-tertiary);
}

.dsh-unrestricted-dockDot[data-state='active'] {
  background: var(--dsw-alias-state-success-primary);
}

.dsh-unrestricted-dockDot[data-state='pending'] {
  background: var(--dsw-alias-state-business-primary);
}
`

/** Inject the stylesheet once; the tag id doubles as the re-evaluation guard. */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin="dsh-unrestricted"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-unrestricted'
  tag.textContent = CSS
  document.head.appendChild(tag)
}
