import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, doc, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getMessaging, getToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
import { MON, money, fmtD, iso, pd, clone, merge, model, torontoToday, daysBetween } from './logic.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLS = ['#00a862', '#2f6f5a', '#7fb8a0', '#0b0b10', '#8fa79b', '#c8321f', '#5a6260', '#b9c9c1'];
const TABS = { today: 'Today', debts: 'Debts', plan: 'Plan', spend: 'Spending', history: 'History' };
const whenTxt = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days';
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function screen(name) { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 's-' + name; }

const CFG = window.FIREBASE_CONFIG;
if (!CFG || !CFG.apiKey) { screen('loading'); document.querySelector('#s-loading .sub').textContent = 'This app has not been connected to Firebase yet (firebase-config.js is empty).'; throw new Error('No Firebase config'); }
const fb = initializeApp(CFG);
const auth = getAuth(fb);
const db = initializeFirestore(fb, { localCache: persistentLocalCache() });

let S = null, M = null, user = null, stateRef = null, unsub = null, CYC = [], last = null, undoSnap = null, toastT = null, swReg = null;

// service worker: offline + push
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./firebase-messaging-sw.js').then(r => { swReg = r; }).catch(() => {});

// ---------- auth ----------
let mode = 'in';
$('authSwitch').addEventListener('click', () => {
  mode = mode === 'in' ? 'up' : 'in';
  $('authBtn').textContent = mode === 'in' ? 'Sign in' : 'Create account';
  $('authSwitch').textContent = mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in';
  $('pw').autocomplete = mode === 'in' ? 'current-password' : 'new-password'; $('authErr').textContent = '';
});
const authMsg = e => ({ 'auth/invalid-credential': 'That email and password don\'t match.', 'auth/wrong-password': 'That email and password don\'t match.', 'auth/user-not-found': 'No account with that email. Tap "Create an account".', 'auth/email-already-in-use': 'There\'s already an account with that email. Sign in instead.', 'auth/weak-password': 'Use at least 6 characters.', 'auth/invalid-email': 'Check the email address.', 'auth/network-request-failed': 'No connection. Try again when you\'re online.', 'auth/too-many-requests': 'Too many tries. Wait a minute and try again.' }[e.code] || 'Something went wrong. Try again.');
$('authForm').addEventListener('submit', async e => {
  e.preventDefault(); $('authErr').textContent = ''; $('authBtn').disabled = true;
  try { if (mode === 'in') await signInWithEmailAndPassword(auth, $('email').value.trim(), $('pw').value); else await createUserWithEmailAndPassword(auth, $('email').value.trim(), $('pw').value); }
  catch (err) { $('authErr').textContent = authMsg(err); }
  $('authBtn').disabled = false;
});
$('forgot').addEventListener('click', async () => {
  const em = $('email').value.trim(); if (!em) { $('authErr').textContent = 'Type your email first, then tap "Forgot password?"'; return; }
  try { await sendPasswordResetEmail(auth, em); $('authErr').textContent = 'Check your email for a reset link.'; } catch (err) { $('authErr').textContent = authMsg(err); }
});
for (const id of ['signOut', 'signOut1']) $(id).addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, u => {
  user = u; if (unsub) { unsub(); unsub = null; }
  if (!u) { S = null; screen('auth'); return; }
  screen('loading');
  stateRef = doc(db, 'users', u.uid, 'app', 'state');
  unsub = onSnapshot(stateRef, { includeMetadataChanges: true }, snap => {
    setSync(snap.metadata);
    if (!snap.exists()) { if (!snap.metadata.fromCache) screen('setup'); return; }
    const d = snap.data();
    if (!S || (!snap.metadata.hasPendingWrites && (+d.upd || 0) >= (+S.upd || 0))) S = merge(d);
    if (!S.cfg) { screen('setup'); return; }
    if ($('s-app').hidden) { screen('app'); route(); }
    render();
  }, () => { setSync(null); });
});
function setSync(meta) {
  const el = $('sync'); if (!el) return;
  let cls = 'ok', txt = 'Synced';
  if (!meta) { cls = 'off'; txt = 'Not syncing'; } else if (!navigator.onLine || meta.fromCache) { cls = 'wait'; txt = 'Offline'; } else if (meta.hasPendingWrites) { cls = 'wait'; txt = 'Saving'; }
  el.className = 'sync ' + cls; el.firstChild.textContent = txt;
}
window.addEventListener('online', () => setSync({})); window.addEventListener('offline', () => setSync({ fromCache: true }));

// ---------- import ----------
function parseImport(txt) {
  const d = JSON.parse(txt.trim());
  if (!d || !d.cfg || !Array.isArray(d.cfg.debts) || !d.cfg.debts.length || !Array.isArray(d.cfg.order)) throw new Error('bad');
  return merge(d);
}
$('importBtn').addEventListener('click', async () => {
  $('importErr').textContent = '';
  let s; try { s = parseImport($('importBox').value); } catch (e) { $('importErr').textContent = 'That doesn\'t look like a setup code. Copy the whole thing and try again.'; return; }
  s.upd = Date.now(); S = s;
  try { await setDoc(stateRef, clone(S)); } catch (e) { $('importErr').textContent = 'Couldn\'t save it. Check your connection and try again.'; }
});

// ---------- saving ----------
function commit() { S.upd = Date.now(); render(); setDoc(stateRef, clone(S)).catch(() => toast('Couldn\'t save that change. Check your connection.')); }

// ---------- render ----------
function render() {
  if (!S || !S.cfg) return;
  M = model(S); const t = torontoToday(); const B = M.budgetNums();
  const bals = Object.fromEntries(M.DEBTS.map(d => [d.id, M.curBal(d.id)]));
  const ms = M.minsNow(); const budget = M.budget();
  const plan = M.sim(budget, false), mins = M.sim(0, true); last = [plan, mins];
  const owed = M.DEBTS.reduce((a, d) => a + bals[d.id], 0), start = M.DEBTS.reduce((a, d) => a + d.bal, 0);
  CYC = M.cycles(t); const nextUp = CYC.find(c => c.plan > 0 && c.paid < c.plan - 0.5);
  const end = new Date(t.getFullYear(), t.getMonth() + plan.months, 1); const short = budget - B.avail;
  // today
  if (nextUp) {
    const n = daysBetween(t, nextUp.D); const left = nextUp.plan - nextUp.paid;
    $('nextCard').innerHTML = `<div class="lab">Next payment</div><div class="amt">${money(left, 2)}</div><div class="to">to ${esc(M.nameOf(nextUp))}</div><div class="when">Due ${fmtD(nextUp.D)}, ${whenTxt(n)}</div><p class="note">${esc(M.noteFor(nextUp))}</p><button class="big" type="button" data-paycyc="${CYC.indexOf(nextUp)}">I paid this</button>`;
  } else $('nextCard').innerHTML = `<div class="lab">Next payment</div><div class="amt">All caught up</div><p class="note">Everything due right now has been logged.</p>`;
  const pct = Math.max(0, Math.min(100, (start - owed) / start * 100));
  $('progBar').style.width = pct + '%'; $('progPct').textContent = pct.toFixed(1) + '%';
  $('progLab').textContent = `${money(start - owed)} of ${money(start)} paid off. ${plan.months < 600 ? `On track to be debt-free by ${MON[end.getMonth()]} ${end.getFullYear()}.` : 'At this budget the debt never gets paid off.'}`;
  const due7 = CYC.filter(c => daysBetween(t, c.D) <= 7).reduce((a, c) => a + Math.max(0, c.plan - c.paid), 0);
  const nospend = M.DEBTS.filter(d => d.nospend); const two = nospend.reduce((a, d) => a + bals[d.id], 0);
  $('stats').innerHTML = [[money(owed), 'Owed now', ''], [money(due7), 'Due in the next 7 days', ''], [money(two), 'Left on ' + nospend.map(d => d.short || d.name).join(' and '), ''], [money(Math.abs(short)), short > 0 ? 'Monthly shortfall' : 'Left over each month', short > 0 ? 'bad' : '']].map(([a, b, c]) => `<div class="${c}"><span class="num">${a}</span><small>${esc(b)}</small></div>`).join('');
  $('shortAlert').innerHTML = budget < ms - 1 ? `<div class="alert"><b>Your budget doesn't cover the minimums (${money(ms)}).</b> A missed minimum hurts your credit score more than anything else.<br><button type="button" data-go="plan">Fix the budget</button></div>` : short > 0 ? `<div class="alert"><b>Your income is ${money(short)} a month short of this plan.</b> See what closes the gap.<br><button type="button" data-go="plan">Open the plan</button></div>` : '';
  $('notifPrompt').innerHTML = notifState() === 'ready' ? `<div class="alert" style="background:var(--mist)"><b>Get a notification before each payment.</b><br><button type="button" data-go="plan">Turn on notifications</button></div>` : '';
  $('todo').innerHTML = CYC.map((c, i) => {
    const n = daysBetween(t, c.D); const left = Math.max(0, c.plan - c.paid); const done = c.plan > 0 && left < 0.5;
    const chip = c.plan === 0 ? '<span class="chip ok">Paid off</span>' : done ? '<span class="chip ok">Paid</span>' : c.paid > 0 ? `<span class="chip part">${money(left, 2)} left</span>` : '';
    return `<li class="row ${done || c.plan === 0 ? 'done' : n <= 7 ? 'soon' : ''}" data-paycyc="${i}" tabindex="0" role="button" aria-label="Log payment to ${esc(M.nameOf(c))}"><span class="d">${fmtD(c.D)}<small>${whenTxt(n)}</small></span><span><b>${esc(M.nameOf(c))}</b><br>${chip || `<span class="sub">${c.sav ? 'Savings' : 'Due'}</span>`}</span><span class="a">${money(c.plan, 2)}</span></li>`;
  }).join('');
  // debts
  const ord = M.ORDER();
  $('debtCards').innerHTML = M.DEBTS.map(d => {
    const b = bals[d.id]; const p = Math.max(0, Math.min(100, (d.bal - b) / d.bal * 100)); const ds = M.dState(d.id);
    const tag = d.id === M.spend && M.full() ? 'Spend' : ord.indexOf(d.id) + 1;
    return `<div class="card dc"><div class="top"><span><span class="ord">${esc(tag)}</span><b>${esc(d.name)}</b>${d.nospend ? '<span class="nospend">Don\'t use</span>' : ''}</span><span class="bal">${b <= 0.005 ? 'Paid off' : money(b, 2)}</span></div>
    <div class="bar2"><i style="width:${p}%"></i></div>
    <div class="sub">${M.aprOf(d.id).toFixed(2)}% interest${d.estRate && !ds.apr ? ' (estimate)' : ''}${d.lim ? ' · ' + Math.round(b / d.lim * 100) + '% of ' + money(d.lim) + ' limit' : ''} · ${p.toFixed(0)}% paid off<br>${ds.asOf ? 'Balance updated ' + fmtD(new Date(ds.asOf)) : 'Starting balance from ' + esc(S.cfg.startLabel || 'setup')}</div>
    <div class="sbtn" style="margin-top:12px"><button type="button" data-upd="${esc(d.id)}">Update balance</button><button type="button" class="pri" data-logd="${esc(d.id)}">Log payment</button></div></div>`;
  }).join('');
  // plan
  const sl = $('budget'); sl.min = 0; sl.max = Math.max(4000, Math.ceil((ms + 2500) / 25) * 25); if (document.activeElement !== sl) sl.value = budget;
  $('budgetOut').textContent = money(budget) + ' a month';
  $('budgetHint').textContent = `Minimums right now: ${money(ms)}. After needs, committed payments, wants at your targets and ${money(B.save)} savings, your income leaves ${money(B.avail)} for debt.`;
  for (const b of document.querySelectorAll('#amexMode button')) b.setAttribute('aria-pressed', b.dataset.m === S.set.amexMode);
  if (document.activeElement !== $('amexStmt')) $('amexStmt').value = S.set.amexStmt; if (document.activeElement !== $('save')) $('save').value = S.set.save;
  $('chartTitle').textContent = plan.months < 600 ? `Debt-free in ${plan.months} months` : 'At this budget the debt never gets paid off';
  drawChart(plan, mins); gap(B, budget); notifUI();
  $('acct').textContent = 'Signed in as ' + (user && user.email || '') + '.';
  // spending
  const MOVE = S.cfg.move || []; const nm = MOVE.filter(m => S.moved[m.id]).length;
  $('mvTitle').textContent = `Move to Amex or cancel (${nm} of ${MOVE.length} done)`;
  $('mv').innerHTML = MOVE.map(m => `<label class="${S.moved[m.id] ? 'on' : ''}"><input type="checkbox" data-mv="${esc(m.id)}" ${S.moved[m.id] ? 'checked' : ''}><span>${esc(m.name)}<br><small class="sub">on ${esc(m.from)}</small></span><b>${money(m.amt, 2)}</b></label>`).join('');
  let nw = '';
  for (const [k, lab] of [['need', 'Needs'], ['commit', 'Already committed'], ['biz', 'Business'], ['want', 'Wants: set your targets']]) {
    const its = S.cfg.items.filter(i => i.kind === k); if (!its.length) continue;
    nw += `<div class="grp">${lab}</div>` + its.map(i => { const tg = B.tg(i); return `<div class="nwr ${k === 'want' && tg === 0 ? 'cut' : ''}"><span><span class="nm">${esc(i.name)}</span><br><small class="sub">${k === 'want' ? 'now ' + money(i.amt, 2) + (i.amt - tg > 0 ? ' · saves ' + money(i.amt - tg) : '') : ''}</small></span>${k === 'want' ? `<input type="number" min="0" step="5" inputmode="decimal" data-t="${esc(i.id)}" value="${tg}" aria-label="Target for ${esc(i.name)}">` : `<b style="text-align:right">${money(i.amt, 2)}</b>`}</div>`; }).join('');
  }
  $('nw').innerHTML = nw; $('nwTitle').textContent = `Your cuts save ${money(B.wantNow - B.want)} a month`;
  if (document.activeElement !== $('inc1')) $('inc1').value = S.set.inc1; if (document.activeElement !== $('inc2')) $('inc2').value = S.set.inc2;
  // history
  const rows = [...S.log].sort((a, b) => b.ts - a.ts);
  $('hist').innerHTML = rows.length ? rows.map(e => `<div class="hr"><span><b>${esc(M.DBY[e.id] ? M.DBY[e.id].name : e.id)}</b><br><small class="sub">${esc(fmtD(pd(e.date)))}, ${esc(e.date.slice(0, 4))}</small></span><b>${money(e.amt, 2)}</b><button type="button" data-del="${esc(e.k)}">Remove</button></div>`).join('') : '<p class="sub">Nothing logged yet. Tap "I paid this" on the Today tab when you make a payment.</p>';
  const sv = Object.entries(S.saveDone).filter(([, v]) => +v > 0).sort().reverse();
  $('savHist').innerHTML = sv.length ? sv.map(([k, v]) => `<div class="hr"><span><b>${esc(MON[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4))}</b></span><b>${money(+v, 2)}</b><span></span></div>`).join('') : '<p class="sub">No savings transfers logged yet.</p>';
}

const svg = $('chart');
function drawChart(plan, mins) {
  const W = svg.clientWidth, H = svg.clientHeight; if (!W || !H) return;
  const N = Math.max(3, Math.min(plan.months, 120)); const L = 42, R = 8, T = 12, Bm = 26;
  const top = plan.path[0].reduce((a, c) => a + c, 0) || 1; const ymax = Math.ceil(top / 10000) * 10000;
  const x = i => L + (W - L - R) * i / N, y = v => T + (H - T - Bm) * (1 - v / ymax);
  const P = plan.path.slice(0, N + 1); while (P.length < N + 1) P.push(P[0].map(() => 0));
  const ord = M.ORDER().filter(id => plan.ds.some(d => d.id === id)); const idx = ord.map(id => plan.ds.findIndex(d => d.id === id));
  const colOf = id => COLS[M.DEBTS.findIndex(d => d.id === id) % COLS.length];
  const cum = (p, k) => idx.slice(0, k).reduce((a, i) => a + p[i], 0); let areas = '';
  idx.forEach((ix, k) => { areas += `<polygon points="${P.map((p, i) => `${x(i)},${y(cum(p, k + 1))}`).join(' ')} ${P.map((p, i) => `${x(i)},${y(cum(p, k))}`).reverse().join(' ')}" fill="${colOf(ord[k])}"/>`; });
  const mp = mins.path.slice(0, N + 1).map((p, i) => `${x(i)},${y(p.reduce((a, c) => a + c, 0))}`).join(' ');
  const now = new Date(); let ticks = ''; const step = Math.max(1, Math.ceil(N / (W < 520 ? 4 : 7)));
  for (let i = 0; i <= N; i += step) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); ticks += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${MON[d.getMonth()]} '${String(d.getFullYear()).slice(2)}</text>`; }
  let gy = ''; for (const v of [0, ymax / 2, ymax]) gy += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v ? '$' + Math.round(v / 1000) + 'k' : '$0'}</text>`;
  svg.innerHTML = gy + areas + `<polyline points="${mp}" fill="none" stroke="var(--red)" stroke-width="2.5" stroke-dasharray="7 5"/>` + ticks;
  $('legend').innerHTML = ord.map(id => `<span><i style="background:${colOf(id)}"></i>${esc(M.DBY[id].name)}</span>`).join('') + '<span><i style="background:var(--red);height:3px"></i>Minimums only</span>';
}
new ResizeObserver(() => last && M && drawChart(...last)).observe($('fig'));

function gap(B, budget) {
  const g = budget - B.avail; $('gapCard').hidden = g <= 0; if (g <= 0) return;
  const items = S.cfg.gap || []; const add = items.reduce((a, i) => a + i.amt, 0);
  $('gapTitle').textContent = `${money(g)} a month short`;
  $('gapIntro').textContent = `Your bills, payment plans, business costs, wants at your targets, ${money(B.save)} savings and ${money(budget)} toward debt add up to more than your ${money(B.income)} take-home. If nothing changes, the shortfall ends up back on the lines of credit. Here's what each fix is worth per month:`;
  $('gapRows').innerHTML = items.map(i => `<div class="gr"><b>${esc(i.name)}</b><span class="v">${money(i.amt)}</span><span class="why">${esc(i.why)}</span></div>`).join('') + (items.length ? `<div class="gr"><b>${add >= g ? 'Together, these close the gap' : 'Together these cover ' + money(add)}</b><span class="v">${money(add)}</span><span class="why">${add >= g ? 'Until they all kick in, keep paying every minimum on time.' : 'You would still need more income or lower rent to cover the rest.'}</span></div>` : '');
}

// ---------- notifications ----------
let msgSupported = null;
isSupported().then(v => { msgSupported = v; if (v) onMessage(getMessaging(fb), p => { const n = p.notification || {}; toast((n.title ? n.title + ': ' : '') + (n.body || '')); }); render(); }).catch(() => { msgSupported = false; });
const myToken = () => { try { return localStorage.getItem('payoff-fcm') || ''; } catch (e) { return ''; } };
function notifState() {
  if (msgSupported === null) return 'checking';
  if (isIOS && !standalone) return 'homescreen';
  if (!msgSupported || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && myToken()) return 'on';
  return 'ready';
}
function notifUI() {
  const st = notifState();
  const txt = {
    checking: 'Checking what this device supports…',
    homescreen: 'On iPhone, notifications only work from the home screen app. In Safari, tap Share, then "Add to Home Screen", then open Payoff from the new icon and come back here.',
    unsupported: 'This browser can\'t receive notifications. On iPhone, open the app from your home screen icon (iOS 16.4 or later).',
    denied: 'Notifications are blocked. Turn them on in Settings, then Notifications, then Payoff.',
    on: 'On for this device. You\'ll get a notification at about 8 am, 3 days before, 1 day before and on the day each payment is due, with the amount.',
    ready: 'Get a notification 3 days before, 1 day before and on the day each payment is due, with the amount.'
  }[st];
  $('notifStatus').textContent = txt;
  $('notifBtns').innerHTML = st === 'ready' ? '<button type="button" class="pri" id="notifOn" style="grid-column:1/3">Turn on notifications</button>' : st === 'on' ? '<button type="button" id="notifTest">Send a test</button><button type="button" id="notifRefresh">Reconnect</button>' : '';
}
async function enableNotif() {
  try {
    const perm = await Notification.requestPermission(); if (perm !== 'granted') { notifUI(); render(); return; }
    const reg = swReg || await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(fb), { vapidKey: window.FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) throw new Error('no token');
    await setDoc(doc(db, 'users', user.uid), { tokens: { [token]: { ts: Date.now(), ua: navigator.userAgent.slice(0, 120) } } }, { merge: true });
    try { localStorage.setItem('payoff-fcm', token); } catch (e) {}
    toast('Notifications are on'); render();
  } catch (e) { toast('Couldn\'t turn on notifications. Try again from the home screen app.'); }
}
async function testNotif() {
  try { const reg = swReg || await navigator.serviceWorker.ready; await reg.showNotification('Payoff', { body: 'Notifications are working. Your payment alerts will look like this.', icon: './icons/icon-192.png' }); }
  catch (e) { toast('Couldn\'t show a test notification.'); }
}

// ---------- navigation ----------
function route() {
  let v = location.hash.slice(1); if (!TABS[v]) v = 'today';
  for (const s of document.querySelectorAll('.view')) s.classList.toggle('on', s.id === 'v-' + v);
  for (const b of document.querySelectorAll('.tabs button')) { if (b.dataset.tab === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  $('title').textContent = TABS[v]; window.scrollTo(0, 0); if (v === 'plan' && last && M) requestAnimationFrame(() => drawChart(...last));
}
function go(v) { if (location.hash.slice(1) === v) route(); else location.hash = v; }
window.addEventListener('hashchange', route);

// ---------- toast + undo ----------
function toast(msg, snap) { undoSnap = snap || null; $('toastMsg').textContent = msg; $('undoBtn').hidden = !snap; $('toast').classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => $('toast').classList.remove('on'), 5000); }
$('undoBtn').addEventListener('click', () => { if (undoSnap) { S = merge(undoSnap); undoSnap = null; commit(); toast('Undone'); } });

// ---------- sheets ----------
let onSave = null, lastFocus = null;
function openSheet(html, save) { lastFocus = document.activeElement; $('shBody').innerHTML = html; onSave = save; $('scrim').classList.add('on'); $('sheet').classList.add('on'); const f = $('shBody').querySelector('input,select'); setTimeout(() => f && f.focus(), 230); }
function closeSheet() { $('scrim').classList.remove('on'); $('sheet').classList.remove('on'); onSave = null; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
$('scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && onSave) closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.row[data-paycyc]')) { e.preventDefault(); paySheet(+e.target.dataset.paycyc); }
});
const amtField = (v, chips) => `<label class="l" for="shAmt">Amount</label><input type="number" id="shAmt" step="0.01" min="0.01" inputmode="decimal" value="${v ? v.toFixed(2) : ''}" required>${chips.length ? `<div class="chips">${chips.map(([l, a]) => `<button type="button" data-fill="${a.toFixed(2)}">${esc(l)} ${money(a, 2)}</button>`).join('')}</div>` : ''}`;
const dateField = () => `<label class="l" for="shDate">Date paid</label><input type="date" id="shDate" value="${iso(torontoToday())}" required>`;
const btns = lbl => `<div class="sbtn"><button type="button" data-close="1">Cancel</button><button type="submit" class="pri">${lbl}</button></div>`;
function logPay(id, amt, date) { const snap = clone(S); S.log.push({ k: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id, amt: Math.round(amt * 100) / 100, date, ts: Date.now(), amex: id === M.spend && M.full() ? 1 : 0 }); commit(); toast(`Logged ${money(amt, 2)} to ${M.DBY[id].name}`, snap); }
function paySheet(i) {
  const c = CYC[i]; if (!c) return; const left = Math.max(0, c.plan - c.paid);
  if (c.sav) { openSheet(`<form><h2 id="shTitle">Savings transfer</h2><p class="sub">For ${MON[c.D.getMonth()]} ${c.D.getFullYear()}. Logged so far: ${money(c.paid, 2)}</p>${amtField(left || c.plan, [['Plan', c.plan]])}${btns('Save')}</form>`, () => { const a = +$('shAmt').value; if (!(a > 0)) return false; const snap = clone(S); S.saveDone[c.key] = (+S.saveDone[c.key] || 0) + a; commit(); toast(`Logged ${money(a, 2)} to savings`, snap); }); return; }
  const b = M.curBal(c.d.id); const chips = []; if (left > 0) chips.push(['Planned', left]);
  const mn = M.minOf(c.d, b + c.paid) * (c.share || 1); if (mn > 0 && Math.abs(mn - left) > 1 && c.d.id !== M.spend) chips.push(['Minimum', mn]);
  if (b > 0 && c.d.type !== 'loan') chips.push(['Whole balance', b]);
  openSheet(`<form><h2 id="shTitle">Pay ${esc(M.nameOf(c))}</h2><p class="sub">Due ${fmtD(c.D)}. Planned ${money(c.plan, 2)}${c.paid > 0 ? ', ' + money(c.paid, 2) + ' logged so far' : ''}. ${esc(M.noteFor(c))}</p>${amtField(left || c.plan || 0, chips)}${dateField()}${btns('Log payment')}</form>`, () => { const a = +$('shAmt').value, dt = $('shDate').value; if (!(a > 0) || !dt) return false; logPay(c.d.id, a, dt); });
}
function anySheet(pre) { openSheet(`<form><h2 id="shTitle">Log a payment</h2><label class="l" for="shDebt">Paid to</label><select id="shDebt">${M.DEBTS.map(d => `<option value="${esc(d.id)}" ${d.id === pre ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>${amtField(0, [])}${dateField()}${btns('Log payment')}</form>`, () => { const a = +$('shAmt').value, dt = $('shDate').value, id = $('shDebt').value; if (!(a > 0) || !dt || !M.DBY[id]) return false; logPay(id, a, dt); }); }
function updSheet(id) { const d = M.DBY[id]; openSheet(`<form><h2 id="shTitle">Update ${esc(d.name)}</h2><p class="sub">Enter the balance from your newest statement or banking app. Payments you log after this come off this number.</p><label class="l" for="shBal">Balance now</label><input type="number" id="shBal" step="0.01" min="0" inputmode="decimal" value="${M.curBal(id).toFixed(2)}" required><label class="l" for="shRate">Interest rate (%)</label><input type="number" id="shRate" step="0.01" min="0" inputmode="decimal" value="${M.aprOf(id)}">${btns('Save')}</form>`, () => { const nb = +$('shBal').value, r = +$('shRate').value; if (!(nb >= 0)) return false; const snap = clone(S); S.debts[id] = { bal: Math.round(nb * 100) / 100, asOf: Date.now(), apr: r > 0 ? r : M.aprOf(id) }; commit(); toast(`${d.name} updated to ${money(nb, 2)}`, snap); }); }
document.addEventListener('submit', e => { if (e.target.closest('#sheet')) { e.preventDefault(); if (onSave && onSave() !== false) closeSheet(); } });

document.addEventListener('click', e => {
  const el = e.target.closest('[data-paycyc],[data-tab],[data-go],[data-upd],[data-logd],[data-del],[data-m],[data-fill],[data-close],#logAny,#notifOn,#notifTest,#notifRefresh,#copyBackup'); if (!el) return;
  if (el.dataset.tab) go(el.dataset.tab);
  else if (el.dataset.go) go(el.dataset.go);
  else if (el.dataset.paycyc != null) paySheet(+el.dataset.paycyc);
  else if (el.dataset.upd) updSheet(el.dataset.upd);
  else if (el.dataset.logd) anySheet(el.dataset.logd);
  else if (el.id === 'logAny') anySheet(M.ORDER()[0]);
  else if (el.dataset.fill) $('shAmt').value = el.dataset.fill;
  else if (el.dataset.close) closeSheet();
  else if (el.dataset.del) { const snap = clone(S); S.log = S.log.filter(x => x.k !== el.dataset.del); commit(); toast('Payment removed', snap); }
  else if (el.dataset.m) { S.set.amexMode = el.dataset.m; commit(); }
  else if (el.id === 'notifOn' || el.id === 'notifRefresh') enableNotif();
  else if (el.id === 'notifTest') testNotif();
  else if (el.id === 'copyBackup') { navigator.clipboard.writeText(JSON.stringify(S)).then(() => { $('backupMsg').textContent = 'Copied. Paste it somewhere safe, like a note.'; }, () => { $('backupMsg').textContent = 'Couldn\'t copy on this device.'; }); }
});
document.addEventListener('change', e => {
  const el = e.target; if (el.closest('#sheet') || !S) return;
  if (el.dataset.mv) { S.moved[el.dataset.mv] = el.checked ? 1 : 0; commit(); if (el.checked) toast('Nice, one less charge on those cards'); }
  else if (el.dataset.t) { S.set.tgt[el.dataset.t] = Math.max(0, +el.value || 0); commit(); }
  else if (el.id === 'amexStmt') { S.set.amexStmt = Math.max(0, +el.value || 0); commit(); }
  else if (el.id === 'save') { S.set.save = Math.max(250, +el.value || 250); commit(); }
  else if (el.id === 'inc1' || el.id === 'inc2') { S.set[el.id] = +el.value || 0; commit(); }
});
$('budget').addEventListener('input', e => { S.set.budget = +e.target.value; render(); });
$('budget').addEventListener('change', () => commit());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
