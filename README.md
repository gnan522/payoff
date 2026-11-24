# Payoff

A phone-first debt payoff tracker.

- **App:** a home-screen web app hosted on GitHub Pages (`index.html`, `app.js`, `logic.js`).
- **Sync:** Firebase Authentication (email and password) and Cloud Firestore. Each person can only read and write their own data (`firestore.rules`).
- **Reminders:** a GitHub Actions job (`.github/workflows/remind.yml`) runs every morning, works out which payments are due in 3 days, tomorrow or today, and sends a push notification through Firebase Cloud Messaging.

No personal financial data is stored in this repository. Debts, balances and payments live in your Firestore account and are loaded after you sign in.

## Setup

1. Fill in `firebase-config.js` with the web app config and Web Push (VAPID) public key from the Firebase console.
2. In Firebase: turn on Email/Password sign-in, create a Firestore database, publish `firestore.rules`, and add `<user>.github.io` to Authentication's authorized domains.
3. In GitHub: Settings → Pages → deploy from the `main` branch, root folder.
4. In Firebase: Project settings → Service accounts → Generate new private key. In GitHub: Settings → Secrets and variables → Actions → New repository secret named `FIREBASE_SERVICE_ACCOUNT`, and paste the whole JSON file. Delete the downloaded file afterwards.
5. On iPhone (iOS 16.4 or later): open the site in Safari, Share → Add to Home Screen, open it from the icon, sign in, then Plan → Turn on notifications.

To check reminders work: Actions → Daily payment reminders → Run workflow → tick "Send a test notification".
