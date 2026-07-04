/* aex-fleet dashboard client. Authored as a plain served file (NOT inside a TS template
 * literal) so there is zero escaping ambiguity — the class of bug that previously killed every
 * button. Polls /api/state every 5s and re-renders #app; all clicks handled via delegation on
 * document so re-renders never detach handlers. Modals live outside #app so they survive a
 * re-render while open. */

const FUND_THRESHOLD = 0.001 // ETH; a demo agent below this counts as "needs funding"
let state = null
let polling = true
let forcePicker = false // when true, the Fund modal shows the treasury picker even if one is set
let detailsOpen = false // persists the Fleet-details drawer open state across re-renders
let fundBrowserMode = false // true when the operator is a browser-signed wallet → fund via window.silk

// ── tiny helpers ──────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel)
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function shortAddr(a) { if (!a) return '—'; return a.length <= 12 ? a : a.slice(0, 6) + '…' + a.slice(-4) }
function shortHash(h) { if (!h) return '—'; return h.slice(0, 8) + '…' + h.slice(-6) }
function relAge(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return Math.round(ms / 1000) + 's'
  if (ms < 3600000) return Math.round(ms / 60000) + 'm'
  if (ms < 86400000) return Math.round(ms / 3600000) + 'h'
  return Math.round(ms / 86400000) + 'd'
}
function explorerBase(chain) {
  const c = (chain || '').toLowerCase()
  if (c === 'ethereum' || c === 'mainnet') return 'https://etherscan.io'
  if (c === 'sepolia') return 'https://sepolia.etherscan.io'
  if (c === 'sui') return 'https://suiscan.xyz/mainnet'
  return null
}
function addrLink(addr, chain) {
  if (!addr) return '<span class="dim">—</span>'
  const base = explorerBase(chain)
  const copy = '<button class="copy" data-copy="' + esc(addr) + '" title="' + esc(addr) + ' — copy"><code>' + esc(shortAddr(addr)) + '</code></button>'
  const ext = base ? ' <a class="ext" href="' + base + '/address/' + esc(addr) + '" target="_blank" rel="noopener" title="explorer">↗</a>' : ''
  return copy + ext
}
function txLink(hash, chain) {
  if (!hash) return '<span class="dim">—</span>'
  const base = explorerBase(chain)
  const copy = '<button class="copy" data-copy="' + esc(hash) + '" title="' + esc(hash) + ' — copy"><code>' + esc(shortHash(hash)) + '</code></button>'
  const ext = base ? ' <a class="ext" href="' + base + '/tx/' + esc(hash) + '" target="_blank" rel="noopener" title="explorer">↗</a>' : ''
  return copy + ext
}
function badge(kind, text) { return '<span class="badge b-' + kind + '">' + esc(text) + '</span>' }

// ── toast ──────────────────────────────────────────────────────────────────
let toastTimer = null
function toast(msg, kind) {
  const t = $('#toast')
  t.textContent = msg
  t.className = 'toast show' + (kind === 'err' ? ' err' : '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.className = 'toast' }, kind === 'err' ? 6000 : 2500)
}

// ── derive pipeline status from state ────────────────────────────────────────
function demoAgents() { return state.agents.filter((a) => !a.isTreasury) }
function isCreated() { return demoAgents().length > 0 }
function isFunded() {
  const d = demoAgents()
  return d.length > 0 && d.every((a) => (a.telemetry.lastBalance ?? 0) >= FUND_THRESHOLD)
}
function isRunning() { return state.loop.managed.pid !== null || (!!state.loop.state && !state.loop.isPauseFilePresent && state.loop.state.lastStatus === 'confirmed') }

// ── render the pipeline (identity-first) ──────────────────────────────────────
// Operator → Create → Fund → Run → Observe. Establish WHO YOU ARE first; the agent fleet is
// created, funded, and linked under that identity. Linking is folded into the Operator step
// (enrollment), so "your fleet is provably yours" is established up front, not mid-flow.
function renderPipeline() {
  const created = isCreated(), funded = isFunded(), running = isRunning()
  const d = demoAgents()
  const anchor = state.operator.anchorAddress
  const operatorSet = !!anchor

  // Step 1 — Operator (identity anchor + funding source + enrollment)
  const linkTargets = d.filter((a) => a.address && a.address !== anchor)
  const linkedCount = anchor ? linkTargets.filter((a) => a.linkedTo === anchor).length : 0
  const allLinked = operatorSet && linkTargets.length > 0 && linkedCount === linkTargets.length
  let opDesc, opCtrl
  if (!operatorSet) {
    opDesc = 'Sign in (top-right) — or designate a wallet you control.'
    opCtrl = '<button class="btn" data-action="open-operator">Choose operator wallet</button>'
  } else {
    const bal = state.treasury.balance != null ? state.treasury.balance.toFixed(4) + ' ETH' : '—'
    const enroll = linkTargets.length === 0 ? ''
      : allLinked ? ' · ' + linkedCount + ' agents enrolled'
      : ' · <button class="btn sm" data-action="link-all">enroll ' + (linkTargets.length - linkedCount) + ' agent' + (linkTargets.length - linkedCount === 1 ? '' : 's') + '</button>'
    opDesc = 'You: <code>' + esc(state.operator.anchorAgentId || '') + '</code> · ' + bal + enroll
    opCtrl = '<button class="btn sm" data-action="open-operator">change</button>'
  }
  const s1 = `<div class="step ${operatorSet ? 'done' : 'active'}"><div class="num">${operatorSet ? '✓' : '1'}</div>
    <div class="title">Operator <span class="badge b-warn" style="font-size:10px;vertical-align:middle">sign-in: preview</span></div>
    <div class="desc">${opDesc}</div><div class="controls">${opCtrl}</div></div>`

  // Step 2 — Create agents (auto-enrolled under the operator on creation)
  const s2cls = !operatorSet ? '' : created ? 'done' : 'active'
  const s2 = `<div class="step ${s2cls}"><div class="num">${created ? '✓' : '2'}</div>
    <div class="title">Create agents</div>
    <div class="desc">${created ? d.length + ' agent' + (d.length === 1 ? '' : 's') + ' under your identity' : operatorSet ? 'Spawn a fleet under your identity.' : 'Set your operator wallet first.'}</div>
    <div class="controls"><button class="btn ${created || !operatorSet ? '' : 'primary'}" data-action="open-create">${created ? '+ Add more' : 'Create agents'}</button></div>
  </div>`

  // Step 3 — Fund
  const s3cls = !created ? '' : funded ? 'done' : 'active'
  let fundDesc, fundCtrl
  if (!created) { fundDesc = 'Create agents first.'; fundCtrl = '' }
  else if (funded) { fundDesc = 'All agents funded (≥ ' + FUND_THRESHOLD + ' ETH).'; fundCtrl = '<button class="btn" data-action="open-fund">Top up</button>' }
  else {
    const ready = (state.treasury.balance ?? 0) > 0
    fundDesc = ready ? 'Your wallet holds ' + (state.treasury.balance ?? 0).toFixed(4) + ' ETH — sweep to agents.' : 'Fund your wallet, then sweep to agents.'
    fundCtrl = '<button class="btn ' + (ready ? 'primary' : '') + '" data-action="open-fund">' + (ready ? 'Fund agents' : 'How to fund') + '</button>'
  }
  const s3 = `<div class="step ${s3cls}"><div class="num">${funded ? '✓' : '3'}</div>
    <div class="title">Fund</div><div class="desc">${esc(fundDesc)}</div><div class="controls">${fundCtrl}</div></div>`

  // Step 4 — Run
  const s4cls = !funded ? '' : running ? 'done' : 'active'
  const isPaused = state.loop.isPauseFilePresent
  let runCtrl
  if (running || state.loop.managed.pid !== null) {
    runCtrl = '<button class="btn danger" data-action="loop-stop">■ Stop</button>'
      + (isPaused ? '<button class="btn primary" data-action="resume">▶ Resume</button>'
                  : '<button class="btn" data-action="pause">⏸ Pause</button>')
  } else {
    runCtrl = '<button class="btn ' + (funded ? 'primary' : '') + '" data-action="open-run">▶ Start loop</button>'
  }
  const runDesc = running ? (isPaused ? 'Paused.' : 'Trading live.') : funded ? 'Start the round-robin.' : 'Fund agents first.'
  const s4 = `<div class="step ${s4cls}"><div class="num">${running ? '✓' : '4'}</div>
    <div class="title">Run</div><div class="desc">${esc(runDesc)}</div><div class="controls">${runCtrl}</div></div>`

  // Step 5 — Observe
  const hops = state.loop.state ? state.loop.state.totalHops : 0
  const s5 = `<div class="step ${running ? 'active' : ''}"><div class="num">5</div>
    <div class="title">Observe</div>
    <div class="desc">${hops} hop${hops === 1 ? '' : 's'} so far. Live feed below ↓</div>
    <div class="controls"><a class="btn sm" href="/api/state" target="_blank">raw JSON</a></div></div>`

  return '<div class="pipeline">' + s1 + s2 + s3 + s4 + s5 + '</div>'
}

// ── render agents table ──────────────────────────────────────────────────────
function renderAgents() {
  if (state.agents.length === 0) return '<div class="empty">No agents yet. Click “Create demo agents”.</div>'
  const rows = state.agents.map((a) => {
    const active = state.activeAgent === a.agentId ? '<span class="active-dot">●</span>' : ''
    const bal = a.telemetry.lastBalance != null ? a.telemetry.lastBalance.toFixed(4) : '<span class="dim">—</span>'
    const tags = (a.tags.length ? a.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join(' ') : '<span class="dim">—</span>')
      + ' <button class="btn sm" data-tags-agent="' + esc(a.agentId) + '" title="edit labels">＋</button>'
    const treas = a.isTreasury ? ' ' + badge('warn', 'treasury') : ''
    const linked = a.linkedTo ? ' <span class="badge b-ok" title="linked to ' + esc(a.linkedTo) + '">🔗</span>' : ''
    return `<tr><td class="center">${active}</td><td><code>${esc(a.agentId)}</code>${treas}${linked}</td>
      <td>${esc(a.chain || '—')}</td><td>${addrLink(a.address, a.chain)}</td>
      <td>${bal}</td><td>${tags}</td>
      <td><button class="btn sm" data-policy-agent="${esc(a.agentId)}" title="set daily limit">⚙ policy</button></td></tr>`
  }).join('')
  return `<table><thead><tr><th></th><th>Agent</th><th>Chain</th><th>Address</th><th>Balance</th><th>Tags</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
}

// ── render tx feed ───────────────────────────────────────────────────────────
function renderTxs() {
  if (!state.recentTxs || state.recentTxs.length === 0) {
    return '<div class="empty">No transactions yet. Start the loop to see live hops.</div>'
  }
  const rows = state.recentTxs.map((t) => {
    const chain = String(t.chainId) === '11155111' ? 'sepolia' : String(t.chainId) === '1' ? 'ethereum' : null
    const b = t.status === 'confirmed' ? badge('ok', '✓ confirmed')
      : t.status === 'reverted' ? badge('err', '✗ reverted')
      : t.status === 'failed' ? badge('err', '! failed')
      : t.status === 'timeout' ? badge('warn', '⏱ timeout') : badge('dim', t.status || '?')
    return `<tr><td>${esc(relAge(t.ts))} ago</td><td><code>${esc(t.src)}</code> → <code>${esc(t.dst)}</code></td>
      <td>${esc(t.amount)} ETH</td><td>${txLink(t.txHash, chain)}</td>
      <td>${b}${t.error ? ' <span class="dim">' + esc(t.error) + '</span>' : ''}</td></tr>`
  }).join('')
  return `<table><thead><tr><th>When</th><th>Hop</th><th>Amount</th><th>Tx</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
}

// ── full render ──────────────────────────────────────────────────────────────
function render() {
  if (!state) return
  // Preserve the details drawer's open state across re-renders (poll re-renders #app, which would
  // otherwise collapse it every 5s). Read the live DOM before we replace it.
  const existingDrawer = document.querySelector('details.section')
  if (existingDrawer) detailsOpen = existingDrawer.open
  const tel = state.telemetryConnected ? badge('ok', 'telemetry live') : badge('warn', 'telemetry off')
  const loopBadge = state.loop.managed.pid !== null
    ? badge('ok', 'loop running (pid ' + state.loop.managed.pid + ')')
    : state.loop.isPauseFilePresent ? badge('warn', 'loop paused')
    : state.loop.state ? badge('dim', 'loop idle') : badge('dim', 'loop not started')

  // Top-right account control — conventional wallet-app placement. Signed in → operator chip
  // (click to change); signed out → "Sign in with WaaP".
  const op = state.operator
  const account = op && op.anchorAgentId
    ? `<button class="account" data-action="open-operator" title="${esc(op.email || op.anchorAddress || '')} — manage operator wallet">
         <span class="acct-dot"></span> ${esc(op.email || op.anchorAgentId)}${op.anchorAddress ? ' · ' + shortAddr(op.anchorAddress) : ''}${state.treasury.balance != null ? ' · ' + state.treasury.balance.toFixed(3) + ' Ξ' : ''}
       </button>
       <button class="btn sm" data-action="operator-signout">Sign out</button>`
    : `<button class="btn primary" data-action="operator-signin">Sign in with WaaP</button>`

  $('#app').innerHTML = `
    <div class="topbar"><h1><code>aex-fleet</code> demo</h1><div class="spacer"></div>${account}</div>
    <div class="statusline">
      ${tel} ${loopBadge}
      <span><span class="pulse"></span> live · 5s</span>
      <span class="dim">${esc(state.configPath)}</span>
    </div>
    ${renderPipeline()}
    <section><h2>Live transaction feed</h2>${renderTxs()}</section>
    <details class="section"${detailsOpen ? ' open' : ''}><summary>Fleet details &amp; bulk controls</summary>
      <div class="detail-controls">
        <button class="btn sm" data-action="open-fleet-policy">⚙ Set policy by tag</button>
        <button class="btn sm" data-action="export">⬇ Export manifest</button>
        <span class="dim">${state.fleetSize} agents · ${state.agentsWithErc8004Intent} with ERC-8004 intent · ${state.totalErrorsLast24h} errors/24h</span>
      </div>
      ${renderAgents()}
    </details>
    <div class="footer">aex-fleet · <a href="/api/state" target="_blank">/api/state</a></div>`
}

// ── data fetch + poll ─────────────────────────────────────────────────────────
async function refresh() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' })
    state = await res.json()
    render()
  } catch (err) {
    toast('refresh failed: ' + err.message, 'err')
  }
}
function pollLoop() {
  setInterval(() => {
    if (!polling) return
    if (document.hidden) return
    if (document.querySelector('.modal-backdrop.show')) return // don't yank an open modal
    refresh()
  }, 5000)
}

// ── modal helpers ────────────────────────────────────────────────────────────
function openModal(id) { $('#' + id).classList.add('show') }
function closeModal(id) { $('#' + id).classList.remove('show') }
function closeAllModals() { document.querySelectorAll('.modal-backdrop.show').forEach((m) => m.classList.remove('show')) }

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  let json = {}
  try { json = await res.json() } catch (e) { /* ignore */ }
  return { status: res.status, body: json }
}

// ── action handlers ────────────────────────────────────────────────────────────
const actions = {
  async pause() { const r = await postJson('/api/control/pause'); toast(r.body.ok ? '⏸ pausing before next hop' : 'pause failed', r.body.ok ? 'ok' : 'err'); refresh() },
  async resume() { const r = await postJson('/api/control/resume'); toast(r.body.ok ? '▶ resumed' : 'resume failed', r.body.ok ? 'ok' : 'err'); refresh() },
  async 'loop-stop'() { const r = await postJson('/api/loop/stop'); toast(r.body.ok ? '■ loop stopped' : 'stop failed', r.body.ok ? 'ok' : 'err'); refresh() },
  async 'link-all'() {
    const r = await postJson('/api/fleet/link', { all: true })
    if (r.body.ok) toast('🔗 linked ' + r.body.linked + ' agents to your identity (preview — wires to silk#904)')
    else toast('link failed: ' + (r.body.error || 'unknown'), 'err')
    refresh()
  },
  async 'unlink-all'() {
    const r = await postJson('/api/fleet/unlink', { all: true })
    if (r.body.ok) toast('unlinked ' + r.body.unlinked + ' agents')
    else toast('unlink failed: ' + (r.body.error || 'unknown'), 'err')
    refresh()
  },
  'open-create'() { $('#create-error').style.display = 'none'; $('#create-email').value = emailBase(); openModal('create-modal'); setTimeout(() => $('#create-email').focus(), 0) },
  // Operator modal: offers BOTH "Sign in with WaaP" and "designate existing wallet", reachable
  // whether or not an operator is already set (so sign-in is always available via "change").
  'open-operator'() { renderOperatorModal(); openModal('operator-modal') },
  // Real embedded WaaP / Human Wallet sign-in via @silk-wallet/silk-wallet-sdk (social/email,
  // no projectId needed). Lazy-loads the SDK from esm.sh on click (sign-in is inherently online).
  async 'operator-signin'() {
    toast('opening Human Wallet sign-in…')
    try {
      const conn = await connectSilk()
      if (!conn) { toast('sign-in cancelled', 'err'); return }
      if (conn.email) localStorage.setItem('aex.emailBase', conn.email)
      const r = await postJson('/api/operator/connect', { address: conn.address, email: conn.email || undefined })
      if (r.body.ok) { toast('signed in — operator: ' + conn.address.slice(0, 6) + '…' + conn.address.slice(-4) + (conn.email ? ' (' + conn.email + ')' : '')); closeAllModals(); await refresh() }
      else toast('connect failed: ' + (r.body.error || 'unknown'), 'err')
    } catch (err) {
      toast('sign-in failed: ' + (err && err.message ? err.message : err), 'err')
    }
  },
  async 'operator-signout'() {
    try { const s = await ensureSilk(); if (s && typeof s.logout === 'function') await s.logout() } catch (e) { /* SDK may not be loaded — fine */ }
    const r = await postJson('/api/operator/disconnect')
    if (r.body.ok) toast('signed out'); else toast('sign-out failed', 'err')
    refresh()
  },
  'open-fund'() { forcePicker = false; renderFundModal(); openModal('fund-modal') },
  async 'set-treasury'() {
    const sel = $('#treasury-pick'); if (!sel) return
    const agentId = sel.value
    const r = await postJson('/api/treasury/set', { agentId })
    if (r.body.ok) { toast('treasury set: ' + agentId); forcePicker = false; await refresh(); renderFundModal() }
    else toast('failed: ' + (r.body.error || 'unknown'), 'err')
  },
  'change-treasury'() {
    // Show the picker again without clearing server state — /api/treasury/set untags the old
    // one when a new one is chosen, so no separate clear step is needed.
    forcePicker = true; renderFundModal()
  },
  'open-run'() { $('#run-error').style.display = 'none'; $('#run-email').value = emailBase(); openModal('run-modal'); setTimeout(() => $('#run-email').focus(), 0) },
  'open-fleet-policy'() { $('#fleet-error').style.display = 'none'; buildTagOptions(); openModal('fleet-modal') },
  async export() {
    const res = await fetch('/api/state', { cache: 'no-store' })
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'aex-fleet-manifest.json'
    a.click()
    toast('manifest downloaded')
  }
}

// ── delegated click handling (survives re-render) ──────────────────────────────
document.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('[data-copy]')
  if (copyBtn) {
    try { await navigator.clipboard.writeText(copyBtn.dataset.copy); copyBtn.classList.add('copied'); toast('copied: ' + copyBtn.dataset.copy); setTimeout(() => copyBtn.classList.remove('copied'), 900) }
    catch (err) { toast('copy failed', 'err') }
    return
  }
  const polBtn = e.target.closest('[data-policy-agent]')
  if (polBtn) { openPolicyModal(polBtn.dataset.policyAgent); return }
  const tagBtn = e.target.closest('[data-tags-agent]')
  if (tagBtn) { openTagsModal(tagBtn.dataset.tagsAgent); return }
  const rmTag = e.target.closest('[data-remove-tag]')
  if (rmTag) { removeTag(rmTag.dataset.removeTag); return }
  // Close on the X/Cancel button, or on a backdrop click — but ONLY if the press STARTED on the
  // backdrop. Without the mousedown-origin check, interacting with a native <select> (whose
  // option list overlays the backdrop) would register a stray backdrop click and close the modal
  // the instant you picked an option. That was the "dropdown closes too quickly" bug.
  if (e.target.matches('[data-modal-close]')) { closeAllModals(); return }
  if (e.target.classList.contains('modal-backdrop') && mousedownTarget === e.target) { closeAllModals(); return }
  const actBtn = e.target.closest('[data-action]')
  if (actBtn && actions[actBtn.dataset.action]) { actBtn.disabled = true; try { await actions[actBtn.dataset.action]() } finally { actBtn.disabled = false } }
})
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals() })
// Track where a press started so backdrop-click-to-close only fires for presses that began on
// the backdrop itself (not a drag/release out of a <select> or input).
let mousedownTarget = null
document.addEventListener('mousedown', (e) => { mousedownTarget = e.target })

// ── per-agent policy modal ──────────────────────────────────────────────────────
let policyAgent = null
function openPolicyModal(agentId) {
  policyAgent = agentId
  $('#policy-agent-label').textContent = agentId
  $('#policy-limit').value = ''
  $('#policy-error').style.display = 'none'
  openModal('policy-modal')
  setTimeout(() => $('#policy-limit').focus(), 0)
}
function wirePolicyApply() {
  const btn = $('#policy-apply')
  btn.addEventListener('click', () => {
    const v = $('#policy-limit').value.trim()
    if (!isPosNum(v)) { showFieldErr('policy-error', 'enter a positive number'); return }
    withBusy(btn, 'Applying…', async () => {
      const r = await postJson('/api/agents/' + encodeURIComponent(policyAgent) + '/policy', { dailyLimit: v })
      if (r.body.ok) { toast('policy set: ' + policyAgent + ' → $' + v + '/day'); closeModal('policy-modal'); refresh() }
      else showFieldErr('policy-error', r.body.error || 'failed')
    })
  })
}

// ── create modal ──────────────────────────────────────────────────────────────
function wireCreate() {
  $('#create-apply').addEventListener('click', async () => {
    const email = $('#create-email').value.trim()
    const count = Number($('#create-count').value || 3)
    if (!email.includes('@')) { showFieldErr('create-error', 'EMAIL_BASE must be an email'); return }
    localStorage.setItem('aex.emailBase', email)
    closeModal('create-modal')
    toast('creating ' + count + ' agents… (signup can take ~30s each)')
    const r = await postJson('/api/agents/create', { emailBase: email, count })
    if (r.body.ok) {
      // Auto-enroll the new agents under the operator identity (the "linked from birth" model),
      // if an operator anchor is set. Prototype link — wires to silk#904.
      if (state.operator && state.operator.anchorAddress) {
        const lr = await postJson('/api/fleet/link', { all: true })
        toast('created ' + (r.body.created ?? count) + ' agents' + (lr.body.ok ? ' · enrolled under your identity' : ''))
      } else {
        toast('created ' + (r.body.created ?? count) + ' agents')
      }
    } else toast('create failed: ' + (r.body.error || 'unknown'), 'err')
    refresh()
  })
}

// ── fund modal (treasury sweep or guided) ────────────────────────────────────────
function renderFundModal() {
  const t = state.treasury
  const d = demoAgents()
  const body = $('#fund-body')
  const treasuryReady = t && t.exists && (t.balance ?? 0) > 0

  if (treasuryReady && !forcePicker) {
    // Funding source is set + funded. If it's a browser-signed Human Wallet (no CLI session),
    // funding happens client-side via window.silk (real signed txs, opens the WaaP signing UX).
    // Otherwise the server sweeps via waap-cli.
    fundBrowserMode = !t.hasSession
    const via = fundBrowserMode
      ? 'Browser-signed Human Wallet — each transfer is signed in your WaaP wallet.'
      : 'Server-signed via waap-cli.'
    body.innerHTML = `<p>Funding source: <code>${esc(t.agentId)}</code> — holds <strong>${(t.balance ?? 0).toFixed(4)} ETH</strong>.
      <button class="btn sm" data-action="change-treasury">change</button></p>
      <p class="dim">${esc(via)}</p>
      <div class="field"><label>Amount to send each agent (ETH)</label><input id="fund-amount" type="text" value="0.05" /></div>
      <p class="dim">${d.length} recipient${d.length === 1 ? '' : 's'} · total ≈ ${(0.05 * d.length).toFixed(3)} ETH</p>
      <div class="err" id="fund-error"></div>`
    return
  }
  fundBrowserMode = false

  // No usable treasury yet. Let the operator PICK any existing agent as the funding source
  // (no terminal, no tags) — the one with the most ETH is the obvious choice and we hint it.
  const candidates = state.agents.filter((a) => (a.telemetry.lastBalance ?? 0) > 0)
  const opts = state.agents.map((a) => {
    const bal = (a.telemetry.lastBalance ?? 0).toFixed(4)
    return '<option value="' + esc(a.agentId) + '">' + esc(a.agentId) + ' — ' + bal + ' ETH</option>'
  }).join('')
  const faucetRows = d.map((a) => '<tr><td><code>' + esc(a.agentId) + '</code></td><td>' + addrLink(a.address, a.chain) + '</td><td>' + ((a.telemetry.lastBalance ?? 0).toFixed(4)) + ' ETH</td></tr>').join('')

  body.innerHTML = `
    <p><strong>Pick which wallet funds the others</strong> — it just needs Sepolia ETH. This is your "treasury".</p>
    <div class="field"><label>Funding source</label>
      <select id="treasury-pick">${opts}</select></div>
    <div class="actions" style="justify-content:flex-start;margin:8px 0 16px;">
      <button class="btn primary" data-action="set-treasury">Use this wallet as treasury</button></div>
    ${candidates.length === 0 ? '<p class="dim">None of your wallets have ETH yet — fund one from a faucet first (below), then pick it.</p>' : ''}
    <details><summary class="dim" style="cursor:pointer;">…or fund agents directly from a faucet</summary>
      <p><a href="https://sepolia-faucet.pk910.de" target="_blank">pk910 PoW faucet</a> · <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank">Alchemy</a> — balances refresh automatically.</p>
      <table><thead><tr><th>Agent</th><th>Address</th><th>Balance</th></tr></thead><tbody>${faucetRows}</tbody></table>
    </details>
    <div class="err" id="fund-error"></div>`
}
function wireFundApply() {
  $('#fund-apply').addEventListener('click', async () => {
    const amtEl = $('#fund-amount')
    if (!amtEl) { closeModal('fund-modal'); return } // guided mode, nothing to apply
    const amount = amtEl.value.trim()
    if (!isPosNum(amount)) { showFieldErr('fund-error', 'enter a positive number'); return }
    if (fundBrowserMode) {
      // Operator is a browser-signed Human Wallet → fund client-side with real signed txs.
      // Renders an intermediate per-transfer screen between the signature popups.
      const btn = $('#fund-apply')
      await withBusy(btn, 'Funding…', async () => {
        try {
          const res = await browserFund(amount, (steps, headline) => renderFundSteps(steps, headline))
          const err = $('#fund-error')
          if (res.fatal) { if (err) { err.style.display = 'block'; err.style.color = 'var(--err)'; err.textContent = res.fatal } }
          else if (res.ok) { toast('funded ' + res.results.length + ' agents from your wallet'); setTimeout(() => closeModal('fund-modal'), 1200); refresh() }
          else if (res.insufficient && err) {
            err.style.display = 'block'; err.style.color = 'var(--err)'
            const addr = res.from || (state.operator && state.operator.anchorAddress) || ''
            err.innerHTML = 'Your operator wallet has no Sepolia ETH to send.<br>Fund <strong>it</strong> first: <code>' + esc(addr) + '</code> <a href="https://sepolia-faucet.pk910.de" target="_blank">faucet ↗</a><br><span class="dim">(it is the source — it needs ETH before it can fund the agents)</span>'
            refresh()
          } else if (err) {
            err.style.display = 'block'; err.style.color = 'var(--err)'
            const failed = res.results.filter((r) => !r.ok)
            err.innerHTML = failed.length + '/' + res.results.length + ' failed:<br>' + failed.map((f) => '• ' + f.id + ': ' + esc(f.error)).join('<br>')
            refresh()
          }
        } catch (e) {
          const err = $('#fund-error'); if (err) { err.style.display = 'block'; err.style.color = 'var(--err)'; err.textContent = 'browser fund failed: ' + (e && e.message ? e.message : e) }
        }
      })
      return
    }
    closeModal('fund-modal')
    toast('funding from treasury… (waits for receipts)')
    const r = await postJson('/api/fund', { amount })
    if (r.body.ok) toast('funded ' + (r.body.total - (r.body.failed || 0)) + '/' + r.body.total + ' agents')
    else toast('fund: ' + (r.body.failed || '?') + ' failed', 'err')
    refresh()
  })
}

// ── run modal ──────────────────────────────────────────────────────────────────
function wireRun() {
  $('#run-apply').addEventListener('click', async () => {
    const email = $('#run-email').value.trim()
    if (!email.includes('@')) { showFieldErr('run-error', 'EMAIL_BASE must be an email'); return }
    localStorage.setItem('aex.emailBase', email)
    const payload = { emailBase: email }
    const delay = $('#run-delay').value.trim(); if (delay) payload.delay = Number(delay)
    const amount = $('#run-amount').value.trim(); if (amount) payload.amount = amount
    const r = await postJson('/api/loop/start', payload)
    if (r.body.ok) { toast('▶ loop started (pid ' + r.body.pid + ')'); closeModal('run-modal'); refresh() }
    else showFieldErr('run-error', r.body.error || 'start failed')
  })
}

// ── fleet policy modal ────────────────────────────────────────────────────────
function buildTagOptions() {
  const sel = $('#fleet-selector')
  sel.innerHTML = '<option value="__all__">All agents (' + state.fleetSize + ')</option>'
    + (state.allTags || []).map((t) => '<option value="' + esc(t) + '">tag: ' + esc(t) + '</option>').join('')
}
function wireFleetApply() {
  const fbtn = $('#fleet-apply')
  fbtn.addEventListener('click', () => withBusy(fbtn, 'Applying…', async () => {
    const v = $('#fleet-limit').value.trim()
    if (!isPosNum(v)) { showFieldErr('fleet-error', 'enter a positive number'); return }
    const sel = $('#fleet-selector').value
    const payload = sel === '__all__' ? { all: true, dailyLimit: v } : { tag: sel, dailyLimit: v }
    const r = await postJson('/api/fleet/policy', payload)
    if (r.status === 200 || r.status === 207) {
      const failed = r.body.failed || 0, total = r.body.total || 0
      if (failed === 0) {
        toast('policy applied to ' + total + ' agent' + (total === 1 ? '' : 's') + ': $' + v + '/day')
        closeModal('fleet-modal'); refresh()
      } else {
        // Keep the modal open and show WHY each agent failed (with a plain-language hint for
        // the common "registered but never signed up → no wallet session" case).
        const lines = (r.body.results || []).filter((x) => !x.ok).map((x) => {
          const m = (x.message || '').toLowerCase()
          const hint = m.includes('session') || m.includes('login') || m.includes('signup')
            ? 'no wallet yet — sign this agent up first' : (x.message || 'failed')
          return '• ' + x.agentId + ': ' + hint
        }).join('<br>')
        const el = $('#fleet-error')
        el.innerHTML = failed + '/' + total + ' failed:<br>' + lines
        el.style.display = 'block'
        refresh()
      }
    } else showFieldErr('fleet-error', r.body.error || 'failed')
  }))
}

// ── operator modal (sign-in OR designate existing) ───────────────────────────
function renderOperatorModal() {
  const cur = state.operator && state.operator.anchorAgentId
  $('#operator-current').innerHTML = cur
    ? '<p>Current operator: <code>' + esc(cur) + '</code>' + (state.operator.anchorAddress ? ' (' + shortAddr(state.operator.anchorAddress) + ')' : '') + '</p>'
    : '<p class="dim">No operator set yet — sign in, or designate a wallet you already control.</p>'
  const opts = state.agents.map((a) => {
    const bal = (a.telemetry.lastBalance ?? 0).toFixed(4)
    return '<option value="' + esc(a.agentId) + '">' + esc(a.agentId) + ' — ' + bal + ' ETH</option>'
  }).join('')
  $('#operator-pick').innerHTML = opts || '<option disabled>no wallets yet — sign in or create agents first</option>'
  $('#operator-error').style.display = 'none'
}
function wireOperatorSet() {
  $('#operator-set').addEventListener('click', async () => {
    const sel = $('#operator-pick'); if (!sel || !sel.value) { showFieldErr('operator-error', 'no wallet to select'); return }
    const r = await postJson('/api/treasury/set', { agentId: sel.value })
    if (r.body.ok) { toast('operator set: ' + sel.value); closeModal('operator-modal'); refresh() }
    else showFieldErr('operator-error', r.body.error || 'failed')
  })
}

// ── labels / tags modal ──────────────────────────────────────────────────────
let tagsAgent = null
function openTagsModal(agentId) {
  tagsAgent = agentId
  $('#tags-agent-label').textContent = agentId
  $('#tags-input').value = ''
  $('#tags-error').style.display = 'none'
  renderTagsChips()
  openModal('tags-modal')
  setTimeout(() => $('#tags-input').focus(), 0)
}
function renderTagsChips() {
  const a = state.agents.find((x) => x.agentId === tagsAgent)
  const cur = (a && a.tags) || []
  $('#tags-current').innerHTML = cur.length
    ? cur.map((t) => '<span class="tag" style="cursor:pointer" data-remove-tag="' + esc(t) + '" title="remove">' + esc(t) + ' ✕</span>').join(' ')
    : '<span class="dim">none</span>'
}
async function removeTag(tag) {
  const r = await postJson('/api/agents/' + encodeURIComponent(tagsAgent) + '/tags', { remove: [tag] })
  if (r.body.ok) { await refresh(); renderTagsChips(); toast('removed “' + tag + '”') }
  else toast('failed: ' + (r.body.error || 'unknown'), 'err')
}
function wireTagsAdd() {
  $('#tags-add').addEventListener('click', async () => {
    const v = $('#tags-input').value.trim()
    if (!v) { showFieldErr('tags-error', 'enter a label'); return }
    const r = await postJson('/api/agents/' + encodeURIComponent(tagsAgent) + '/tags', { add: [v] })
    if (r.body.ok) { $('#tags-input').value = ''; $('#tags-error').style.display = 'none'; await refresh(); renderTagsChips(); toast('added “' + v + '”') }
    else showFieldErr('tags-error', r.body.error || 'failed')
  })
}

// ── embedded Human Wallet (Silk) SDK ─────────────────────────────────────────
// Lazy-loaded from esm.sh on first sign-in. @silk-wallet/silk-wallet-sdk is the published WaaP
// web SDK; initSilk() sets window.silk (an EIP-1193 provider). Social/email sign-in needs no
// WalletConnect projectId. Loaded on demand so the rest of the dashboard stays offline-capable.
const SILK_SDK_URL = 'https://esm.sh/@silk-wallet/silk-wallet-sdk@1.0.2'
let silkReady = null
async function ensureSilk() {
  if (window.silk) return window.silk
  if (!silkReady) {
    silkReady = import(/* @vite-ignore */ SILK_SDK_URL).then((mod) => {
      const initSilk = mod.initSilk || (mod.default && mod.default.initSilk)
      if (typeof initSilk !== 'function') throw new Error('initSilk not found in SDK')
      // Theme the hosted Human Wallet to match the dashboard (dark) + brand it. The hosted iframe
      // only honors the SDK's documented style/project options — full CSS theming isn't exposed.
      initSilk({
        project: { name: 'aex-fleet', entryTitle: 'Sign in to aex-fleet' },
        config: { styles: { darkMode: true } }
      })
      if (!window.silk) throw new Error('window.silk not set after initSilk')
      return window.silk
    })
  }
  return silkReady
}

const SEPOLIA_HEX = '0xaa36a7' // 11155111
// Put the wallet on Sepolia SILENTLY and verify it took. The Silk SDK marks
// wallet_switchEthereumChain as UI-less, so this is invisible to the user — they shouldn't have
// to think about chains. We verify via eth_chainId because the tx UI estimates gas on the active
// chain; if the switch hadn't propagated, gas would be estimated on the wrong (unfunded) chain.
async function ensureSepolia(silk) {
  try {
    const cur = await silk.request({ method: 'eth_chainId' })
    if (String(cur).toLowerCase() === SEPOLIA_HEX) return true
  } catch (e) { /* fall through to switch */ }
  try {
    await silk.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_HEX }] })
  } catch (err) {
    try {
      await silk.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: SEPOLIA_HEX, chainName: 'Sepolia',
        nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
        blockExplorerUrls: ['https://sepolia.etherscan.io']
      }] })
      await silk.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_HEX }] })
    } catch (e2) { /* best effort */ }
  }
  // verify (poll briefly — switch may settle async)
  for (let i = 0; i < 5; i++) {
    try { if (String(await silk.request({ method: 'eth_chainId' })).toLowerCase() === SEPOLIA_HEX) return true } catch (e) {}
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

// Open the hosted Human Wallet and return { silk, address }, or null if cancelled. The SDK's
// login() is what actually opens the modal (eth_requestAccounts alone returns empty until you've
// logged in — that was the "no popup / no account" bug). Skip login() if already connected.
async function connectSilk() {
  const silk = await ensureSilk()
  const already = typeof silk.getLoginMethod === 'function' ? silk.getLoginMethod() : null
  if (!already) {
    const res = await silk.login() // opens hosted social/email modal; 'human'|'injected'|'walletconnect'|null
    if (!res) return null
  }
  await ensureSepolia(silk) // put on Sepolia in the background right after sign-in
  const accounts = await silk.request({ method: 'eth_requestAccounts' })
  const address = Array.isArray(accounts) ? accounts[0] : accounts
  if (!address) return null
  // Best-effort: capture the operator's email so it can prefill EMAIL_BASE (create/run).
  let email = null
  try {
    const e = typeof silk.requestEmail === 'function' ? await silk.requestEmail() : null
    email = typeof e === 'string' ? e : (e && e.email) || null
  } catch (err) { /* social logins may not expose email — fine */ }
  return { silk, address, email }
}

// The shared EMAIL_BASE: operator's signed-in email if known, else last-used from localStorage.
function emailBase() {
  return (state && state.operator && state.operator.email) || localStorage.getItem('aex.emailBase') || ''
}

// Browser-side funding: when the operator wallet is browser-signed (no CLI session), the operator
// funds agents with REAL signed txs via window.silk. Sequential eth_sendTransaction; each opens
// the Human Wallet signing UX. valueEth → wei hex.
// Fund agents from the operator's browser-signed Human Wallet. Reports a structured step list
// via onStep(steps, headline) so the modal can render an intermediate screen between each
// signature popup (which agent, amount, ✓/✗, tx link). Chain is put on Sepolia silently.
async function browserFund(amountEth, onStep) {
  const headline = (h) => { if (onStep) onStep(null, h) }
  const conn = await connectSilk()
  if (!conn) return { ok: false, fatal: 'sign-in needed to fund from your wallet' }
  const { silk, address: from } = conn

  headline('Putting your wallet on Sepolia…')
  const onSepolia = await ensureSepolia(silk)
  if (!onSepolia) return { ok: false, fatal: "couldn't switch your wallet to Sepolia automatically" }

  const wei = BigInt(Math.round(Number(amountEth) * 1e18))
  const valueHex = '0x' + wei.toString(16)
  const recipients = demoAgents().filter((a) => a.address && a.address !== from)
  if (recipients.length === 0) return { ok: false, fatal: 'no recipient agents with addresses (and not the operator)' }

  // steps drives the intermediate screen; each recipient is pending → signing → confirmed/failed
  const steps = recipients.map((a) => ({ id: a.agentId, address: a.address, status: 'pending', tx: null, error: null }))
  const paint = (h) => { if (onStep) onStep(steps, h) }
  paint('Sending ' + amountEth + ' ETH to each of ' + recipients.length + ' agents…')

  let insufficient = false
  for (let i = 0; i < recipients.length; i++) {
    const a = recipients[i]
    steps[i].status = 'signing'
    paint('Transfer ' + (i + 1) + ' of ' + recipients.length + ' — confirm in your WaaP wallet')
    try {
      const tx = await silk.request({ method: 'eth_sendTransaction', params: [{ from, to: a.address, value: valueHex }] })
      steps[i].status = 'confirmed'; steps[i].tx = typeof tx === 'string' ? tx : (tx && tx.hash) || null
    } catch (err) {
      const msg = (err && (err.message || err.reason)) || String(err)
      if (/insufficient funds/i.test(msg)) insufficient = true
      steps[i].status = 'failed'; steps[i].error = msg
    }
    paint(i + 1 < recipients.length ? 'Opening next transfer…' : 'Done.')
  }
  const results = steps.map((s) => ({ id: s.id, ok: s.status === 'confirmed', tx: s.tx, error: s.error }))
  return { ok: results.every((r) => r.ok), results, insufficient, from }
}

// Render the intermediate funding screen into the fund modal between signature popups.
function renderFundSteps(steps, headline) {
  const body = $('#fund-body'); if (!body) return
  const rows = (steps || []).map((s) => {
    const icon = s.status === 'confirmed' ? '<span class="badge b-ok">✓</span>'
      : s.status === 'signing' ? '<span class="badge b-warn">signing…</span>'
      : s.status === 'failed' ? '<span class="badge b-err">✗</span>'
      : '<span class="badge b-dim">queued</span>'
    const tx = s.tx ? ' · ' + txLink(s.tx, 'sepolia') : (s.error ? ' · <span class="dim">' + esc(s.error) + '</span>' : '')
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--line)"><code>' + esc(s.id) + '</code> ' + icon + tx + '</div>'
  }).join('')
  body.innerHTML = '<p>' + esc(headline || '') + '</p>' + (rows || '') + '<div class="err" id="fund-error" style="display:none"></div>'
}

// ── shared little helpers ──────────────────────────────────────────────────────
function isPosNum(v) { return /^[0-9]+(\.[0-9]+)?$/.test(v) && Number(v) >= 0 }
function showFieldErr(id, msg) { const el = $('#' + id); el.textContent = msg; el.style.display = 'block' }
// Run an async task with the button in a disabled "busy" state — prevents double-submits and
// shows the action is in flight (the policy-apply "buggy" report was a missing loading state).
async function withBusy(btn, label, fn) {
  if (btn._busy) return // guard re-entry
  btn._busy = true
  const orig = btn.textContent; btn.disabled = true; btn.textContent = label
  try { return await fn() } finally { btn.disabled = false; btn.textContent = orig; btn._busy = false }
}

window.addEventListener('error', (e) => toast('JS error: ' + (e.error?.message || e.message), 'err'))
window.addEventListener('unhandledrejection', (e) => toast('promise: ' + (e.reason?.message || e.reason), 'err'))

// ── boot ──────────────────────────────────────────────────────────────────────
wirePolicyApply(); wireCreate(); wireFundApply(); wireRun(); wireFleetApply(); wireTagsAdd(); wireOperatorSet()
// Instant first paint from the server-injected snapshot (also makes static exports render
// without a live server), then go live.
if (window.__STATE__) { state = window.__STATE__; render() }
refresh(); pollLoop()
