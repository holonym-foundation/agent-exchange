import type { DashboardState } from './server.js'

// The dashboard is now a thin server-rendered shell: structure + modals + a JSON state blob,
// with ALL behavior + styling in served static files (public/app.js, public/app.css). This
// eliminates the TS-template-literal escaping hazards (regex, ${}, backticks, stray </script>)
// that previously broke the client script. The client fetches /api/state and renders #app.

const MODALS = `
  <div class="modal-backdrop" id="create-modal"><div class="modal">
    <h3>Create demo agents</h3>
    <div class="field"><label>EMAIL_BASE (plus-aliasing routes all to one inbox)</label>
      <input id="create-email" type="email" placeholder="webmaster@holonym.id" /></div>
    <div class="field"><label>How many</label>
      <input id="create-count" type="number" min="1" max="20" value="3" /></div>
    <div class="err" id="create-error"></div>
    <div class="actions"><button class="btn" data-modal-close>Cancel</button>
      <button class="btn primary" id="create-apply">Create</button></div>
  </div></div>

  <div class="modal-backdrop" id="fund-modal"><div class="modal">
    <h3>Fund agents</h3>
    <div id="fund-body"></div>
    <div class="actions"><button class="btn" data-modal-close>Close</button>
      <button class="btn primary" id="fund-apply">Fund</button></div>
  </div></div>

  <div class="modal-backdrop" id="run-modal"><div class="modal">
    <h3>Start perpetual loop</h3>
    <div class="field"><label>EMAIL_BASE</label>
      <input id="run-email" type="email" placeholder="webmaster@holonym.id" /></div>
    <div class="field"><label>Delay between hops (seconds, default 300)</label>
      <input id="run-delay" type="number" min="3" placeholder="300" /></div>
    <div class="field"><label>Amount per hop (ETH, default 0.0001)</label>
      <input id="run-amount" type="text" placeholder="0.0001" /></div>
    <div class="err" id="run-error"></div>
    <div class="actions"><button class="btn" data-modal-close>Cancel</button>
      <button class="btn primary" id="run-apply">Start</button></div>
  </div></div>

  <div class="modal-backdrop" id="policy-modal"><div class="modal">
    <h3>Daily limit — <code id="policy-agent-label">…</code></h3>
    <div class="field"><label>Daily spend limit (USD)</label>
      <input id="policy-limit" type="number" min="0" placeholder="e.g. 50" /></div>
    <div class="err" id="policy-error"></div>
    <div class="actions"><button class="btn" data-modal-close>Cancel</button>
      <button class="btn primary" id="policy-apply">Apply</button></div>
  </div></div>

  <div class="modal-backdrop" id="operator-modal"><div class="modal">
    <h3>Operator wallet <span class="badge b-warn" style="font-size:10px;vertical-align:middle">your identity</span></h3>
    <div id="operator-current"></div>
    <div class="field">
      <label>Designate an existing wallet you control as the operator</label>
      <select id="operator-pick"></select>
    </div>
    <p class="dim" style="font-size:11px">To sign in with a Human Wallet instead, use “Sign in with WaaP” at the top-right.</p>
    <div class="err" id="operator-error"></div>
    <div class="actions"><button class="btn" data-modal-close>Cancel</button>
      <button class="btn" id="operator-set">Use selected wallet</button></div>
  </div></div>

  <div class="modal-backdrop" id="tags-modal"><div class="modal">
    <h3>Labels — <code id="tags-agent-label">…</code></h3>
    <div class="field"><label>Current labels (click to remove)</label>
      <div id="tags-current"></div></div>
    <div class="field"><label>Add a label</label>
      <input id="tags-input" type="text" placeholder="e.g. yield, prod, treasury" /></div>
    <div class="err" id="tags-error"></div>
    <div class="actions"><button class="btn" data-modal-close>Done</button>
      <button class="btn primary" id="tags-add">Add label</button></div>
  </div></div>

  <div class="modal-backdrop" id="fleet-modal"><div class="modal">
    <h3>Set daily limit by tag</h3>
    <div class="field"><label>Select agents</label><select id="fleet-selector"></select></div>
    <div class="field"><label>Daily limit (USD)</label>
      <input id="fleet-limit" type="number" min="0" placeholder="e.g. 50" /></div>
    <div class="err" id="fleet-error"></div>
    <div class="actions"><button class="btn" data-modal-close>Cancel</button>
      <button class="btn primary" id="fleet-apply">Apply</button></div>
  </div></div>`

interface ShellOptions {
  /** Inline the CSS/JS contents (for a portable static export) instead of linking /static/. */
  inlineAssets?: { css: string; js: string }
}

export function renderShell(state: DashboardState, opts: ShellOptions = {}): string {
  // Safe JSON inject: escape </ so a stray "</script>" inside data can't close the tag early.
  const stateJson = JSON.stringify(state).replace(/</g, '\\u003c')
  const head = opts.inlineAssets
    ? `<style>${opts.inlineAssets.css}</style>`
    : `<link rel="stylesheet" href="/static/app.css" />`
  const script = opts.inlineAssets
    ? `<script>${opts.inlineAssets.js}</script>`
    : `<script src="/static/app.js"></script>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>aex-fleet</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
${head}
</head>
<body>
<main id="app"></main>
${MODALS}
<div class="toast" id="toast"></div>
<script>window.__STATE__ = ${stateJson};</script>
${script}
</body>
</html>`
}
