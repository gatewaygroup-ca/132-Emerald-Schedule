/* ============================================================
   FIREBASE CONFIG — TEMPLATE / PLACEHOLDER
   ------------------------------------------------------------
   This is a BLANK MASTER TEMPLATE. Do not commit a real Firebase
   config into this file in the master repo.

   Setup for a NEW project deployment:
     1. Go to https://console.firebase.google.com and create a new
        Firebase project (one per deployed site is recommended, so
        each client's data lives in its own project — but you can
        also point several deployments at one Firebase project; see
        README.md "Duplicating this repo for a new project").
     2. Enable: Realtime Database, Authentication (Email/Password),
        and Storage.
     3. Project settings > General > Your apps > Web app > copy the
        config object below.
     4. Rename this file to firebase-config.js (it's already in
        .gitignore so you never accidentally commit real keys) OR,
        if you're fine with this client-side config being public
        (it is NOT a secret — see note below), just fill in the
        values here and rename the file.
     5. Publish firebase-database-rules.json in Database > Rules,
        and the storage rules in Storage > Rules (see
        firebase-storage-rules.txt in this repo).

   This config object is CLIENT-SIDE and safe to ship in a public
   repo — it only identifies which Firebase project to talk to. It
   grants no access by itself; real permissions come from the
   security rules files mentioned above. Never put a Firebase Admin
   SDK service-account key (a private server-side secret) here or
   anywhere in this repo.
   ============================================================ */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
const storage = firebase.storage();
