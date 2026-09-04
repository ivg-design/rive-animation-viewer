const select = (name, label, entries, className = '') => `<label class="media-field ${className}"><span>${label}</span><select id="media-${name}" name="${name}">${entries.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
const input = (name, label, attributes = '', className = '') => `<label class="media-field ${className}"><span>${label}</span><input id="media-${name}" name="${name}" ${attributes}></label>`;
const check = (name, label, className = '') => `<label class="media-check ${className}"><input type="checkbox" id="media-${name}" name="${name}"><span>${label}</span></label>`;
const number = (name, label, attributes = '', className = '') => input(name, label, `type="number" ${attributes}`, className);

export function mediaTemplate() {
    return `<header class="media-header">
      <div class="media-header-main"><span class="media-eyebrow">RAV output</span>
        <div class="media-title-line"><h2>Export</h2><p data-media-source>Animation only · no application chrome</p></div>
      </div>
      <button type="button" class="icon-btn icon-btn-ghost rav-modal-close ui-overlay-close media-close" data-overlay-close data-media-action="close" aria-label="Close export">×</button>
    </header>
    <div class="media-body">
      <div class="media-menu" data-media-menu>
        <section class="media-menu-section" aria-labelledby="media-menu-heading">
          <div class="media-section-heading"><h3 id="media-menu-heading">Media</h3><span>Choose a capture workflow</span></div>
          <div class="media-menu-choices" data-media-choices></div>
        </section>
        <section class="media-menu-section media-web-section" aria-labelledby="media-web-heading">
          <div class="media-section-heading"><h3 id="media-web-heading">Web &amp; code</h3></div>
          <button type="button" class="media-menu-item media-menu-item-wide" data-media-action="media-html">
            <span class="media-menu-index" aria-hidden="true">WEB</span>
            <strong>Standalone HTML &amp; snippets</strong>
            <span>Package a viewer or copy selected-property integration code</span>
          </button>
        </section>
      </div>
      <form class="media-settings" data-media-form hidden>
        <div class="media-settings-toolbar">
          <button type="button" class="media-back" data-media-action="media-menu" aria-label="Back to export options">← Export</button>
          <div class="media-mode-title"><strong data-media-mode-title>Media settings</strong><span data-media-mode-detail></span></div>
          <label class="media-format-field"><span>Format</span><select id="media-format" name="format"></select></label>
        </div>
        <p class="media-note media-format-note" data-media-format-note></p>
        <ul class="media-note media-unavailable" data-media-unavailable hidden></ul>
        <div class="media-settings-layout">
          <div class="media-capture-stack">
            <fieldset class="media-panel" data-media-scope="timeline"><legend>Timeline range</legend>
              <div class="media-grid">${select('range', 'Range', [['full', 'Full timeline'], ['segment', 'Segment']])}
              ${select('range_unit', 'Units', [['seconds', 'Seconds'], ['frames', 'Frames']])}</div>
              <div class="media-grid" data-media-segment>${number('start', 'Start · inclusive', 'min="0" step="any"')}${number('end', 'End · exclusive', 'min="0" step="any"')}</div>
            </fieldset>
            <fieldset class="media-panel" data-media-scope="still"><legend>Still frame</legend>
              ${select('at_mode', 'Capture', [['current', 'Current visible frame'], ['time', 'Timeline time'], ['frame', 'Timeline frame']])}
              <div data-media-at-time>${number('at_seconds', 'Time · seconds', 'min="0" step="any"')}</div>
              <div data-media-at-frame>${number('at_frame', 'Frame · zero-based', 'min="0" step="1"')}</div>
            </fieldset>
            <fieldset class="media-panel" data-media-scope="record"><legend>Recording</legend>
              <div class="media-grid">${select('stop_mode', 'Stop', [['manual', 'Manual start / stop'], ['duration', 'After a duration']])}
              <div data-media-duration>${number('duration_seconds', 'Duration · seconds', 'min="0.01" step="any"')}</div></div>
              <p class="media-note media-callout">Start closes this panel. Use toolbar STOP or Cmd/Ctrl+Shift+R after interacting with the canvas or ViewModel controls.</p>
            </fieldset>
            <fieldset class="media-panel media-gif-panel" data-media-gif><legend>GIF compression</legend>
              <div class="media-grid">${select('gif_preset', 'Preset', [['source', 'Source'], ['balanced', 'Balanced'], ['small', 'Small'], ['custom', 'Custom'], ['target-size', 'Target size']])}
              ${select('encoder', 'Encoder', [['auto', 'Auto'], ['gifski', 'gifski'], ['ffmpeg', 'FFmpeg palette']])}</div>
              <p class="media-note" data-media-preset-note></p>
              <div data-media-target><div class="media-grid">${number('target_mib', 'Target · MiB', 'min="0.001" step="any"')}
                ${select('size_policy', 'Adjust', [['quality_only', 'Quality only'], ['quality_fps_scale', 'Quality, FPS & size']])}</div>
                <p class="media-note" data-media-target-note></p></div>
              <div class="media-grid"><div data-media-motion>${number('motion_quality', 'Motion quality', 'min="1" max="100" step="1" placeholder="Auto"')}</div>
                <div data-media-lossy>${number('lossy_quality', 'Lossy quality', 'min="1" max="100" step="1" placeholder="Auto"')}</div></div>
              ${number('repeat', 'Repeat · 0 forever, −1 once', 'min="-1" max="32767" step="1"')}
            </fieldset>
          </div>
          <fieldset class="media-panel media-output-panel"><legend>Output</legend>
            <div class="media-grid">${number('width', 'Width · px', 'min="1" step="1" placeholder="Source"')}${number('height', 'Height · px', 'min="1" step="1" placeholder="Source"')}</div>
            <div class="media-grid media-size-meta">${check('aspect_lock', 'Lock aspect ratio')}${select('scale', 'Source scale', [['1', '100%'], ['0.75', '75%'], ['0.5', '50%'], ['0.25', '25%']])}</div>
            <div class="media-grid"><div data-media-fps>${number('fps', 'Frame rate', 'min="1" step="any"')}</div>
              <div data-media-quality>${number('quality', 'Quality · 1–100', 'min="1" max="100" step="1"')}</div></div>
            <div class="media-output-flags">
              ${check('alpha', 'Transparent')}
              <label class="media-color-field"><span>Matte</span><input id="media-background" name="background" type="color"></label>
              ${check('cursor', 'Cursor')}
            </div>
            <p class="media-note media-alpha-note" data-media-alpha-note></p>
            <div class="media-path-field">
              <span class="media-path-label">Save to</span>
              <div class="media-path-picker">
                <button type="button" class="media-path-button" data-media-action="media-choose-path" aria-describedby="media-output-path-value" aria-label="Choose output file" title="Choose output file">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6A2 2 0 0 1 18.46 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2A2 2 0 0 0 12.07 6H18a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
                <span id="media-output-path-value" class="media-path-value is-empty" data-media-path-value>Choose a folder and file name</span>
              </div>
            </div>
            <p class="media-note media-output-note">Existing files are preserved · audio is not captured</p>
          </fieldset>
        </div>
        <footer class="media-actions">
          <div class="media-summary"><span>Resolved output</span><p class="media-preview" data-media-preview></p></div>
          <button type="submit" class="btn btn-primary" data-media-submit>Export media</button>
        </footer>
      </form>
      <section class="media-job" data-media-job hidden aria-label="Media export job">
        <div class="media-job-heading"><div class="media-job-title"><span class="media-job-dot" aria-hidden="true"></span><strong data-media-job-text role="status" aria-live="polite"></strong></div>
          <div class="media-job-actions"><button type="button" class="btn media-stop" data-media-action="media-stop">Stop</button>
          <button type="button" class="btn" data-media-action="media-cancel">Cancel</button></div></div>
        <progress class="media-progress" max="1" aria-label="Export progress"></progress>
        <p class="media-error" data-media-job-error role="alert" hidden></p>
        <ul class="media-warnings" data-media-warnings aria-label="Export warnings" hidden></ul>
        <details class="media-job-disclosure" data-media-job-disclosure><summary>Technical details</summary><pre data-media-job-details></pre></details>
      </section>
      <p class="media-error" data-media-error role="alert" hidden></p>
      <p class="media-note media-limits" data-media-limits></p>
    </div>`;
}
