// Pieces the sign-in and action endpoints share: who's asking, reading/changing the shared data
// (app/state) safely, passwords, and the change log. Server-only collections (no browser can read
// or write them -- see the Firestore rules): creds/{who} scrambled passwords, loginFails/{name}
// lockouts, audit/ the change log, backups/ copies of app/state, secrets/tv the TV key.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const fb = require("./_firebase");

const STAFF_ROLES = ["admin", "teacher", "limited", "family"];

function send(res, code, body) { res.setHeader("Cache-Control", "no-store"); res.status(code).json(body); }
function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}
// Each person's Firebase identity: "staff_<id>" or "student_<id>".
const uidFor = (ptype, id) => ptype + "_" + id;
const credRef = (ptype, id) => fb.db().collection("creds").doc(uidFor(ptype, id));
const stateRef = () => fb.db().collection("app").doc("state");

async function readState() { const s = await stateRef().get(); return s.exists ? s.data() : null; }
function findPerson(state, ptype, id) { return ((ptype === "staff" ? state.staff : state.roster) || []).find((r) => r.id === id) || null; }
function isGraduated(ptype, rec) { return ptype === "staff" ? rec.graduated === true : rec.active === false; }
function roleOf(ptype, rec) { return ptype === "staff" ? (STAFF_ROLES.includes(rec.role) ? rec.role : "teacher") : "student"; }
function displayName(ptype, rec) { return ptype === "staff" ? rec.name : (rec.first + " " + rec.last); }

// The signed-in caller, from the "Authorization: Bearer <Firebase ID token>" header, checked
// against the current data (so someone graduated or demoted since signing in is refused).
async function caller(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  const m = /^Bearer\s+(.+)$/.exec(h);
  if (!m) throw Object.assign(new Error("Not signed in."), { status: 401 });
  let tok;
  try { tok = await fb.auth().verifyIdToken(m[1], true); } catch (e) { throw Object.assign(new Error("Your sign-in has expired — sign in again."), { status: 401 }); }
  if (!tok.ptype || !tok.pid) throw Object.assign(new Error("Not signed in."), { status: 401 });
  const state = await readState();
  const rec = state && findPerson(state, tok.ptype, tok.pid);
  if (!rec || isGraduated(tok.ptype, rec)) throw Object.assign(new Error("This account can't do that anymore."), { status: 403 });
  return { uid: tok.uid, ptype: tok.ptype, id: tok.pid, role: roleOf(tok.ptype, rec), rec, name: displayName(tok.ptype, rec) };
}

// Change app/state in a transaction, the same way the app's own saves do: whatever `mutate`
// returns is written back with _rev one higher, so every open device picks it up. `mutate` may
// throw an Error with .status to refuse (nothing is written then).
async function changeState(mutate) {
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(stateRef());
    if (!snap.exists) throw Object.assign(new Error("No data found."), { status: 500 });
    const cur = snap.data();
    const next = mutate(JSON.parse(JSON.stringify(cur)));
    next._rev = (cur._rev || 0) + 1;
    tx.set(stateRef(), next);
    return next;
  });
}

async function hashPassword(pw) { return bcrypt.hash(String(pw), 10); }
async function checkPassword(pw, hash) { return bcrypt.compare(String(pw), hash); }
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

async function audit(who, action, details) {
  try { await fb.db().collection("audit").add({ at: Date.now(), who: who || null, action, details: details || {} }); } catch (e) { /* the log never blocks the action */ }
}
// Check a username and password (scrambled copy in creds/, or an old plain one still in the data,
// moved to creds/ on first use). Ten wrong tries on one username lock it for 15 minutes.
// Returns { ptype, rec } for the right person; throws with .status (401/403/429) otherwise.
const MAX_FAILS = 10, LOCK_MS = 15 * 60000;
async function verifyLogin(username, password, state) {
  const u = String(username || "").trim().toLowerCase();
  if (!u || !password) throw Object.assign(new Error("Enter your username and password."), { status: 400 });
  const failRef = fb.db().collection("loginFails").doc(sha256(u).slice(0, 40));
  const failSnap = await failRef.get();
  const fails = failSnap.exists ? failSnap.data() : null;
  if (fails && fails.count >= MAX_FAILS && Date.now() - fails.last < LOCK_MS) {
    throw Object.assign(new Error("Too many wrong tries. Wait 15 minutes, or ask an admin to reset your password."), { status: 429 });
  }
  state = state || await readState();
  if (!state) throw Object.assign(new Error("No data found."), { status: 500 });
  let ptype = "staff", rec = (state.staff || []).find((s) => String(s.username || "").toLowerCase() === u);
  if (!rec) { ptype = "student"; rec = (state.roster || []).find((s) => String(s.username || "").toLowerCase() === u); }
  let good = false;
  if (rec) {
    const cred = await credRef(ptype, rec.id).get();
    if (cred.exists && cred.data().hash) good = await checkPassword(password, cred.data().hash);
    else if (typeof rec.password === "string" && rec.password !== "" && rec.password === String(password)) {
      good = true;
      await credRef(ptype, rec.id).set({ hash: await hashPassword(password), setAt: Date.now(), setBy: "moved at first sign-in" });
    }
  }
  if (!good) {
    const prev = fails && Date.now() - fails.last < LOCK_MS ? fails.count : 0;
    await failRef.set({ count: prev + 1, last: Date.now() });
    throw Object.assign(new Error("Username or password not recognized."), { status: 401 });
  }
  if (isGraduated(ptype, rec)) throw Object.assign(new Error("This account has graduated, so it can’t sign in. An admin can re-enroll it."), { status: 403 });
  if (failSnap.exists) await failRef.delete();
  return { ptype, rec };
}

// A device key (the hallway TV, the canteen tablet): only its sha256 is kept, in secrets/<name>.
async function keyOk(name, key) {
  if (!key || String(key).length < 20) return false;
  const snap = await fb.db().collection("secrets").doc(name).get();
  return (snap.exists ? (snap.data().keyHashes || []) : []).includes(sha256(key));
}

function fail(res, e) { send(res, e.status || 500, { ok: false, error: e.status ? e.message : "Something went wrong on the server." }); if (!e.status) console.error(e); }

module.exports = { STAFF_ROLES, send, body, uidFor, credRef, stateRef, readState, findPerson, isGraduated, roleOf, displayName, caller, changeState, hashPassword, checkPassword, sha256, audit, fail, verifyLogin, keyOk };
