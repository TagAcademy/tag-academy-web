// Shared by the server functions in api/ (Vercel doesn't serve files starting with "_" as pages).
//
// The server talks to Firebase with the project's service-account key, kept in Vercel as the
// private setting FIREBASE_SERVICE_ACCOUNT (the downloaded JSON, pasted whole). It never appears
// in index.html or anywhere a browser can see it. With it the server can read the data, check
// passwords, and give each person who signs in their own Firebase pass (a custom token) that says
// who they are and what they're allowed to do.
const admin = require("firebase-admin");

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function app() {
  if (admin.apps.length) return admin.app();
  const sa = serviceAccount();
  if (!sa) throw Object.assign(new Error("FIREBASE_SERVICE_ACCOUNT is missing or isn't valid JSON"), { code: "no-service-account" });
  return admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const db = () => app().firestore();
const auth = () => app().auth();

module.exports = { admin, app, db, auth, serviceAccount };
