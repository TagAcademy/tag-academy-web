// POST /api/student  { action, ... }  (signed in as a student)
//
// The only changes a student can make to the shared data, each checked here -- the Firestore
// rules don't let a student's device write it directly:
//   avatar  { url }                       their own avatar ("gallery:<n>", or null for the default)
//   pool    { poolId, amount }            chip into an open pool, never more than their balance
//   chazzan { date, period, studentIds }  (TAs only) record who led davening, granting the coins
// Balances and Chazzan amounts are worked out with the app's own code (lib/appcode.js).
const S = require("./_server");
const { withState } = require("../lib/appcode");

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.send(res, 405, { ok: false, error: "Use POST." });
  try {
    const me = await S.caller(req);
    if (me.ptype !== "student") return S.send(res, 403, { ok: false, error: "Students only." });
    const b = S.body(req);
    const who = { uid: me.uid, name: me.name };
    const refuse = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };

    if (b.action === "avatar") {
      const url = b.url === null ? null : String(b.url || "");
      if (url !== null && !/^gallery:\d{1,3}$/.test(url)) return S.send(res, 400, { ok: false, error: "Pick one of the avatars." });
      await S.changeState((st) => { const r = S.findPerson(st, "student", me.id); if (r) { if (url) r.photoUrl = url; else delete r.photoUrl; } return st; });
      return S.send(res, 200, { ok: true });
    }

    if (b.action === "pool") {
      const amount = r2(b.amount);
      let title = "";
      await S.changeState((st) => {
        const pool = (st.pools || []).find((p) => p.id === b.poolId);
        if (!pool || pool.status !== "open") refuse("That pool isn’t open anymore.");
        if (!(amount > 0)) refuse("Enter how many coins.");
        const bal = withState(st).computeStats(me.id, {}).balance;
        if (amount > bal + 1e-9) refuse("You only have " + Math.round(bal * 100) / 100 + " TAG coins.");
        title = pool.title;
        st.ledger = st.ledger || [];
        st.ledger.push({ id: "l_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), date: todayIso(), studentId: me.id, type: "Spent/Redeemed", amount, poolId: pool.id, note: "Chipped in: " + pool.title, enteredBy: me.name, enteredAt: Date.now() });
        return st;
      });
      await S.audit(who, "pool", { poolId: b.poolId, title, amount });
      return S.send(res, 200, { ok: true });
    }

    if (b.action === "chazzan") {
      if (!me.rec.isTA) return S.send(res, 403, { ok: false, error: "Only a TA can record the chazzan." });
      const date = String(b.date || ""), period = String(b.period || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return S.send(res, 400, { ok: false, error: "Pick a date." });
      await S.changeState((st) => {
        const app = withState(st);
        if (!Object.prototype.hasOwnProperty.call(app.CHAZZAN_COIN_TABLE, period)) refuse("Pick a tefilah.");
        const ids = Array.from(new Set((b.studentIds || []).filter(Boolean))).slice(0, 2);
        if (ids.some((id) => id !== app.CHAZZAN_OTHER && !S.findPerson(st, "student", id))) refuse("Pick students from the list.");
        // The same change the app's applyChazzanChoice makes.
        st.settings = st.settings || {}; st.settings.chazzan = st.settings.chazzan || {}; st.settings.chazzan[date] = st.settings.chazzan[date] || {};
        st.ledger = st.ledger || [];
        const prefix = app.chazzanLedgerPrefix(date, period);
        st.ledger = st.ledger.filter((tx) => !String(tx.id).startsWith(prefix));
        if (ids.length) {
          st.settings.chazzan[date][period] = { studentIds: ids };
          const share = app.chazzanShareFor(period, date, ids.length);
          const hasOther = ids.includes(app.CHAZZAN_OTHER);
          const note = "Chazzan — " + period + (ids.length === 2 ? (hasOther ? " (half, with a non-student)" : " (split)") : "");
          ids.filter((id) => id !== app.CHAZZAN_OTHER).forEach((studentId) => st.ledger.push({ id: app.chazzanLedgerId(date, period, studentId), date, studentId, type: "Chazzan Bonus", amount: share, period, note, enteredBy: me.name, enteredAt: Date.now() }));
        } else delete st.settings.chazzan[date][period];
        return st;
      });
      await S.audit(who, "chazzan", { date, period, studentIds: b.studentIds || [] });
      return S.send(res, 200, { ok: true });
    }
    return S.send(res, 400, { ok: false, error: "Unknown action." });
  } catch (e) { return S.fail(res, e); }
};
