# NACI Practice Schedule

An iPhone web app that reads the **NACI Athletics Booking Schedule** Google Sheet each time it opens (and every 2 minutes while it is open). It shows:

- **Today**: what's booked in Gym A/B, Gym C, the Field and the Weight Room, plus today's games
- **Week**: the full week, with a filter for each facility
- **Free**: open slots and their credit cost, and which days are free after school
- **Games**: game schedules shared with every coach through Firebase. The 2026–27 basketball and volleyball schedules are already built in.

The teachers don't need to change anything. The app finds each week's tab by its dates ("Nov 23-27", "Nov 30 - Dec 4", "Sept 28-Oct 2"…).

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app |
| `manifest.json`, `icon-180.png`, `icon-512.png` | Home-screen name and icon |
| `firestore.rules` | Database security rules (paste into Firebase) |

## Setup (about 10 minutes)

### 1. GitHub
1. Create a new repo, e.g. **gnan522/practice**.
2. **Add file → Upload files**, then drag in `index.html`, `manifest.json`, `icon-180.png` and `icon-512.png`. Commit.
3. **Settings → Pages → Source: Deploy from a branch → main / (root)**. Save.
4. After a minute the app is live at `https://gnan522.github.io/practice/`.

At this point the schedule already works. Games are saved on the phone only until step 2 is done.

### 2. Firebase (so everyone shares the same games)
1. Go to console.firebase.google.com. Use your existing project or **Add project** (e.g. `naci-practice`).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Authentication → Settings → Authorized domains → Add domain →** `gnan522.github.io`
4. **Build → Firestore Database → Create database** (production mode, region `northamerica-northeast2` (Toronto)).
5. **Firestore → Rules**: replace everything with the contents of `firestore.rules` and click **Publish**.
6. **Project settings (gear) → General → Your apps → `</>` Web** → register the app → copy the `firebaseConfig` object.
7. In `index.html` on GitHub (pencil icon), find `const FIREBASE_CONFIG = null;` near the top of the script and replace `null` with the config you copied:
   ```js
   const FIREBASE_CONFIG = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…"
   };
   ```
   Commit.

### 3. iPhone
Open the link in **Safari → Share → Add to Home Screen**. Each coach opens **Settings** in the app, types an email and password, and taps **Create account**. Anyone with the link can see games; only signed-in coaches can add or edit them.

The first time anyone signs in, the built-in basketball and volleyball games are copied into Firebase once. After that, edits and deletions are shared with everyone.

## Adding games in bulk
**Games → Paste schedule**, one game per line:
```
2026-12-03, 3:30, Sr Boys Basketball, Thistletown CI, Home, Gym A/B
Dec 10, 4:00pm, Jr Boys Basketball, Martingrove, Away, , Bus leaves 3:00
```
Order: date, time, team, opponent, Home/Away, location, notes.

## Good to know
- The sheet must stay shared as **Anyone with the link can view**.
- If the teachers name a week's tab oddly, set its exact name under **Settings → Week tab name**. That setting is shared with everyone.
- Games marked with "@" in the sheet (e.g. "TCI @ NACI") are tagged **Game** automatically.
- **Settings → My team** (e.g. "basketball") marks your practices as **Yours**.
- Credit values and the Friday 3 PM open-booking rule come from the sheet's FYI tab.
