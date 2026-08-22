/**
 * Stylesheet for the unrestricted settings card. One hand-written stylesheet
 * injected as a single <style data-plugin> tag (the loader convention for
 * plugin-owned styles); colors come from the shared --dsw-* tokens.
 */

const CSS = `
.dsh-unrestricted-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  padding: 14px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
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
