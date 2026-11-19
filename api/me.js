// POST /api/me  { action: "changePassword", current, next }  (anyone signed in)
//
// Lets a person change their own password: the current one has to be right, and the new one
// needs at least 6 characters. Stored scrambled in creds/, like every password.
const S = require("./_server");

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.send(res, 405, { ok: false, error: "Use POST." });
  try {
    const me = await S.caller(req);
    const b = S.body(req);
    if (b.action !== "changePassword") return S.send(res, 400, { ok: false, error: "Unknown action." });
    const next = String(b.next || "");
    if (next.length < 6) return S.send(res, 400, { ok: false, error: "Choose a new password with at least 6 characters." });
    const cred = await S.credRef(me.ptype, me.id).get();
    const good = cred.exists && cred.data().hash ? await S.checkPassword(b.current || "", cred.data().hash)
      : (typeof me.rec.password === "string" && me.rec.password !== "" && me.rec.password === String(b.current || ""));
    if (!good) return S.send(res, 401, { ok: false, error: "Your current password isn’t right." });
    await S.credRef(me.ptype, me.id).set({ hash: await S.hashPassword(next), setAt: Date.now(), setBy: "themselves" });
    await S.audit({ uid: me.uid, name: me.name }, "changeOwnPassword", { name: me.name });
    return S.send(res, 200, { ok: true });
  } catch (e) { return S.fail(res, e); }
};
