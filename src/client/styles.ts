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
