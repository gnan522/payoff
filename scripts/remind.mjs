// Daily reminder job, run by GitHub Actions.
// Reads each user's saved plan from Firestore, works out what's due (3 days before, 1 day before, and on the day),
// and sends one push notification per user to every device they turned notifications on for.
import admin from 'firebase-admin';
import { merge, torontoToday, dueReminders, money } from '../logic.js';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('Missing FIREBASE_SERVICE_ACCOUNT secret.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
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
