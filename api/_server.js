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
function fail(res, e) { send(res, e.status || 500, { ok: false, error: e.status ? e.message : "Something went wrong on the server." }); if (!e.status) console.error(e); }

module.exports = { STAFF_ROLES, send, body, uidFor, credRef, stateRef, readState, findPerson, isGraduated, roleOf, displayName, caller, changeState, hashPassword, checkPassword, sha256, audit, fail };
