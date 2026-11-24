// Shared payoff logic. Used by the app (browser) and by the daily reminder job (Node).
// Holds no personal data: everything about the debts comes from the user's saved state (S.cfg).

export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const money = (v, d = 0) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtD = d => MON[d.getMonth()] + ' ' + d.getDate();
export const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const dim = (y, m) => new Date(y, m + 1, 0).getDate();
export const on = (y, m, day) => new Date(y, m, Math.min(day, dim(y, m)));
export const clone = o => JSON.parse(JSON.stringify(o));
export const daysBetween = (a, b) => Math.round((b - a) / 864e5);

export const BASE = {
  v: 2, upd: 0, cfg: null, debts: {}, log: [], moved: {}, saveDone: {}, notified: {},
  set: { budget: null, save: 250, amexMode: 'full', amexStmt: 0, inc1: 0, inc2: 0, tgt: {} }
};
export function merge(d) {
  const s = Object.assign(clone(BASE), d || {});
  s.set = Object.assign(clone(BASE.set), (d && d.set) || {});
  return s;
}

// Today's date in Toronto, as a local midnight Date (works the same in the browser and on a UTC server).
export function torontoToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return pd(p);
}

export function model(S) {
  const cfg = S.cfg;
  const DEBTS = cfg.debts;
  const DBY = Object.fromEntries(DEBTS.map(d => [d.id, d]));
  const spend = cfg.spendCard;
  const full = () => S.set.amexMode === 'full';
  const dState = id => S.debts[id] || {};
  const aprOf = id => dState(id).apr != null ? dState(id).apr : DBY[id].apr;
  function curBal(id) {
    const ds = dState(id);
    const b = ds.bal != null ? ds.bal : DBY[id].bal;
    const asOf = ds.asOf || 0;
    return Math.max(0, b - S.log.filter(e => e.id === id && e.ts > asOf).reduce((a, e) => a + e.amt, 0));
  }
  const pool = () => DEBTS.filter(d => d.id !== spend || !full());
  const ORDER = () => cfg.order.filter(id => DBY[id] && (id !== spend || !full()));
  function minOf(d, b) {
    if (b <= 0) return 0;
    const it = b * aprOf(d.id) / 1200;
    let m;
    if (d.type === 'card') m = 10 + it;
    else if (d.type === 'bmoloc') m = Math.max(it, 0.02 * b);
    else if (d.type === 'tdloc') m = it + 0.00125 * b;
    else m = d.fixed;
    return Math.min(b + it, m);
  }
  function alloc(bals, budget) {
    const ids = pool().map(d => d.id); const p = {}; let ms = 0;
    for (const id of ids) { p[id] = minOf(DBY[id], bals[id] || 0); ms += p[id]; }
    let left = Math.max(0, budget - ms);
    for (const id of ORDER()) {
      if (!ids.includes(id)) continue;
      const room = Math.max(0, (bals[id] || 0) - p[id]); const x = Math.min(room, left); p[id] += x; left -= x;
    }
    return { p, ms };
  }
  function sim(budget, minsOnly) {
    const ds = pool(); let b = ds.map(d => curBal(d.id)); const path = [[...b]]; let m = 0, interest = 0;
    while (b.some(x => x > 0.005) && m < 600) {
      const it = b.map((x, i) => x * aprOf(ds[i].id) / 1200); interest += it.reduce((a, c) => a + c, 0);
      b = b.map((x, i) => x + it[i]);
      const mins = b.map((x, i) => Math.min(x, minOf(ds[i], x - it[i])));
      let left = minsOnly ? 0 : Math.max(0, budget - mins.reduce((a, c) => a + c, 0));
      b = b.map((x, i) => x - mins[i]);
      for (const id of ORDER()) { const i = ds.findIndex(d => d.id === id); if (i < 0 || b[i] <= 0) continue; const x = Math.min(b[i], left); b[i] -= x; left -= x; }
      b = b.map(x => x < 0.005 ? 0 : x); path.push([...b]); m++;
    }
    return { path, months: m, interest, ds };
  }
  function budgetNums() {
    const s = S.set;
    const tg = i => i.kind !== 'want' ? i.amt : (s.tgt[i.id] != null ? +s.tgt[i.id] : i.target);
    const sum = (k, f) => cfg.items.filter(i => i.kind === k).reduce((a, i) => a + f(i), 0);
    const income = (+s.inc1 || 0) + (+s.inc2 || 0);
    const need = sum('need', i => i.amt), commit = sum('commit', i => i.amt), biz = sum('biz', i => i.amt);
    const wantNow = sum('want', i => i.amt), want = sum('want', tg);
    const save = Math.max(250, +s.save || 250);
    return { income, need, commit, biz, wantNow, want, save, avail: income - need - commit - biz - want - save, tg };
  }
  function minsNow() { return alloc(Object.fromEntries(DEBTS.map(d => [d.id, curBal(d.id)])), 0).ms; }
  function budget() { return S.set.budget == null ? Math.ceil((minsNow() + 500) / 25) * 25 : +S.set.budget; }
  function cycles(t) {
    const nowBal = Object.fromEntries(DEBTS.map(d => [d.id, curBal(d.id)]));
    const items = [];
    for (const d of DEBTS) {
      for (const day of d.days) {
        let D = on(t.getFullYear(), t.getMonth(), day); if (D < t) D = on(t.getFullYear(), t.getMonth() + 1, day);
        const prev = []; for (const k of [-1, 0]) for (const dd of d.days) { const x = on(D.getFullYear(), D.getMonth() + k, dd); if (x < D) prev.push(x); }
        const W = new Date(Math.max(...prev.map(x => +x)));
        const paid = S.log.filter(e => e.id === d.id && pd(e.date) > W && pd(e.date) <= D).reduce((a, e) => a + e.amt, 0);
        items.push({ d, D, W, paid, share: 1 / d.days.length });
      }
    }
    const startBal = {}; for (const d of DEBTS) startBal[d.id] = nowBal[d.id] + items.filter(i => i.d.id === d.id).reduce((a, i) => a + i.paid, 0);
    const { p } = alloc(startBal, budget());
    const out = [];
    for (const it of items) {
      let plan;
      if (it.d.id === spend && full()) plan = +S.set.amexStmt || 0;
      else plan = (p[it.d.id] || 0) * it.share;
      const key = iso(it.D);
      const o = (cfg.overrides || []).find(o => o.id === it.d.id && o.date === key);
      if (o) { plan = Math.max(plan, o.amt); it.note = o.note; }
      if (startBal[it.d.id] <= 0.005 && !(it.d.id === spend && full())) plan = 0;
      out.push(Object.assign(it, { plan: Math.round(plan * 100) / 100 }));
    }
    const sv = on(t.getFullYear(), t.getMonth() + (t.getDate() > 1 ? 1 : 0), 1); const sk = iso(sv).slice(0, 7);
    out.push({ sav: 1, D: sv, key: sk, plan: Math.max(250, +S.set.save || 250), paid: +(S.saveDone[sk] || 0) });
    return out.sort((a, b) => a.D - b.D);
  }
  const nameOf = c => c.sav ? 'Savings' : c.d.name + (c.d.days.length > 1 ? ' (half)' : '');
  function noteFor(c) {
    if (c.sav) return 'Move it on payday, before you spend anything.';
    if (c.d.id === spend && full()) return 'Pay the full statement so everyday spending never becomes debt.';
    if (c.plan === 0) return 'Paid off. Nothing due.';
    if (c.note) return c.note;
    const pos = ORDER().indexOf(c.d.id);
    if (pos === 0) return 'Minimum plus extra. This gets paid off first.';
    if (pos === 1 && c.d.type === 'card') return 'Minimum plus anything left over. Paid off second.';
    return 'Minimum payment.';
  }
  return { DEBTS, DBY, dState, aprOf, curBal, pool, ORDER, minOf, alloc, sim, budgetNums, minsNow, budget, cycles, nameOf, noteFor, spend, full };
}

// The reminder messages due today, used by the daily job. Returns [{key, title, body}].
export function dueReminders(S, t, leadDays = [3, 1, 0]) {
  const M = model(S); const out = [];
  for (const c of M.cycles(t)) {
    const left = c.plan - c.paid; if (left < 0.5) continue;
    const n = daysBetween(t, c.D); if (!leadDays.includes(n)) continue;
    const key = (c.sav ? 'sav' : c.d.id) + '_' + iso(c.D) + '_' + n;
    if (S.notified && S.notified[key]) continue;
    const name = M.nameOf(c);
    out.push({ key, n, name, left, D: c.D,
      title: n === 0 ? `Due today: ${name}` : `Due ${n === 1 ? 'tomorrow' : 'in ' + n + ' days'}: ${name}`,
      body: `${c.sav ? 'Move' : 'Pay'} ${money(left, 2)} by ${fmtD(c.D)}. Tap to log it.` });
  }
  return out;
}
