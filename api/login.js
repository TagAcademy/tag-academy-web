// POST /api/login  { username, password }  ->  { ok, token }
//
// Checks a username and password on the server and, if they're right, hands back a Firebase
// sign-in pass (a custom token) for that one person, marked with who they are and their role.
// The page signs in with it; from then on Firebase knows exactly who's asking, and its rules let
// each role do only what it should. Passwords are kept scrambled (bcrypt) in creds/, which no
// browser can read. An account that still has its old plain password in the shared data (before
// "Finish moving passwords" in Admin) is checked against that once, then moved to creds/.
// Ten wrong tries on one username lock it for 15 minutes.
const fb = require("./_firebase");
const S = require("./_server");

const MAX_FAILS = 10, LOCK_MS = 15 * 60000;

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.send(res, 405, { ok: false, error: "Use POST." });
  const { username, password } = S.body(req);
  const u = String(username || "").trim().toLowerCase();
  if (!u || !password) return S.send(res, 400, { ok: false, error: "Enter your username and password." });
  try {
    const failRef = fb.db().collection("loginFails").doc(S.sha256(u).slice(0, 40));
    const failSnap = await failRef.get();
    const fails = failSnap.exists ? failSnap.data() : null;
    if (fails && fails.count >= MAX_FAILS && Date.now() - fails.last < LOCK_MS) {
      return S.send(res, 429, { ok: false, error: "Too many wrong tries. Wait 15 minutes, or ask an admin to reset your password." });
    }
    const state = await S.readState();
    if (!state) return S.send(res, 500, { ok: false, error: "No data found." });
    let ptype = "staff", rec = (state.staff || []).find((s) => String(s.username || "").toLowerCase() === u);
    if (!rec) { ptype = "student"; rec = (state.roster || []).find((s) => String(s.username || "").toLowerCase() === u); }

    let good = false;
    if (rec) {
      const cred = await S.credRef(ptype, rec.id).get();
      if (cred.exists && cred.data().hash) good = await S.checkPassword(password, cred.data().hash);
      else if (typeof rec.password === "string" && rec.password !== "" && rec.password === String(password)) {
        good = true;
        await S.credRef(ptype, rec.id).set({ hash: await S.hashPassword(password), setAt: Date.now(), setBy: "moved at first sign-in" });
      }
    }
    if (!good) {
      const prev = fails && Date.now() - fails.last < LOCK_MS ? fails.count : 0;
      await failRef.set({ count: prev + 1, last: Date.now() });
      return S.send(res, 401, { ok: false, error: "Username or password not recognized." });
    }
    if (S.isGraduated(ptype, rec)) return S.send(res, 403, { ok: false, error: "This account has graduated, so it can’t sign in. An admin can re-enroll it." });
    if (failSnap.exists) await failRef.delete();
    const role = S.roleOf(ptype, rec);
    const token = await fb.auth().createCustomToken(S.uidFor(ptype, rec.id), { role, ptype, pid: rec.id, ta: ptype === "student" && !!rec.isTA });
    return S.send(res, 200, { ok: true, token, ptype, id: rec.id, role });
  } catch (e) { return S.fail(res, e); }
};
