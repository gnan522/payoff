// Daily reminder job, run by GitHub Actions.
// Reads each user's saved plan from Firestore, works out what's due (3 days before, 1 day before, and on the day),
// and sends one push notification per user to every device they turned notifications on for.
import admin from 'firebase-admin';
import { merge, torontoToday, dueReminders, money } from '../logic.js';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('Missing FIREBASE_SERVICE_ACCOUNT secret.'); process.exit(1); }
// Clean up common copy-paste problems (smart quotes, stray BOM, trailing commas, wrapping quotes).
function parseKey(text) {
  let t = text.replace(/^\uFEFF/, '').trim()
    .replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
  if (t.startsWith("'") && t.endsWith("'")) t = t.slice(1, -1);
  // A paste that got cut off after a complete field: close it. Only the first few fields are needed to sign in.
  if (t.startsWith('{') && !t.endsWith('}')) t = t.replace(/,\s*$/, '') + '\n}';
  try {
    const k = JSON.parse(t);
    if (!k.project_id || !k.private_key || !k.client_email) throw new Error('missing project_id, private_key or client_email');
    return k;
  }
  catch (e) {
    // Show the shape around the problem with every letter and digit masked, so nothing secret is printed.
    const m = /position (\d+)/.exec(e.message); const pos = m ? +m[1] : 0;
    const mask = s => s.replace(/[A-Za-z0-9+/=_-]/g, 'x').replace(/\n/g, '\\n');
    console.error(`The FIREBASE_SERVICE_ACCOUNT secret isn't valid JSON (${e.message}).`);
    console.error(`Length ${t.length}. Starts with ${JSON.stringify(mask(t.slice(0, 12)))}, ends with ${JSON.stringify(mask(t.slice(-40)))}.`);
    console.error(`Around the problem: ${JSON.stringify(mask(t.slice(Math.max(0, pos - 40), pos + 40)))}`);
    console.error('Fix: re-copy the whole downloaded .json file (it starts with { and ends with }) and paste it into the secret again.');
    process.exit(1);
  }
}
admin.initializeApp({ credential: admin.credential.cert(parseKey(raw)) });
const db = admin.firestore();
const appUrl = process.env.APP_URL || '';
const test = process.env.TEST === 'true';
const t = torontoToday();

let sent = 0;
const users = await db.collection('users').get();
for (const u of users.docs) {
  const tokens = Object.keys(u.data().tokens || {});
  if (!tokens.length) continue;
  const ref = db.doc(`users/${u.id}/app/state`);
  const snap = await ref.get();
  if (!snap.exists) continue;
  const S = merge(snap.data());
  if (!S.cfg) continue;

  let title, body, keys = [];
  if (test) {
    title = 'Payoff test'; body = 'Notifications from the daily reminder job are working.';
  } else {
    const due = dueReminders(S, t);
    if (!due.length) continue;
    keys = due.map(r => r.key);
    if (due.length === 1) { title = due[0].title; body = due[0].body; }
    else {
      const total = due.reduce((a, r) => a + r.left, 0);
      title = `${due.length} payments coming up (${money(total, 2)})`;
      body = due.map(r => `${r.name}: ${money(r.left, 2)} ${r.n === 0 ? 'today' : r.n === 1 ? 'tomorrow' : 'in ' + r.n + ' days'}`).join('\n');
    }
  }

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: { notification: { icon: appUrl ? appUrl + 'icons/icon-192.png' : undefined }, fcmOptions: appUrl ? { link: appUrl + '#today' } : undefined }
  });
  sent += res.successCount;

  // Forget devices that no longer accept notifications.
  const dead = {};
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead['tokens.' + tokens[i]] = admin.firestore.FieldValue.delete();
  });
  if (Object.keys(dead).length) await u.ref.update(dead);

  // Remember what was sent so the same reminder never goes out twice.
  if (keys.length && res.successCount) {
    const notified = Object.fromEntries(keys.map(k => [k, Date.now()]));
    await ref.set({ notified }, { merge: true });
  }
  console.log(`user ${u.id.slice(0, 6)}…: ${res.successCount} sent, ${res.failureCount} failed`);
}
console.log(`Done. ${sent} notification(s) sent for ${t.toDateString()}.`);
