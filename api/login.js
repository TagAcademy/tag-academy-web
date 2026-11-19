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

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.send(res, 405, { ok: false, error: "Use POST." });
  const { username, password } = S.body(req);
  try {
    const { ptype, rec } = await S.verifyLogin(username, password);
    const role = S.roleOf(ptype, rec);
    const token = await fb.auth().createCustomToken(S.uidFor(ptype, rec.id), { role, ptype, pid: rec.id, ta: ptype === "student" && !!rec.isTA });
    return S.send(res, 200, { ok: true, token, ptype, id: rec.id, role });
  } catch (e) { return S.fail(res, e); }
};
