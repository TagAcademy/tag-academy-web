// POST /api/me  { action, ... }  (anyone signed in -- a student or staff)
//
//   changePassword { current, next }  change their own password: the current one has to be right,
//                  and the new one needs at least 6 characters. Stored scrambled in creds/.
//   buy  { cart: [{id, qty}], date, method }  buy from the canteen: method "tag" (default) takes it
//                  from their own TAG coins; "cash" / "coins" (physical TAG coins, into the canteen
//                  box) just records the sale and the stock (see _canteen.js)
const S = require("./_server");
const canteen = require("./_canteen");

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.send(res, 405, { ok: false, error: "Use POST." });
  try {
    const me = await S.caller(req);
    const b = S.body(req);
    if (b.action === "buy") {
      if (me.role === "family") return S.send(res, 403, { ok: false, error: "This account can’t buy at the canteen." });
      let out = null;
      const method = b.method === "cash" || b.method === "coins" ? b.method : "tag";
      const tag = me.ptype === "staff" ? { staffId: me.id } : { studentId: me.id };
      await S.changeState((st) => {
        out = method === "tag" ? canteen.buy(st, { ptype: me.ptype, id: me.id }, b.cart, me.name, "phone", b.date) : canteen.sellOther(st, b.cart, method, Object.assign({ by: me.name }, tag), "phone", b.date);
        return st;
      });
      await S.audit({ uid: me.uid, name: me.name }, "canteenBuy", { total: out.total, items: out.lines, method });
      return S.send(res, 200, { ok: true, total: out.total, balance: out.balance, method });
    }
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
