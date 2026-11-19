// POST /api/canteen  { key, action, ... }  -- the shared canteen tablet.
//
// The tablet never signs in to the data itself. It holds only a canteen key (made in
// Canteen > "Canteen tablet", which stores just a scrambled copy in secrets/canteen) and can:
//   items {}                                  the items for sale, with prices and stock
//   buy   { username, password, cart, date }  a student pays with their own coins: their
//                                             username and password are checked for this one
//                                             purchase (same lockout as the sign-in page);
//                                             students and staff both pay from their own coins
//   payOther { method: "cash"|"coins", cart, date }  paid into the canteen box instead (cash, or
//                                             physical TAG coins): records the sale and the stock
const S = require("./_server");
const canteen = require("./_canteen");

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.send(res, 405, { ok: false, error: "Use POST." });
  const b = S.body(req);
  try {
    if (!(await S.keyOk("canteen", b.key))) return S.send(res, 401, { ok: false, error: "This tablet isn’t connected — open the link from Canteen › Canteen tablet on it." });
    if (b.action === "items") {
      const st = await S.readState();
      return S.send(res, 200, { ok: true, items: canteen.itemsForShop(st || {}) });
    }
    if (b.action === "payOther") {
      let out = null;
      await S.changeState((st) => { out = canteen.sellOther(st, b.cart, b.method, { by: "Canteen tablet" }, "tablet", b.date); return st; });
      await S.audit({ uid: "canteen_tablet", name: "Canteen tablet" }, "canteenBuy", { total: out.total, items: out.lines, method: b.method, via: "tablet" });
      return S.send(res, 200, { ok: true, total: out.total, method: b.method });
    }
    if (b.action === "buy") {
      const { ptype, rec } = await S.verifyLogin(b.username, b.password);
      if (S.roleOf(ptype, rec) === "family") return S.send(res, 403, { ok: false, error: "This account can’t buy at the canteen." });
      const name = S.displayName(ptype, rec);
      let out = null;
      await S.changeState((st) => {
        const me = S.findPerson(st, ptype, rec.id);
        if (!me || S.isGraduated(ptype, me)) throw Object.assign(new Error("This account can’t buy anymore."), { status: 403 });
        out = canteen.buy(st, { ptype, id: rec.id }, b.cart, name, "tablet", b.date);
        return st;
      });
      await S.audit({ uid: S.uidFor(ptype, rec.id), name }, "canteenBuy", { total: out.total, items: out.lines, via: "tablet" });
      return S.send(res, 200, { ok: true, first: ptype === "staff" ? String(rec.name || "").split(" ")[0] : rec.first, total: out.total, balance: out.balance });
    }
    return S.send(res, 400, { ok: false, error: "Unknown action." });
  } catch (e) { return S.fail(res, e); }
};
