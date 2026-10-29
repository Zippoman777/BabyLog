'use strict'

/* ------------------------------------------------------------------ API */
function getCookie(name) {
  const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)')
  return m ? decodeURIComponent(m[1]) : ''
}
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const method = (opts.method || 'GET').toUpperCase()
  if (method !== 'GET') {
    const csrf = getCookie('csrf_token')
    if (csrf) headers['X-CSRF-Token'] = csrf
  }
  const res = await fetch('/api' + path, { headers, ...opts })
  if (res.status === 401) {
    // session expired or not signed in — go to the login page
    window.location.href = '/login'
    throw new Error('unauthorized')
  }
  if (res.status === 403) throw new Error('forbidden')
  if (res.status === 429) throw new Error('too many requests — slow down')
  if (!res.ok) throw new Error('request failed: ' + res.status)
  return res.json()
}
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) })
const put = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body || {}) })
const del = (p) => api(p, { method: 'DELETE' })

/* ---------------------------------------------------------------- state */
const state = {
  babies: [],
  events: [],
  timers: [],
  activeBabyId: null,
  tab: 'home',
  view: 'day', // calendar
  cursor: new Date(),
  sheet: null, // {type} or {type, editId}
  babyForm: null, // 'add' | 'edit'
  sessionDetail: null, // array of event ids being inspected
  msDetail: null, // milestone id shown on the journey road
  sleepSide: 'back', // position for the next sleep: back | L | R
  statsRange: 7, // days shown in Stats
  mediaView: null, // {id: milestone event id, i: media index} full-screen viewer
  loaded: false,
}

function activeBaby() {
  return state.babies.find((b) => b.id === state.activeBabyId) || state.babies[0] || null
}

let lastSig = ''
async function refresh() {
  const data = await api('/data')
  state.babies = data.babies
  state.events = data.events
  state.timers = data.timers
  if (!state.activeBabyId || !state.babies.find((b) => b.id === state.activeBabyId)) {
    state.activeBabyId = state.babies[0] ? state.babies[0].id : null
  }
  state.loaded = true
  // Only re-render when something actually changed, so an auto-refresh never
  // wipes what the user is currently typing.
  const sig = JSON.stringify(data) + '|' + state.activeBabyId
  if (sig !== lastSig) {
    lastSig = sig
    render()
  }
}

/* -------------------------------------------------------------- helpers */
const pad = (n) => (n < 10 ? '0' + n : '' + n)
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
function fmtDurationShort(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
const fmtTime = (iso) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const dateInputVal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// A date + time pair of inputs; reused by every log sheet so any entry can be
// backdated. Reads back via readDateTime().
const dateTimeFields = (d) => `<div class="row" style="gap:10px">
    <div class="field" style="flex:1.3"><label>Date</label><input id="f-date" type="date" value="${dateInputVal(d)}"></div>
    <div class="field" style="flex:1"><label>Time</label><input id="f-time" type="time" value="${pad(d.getHours())}:${pad(d.getMinutes())}"></div>
  </div>`
// Builds a Date from the sheet's date + time inputs (falls back to today/now).
function readDateTime(fallback) {
  const base = fallback ? new Date(fallback) : new Date()
  const dv = document.getElementById('f-date')
  const tv = document.getElementById('f-time')
  const at = dv && dv.value ? new Date(dv.value + 'T00:00') : base
  if (tv && tv.value) {
    const [h, m] = tv.value.split(':').map(Number)
    at.setHours(h, m, 0, 0)
  }
  return at
}
const fmtDateLong = (d) =>
  d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
const fmtMonth = (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
const dayKey = (iso) => {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function babyAge(birthISO, atMsVal) {
  const birth = new Date(birthISO)
  const ms = (atMsVal == null ? Date.now() : atMsVal) - birth.getTime()
  if (ms < 0) return 'not born yet'
  const days = Math.floor(ms / 86400000)
  if (days < 1) {
    const h = Math.floor(ms / 3600000)
    return h <= 1 ? 'newborn' : `${h} hours old`
  }
  const w = Math.floor(days / 7)
  const rd = days % 7
  const parts = []
  if (w > 0) parts.push(`${w} week${w > 1 ? 's' : ''}`)
  parts.push(`${rd} day${rd === 1 ? '' : 's'}`)
  return parts.join(', ') + ' old'
}
const celsiusFmt = (c) => c.toFixed(1) + '°C'
const kgFmt = (g) => (g / 1000).toFixed(2) + ' kg'
// Length (height) is stored as a plain cm number in the note field.
const lengthCm = (e) => num(e.note)
const cmFmt = (cm) => (Math.round(cm * 10) / 10).toFixed(1) + ' cm'
// Accept both comma and dot as the decimal separator (locale-friendly).
const num = (s) => parseFloat(String(s == null ? '' : s).replace(',', '.'))
const sideLabel = (s) => (s === 'L' ? 'left' : s === 'R' ? 'right' : s === 'back' ? 'back' : s === 'both' ? 'both' : s)
const elapsed = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
// Sort by the real instant, not the ISO string — events are stored in mixed
// formats (UTC "Z" for quick logs, local "+hh:mm" for timers), so text compare
// would order them wrong.
const atMs = (e) => new Date(e.atISO).getTime()
// Sleeps can cross midnight, so per-day totals use the part of each sleep that
// falls inside that day (23:00-02:00 = 1h on day one, 2h on day two).
const sleepEndMs = (e) => (e.endISO ? new Date(e.endISO).getTime() : atMs(e) + (e.durationSec || 0) * 1000)
const overlapSec = (e, fromMs, toMs) => Math.max(0, (Math.min(sleepEndMs(e), toMs) - Math.max(atMs(e), fromMs)) / 1000)
function dayBounds(d) {
  const s0 = startOfDay(d)
  return [s0.getTime(), addDays(s0, 1).getTime()] // next local midnight (DST-safe)
}
const sleepOnDay = (sleeps, d) => {
  const [a, b] = dayBounds(d)
  return Math.round(sleeps.reduce((sum, e) => sum + overlapSec(e, a, b), 0))
}

const ICON = {
  home: '🏠', calendar: '📅', 'chart-bar': '📊', settings: '⚙️', milk: '🤱',
  bottle: '🍼', moon: '🌙', droplet: '💧', poo: '💩', temperature: '🌡️',
  scale: '⚖️', note: '📝', baby: '👶', play: '▶️', stop: '⏹️', list: '📋',
  trash: '🗑️', plus: '➕', database: '💾', left: '‹', right: '›', length: '📏', star: '⭐',
}
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function eventIcon(e) {
  return { breast: '🤱', bottle: '🍼', sleep: '🌙', pee: '💧', poo: '💩', temp: '🌡️', weight: '⚖️', note: '📝', bath: '🛁', med: '💊', length: '📏', milestone: '⭐' }[e.type]
}
// Medicines are stored as hidden 'med_def' events; note = JSON {name, description}.
function medicines() {
  return state.events
    .filter((e) => e.babyId === state.activeBabyId && e.type === 'med_def')
    .map((e) => {
      try {
        const o = JSON.parse(e.note)
        return { id: e.id, name: o.name, description: o.description || '', perDay: Number(o.perDay) || 0 }
      } catch {
        return { id: e.id, name: e.note || '?', description: '', perDay: 0 }
      }
    })
    .sort((a, c) => a.name.localeCompare(c.name))
}
// Milestones: type 'milestone', note = JSON {title, text, media:[{kind:'photo', id}]}.
// Older entries stored a single {photo}; it's read as a one-photo list.
function milestoneData(e) {
  let o
  try {
    o = JSON.parse(e.note)
  } catch {
    return { title: e.note || 'Milestone', text: '', media: [] }
  }
  let media = Array.isArray(o.media) ? o.media.filter((m) => m && m.id && m.kind === 'photo') : []
  if (!media.length && o.photo) media = [{ kind: 'photo', id: o.photo }]
  return { title: o.title || 'Milestone', text: o.text || '', media }
}
const PHOTO_URL = (id) => '/api/photos/' + encodeURIComponent(id)
async function deleteMediaFiles(media) {
  for (const m of media) await del('/photos/' + m.id).catch(() => {})
}
// Medicine name of a logged dose ("Vitamin D · 2 drops" -> "Vitamin D").
const medName = (e) => (e.note || '').split(' · ')[0]

function eventLabel(e) {
  switch (e.type) {
    case 'breast': return `Breastfed ${e.side === 'both' ? 'L+R' : e.side} · ${fmtDurationShort(e.durationSec)}`
    case 'bottle': return `Bottle · ${e.ml} ml`
    case 'sleep': return `Slept · ${fmtDurationShort(e.durationSec)}${e.side ? ' · ' + sideLabel(e.side) : ''}`
    case 'pee': return 'Pee'
    case 'poo': return 'Poo'
    case 'temp': return `Temp · ${celsiusFmt(e.celsius)}`
    case 'weight': return `Weight · ${kgFmt(e.grams)}`
    case 'length': return `Length · ${cmFmt(lengthCm(e))}`
    case 'bath': return 'Bath'
    case 'med': return esc(e.note)
    case 'milestone': return esc(milestoneData(e).title)
    case 'note': return esc(e.note)
  }
}

/* ------------------------------------------------------------ feed timing */
function fmtAgo(ms) {
  const m = Math.floor(ms / 60000)
  if (m < 1) return '<1m'
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}
/* ------------------------------------------------------------ night mode */
// Auto: dim theme from 21:00 to 07:00. Per-device preference (auto|on|off).
function nightPref() {
  try { return localStorage.getItem('babylog-night') || 'auto' } catch { return 'auto' }
}
function nightActive() {
  const p = nightPref()
  if (p === 'on') return true
  if (p === 'off') return false
  const h = new Date().getHours()
  return h >= 21 || h < 7
}
function applyNight() {
  const n = nightActive()
  if (n) document.documentElement.dataset.night = '1'
  else delete document.documentElement.dataset.night
  return n
}

/* ------------------------------------------------------------ mutations */
const getTimer = (kind) => state.timers.find((t) => t.kind === kind && t.babyId === state.activeBabyId)

async function toggleTimer(kind) {
  const babyId = state.activeBabyId
  if (getTimer(kind)) {
    await post('/timers/stop', kind === 'sleep' ? { babyId, kind, side: state.sleepSide } : { babyId, kind })
  } else {
    // A baby can't feed on both breasts at once: starting one side stops
    // (and logs) the other if it was running.
    if (kind === 'breast-L' && getTimer('breast-R')) await post('/timers/stop', { babyId, kind: 'breast-R' })
    if (kind === 'breast-R' && getTimer('breast-L')) await post('/timers/stop', { babyId, kind: 'breast-L' })
    await post('/timers/start', { babyId, kind })
  }
  await refresh()
}
async function cancelTimer(kind) {
  await post('/timers/cancel', { babyId: state.activeBabyId, kind })
  await refresh()
}
async function deleteEvent(id) {
  const e = state.events.find((x) => x.id === id)
  if (e && e.type === 'milestone') await deleteMediaFiles(milestoneData(e).media)
  await del('/events/' + id)
  await refresh()
}

/* -------------------------------------------------------------- rendering */
const root = () => document.getElementById('root')

function render() {
  const b = activeBaby()
  document.documentElement.dataset.theme = b ? b.sex : 'girl'
  const meta = document.querySelector('meta[name="theme-color"]')
  const night = applyNight()
  if (meta) meta.setAttribute('content', night ? '#1A1416' : b && b.sex === 'boy' ? '#E6F1FB' : '#FBEAF0')

  if (!state.loaded) {
    root().innerHTML = `<div class="center-screen"><p>Loading…</p></div>`
    return
  }
  if (!b) {
    root().innerHTML = onboardingHTML()
    return
  }

  // Keep the session-detail overlay in sync; close it once its entries are gone.
  if (state.sessionDetail) {
    const alive = state.sessionDetail.filter((id) => state.events.some((e) => e.id === id))
    state.sessionDetail = alive.length ? alive : null
  }

  let screen = ''
  if (state.tab === 'home') screen = homeHTML(b)
  else if (state.tab === 'calendar') screen = calendarHTML(b)
  else if (state.tab === 'stats') screen = statsHTML(b)
  else if (state.tab === 'milestones') screen = milestonesHTML(b)
  else if (state.tab === 'settings') screen = settingsHTML(b)

  const switcher =
    state.babies.length > 1
      ? `<div class="screen" style="padding-bottom:0;flex:none"><div class="baby-switcher">${state.babies
          .map(
            (x) =>
              `<button class="baby-pill ${x.id === b.id ? 'on' : ''}" data-action="switch" data-id="${x.id}">${esc(x.name)}</button>`
          )
          .join('')}</div></div>`
      : ''

  root().innerHTML = `<div class="app">${switcher}${screen}
    <nav class="nav">
      ${navBtn('home', 'home', 'Home')}
      ${navBtn('calendar', 'calendar', 'Calendar')}
      ${navBtn('chart-bar', 'stats', 'Stats')}
      ${navBtn('star', 'milestones', 'Moments')}
      ${navBtn('settings', 'settings', 'Baby')}
    </nav>
  </div>${state.sheet ? sheetHTML(state.sheet) : ''}${state.babyForm ? babyFormOverlay() : ''}${state.sessionDetail ? sessionDetailHTML() : ''}${state.msDetail ? msDetailHTML() : ''}${
    state.mediaView ? mediaViewerHTML() : ''
  }`
}

function sessionDetailHTML() {
  const events = state.sessionDetail
    .map((id) => state.events.find((e) => e.id === id))
    .filter(Boolean)
    .sort((a, c) => atMs(a) - atMs(c))
  return `<div class="overlay" data-action="close-detail"><div class="sheet" data-stop="1">
    <h3>Entries</h3>
    <div>${events
      .map(
        (e) => `<div class="logrow">
        <div><span style="margin-right:8px">${eventIcon(e)}</span>${eventLabel(e)}<div class="meta">${fmtTime(e.atISO)}</div></div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn ghost small" data-action="edit-event" data-id="${e.id}">Edit</button>
          <button class="del" data-action="del-event" data-id="${e.id}" aria-label="Delete">${ICON.trash}</button>
        </div>
      </div>`
      )
      .join('')}</div>
    <div class="sheet-actions"><button class="btn" data-action="close-detail">Close</button></div>
  </div></div>`
}

const navBtn = (icon, tab, label) =>
  `<button class="${state.tab === tab ? 'active' : ''}" data-action="tab" data-tab="${tab}"><span>${ICON[icon]}</span>${label}</button>`

/* ---- onboarding ---- */
function onboardingHTML() {
  return `<div class="app"><div class="center-screen">
    <div style="font-size:48px;margin-bottom:8px">${ICON.baby}</div>
    <h1>Welcome to BabyLog</h1>
    <p>Add your baby to start tracking feeds, sleep and more.</p>
    <div style="width:100%;max-width:360px;text-align:left">${babyFormFields()}</div>
  </div></div>`
}

/* ---- home ---- */
function homeHTML(b) {
  const tL = getTimer('breast-L'), tR = getTimer('breast-R'), tS = getTimer('sleep')
  const today = dayKey(new Date())
  const todays = state.events
    .filter((e) => e.babyId === b.id && e.type !== 'med_def' && dayKey(e.atISO) === today)
    .sort((a, c) => atMs(c) - atMs(a)) // latest first

  // Most recent breastfeed, to show + highlight the last-used side.
  const lastBreast = state.events
    .filter((e) => e.babyId === b.id && e.type === 'breast')
    .sort((a, c) => atMs(c) - atMs(a))[0]
  const lastSideMatches = (kind) =>
    lastBreast && (lastBreast.side === 'both' || lastBreast.side === (kind === 'breast-L' ? 'L' : 'R'))

  const timerTile = (kind, label, t) => `
    <button class="tile timer-tile ${t ? 'running' : ''} ${!t && lastSideMatches(kind) ? 'last-used' : ''}" data-action="toggle" data-kind="${kind}">
      ${!t && lastSideMatches(kind) ? '<span class="badge-last">last used</span>' : ''}
      <p class="label">${label}</p>
      <p class="value js-elapsed" ${t ? `data-start="${t.startISO}"` : ''}>${fmtDuration(t ? elapsed(t.startISO) : 0)}</p>
      <p class="hint">${t ? ICON.stop + ' tap to stop' : ICON.play + ' tap to start'}</p>
    </button>`

  const lastBreastLine = lastBreast
    ? `<p style="margin:8px 0 0;font-size:12px;color:var(--text-dim)">Last feed: ${sideLabel(lastBreast.side)} at ${fmtTime(lastBreast.atISO)} · <b class="js-since" data-since="${lastBreast.atISO}">${fmtAgo(Date.now() - atMs(lastBreast))}</b> ago</p>`
    : ''

  // Most recent sleep, to show the last sleeping position.
  const lastSleep = state.events
    .filter((e) => e.babyId === b.id && e.type === 'sleep')
    .sort((a, c) => atMs(c) - atMs(a))[0]
  // Woke = end of the last sleep; hidden while a sleep timer is running.
  let lastSleepLine = ''
  if (lastSleep && !tS) {
    const wokeISO = lastSleep.endISO || new Date(atMs(lastSleep) + (lastSleep.durationSec || 0) * 1000).toISOString()
    lastSleepLine = `<p style="margin:8px 0 0;font-size:12px;color:var(--text-dim)">Last slept: ${lastSleep.side ? sideLabel(lastSleep.side) + ' ' : ''}at ${fmtTime(lastSleep.atISO)} · woke ${fmtTime(wokeISO)} · awake <b class="js-since" data-since="${wokeISO}">${fmtAgo(Date.now() - new Date(wokeISO).getTime())}</b></p>`
  }

  const sideBtn = (val, txt) =>
    `<button data-action="sleep-side" data-side="${val}" class="${state.sleepSide === val ? 'on' : ''}">${txt}</button>`

  const quick = (type, icon, label) =>
    `<button class="quick" data-action="sheet" data-type="${type}"><span>${ICON[icon]}</span>${label}</button>`

  // Last weight + bath reminder (bath every 3 days, anchored to the last bath;
  // if none logged yet it's due today).
  const lastWeight = state.events
    .filter((e) => e.babyId === b.id && e.type === 'weight')
    .sort((a, c) => atMs(c) - atMs(a))[0]
  const lastLength = state.events
    .filter((e) => e.babyId === b.id && e.type === 'length')
    .sort((a, c) => atMs(c) - atMs(a))[0]
  const diaperRow = (type, label) => {
    const last = state.events.filter((e) => e.babyId === b.id && e.type === type).sort((a, c) => atMs(c) - atMs(a))[0]
    const n = todays.filter((e) => e.type === type).length
    return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
      <span>${label}</span>
      <span style="font-weight:600">${
        last ? `<span class="js-since" data-since="${last.atISO}">${fmtAgo(Date.now() - atMs(last))}</span> ago · ${n} today` : '—'
      }</span>
    </div>`
  }
  const lastBath = state.events
    .filter((e) => e.babyId === b.id && e.type === 'bath')
    .sort((a, c) => atMs(c) - atMs(a))[0]
  let bathDue, bathText
  if (lastBath) {
    const next = addDays(startOfDay(new Date(lastBath.atISO)), 3)
    bathDue = startOfDay(new Date()).getTime() >= next.getTime()
    bathText = bathDue ? 'Bath due today' : 'Next bath ' + next.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } else {
    bathDue = true
    bathText = 'Bath due today'
  }
  const infoCard = `<div class="tile" style="margin-bottom:14px;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
      <span>${ICON.scale} Last weight</span>
      <span style="font-weight:600">${lastWeight ? kgFmt(lastWeight.grams) + ' · ' + new Date(lastWeight.atISO).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</span>
    </div>
    ${diaperRow('pee', ICON.droplet + ' Last pee')}
    ${diaperRow('poo', ICON.poo + ' Last poo')}
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
      <span>${ICON.length} Last length</span>
      <span style="font-weight:600">${lastLength ? cmFmt(lengthCm(lastLength)) + ' · ' + new Date(lastLength.atISO).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
      <span class="${bathDue ? 'bath-due' : ''}">🛁 ${bathText}</span>
      <button class="btn small ${bathDue ? '' : 'ghost'}" data-action="log-bath">Bath done</button>
    </div>
  </div>`

  // Scheduled medicines: today's doses vs times-per-day, with one-tap Give.
  const sched = medicines().filter((m) => m.perDay > 0)
  const medCard = sched.length
    ? `<div class="tile" style="margin-bottom:14px">
      <p class="feed-lbl">💊 Today's medicine</p>
      ${sched
        .map((m) => {
          const n = todays.filter((e) => e.type === 'med' && medName(e) === m.name).length
          const done = n >= m.perDay
          return `<div class="med-row">
            <span>${esc(m.name)} <span class="meta" style="display:inline">${n}/${m.perDay}</span></span>
            ${done ? '<span>✅</span>' : `<button class="btn small" data-action="give-med" data-name="${esc(m.name)}">Give</button>`}
          </div>`
        })
        .join('')}
    </div>`
    : ''

  return `<div class="screen">
    <div class="hdr">
      <div><p class="name">${esc(b.name)}</p><p class="age">${babyAge(b.birthISO)}</p></div>
      <div class="avatar">${ICON.baby}</div>
    </div>

    ${medCard}
    ${infoCard}

    <p class="section-label">${ICON.milk} Breastfeeding</p>
    <div class="row">${timerTile('breast-L', 'Left', tL)}${timerTile('breast-R', 'Right', tR)}</div>
    ${lastBreastLine}

    <div class="tile" style="margin-top:14px">
      <div class="sleep-tile" style="margin-top:0">
        <div>
          <p class="label" style="margin:0;font-size:13px">${ICON.moon} Sleep</p>
          <p class="value js-elapsed" ${tS ? `data-start="${tS.startISO}"` : ''}>${fmtDuration(tS ? elapsed(tS.startISO) : 0)}</p>
        </div>
        <div style="display:flex;gap:8px">
          ${tS ? `<button class="btn ghost small" data-action="cancel-sleep">Cancel</button>` : ''}
          <button class="btn small" data-action="toggle" data-kind="sleep">${tS ? 'Stop' : 'Start'}</button>
        </div>
      </div>
      <p class="label" style="margin:12px 0 6px;font-size:12px">Sleeping position</p>
      <div class="seg-pick">${sideBtn('back', 'On back')}${sideBtn('L', 'Left')}${sideBtn('R', 'Right')}</div>
      ${lastSleepLine}
    </div>

    <button class="btn block" data-action="sheet" data-type="checkin" style="margin:14px 0"><span>📋</span> Quick check-in</button>

    <div class="quick-row" style="margin-top:0">${quick('bottle', 'bottle', 'Bottle')}${quick('pee', 'droplet', 'Pee')}${quick('poo', 'poo', 'Poo')}</div>
    <div class="quick-row" style="margin-top:0">${quick('temp', 'temperature', 'Temp')}${quick('weight', 'scale', 'Weight')}${quick('length', 'length', 'Length')}${quick('note', 'note', 'Note')}</div>
    <button class="btn block" data-action="sheet" data-type="med" style="margin-top:12px">💊 Medicine</button>

    <p class="section-label" style="margin-top:8px">${ICON.list} Today's log</p>
    ${
      todays.length === 0
        ? `<p class="empty">Nothing logged yet today.</p>`
        : `<div class="tile" style="padding:4px 14px">${todays
            .map(
              (e) => `<div class="logrow">
        <div><div><span style="margin-right:8px">${eventIcon(e)}</span>${eventLabel(e)}</div>
        <div class="meta">${fmtTime(e.atISO)}</div></div>
        <button class="del" data-action="del-event" data-id="${e.id}" aria-label="Delete">${ICON.trash}</button>
      </div>`
            )
            .join('')}</div>`
    }
  </div>`
}

/* ---- calendar ---- */
function calendarHTML(b) {
  const events = state.events.filter((e) => e.babyId === b.id)
  const body = state.view === 'month' ? monthGridHTML(events) : dayTableHTML(events)
  return `<div class="screen">
    <div class="seg">
      <button class="${state.view === 'month' ? 'active' : ''}" data-action="view" data-view="month">Month</button>
      <button class="${state.view === 'day' ? 'active' : ''}" data-action="view" data-view="day">Day</button>
    </div>
    <div class="cal-hdr">
      <button class="cal-nav" data-action="cal-prev">${ICON.left}</button>
      <span class="title">${state.view === 'month' ? fmtMonth(state.cursor) : fmtDateLong(state.cursor)}</span>
      <button class="cal-nav" data-action="cal-next">${ICON.right}</button>
    </div>
    ${body}
  </div>`
}

function monthGridHTML(events) {
  const withData = new Set(events.map((e) => dayKey(e.atISO)))
  const c = state.cursor
  const first = new Date(c.getFullYear(), c.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const gridStart = addDays(first, -offset)
  const todayKey = dayKey(new Date())
  const dows = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="dow">${d}</div>`).join('')
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = addDays(gridStart, i)
    const inMonth = d.getMonth() === c.getMonth()
    const k = dayKey(d)
    return `<div class="cell ${inMonth ? '' : 'other'} ${k === todayKey ? 'today' : ''}" data-action="pick-day" data-date="${d.toISOString()}">
      <span>${d.getDate()}</span>${withData.has(k) ? '<span class="dot"></span>' : ''}</div>`
  }).join('')
  return `<div class="grid7">${dows}${cells}</div>`
}

function dayTableHTML(events) {
  const k = dayKey(state.cursor)
  const evs = events
    .filter((e) => e.type !== 'med_def' && dayKey(e.atISO) === k)
    .sort((a, c) => atMs(a) - atMs(c))
  const allSleeps = events.filter((e) => e.type === 'sleep')
  const [dayStart] = dayBounds(state.cursor)
  const carried = allSleeps
    .filter((e) => atMs(e) < dayStart && sleepEndMs(e) > dayStart)
    .sort((a, c) => atMs(a) - atMs(c))
  if (evs.length === 0 && carried.length === 0) return `<p class="empty">No entries for this day.</p>`

  let feeds = 0, pee = 0, poo = 0
  const sleepSec = sleepOnDay(allSleeps, state.cursor)
  evs.forEach((e) => {
    if (e.type === 'breast' || e.type === 'bottle') feeds++
    if (e.type === 'pee') pee++
    if (e.type === 'poo') poo++
  })

  // Build sessions: a sleep is its own card; other events cluster into a
  // "session" while gaps stay under 45 min. A quiet stretch starts a new one.
  const GAP = 45 * 60 * 1000
  const sessions = carried.map((e) => ({
    kind: 'sleep', carry: true, label: 'Sleep', events: [e], start: e.atISO, end: e.endISO || e.atISO,
    onDaySec: Math.round(overlapSec(e, dayStart, Infinity)),
  }))
  let cur = null
  let careCount = 0
  for (const e of evs) {
    if (e.type === 'sleep') {
      cur = null
      sessions.push({ kind: 'sleep', label: 'Sleep', events: [e], start: e.atISO, end: e.endISO || e.atISO })
      continue
    }
    const t = new Date(e.atISO).getTime()
    if (cur && t - new Date(cur.end).getTime() <= GAP) {
      cur.events.push(e)
      cur.end = e.atISO
    } else {
      careCount++
      cur = { kind: 'care', label: 'Session ' + careCount, events: [e], start: e.atISO, end: e.atISO }
      sessions.push(cur)
    }
  }

  const cards = sessions.map(sessionCardHTML).join('')

  return `${cards}
    <div class="chips">
      <div class="chip">Feeds<b>${feeds}</b></div>
      <div class="chip">Sleep<b>${fmtDurationShort(sleepSec)}</b></div>
      <div class="chip">Pee · Poo<b>${pee} · ${poo}</b></div>
    </div>
    <p class="empty" style="padding:10px 0 0;font-size:11px">Tap a card to view, edit or delete its entries.</p>`
}

function sessionCardHTML(s) {
  const ids = s.events.map((e) => e.id).join(',')
  const range = (a, b) => (a === b ? fmtTime(a) : `${fmtTime(a)} – ${fmtTime(b)}`)

  if (s.kind === 'sleep') {
    const e = s.events[0]
    const body = s.carry
      ? `${fmtDurationShort(s.onDaySec)} after midnight · ${fmtDurationShort(e.durationSec)} total${e.side ? ' · ' + sideLabel(e.side) : ''}`
      : `Slept ${fmtDurationShort(e.durationSec)}${e.side ? ' · ' + sideLabel(e.side) : ''}`
    return `<div class="session" data-action="open-session" data-ids="${ids}">
      <div class="session-hd"><span>🌙 ${range(e.atISO, e.endISO || e.atISO)}</span><span>${s.carry ? 'Sleep · from yesterday' : 'Sleep'}</span></div>
      <div class="session-body"><div class="session-line">${body}</div></div>
    </div>`
  }

  const evs = s.events
  const lines = []
  const breasts = evs.filter((e) => e.type === 'breast')
  if (breasts.length)
    lines.push(`🤱 Breast · ${breasts.map((e) => `${e.side === 'both' ? 'L+R' : e.side} ${fmtDurationShort(e.durationSec)}`).join(' + ')}`)
  const bottles = evs.filter((e) => e.type === 'bottle')
  if (bottles.length) lines.push(`🍼 Bottle · ${bottles.reduce((sum, e) => sum + e.ml, 0)} ml`)
  const peeN = evs.filter((e) => e.type === 'pee').length
  const pooN = evs.filter((e) => e.type === 'poo').length
  const temp = evs.filter((e) => e.type === 'temp').slice(-1)[0]
  const dv = []
  if (peeN) dv.push(`💧 Pee${peeN > 1 ? ' ×' + peeN : ''}`)
  if (pooN) dv.push(`💩 Poo${pooN > 1 ? ' ×' + pooN : ''}`)
  if (temp) dv.push(`🌡️ ${celsiusFmt(temp.celsius)}`)
  if (dv.length) lines.push(dv.join('&nbsp;&nbsp;'))
  const weight = evs.filter((e) => e.type === 'weight').slice(-1)[0]
  if (weight) lines.push(`⚖️ ${kgFmt(weight.grams)}`)
  if (evs.some((e) => e.type === 'bath')) lines.push('🛁 Bath')
  evs.filter((e) => e.type === 'med').forEach((e) => lines.push(`💊 ${esc(e.note)}`))
  evs.filter((e) => e.type === 'note').forEach((e) => lines.push(`📝 ${esc(e.note)}`))
  evs.filter((e) => e.type === 'milestone').forEach((e) => lines.push(`⭐ ${esc(milestoneData(e).title)}`))

  return `<div class="session" data-action="open-session" data-ids="${ids}">
    <div class="session-hd"><span>🕘 ${range(s.start, s.end)}</span><span>${s.label}</span></div>
    <div class="session-body">${lines.map((l) => `<div class="session-line">${l}</div>`).join('')}</div>
  </div>`
}

/* ---- stats ---- */
function statsHTML(b) {
  const all = state.events.filter((e) => e.babyId === b.id)
  const N = state.statsRange
  const days = Array.from({ length: N }, (_, i) => addDays(new Date(), -(N - 1 - i)))
  const dayKeys = new Set(days.map(dayKey))
  const win = all.filter((e) => dayKeys.has(dayKey(e.atISO)))

  const allSleeps = all.filter((e) => e.type === 'sleep')
  const perDay = days.map((d) => {
    const k = dayKey(d)
    const evs = win.filter((e) => dayKey(e.atISO) === k)
    return {
      d,
      feeds: evs.filter((e) => e.type === 'breast' || e.type === 'bottle').length,
      sleepSec: sleepOnDay(allSleeps, d),
    }
  })
  const activeDays = perDay.filter((p) => p.feeds > 0 || p.sleepSec > 0).length || 1

  // feeding
  const feedsAll = win.filter((e) => e.type === 'breast' || e.type === 'bottle')
  const breasts = win.filter((e) => e.type === 'breast')
  const bottles = win.filter((e) => e.type === 'bottle')
  const avgFeeds = feedsAll.length / activeDays
  const avgBreastLen = breasts.length ? breasts.reduce((s, e) => s + e.durationSec, 0) / breasts.length : 0
  const bottleMlDay = bottles.reduce((s, e) => s + e.ml, 0) / activeDays
  const lCount = breasts.filter((e) => e.side === 'L').length
  const rCount = breasts.filter((e) => e.side === 'R').length
  const lrTotal = lCount + rCount || 1
  // avg interval between feeds (within each day)
  let gaps = []
  days.forEach((d) => {
    const k = dayKey(d)
    const t = feedsAll.filter((e) => dayKey(e.atISO) === k).map(atMs).sort((a, c) => a - c)
    for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1])
  })
  const avgGap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length / 1000 : 0

  // sleep
  const sleeps = win.filter((e) => e.type === 'sleep')
  const sleepDay = perDay.reduce((s2, p2) => s2 + p2.sleepSec, 0) / activeDays
  const longest = sleeps.reduce((mx, e) => Math.max(mx, e.durationSec), 0)
  const sleepsDay = sleeps.length / activeDays

  // Sleep by time of day: split every sleep into the clock hours it covers
  // (a 22:00-03:00 sleep counts toward both evening and night), then average
  // per active day.
  const sleepByHour = Array(24).fill(0) // seconds
  const winStart = startOfDay(days[0]).getTime()
  allSleeps.forEach((e) => {
    let t = Math.max(atMs(e), winStart)
    const end = Math.min(sleepEndMs(e), Date.now())
    while (t < end) {
      const d = new Date(t)
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime()
      const upto = Math.min(end, nextHour)
      sleepByHour[d.getHours()] += (upto - t) / 1000
      t = upto
    }
  })
  const FRAMES = [
    { name: 'Night', icon: '🌌', from: 0, to: 6 },
    { name: 'Morning', icon: '🌅', from: 6, to: 12 },
    { name: 'Midday', icon: '☀️', from: 12, to: 18 },
    { name: 'Evening', icon: '🌆', from: 18, to: 24 },
  ].map((f) => ({ ...f, sec: sleepByHour.slice(f.from, f.to).reduce((a, c2) => a + c2, 0) / activeDays }))
  const frameTotal = FRAMES.reduce((a, f) => a + f.sec, 0)
  // Night = 19:00-07:00, measured from the actual hours slept (not the start time).
  const nightSec = sleepByHour.reduce((a, x, h) => a + (h >= 19 || h < 7 ? x : 0), 0)
  const allHoursSec = sleepByHour.reduce((a, x) => a + x, 0)
  const nightPct = allHoursSec ? Math.round((nightSec / allHoursSec) * 100) : 0
  const frameMax = Math.max(1, ...FRAMES.map((f) => f.sec))
  const topFrame = FRAMES.reduce((a, f) => (f.sec > a.sec ? f : a), FRAMES[0])
  const hourAvg = sleepByHour.map((x) => x / activeDays) // seconds asleep in that hour per day
  const peakHour = hourAvg.indexOf(Math.max(...hourAvg))
  const frameRows = FRAMES.map((f) => {
    const pct = frameTotal ? Math.round((f.sec / frameTotal) * 100) : 0
    const top = f === topFrame && frameTotal
    return `<div class="frame-row${top ? ' top' : ''}">
      <div class="frame-name">${f.icon} ${f.name}<span>${pad(f.from)}–${pad(f.to % 24)}</span></div>
      <div class="frame-bar"><div style="width:${(f.sec / frameMax) * 100}%"></div></div>
      <div class="frame-val">${fmtDurationShort(Math.round(f.sec))}<span>${pct}%</span></div>
    </div>`
  }).join('')
  const hourStrip = hourAvg
    .map((x, h) => `<div title="${pad(h)}:00–${pad((h + 1) % 24)}:00 · asleep ${Math.round(x / 60)} min/day" style="flex:1;height:${Math.max(x ? 3 : 0, (x / 3600) * 100)}%;background:var(--accent);border-radius:2px 2px 0 0;opacity:${0.35 + 0.65 * (x / 3600)}"></div>`)
    .join('')

  // diapers
  const peeDay = win.filter((e) => e.type === 'pee').length / activeDays
  const pooDay = win.filter((e) => e.type === 'poo').length / activeDays

  // weight (full history, not limited to window)
  const weights = all.filter((e) => e.type === 'weight').sort((a, c) => atMs(a) - atMs(c))
  let weightSummary = ''
  if (weights.length >= 2) {
    const first = weights[0], last = weights[weights.length - 1]
    const gain = last.grams - first.grams
    const spanDays = Math.max(1, (atMs(last) - atMs(first)) / 86400000)
    const perDayG = Math.round(gain / spanDays)
    weightSummary = `<div class="stat-grid" style="margin-top:10px">
      <div class="chip">Total gain<b>${gain >= 0 ? '+' : ''}${gain} g</b></div>
      <div class="chip">Per day<b>${perDayG >= 0 ? '+' : ''}${perDayG} g</b></div>
    </div>`
  }

  // length (full history)
  const lengths = all.filter((e) => e.type === 'length' && lengthCm(e) > 0).sort((a, c) => atMs(a) - atMs(c))
  let lengthSummary = ''
  if (lengths.length >= 2) {
    const first = lengths[0], last = lengths[lengths.length - 1]
    const gain = lengthCm(last) - lengthCm(first)
    lengthSummary = `<div class="stat-grid" style="margin-top:10px">
      <div class="chip">Latest<b>${cmFmt(lengthCm(last))}</b></div>
      <div class="chip">Total growth<b>${gain >= 0 ? '+' : ''}${(Math.round(gain * 10) / 10).toFixed(1)} cm</b></div>
    </div>`
  }

  // Per-day feed breakdown: date, the feed times, and average feed length that
  // day (breast feeds have a duration; bottles don't, so length averages breasts).
  const feedRows = days
    .slice()
    .reverse()
    .map((d) => {
      const k = dayKey(d)
      const dayFeeds = feedsAll.filter((e) => dayKey(e.atISO) === k).sort((a, c) => atMs(a) - atMs(c))
      if (!dayFeeds.length) return ''
      const times = dayFeeds.map((e) => fmtTime(e.atISO)).join(', ')
      const durs = dayFeeds.filter((e) => e.type === 'breast' && e.durationSec)
      const avg = durs.length ? fmtDurationShort(Math.round(durs.reduce((s, e) => s + e.durationSec, 0) / durs.length)) : '—'
      return `<div class="logrow">
        <div><div style="font-weight:500">${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${dayFeeds.length} feeds</div>
        <div class="meta">${times}</div></div>
        <div style="font-size:12px;color:var(--text-dim);white-space:nowrap">avg ${avg}</div>
      </div>`
    })
    .filter(Boolean)
    .join('')

  // 24h feeding pattern
  const byHour = Array(24).fill(0)
  feedsAll.forEach((e) => byHour[new Date(e.atISO).getHours()]++)
  const maxHour = Math.max(1, ...byHour)
  const hourBars = byHour
    .map((n, h) => `<div title="${h}:00 · ${n} feed${n === 1 ? '' : 's'}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:82px">
        <div style="font-size:9px;font-weight:600;line-height:1;margin-bottom:2px;color:var(--text)">${n || ''}</div>
        <div style="width:100%;background:var(--accent);border-radius:2px 2px 0 0;height:${(n / maxHour) * 100}%;min-height:${n ? 2 : 0}px"></div>
      </div>`)
    .join('')

  const maxFeeds = Math.max(1, ...perDay.map((p) => p.feeds))
  const rangeBtn = (n) =>
    `<button class="${state.statsRange === n ? 'active' : ''}" data-action="stats-range" data-n="${n}">${n}d</button>`

  return `<div class="screen">
    <div class="hdr"><div><p class="name">${esc(b.name)}</p><p class="age">${babyAge(b.birthISO)}</p></div></div>

    <div class="seg">${rangeBtn(7)}${rangeBtn(14)}${rangeBtn(30)}</div>

    <div class="stat-grid">
      <div class="chip">Feeds / day<b>${avgFeeds.toFixed(1)}</b></div>
      <div class="chip">Sleep / day<b>${fmtDurationShort(Math.round(sleepDay))}</b></div>
      <div class="chip">Feed interval<b>${avgGap ? fmtDurationShort(Math.round(avgGap)) : '—'}</b></div>
      <div class="chip">Feed length<b>${avgBreastLen ? fmtDurationShort(Math.round(avgBreastLen)) : '—'}</b></div>
    </div>

    <p class="section-label" style="margin-top:16px">${ICON['chart-bar']} Feeds per day</p>
    <div class="tile">
      <div class="bars-labels" style="margin-bottom:2px">${perDay.map((p) => `<span style="font-weight:600;color:var(--text)">${p.feeds || ''}</span>`).join('')}</div>
      <div class="bars">${perDay.map((p) => `<div class="bar" style="height:${(p.feeds / maxFeeds) * 100}%" title="${p.d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${p.feeds} feeds"></div>`).join('')}</div>
      <div class="bars-labels">${perDay.map((p) => `<span>${p.d.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`).join('')}</div>
    </div>
    ${feedRows ? `<div class="tile" style="padding:4px 14px;margin-top:10px">${feedRows}</div>` : ''}

    <p class="section-label" style="margin-top:16px">${ICON.scale} Weight</p>
    ${weights.length < 2 ? `<p class="empty">Add at least two weights to see the trend.</p>` : `<div class="tile">${weightChartSVG(weights)}</div>${weightSummary}`}

    <p class="section-label" style="margin-top:16px">${ICON.length} Length</p>
    ${lengths.length < 2 ? `<p class="empty">Add at least two lengths to see the trend.</p>` : `<div class="tile">${lengthChartSVG(lengths)}</div>${lengthSummary}`}

    <p class="section-label" style="margin-top:16px">${ICON.milk} Feeding</p>
    <div class="tile">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim);margin-bottom:6px"><span>Left ${lCount}</span><span>Right ${rCount}</span></div>
      <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--accent-soft)">
        <div style="width:${(lCount / lrTotal) * 100}%;background:var(--accent)"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:12px">
        <span style="color:var(--text-dim)">Bottle / day</span><span style="font-weight:600">${bottleMlDay ? Math.round(bottleMlDay) + ' ml' : '—'}</span>
      </div>
    </div>

    <p class="section-label" style="margin-top:16px">${ICON.moon} Sleep</p>
    <div class="stat-grid">
      <div class="chip">Longest stretch<b>${longest ? fmtDurationShort(longest) : '—'}</b></div>
      <div class="chip">Sleeps / day<b>${sleepsDay.toFixed(1)}</b></div>
    </div>
    <div class="tile" style="margin-top:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim);margin-bottom:6px"><span>🌙 Night ${nightPct}%</span><span>☀️ Day ${100 - nightPct}%</span></div>
      <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--accent-soft)">
        <div style="width:${nightPct}%;background:var(--accent)"></div>
      </div>
    </div>

    <p class="section-label" style="margin-top:16px">🕰️ Sleep by time of day</p>
    ${
      !frameTotal
        ? `<p class="empty">No sleep logged in this period.</p>`
        : `<div class="tile">
      <p class="meta" style="margin:0 0 10px">Mostly sleeps in the <b>${topFrame.name.toLowerCase()}</b> · ${fmtDurationShort(Math.round(topFrame.sec))} a day on average</p>
      ${frameRows}
      <div style="display:flex;gap:2px;align-items:flex-end;height:46px;margin-top:14px">${hourStrip}</div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-dim);margin-top:4px"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      <p class="meta" style="margin-top:8px">Most asleep ${pad(peakHour)}:00–${pad((peakHour + 1) % 24)}:00 · ${Math.round(hourAvg[peakHour] / 60)} of 60 min on average</p>
    </div>`
    }

    <p class="section-label" style="margin-top:16px">💧 Diapers</p>
    <div class="stat-grid">
      <div class="chip">Pee / day<b>${peeDay.toFixed(1)}</b></div>
      <div class="chip">Poo / day<b>${pooDay.toFixed(1)}</b></div>
    </div>

    <p class="section-label" style="margin-top:16px">🕐 Feeding times (24h)</p>
    <div class="tile">
      <div style="display:flex;gap:2px;align-items:flex-end">${hourBars}</div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-dim);margin-top:4px">
        <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  </div>`
}

// Small inline SVG line chart for a measurement over time. Each point carries a
// value label that appears on hover/touch (CSS-driven, CSP-safe) plus a native
// <title> tooltip.
function measureChartSVG(items, valueOf, fmtVal, fmtAxis, label) {
  const W = 300, H = 120, padL = 34, padR = 8, padT = 14, padB = 18
  const xs = items.map(atMs)
  const ys = items.map(valueOf)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const px = (x) => padL + ((x - minX) / spanX) * (W - padL - padR)
  const py = (y) => padT + (1 - (y - minY) / spanY) * (H - padT - padB)
  const pts = items.map((it) => `${px(atMs(it)).toFixed(1)},${py(valueOf(it)).toFixed(1)}`)
  const dots = items
    .map((it) => {
      const x = px(atMs(it)), y = py(valueOf(it))
      const v = fmtVal(valueOf(it))
      const dateStr = new Date(atMs(it)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const anchor = x > W - 60 ? 'end' : x < 40 ? 'start' : 'middle'
      // Flip the label below the point when it sits too near the top to fit above.
      const below = y - 30 < 0
      const vY = below ? y + 16 : y - 18
      const rectY = below ? y + 6 : y - 30
      return `<g class="chart-pt" tabindex="0">
        <title>${v} · ${dateStr}</title>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--accent)"/>
        <rect x="${(x - 20).toFixed(1)}" y="${rectY.toFixed(1)}" width="40" height="24" fill="transparent"/>
        <text class="chart-lbl" x="${x.toFixed(1)}" y="${vY.toFixed(1)}" font-size="10" font-weight="600" fill="var(--accent-strong)" text-anchor="${anchor}">${v}<tspan x="${x.toFixed(1)}" dy="11" font-weight="400" fill="var(--text-dim)">${dateStr}</tspan></text>
      </g>`
    })
    .join('')
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${label} over time">
    <text x="2" y="${padT + 4}" font-size="10" fill="var(--text-dim)">${fmtAxis(maxY)}</text>
    <text x="2" y="${H - padB}" font-size="10" fill="var(--text-dim)">${fmtAxis(minY)}</text>
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    ${dots}
    <text x="${padL}" y="${H - 4}" font-size="10" fill="var(--text-dim)">${new Date(minX).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>
    <text x="${W - padR}" y="${H - 4}" font-size="10" fill="var(--text-dim)" text-anchor="end">${new Date(maxX).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>
  </svg>`
}
const weightChartSVG = (weights) =>
  measureChartSVG(weights, (w) => w.grams, (g) => kgFmt(g), (g) => (g / 1000).toFixed(2), 'Weight')
const lengthChartSVG = (lengths) =>
  measureChartSVG(lengths, lengthCm, cmFmt, (c) => (Math.round(c * 10) / 10).toFixed(1), 'Length')

/* ---- milestones ---- */
// Typical order of upcoming milestones, used for the faded "next stops".
const NEXT_STOPS = ['First smile', 'Lifted head', 'First laugh', 'Rolled over', 'Sat up', 'First tooth', 'Crawled', 'First word', 'First steps']
// Age in completed calendar months (Aug 9 -> Sep 9 = 1 month), like parents count.
function monthsOld(birthISO, ms) {
  const b = new Date(birthISO), d = new Date(ms)
  let m = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth())
  if (d.getDate() < b.getDate()) m--
  return Math.max(0, m)
}
const monthChip = (m) => `<span class="chapter">${m === 0 ? 'Newborn' : m + (m === 1 ? ' month' : ' months')}</span>`

// Moments as a winding road: Born at the top, milestones as stops alternating
// left/right, then up to two faded next stops. The road is an SVG drawn in a
// stretched 0..100 x-space; stops are HTML placed at the same coordinates.
function milestonesHTML(b) {
  const list = state.events
    .filter((e) => e.babyId === b.id && e.type === 'milestone')
    .sort((a, c) => atMs(a) - atMs(c))
  const have = new Set(list.map((e) => milestoneData(e).title.toLowerCase()))
  const next = NEXT_STOPS.filter((t) => !have.has(t.toLowerCase())).slice(0, 2)

  const stops = [{ kind: 'born', ms: new Date(b.birthISO).getTime() }]
  list.forEach((e) => stops.push({ kind: 'ms', e, ms: atMs(e) }))
  next.forEach((t) => stops.push({ kind: 'next', title: t }))

  const STEP = 128, TOP = 44
  const xOf = (i) => (i === 0 ? 50 : i % 2 ? 24 : 76)
  const yOf = (i) => TOP + i * STEP
  const H = yOf(stops.length - 1) + 70
  // Where real stops end, the road continues dashed/faded into the future.
  const realCount = stops.length - next.length

  let lastMonth = -1
  const nodes = stops
    .map((st, i) => {
      const x = xOf(i), y = yOf(i)
      const side = x > 50 ? 'left' : 'right' // label goes toward the middle
      let dot, title, meta = '', action = '', chip = ''
      if (st.kind === 'born') {
        dot = `<span class="stop-dot born">${ICON.baby}</span>`
        title = 'Born'
        meta = new Date(b.birthISO).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        lastMonth = 0
        chip = monthChip(0)
      } else if (st.kind === 'ms') {
        const m = milestoneData(st.e)
        const badge = m.media.length > 1 ? `<span class="stop-badge">${m.media.length}</span>` : ''
        dot = m.media.length
          ? `<span class="stop-dot"><img src="${PHOTO_URL(m.media[0].id)}" alt="">${badge}</span>`
          : `<span class="stop-dot">${ICON.star}</span>`
        title = esc(m.title)
        meta = `${babyAge(b.birthISO, st.ms).replace(' old', '')} · ${new Date(st.ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
        const mo = monthsOld(b.birthISO, st.ms)
        if (mo !== lastMonth) {
          chip = monthChip(mo)
          lastMonth = mo
        }
        action = `data-action="open-ms" data-id="${st.e.id}"`
      } else {
        dot = `<span class="stop-dot next">?</span>`
        title = esc(st.title) + '?'
        meta = 'next stop · tap to add'
        action = `data-action="next-stop" data-t="${esc(st.title)}"`
      }
      return `<button class="stop ${st.kind} lbl-${side}" style="left:${x}%;top:${y}px" ${action}>
        ${dot}<span class="stop-lbl">${chip}<b>${title}</b><span>${meta}</span></span>
      </button>`
    })
    .join('')

  // Split the road path at the last real stop so the future part is faded.
  let dReal = `M ${xOf(0)} ${yOf(0)}`, dNext = ''
  for (let i = 1; i < stops.length; i++) {
    const seg = ` C ${xOf(i - 1)} ${yOf(i - 1) + STEP / 2}, ${xOf(i)} ${yOf(i) - STEP / 2}, ${xOf(i)} ${yOf(i)}`
    if (i < realCount) dReal += seg
    else dNext += (dNext ? '' : `M ${xOf(i - 1)} ${yOf(i - 1)}`) + seg
  }

  return `<div class="screen">
    <div class="hdr"><div><p class="name">${esc(b.name)}'s journey</p><p class="age">${babyAge(b.birthISO)}</p></div></div>
    <button class="btn block" data-action="sheet" data-type="milestone" style="margin-bottom:8px">${ICON.star} Add milestone</button>
    <div class="road" style="height:${H}px">
      <svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" width="100%" height="${H}" aria-hidden="true">
        <path d="${dReal}" class="road-bed"/>
        <path d="${dReal}" class="road-dash"/>
        ${dNext ? `<path d="${dNext}" class="road-bed future"/>` : ''}
      </svg>
      ${nodes}
    </div>
  </div>`
}

// One photo -> shown large; several -> a grid of thumbnails. Tapping any opens
// the full-screen viewer with previous/next.
function galleryHTML(evId, media) {
  if (!media.length) return ''
  if (media.length === 1)
    return `<img class="ms-detail-photo" src="${PHOTO_URL(media[0].id)}" alt="" data-action="view-media" data-ev="${evId}" data-i="0">`
  return `<div class="ms-gallery">${media
    .map((m, i) => `<button class="ms-tile" data-action="view-media" data-ev="${evId}" data-i="${i}"><img src="${PHOTO_URL(m.id)}" alt=""></button>`)
    .join('')}</div>`
}

function mediaViewerHTML() {
  const e = state.events.find((x) => x.id === state.mediaView.id)
  if (!e) return ''
  const media = milestoneData(e).media
  const i = Math.min(state.mediaView.i, media.length - 1)
  if (!media[i]) return ''
  return `<div class="overlay media-view" data-action="close-media">
    <div class="mv-body" data-stop="1"><img src="${PHOTO_URL(media[i].id)}" alt=""></div>
    <div class="mv-bar" data-stop="1">
      <button class="mv-btn" data-action="media-step" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Previous">‹</button>
      <span>${i + 1} / ${media.length}</span>
      <button class="mv-btn" data-action="media-step" data-d="1" ${i === media.length - 1 ? 'disabled' : ''} aria-label="Next">›</button>
      <button class="mv-btn" data-action="close-media" aria-label="Close">✕</button>
    </div>
  </div>`
}

// Tapped stop: photos, title, age, note + Edit/Delete.
function msDetailHTML() {
  const e = state.events.find((x) => x.id === state.msDetail)
  if (!e) return ''
  const b = activeBaby()
  const m = milestoneData(e)
  const d = new Date(e.atISO)
  return `<div class="overlay" data-action="close-ms"><div class="sheet" data-stop="1">
    ${galleryHTML(e.id, m.media)}
    <h3 style="margin-bottom:4px">${ICON.star} ${esc(m.title)}</h3>
    <p class="meta">${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} · ${babyAge(b.birthISO, d.getTime())}</p>
    ${m.text ? `<p class="ms-text">${esc(m.text)}</p>` : ''}
    <div class="sheet-actions">
      <button class="btn ghost" data-action="del-event-confirm" data-id="${e.id}">Delete</button>
      <button class="btn ghost" data-action="edit-event" data-id="${e.id}">Edit</button>
      <button class="btn" data-action="close-ms">Close</button>
    </div>
  </div></div>`
}

/* ---- settings ---- */
function settingsHTML(b) {
  return `<div class="screen">
    <div class="hdr"><p class="name">Baby</p></div>
    <div class="tile" style="margin-bottom:12px">
      <p style="margin:0;font-size:18px;font-weight:600">${esc(b.name)}</p>
      <p style="margin:4px 0 0;color:var(--text-dim);font-size:13px">${b.sex === 'girl' ? 'Girl · pink theme' : 'Boy · blue theme'}</p>
      <p style="margin:2px 0 12px;color:var(--text-dim);font-size:13px">Born ${new Date(b.birthISO).toLocaleString()}</p>
      <button class="btn small" data-action="edit-baby">Edit baby</button>
    </div>
    <button class="btn block ghost" style="margin-bottom:20px" data-action="add-baby"><span>${ICON.plus}</span> Add another baby</button>

    <p class="section-label">💊 Medicines</p>
    ${
      medicines().length === 0
        ? `<p class="empty" style="padding:6px 0 12px">No medicines yet.</p>`
        : `<div class="tile" style="padding:4px 14px;margin-bottom:12px">${medicines()
            .map(
              (m) => `<div class="logrow">
        <div><div style="font-weight:500">${esc(m.name)}</div><div class="meta">${m.perDay ? m.perDay + '× a day' : 'As needed'}${m.description ? ' · ' + esc(m.description) : ''}</div></div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn ghost small" data-action="edit-med" data-id="${m.id}">Edit</button>
          <button class="del" data-action="del-event-confirm" data-id="${m.id}" aria-label="Delete">${ICON.trash}</button>
        </div>
      </div>`
            )
            .join('')}</div>`
    }
    <button class="btn block ghost" style="margin-bottom:20px" data-action="sheet" data-type="add-med"><span>${ICON.plus}</span> Add medicine</button>

    <p class="section-label">🌙 Night mode</p>
    <div class="tile" style="margin-bottom:20px">
      <div class="seg-pick">${['auto', 'on', 'off']
        .map((v) => `<button data-action="night-pref" data-v="${v}" class="${nightPref() === v ? 'on' : ''}">${v === 'auto' ? 'Auto 21–07' : v === 'on' ? 'Always' : 'Off'}</button>`)
        .join('')}</div>
      <p class="meta" style="margin-top:8px">Dim, warm colours for night feeds. Auto switches on between 21:00 and 07:00 (this device).</p>
    </div>

    <p class="section-label">${ICON.database} Backup</p>
    <div class="tile">
      <p style="margin:0 0 12px;font-size:13px;color:var(--text-dim)">Your data lives on the server and is shared across devices. Export a JSON copy any time.</p>
      <button class="btn ghost" data-action="export">Export data</button>
    </div>
    ${getCookie('csrf_token') ? `<button class="btn block ghost" style="margin-top:24px" data-action="logout">Log out</button>` : ''}
    <button class="btn block" style="background:var(--danger);margin-top:12px" data-action="delete-baby">Delete this baby</button>
  </div>`
}

/* ---- quick check-in sheet ---- */
function checkinSheetHTML() {
  const b = activeBaby()
  const name = b ? esc(b.name) : 'baby'
  const yesno = (id) =>
    `<div class="seg-pick" id="${id}"><button data-val="no" class="on">No</button><button data-val="yes">Yes</button></div>`
  return `<div class="overlay" data-action="close-sheet"><div class="sheet" data-stop="1">
    <h3>Check-in · ${name}</h3>
    ${field(`Did ${name} pee?`, yesno('ci-pee'))}
    ${field(`Did ${name} poo?`, yesno('ci-poo'))}
    ${field('Temperature (°C) — optional', `<input id="ci-temp" type="text" inputmode="decimal" placeholder="36.6">`)}
    ${dateTimeFields(new Date())}
    <div class="sheet-actions">
      <button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn" data-action="save-checkin">Save</button>
    </div>
  </div></div>`
}

/* ---- log sheet (also used for editing an existing entry) ---- */
function sheetHTML(sheet) {
  if (sheet.type === 'checkin') return checkinSheetHTML()
  if (sheet.type === 'med') return medSheetHTML(sheet)
  if (sheet.type === 'add-med') return addMedSheetHTML(sheet)
  if (sheet.type === 'milestone') return milestoneSheetHTML(sheet)
  const t = sheet.type
  const ev = sheet.editId ? state.events.find((e) => e.id === sheet.editId) : null
  const names = { bottle: 'bottle feed', temp: 'temperature', weight: 'weight', length: 'length', note: 'note', breast: 'breastfeed', pee: 'pee', poo: 'poo', sleep: 'sleep' }
  const title = (ev ? 'Edit ' : 'Add ') + names[t]
  const d = ev ? new Date(ev.atISO) : new Date()
  const on = (cond) => (cond ? ' class="on"' : '')

  let fields = ''
  if (t === 'bottle')
    fields = field('Amount (ml)', `<input id="f-ml" type="text" inputmode="decimal" placeholder="60" value="${ev ? ev.ml : ''}" autofocus>`)
  if (t === 'breast')
    fields =
      field('Side', `<div class="seg-pick" id="f-side"><button data-side="L"${on(ev && ev.side === 'L')}>Left</button><button data-side="R"${on(ev && ev.side === 'R')}>Right</button><button data-side="both"${on(!ev || ev.side === 'both')}>Both</button></div>`) +
      durUntilFields(ev, '15')
  if (t === 'sleep')
    fields =
      field('Position', `<div class="seg-pick" id="f-side"><button data-side="back"${on(!ev || ev.side === 'back' || !ev.side)}>On back</button><button data-side="L"${on(ev && ev.side === 'L')}>Left</button><button data-side="R"${on(ev && ev.side === 'R')}>Right</button></div>`) +
      durUntilFields(ev, '60')
  if (t === 'temp')
    fields = field('Temperature (°C)', `<input id="f-temp" type="text" inputmode="decimal" placeholder="36.6" value="${ev ? ev.celsius : ''}" autofocus>`)
  if (t === 'weight')
    fields = field('Weight (kg)', `<input id="f-weight" type="text" inputmode="decimal" placeholder="3.42" value="${ev ? (ev.grams / 1000).toFixed(2) : ''}" autofocus>`)
  if (t === 'length')
    fields = field('Length (cm)', `<input id="f-length" type="text" inputmode="decimal" placeholder="52.5" value="${ev ? cmFmt(lengthCm(ev)).replace(' cm', '') : ''}" autofocus>`)

  const noteVal = ev && ev.note ? esc(ev.note) : ''
  const noteField =
    t === 'note'
      ? field('Note', `<textarea id="f-note" autofocus>${noteVal}</textarea>`)
      : t === 'sleep' || t === 'bath' || t === 'length'
      ? ''
      : field('Note (optional)', `<input id="f-note" value="${noteVal}">`)

  return `<div class="overlay" data-action="close-sheet"><div class="sheet" data-stop="1">
    <h3>${title}</h3>
    ${fields}
    ${dateTimeFields(d)}
    ${noteField}
    <p id="sheet-err" style="color:var(--danger);font-size:13px;margin:0 0 10px;display:none"></p>
    <div class="sheet-actions">
      <button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn" data-action="save-sheet">Save</button>
    </div>
  </div></div>`
}
const field = (label, inner) => `<div class="field"><label>${label}</label>${inner}</div>`

// Duration-or-end-time chooser for breast/sleep. Toggle picks which input is
// used; saveSheet reads whichever field is visible.
function durUntilFields(ev, ph) {
  const untilVal = ev && ev.endISO ? `${pad(new Date(ev.endISO).getHours())}:${pad(new Date(ev.endISO).getMinutes())}` : ''
  return `
    <div class="field"><label>Length</label>
      <div class="seg-pick" id="dur-mode">
        <button data-action="dur-mode" data-mode="dur" class="on">Duration</button>
        <button data-action="dur-mode" data-mode="until">End time</button>
      </div>
    </div>
    <div class="field" id="dur-field"><label>Minutes</label><input id="f-min" type="text" inputmode="decimal" placeholder="${ph}" value="${ev ? Math.round(ev.durationSec / 60) : ''}"></div>
    <div class="field" id="until-field" hidden><label>Ends at</label><input id="f-until" type="time" value="${untilVal}"></div>`
}

function medSheetHTML(sheet) {
  const meds = medicines()
  const ev = sheet.editId ? state.events.find((e) => e.id === sheet.editId) : null
  const d = ev ? new Date(ev.atISO) : new Date()
  if (!meds.length && !ev) {
    return `<div class="overlay" data-action="close-sheet"><div class="sheet" data-stop="1">
      <h3>Medicine</h3>
      <p style="font-size:13px;color:var(--text-dim)">No medicines yet. Add them in the Baby tab under "Medicines" first.</p>
      <div class="sheet-actions"><button class="btn" data-action="close-sheet">OK</button></div>
    </div></div>`
  }
  let selName = meds[0] ? meds[0].name : ''
  let dose = ''
  if (ev) {
    const parts = (ev.note || '').split(' · ')
    selName = parts[0]
    dose = parts.slice(1).join(' · ')
  }
  const extra = ev && selName && !meds.some((m) => m.name === selName) ? `<option value="${esc(selName)}" selected>${esc(selName)}</option>` : ''
  const options = meds.map((m) => `<option value="${esc(m.name)}"${m.name === selName ? ' selected' : ''}>${esc(m.name)}</option>`).join('')
  return `<div class="overlay" data-action="close-sheet"><div class="sheet" data-stop="1">
    <h3>${ev ? 'Edit medicine' : 'Log medicine'}</h3>
    ${field('Medicine', `<select id="f-med">${extra}${options}</select>`)}
    ${field('Dose / note (optional)', `<input id="f-dose" value="${esc(dose)}" placeholder="e.g. 2.5 ml">`)}
    ${dateTimeFields(d)}
    <p id="sheet-err" style="color:var(--danger);font-size:13px;margin:0 0 10px;display:none"></p>
    <div class="sheet-actions">
      <button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn" data-action="save-med">Save</button>
    </div>
  </div></div>`
}

function addMedSheetHTML(sheet) {
  const m = sheet && sheet.editId ? medicines().find((x) => x.id === sheet.editId) : null
  return `<div class="overlay" data-action="close-sheet"><div class="sheet" data-stop="1">
    <h3>${m ? 'Edit medicine' : 'Add medicine'}</h3>
    ${field('Name', `<input id="md-name" placeholder="e.g. Vitamin D" value="${m ? esc(m.name) : ''}" autofocus>`)}
    ${field('Times per day', `<div class="seg-pick" id="md-perday">${[0, 1, 2, 3]
      .map((n) => `<button data-n="${n}"${(m ? m.perDay : 0) === n ? ' class="on"' : ''}>${n ? n + '×' : 'As needed'}</button>`)
      .join('')}</div>`)}
    ${field('Description (optional)', `<textarea id="md-desc" placeholder="dose, when to give, notes">${m ? esc(m.description) : ''}</textarea>`)}
    <p id="sheet-err" style="color:var(--danger);font-size:13px;margin:0 0 10px;display:none"></p>
    <div class="sheet-actions">
      <button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn" data-action="save-add-med">Save</button>
    </div>
  </div></div>`
}

/* ---- milestone sheet ---- */
const MS_SUGGEST = ['First smile', 'First laugh', 'First bath', 'Lifted head', 'Rolled over', 'First tooth', 'Sat up', 'First word', 'Crawled', 'First steps']
const MAX_MEDIA = 20 // per milestone
// Photos being edited in the sheet. Existing ones carry an id; new ones carry
// a downscaled data URL until Save uploads them.
let msMedia = []
let msRemoved = [] // existing items removed in this edit (files deleted on Save)
let msBusy = false
function resetMsMedia(ev) {
  msMedia = ev ? milestoneData(ev).media.map((m) => ({ ...m })) : []
  msRemoved = []
  msBusy = false
}
function milestoneSheetHTML(sheet) {
  const ev = sheet.editId ? state.events.find((e) => e.id === sheet.editId) : null
  const m = ev ? milestoneData(ev) : { title: sheet.prefill || '', text: '', media: [] }
  const d = ev ? new Date(ev.atISO) : new Date()
  return `<div class="overlay" data-action="close-sheet"><div class="sheet" data-stop="1">
    <h3>${ev ? 'Edit milestone' : 'Add milestone'}</h3>
    <div class="ms-chips">${MS_SUGGEST.map((t) => `<button data-action="ms-suggest" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    ${field('Title', `<input id="ms-title" value="${esc(m.title)}" placeholder="e.g. First smile">`)}
    ${field('Note (optional)', `<textarea id="ms-text" placeholder="what happened">${esc(m.text)}</textarea>`)}
    ${dateTimeFields(d)}
    <div class="field"><label>Photos (optional)</label>
      <div id="ms-grid" class="ms-gallery edit">${msGridHTML()}</div>
      <label class="btn ghost small ms-add">${ICON.plus} Add photos
        <input id="ms-files" type="file" accept="image/*" multiple hidden>
      </label>
      <p id="ms-status" class="meta" style="margin-top:6px"></p>
    </div>
    <p id="sheet-err" style="color:var(--danger);font-size:13px;margin:0 0 10px;display:none"></p>
    <div class="sheet-actions">
      <button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn" id="ms-save" data-action="save-milestone">Save</button>
    </div>
  </div></div>`
}
function msGridHTML() {
  return msMedia
    .map(
      (m, i) => `<div class="ms-tile">
        <img src="${m.data || PHOTO_URL(m.id)}" alt="">
        <button class="ms-x" data-action="ms-del-media" data-i="${i}" aria-label="Remove">✕</button>
      </div>`
    )
    .join('')
}
const refreshMsGrid = () => {
  const g = document.getElementById('ms-grid')
  if (g) g.innerHTML = msGridHTML()
}
const msStatus = (t) => {
  const el = document.getElementById('ms-status')
  if (el) el.textContent = t
}
async function addMsFiles(files) {
  const list = [...files]
  let skipped = 0
  for (let k = 0; k < list.length; k++) {
    const f = list[k]
    if (!f.type.startsWith('image/') && !/\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name)) {
      skipped++
      continue
    }
    if (msMedia.length >= MAX_MEDIA) {
      alert(`Up to ${MAX_MEDIA} photos per milestone.`)
      break
    }
    msStatus(`Preparing ${k + 1} of ${list.length}…`)
    try {
      msMedia.push({ kind: 'photo', data: await downscalePhoto(f) })
      refreshMsGrid()
    } catch {
      alert(`Could not read "${f.name}".`)
    }
  }
  msStatus(skipped ? `${skipped} non-photo file${skipped > 1 ? 's' : ''} skipped — only photos can be added.` : '')
}
// Shrink a picked photo to max 1280px JPEG so uploads stay small (<1 MB).
function downscalePhoto(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = reject
    r.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * k)
        c.height = Math.round(img.height * k)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        let q = 0.82
        let out = c.toDataURL('image/jpeg', q)
        while (out.length > 900000 && q > 0.35) {
          q -= 0.1
          out = c.toDataURL('image/jpeg', q)
        }
        resolve(out)
      }
      img.src = r.result
    }
    r.readAsDataURL(file)
  })
}
async function saveMilestone() {
  if (msBusy) return
  const err = document.getElementById('sheet-err')
  const fail = (t) => {
    err.textContent = t
    err.style.display = 'block'
  }
  const title = document.getElementById('ms-title').value.trim()
  if (!title) return fail('Enter a title')
  const text = document.getElementById('ms-text').value.trim()
  const ev = state.sheet.editId ? state.events.find((x) => x.id === state.sheet.editId) : null
  const at = readDateTime(ev ? ev.atISO : null)

  msBusy = true
  const saveBtn = document.getElementById('ms-save')
  if (saveBtn) saveBtn.disabled = true
  const uploaded = [] // new files, removed again if anything fails
  try {
    const media = []
    const total = msMedia.filter((m) => !m.id).length
    let n = 0
    for (const m of msMedia) {
      if (m.id) {
        media.push({ kind: 'photo', id: m.id })
        continue
      }
      n++
      msStatus(`Uploading ${n} of ${total}…`)
      const r = await post('/photos', { data: m.data })
      uploaded.push({ kind: 'photo', id: r.id })
      media.push({ kind: 'photo', id: r.id })
    }
    msStatus('Saving…')
    if (ev) await del('/events/' + ev.id)
    await post('/events', { babyId: state.activeBabyId, type: 'milestone', atISO: at.toISOString(), note: JSON.stringify({ title, text, media }) })
    await deleteMediaFiles(msRemoved)
  } catch (e) {
    await deleteMediaFiles(uploaded)
    msBusy = false
    if (saveBtn) saveBtn.disabled = false
    msStatus('')
    return fail('Upload failed: ' + e.message)
  }
  resetMsMedia(null)
  state.sheet = null
  await refresh()
}

/* ---- baby form ---- */
function babyFormFields(initial) {
  // Leave date/time empty for a new baby so the parent fills them in.
  let date = '', time = ''
  if (initial) {
    const d = new Date(initial.birthISO)
    date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const sex = initial ? initial.sex : 'girl'
  return `
    ${field('Name', `<input id="bf-name" value="${initial ? esc(initial.name) : ''}" placeholder="Baby's name" autofocus>`)}
    ${field('Sex (sets the theme)', `<div class="seg-pick" id="bf-sex">
      <button data-sex="girl" class="${sex === 'girl' ? 'on' : ''}">Girl · pink</button>
      <button data-sex="boy" class="${sex === 'boy' ? 'on' : ''}">Boy · blue</button></div>`)}
    <div class="row" style="gap:10px">
      <div class="field" style="flex:1"><label>Date of birth</label><input id="bf-date" type="date" value="${date}"></div>
      <div class="field" style="flex:1"><label>Time</label><input id="bf-time" type="time" value="${time}"></div>
    </div>
    <p id="bf-err" style="color:var(--danger);font-size:13px;margin:0 0 10px;display:none"></p>
    <div class="sheet-actions">
      ${initial || state.babies.length ? `<button class="btn ghost" data-action="close-babyform">Cancel</button>` : ''}
      <button class="btn" data-action="save-baby">Save baby</button>
    </div>`
}
function babyFormOverlay() {
  const initial = state.babyForm === 'edit' ? activeBaby() : null
  return `<div class="overlay" data-action="close-babyform"><div class="sheet" data-stop="1">
    <h3>${initial ? 'Edit baby' : 'Add baby'}</h3>${babyFormFields(initial)}</div></div>`
}

/* -------------------------------------------------------------- actions */
function readBabyForm() {
  const name = document.getElementById('bf-name').value.trim()
  const err = document.getElementById('bf-err')
  if (!name) {
    err.textContent = 'Enter a name first'
    err.style.display = 'block'
    return null
  }
  const sexBtn = document.querySelector('#bf-sex .on')
  const sex = sexBtn ? sexBtn.dataset.sex : 'girl'
  const date = document.getElementById('bf-date').value
  const time = document.getElementById('bf-time').value
  if (!date || !time) {
    err.textContent = 'Enter the date and time of birth'
    err.style.display = 'block'
    return null
  }
  const birthISO = new Date(`${date}T${time}`).toISOString()
  return { name, sex, birthISO }
}

async function saveSheet() {
  const t = state.sheet.type
  const ev = state.sheet.editId ? state.events.find((x) => x.id === state.sheet.editId) : null
  const err = document.getElementById('sheet-err')
  const fail = (m) => {
    err.textContent = m
    err.style.display = 'block'
  }
  const at = readDateTime(ev ? ev.atISO : null)
  const atISO = at.toISOString()
  const noteEl = document.getElementById('f-note')
  const note = noteEl ? noteEl.value.trim() : ''
  const e = { babyId: state.activeBabyId, type: t, atISO }

  if (t === 'bottle') {
    const v = num(document.getElementById('f-ml').value)
    if (!v || v <= 0) return fail('Enter ml')
    e.ml = v
  } else if (t === 'temp') {
    const v = num(document.getElementById('f-temp').value)
    if (!v) return fail('Enter temperature')
    e.celsius = v
  } else if (t === 'weight') {
    const v = num(document.getElementById('f-weight').value)
    if (!v || v <= 0) return fail('Enter weight')
    e.grams = Math.round(v * 1000)
  } else if (t === 'length') {
    const v = num(document.getElementById('f-length').value)
    if (!v || v <= 0) return fail('Enter length')
    e.note = String(v) // cm stored in note
  } else if (t === 'breast') {
    e.side = (document.querySelector('#f-side .on') || {}).dataset?.side || 'both'
    const r = readDurationSec(at)
    if (r.err) return fail(r.err)
    e.durationSec = r.sec
  } else if (t === 'sleep') {
    e.side = (document.querySelector('#f-side .on') || {}).dataset?.side || 'back'
    const r = readDurationSec(at)
    if (r.err) return fail(r.err)
    e.durationSec = r.sec
    e.endISO = new Date(at.getTime() + e.durationSec * 1000).toISOString()
  } else if (t === 'note') {
    if (!note) return fail('Enter a note')
  }
  if (note && t !== 'note' && t !== 'sleep') e.note = note
  if (t === 'note') e.note = note

  // Edit = replace the old entry (uses existing create/delete endpoints).
  if (state.sheet.editId) await del('/events/' + state.sheet.editId)
  await post('/events', e)
  state.sheet = null
  await refresh()
}

// Reads duration from either the minutes field or the end-time field,
// depending on which is visible. Returns {sec} or {err}.
function readDurationSec(startDate) {
  const uf = document.getElementById('until-field')
  if (uf && !uf.hidden) {
    const v = document.getElementById('f-until').value
    if (!v) return { err: 'Enter the end time' }
    const [eh, em] = v.split(':').map(Number)
    const end = new Date(startDate)
    end.setHours(eh, em, 0, 0)
    if (end <= startDate) end.setDate(end.getDate() + 1) // crossed midnight
    return { sec: Math.round((end - startDate) / 1000) }
  }
  const mins = num(document.getElementById('f-min').value)
  if (!mins || mins <= 0) return { err: 'Enter minutes' }
  return { sec: Math.round(mins * 60) }
}

async function saveMed() {
  const err = document.getElementById('sheet-err')
  const name = document.getElementById('f-med').value
  if (!name) {
    err.textContent = 'Pick a medicine'
    err.style.display = 'block'
    return
  }
  const dose = document.getElementById('f-dose').value.trim()
  const ev = state.sheet.editId ? state.events.find((x) => x.id === state.sheet.editId) : null
  const at = readDateTime(ev ? ev.atISO : null)
  const e = { babyId: state.activeBabyId, type: 'med', atISO: at.toISOString(), note: dose ? `${name} · ${dose}` : name }
  if (state.sheet.editId) await del('/events/' + state.sheet.editId)
  await post('/events', e)
  state.sheet = null
  await refresh()
}

async function saveAddMed() {
  const err = document.getElementById('sheet-err')
  const name = document.getElementById('md-name').value.trim()
  if (!name) {
    err.textContent = 'Enter a name'
    err.style.display = 'block'
    return
  }
  const description = document.getElementById('md-desc').value.trim()
  // Editing a medicine = replace its hidden med_def event, preserving its date.
  const ev = state.sheet.editId ? state.events.find((x) => x.id === state.sheet.editId) : null
  if (ev) await del('/events/' + ev.id)
  await post('/events', {
    babyId: state.activeBabyId,
    type: 'med_def',
    atISO: ev ? ev.atISO : new Date().toISOString(),
    note: JSON.stringify({ name, description, perDay: Number((document.querySelector('#md-perday .on') || {}).dataset?.n || 0) }),
  })
  state.sheet = null
  await refresh()
}

async function saveCheckin() {
  const atISO = readDateTime(null).toISOString()
  const babyId = state.activeBabyId

  const peeYes = (document.querySelector('#ci-pee .on') || {}).dataset?.val === 'yes'
  const pooYes = (document.querySelector('#ci-poo .on') || {}).dataset?.val === 'yes'
  const tempV = num(document.getElementById('ci-temp').value)

  const reqs = []
  if (peeYes) reqs.push(post('/events', { babyId, type: 'pee', atISO }))
  if (pooYes) reqs.push(post('/events', { babyId, type: 'poo', atISO }))
  if (tempV) reqs.push(post('/events', { babyId, type: 'temp', atISO, celsius: tempV }))
  await Promise.all(reqs)

  state.sheet = null
  await refresh()
}

function doExport() {
  const data = { babies: state.babies, events: state.events, timers: state.timers }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `babylog-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* click delegation */
document.addEventListener('click', async (ev) => {
  const seg = ev.target.closest('.seg-pick button')
  if (seg && !seg.dataset.action) {
    // simple visual toggles (sex, breast side) read at save time
    seg.parentElement.querySelectorAll('button').forEach((x) => x.classList.remove('on'))
    seg.classList.add('on')
    return
  }
  const el = ev.target.closest('[data-action]')
  if (!el) return
  const a = el.dataset.action

  try {
    if (a === 'tab') { state.tab = el.dataset.tab; render() }
    else if (a === 'switch') { state.activeBabyId = el.dataset.id; render() }
    else if (a === 'toggle') await toggleTimer(el.dataset.kind)
    else if (a === 'cancel-sleep') await cancelTimer('sleep')
    else if (a === 'sleep-side') { state.sleepSide = el.dataset.side; render() }
    else if (a === 'stats-range') { state.statsRange = Number(el.dataset.n); render() }
    else if (a === 'sheet') { resetMsMedia(null); state.sheet = { type: el.dataset.type }; render() }
    else if (a === 'open-session') { state.sessionDetail = el.dataset.ids.split(','); render() }
    else if (a === 'close-detail') {
      if (el.classList.contains('overlay') && ev.target.closest('[data-stop]')) return
      state.sessionDetail = null; render()
    }
    else if (a === 'edit-event') {
      const e = state.events.find((x) => x.id === el.dataset.id)
      if (e) { resetMsMedia(e.type === 'milestone' ? e : null); state.sheet = { type: e.type, editId: e.id }; state.sessionDetail = null; state.msDetail = null; render() }
    }
    else if (a === 'close-sheet') {
      // ignore clicks inside the sheet body (only the backdrop or Cancel closes)
      if (el.classList.contains('overlay') && ev.target.closest('[data-stop]')) return
      if (msBusy) return
      state.sheet = null; render()
    }
    else if (a === 'save-sheet') await saveSheet()
    else if (a === 'save-checkin') await saveCheckin()
    else if (a === 'save-med') await saveMed()
    else if (a === 'save-add-med') await saveAddMed()
    else if (a === 'save-milestone') await saveMilestone()
    else if (a === 'ms-suggest') { document.getElementById('ms-title').value = el.dataset.t }
    else if (a === 'ms-del-media') {
      if (msBusy) return
      const [m] = msMedia.splice(Number(el.dataset.i), 1)
      if (m && m.id) msRemoved.push(m)
      refreshMsGrid()
    }
    else if (a === 'view-media') { state.mediaView = { id: el.dataset.ev, i: Number(el.dataset.i) }; render() }
    else if (a === 'media-step') { state.mediaView.i += Number(el.dataset.d); render() }
    else if (a === 'close-media') {
      if (el.classList.contains('overlay') && ev.target.closest('[data-stop]')) return
      state.mediaView = null; render()
    }
    else if (a === 'open-ms') { state.msDetail = el.dataset.id; render() }
    else if (a === 'close-ms') {
      if (el.classList.contains('overlay') && ev.target.closest('[data-stop]')) return
      state.msDetail = null; render()
    }
    else if (a === 'next-stop') { resetMsMedia(null); state.sheet = { type: 'milestone', prefill: el.dataset.t }; render() }
    else if (a === 'night-pref') {
      try { localStorage.setItem('babylog-night', el.dataset.v) } catch {}
      render()
    }
    else if (a === 'give-med') {
      await post('/events', { babyId: state.activeBabyId, type: 'med', atISO: new Date().toISOString(), note: el.dataset.name })
      await refresh()
    }
    else if (a === 'edit-med') { state.sheet = { type: 'add-med', editId: el.dataset.id }; render() }
    else if (a === 'dur-mode') {
      document.querySelectorAll('#dur-mode button').forEach((x) => x.classList.remove('on'))
      el.classList.add('on')
      document.getElementById('dur-field').hidden = el.dataset.mode !== 'dur'
      document.getElementById('until-field').hidden = el.dataset.mode !== 'until'
    }
    else if (a === 'del-event') await deleteEvent(el.dataset.id)
    else if (a === 'del-event-confirm') {
      if (confirm('Delete this entry?')) {
        if (state.msDetail === el.dataset.id) state.msDetail = null
        await deleteEvent(el.dataset.id)
      }
    }
    else if (a === 'del-group') {
      const ids = el.dataset.ids.split(',')
      const msg = ids.length > 1 ? `Delete these ${ids.length} entries?` : 'Delete this entry?'
      if (confirm(msg)) {
        for (const id of ids) await del('/events/' + id)
        await refresh()
      }
    }
    else if (a === 'view') { state.view = el.dataset.view; render() }
    else if (a === 'cal-prev') { state.cursor = state.view === 'month' ? new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1) : addDays(state.cursor, -1); render() }
    else if (a === 'cal-next') { state.cursor = state.view === 'month' ? new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1) : addDays(state.cursor, 1); render() }
    else if (a === 'pick-day') { state.cursor = startOfDay(new Date(el.dataset.date)); state.view = 'day'; render() }
    else if (a === 'add-baby') { state.babyForm = 'add'; render() }
    else if (a === 'edit-baby') { state.babyForm = 'edit'; render() }
    else if (a === 'close-babyform') {
      if (el.classList.contains('overlay') && ev.target.closest('[data-stop]')) return
      state.babyForm = null; render()
    }
    else if (a === 'save-baby') {
      const data = readBabyForm()
      if (!data) return
      if (state.babyForm === 'edit') await put('/babies/' + state.activeBabyId, data)
      else { const nb = await post('/babies', data); state.activeBabyId = nb.id }
      state.babyForm = null
      await refresh()
    }
    else if (a === 'export') doExport()
    else if (a === 'log-bath') {
      await post('/events', { babyId: state.activeBabyId, type: 'bath', atISO: new Date().toISOString() })
      await refresh()
    }
    else if (a === 'logout') window.location.href = '/logout'
    else if (a === 'delete-baby') {
      const b = activeBaby()
      if (confirm(`Delete ${b.name} and all their data? This cannot be undone.`)) {
        await del('/babies/' + b.id)
        state.activeBabyId = null
        await refresh()
      }
    }
  } catch (e) {
    console.error(e)
    alert('Something went wrong: ' + e.message)
  }
})

/* milestone photos picked -> downscale + add to the grid */
document.addEventListener('change', async (ev) => {
  if (ev.target.id !== 'ms-files') return
  const files = ev.target.files
  if (files && files.length) await addMsFiles(files)
  ev.target.value = '' // allow picking the same file again
})

/* live timer tick — updates only the elapsed displays, no full re-render */
let lastNight = null
setInterval(() => {
  document.querySelectorAll('.js-elapsed[data-start]').forEach((el) => {
    el.textContent = fmtDuration(elapsed(el.dataset.start))
  })
  document.querySelectorAll('.js-since[data-since]').forEach((el) => {
    el.textContent = fmtAgo(Date.now() - new Date(el.dataset.since).getTime())
  })
  // flip night mode at 21:00 / 07:00 without waiting for a data change
  const n = nightActive()
  if (lastNight !== null && n !== lastNight && state.loaded) render()
  lastNight = n
}, 1000)

/* auto-refresh for partner sync — skip while a modal is open or tab hidden */
setInterval(() => {
  if (state.sheet || state.babyForm || state.mediaView || state.msDetail || document.hidden) return
  // Don't refresh while the user is typing/picking in a field.
  const ae = document.activeElement
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return
  refresh().catch(() => {})
}, 6000)

/* boot */
refresh().catch((e) => {
  console.error(e)
  root().innerHTML = `<div class="center-screen"><p>Could not reach the server.</p></div>`
})
