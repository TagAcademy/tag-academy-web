// POST /api/admin  { action, ... }  (signed in as an admin)
//
//   setPassword { ptype: "staff"|"student", id, password }  set someone's password (new account,
//               reset, or changing it) and sign them out everywhere
//   signOut     { ptype, id }   sign someone out everywhere (graduated, role changed)
//   movePasswords {}            one time: copy the whole shared data to backups/, then move every
//               plain password still in it into creds/ (scrambled) and remove it from the data
//   resetAllStudents {}         a new password for every current student (returned once, to print)
//   tvKey       {}              make a new key for the hallway TV (replaces the old one)
//   log         {}              the last 100 entries of the change log
const crypto = require("crypto");
const fb = require("./_firebase");
const S = require("./_server");

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.send(res, 405, { ok: false, error: "Use POST." });
  try {
    const me = await S.caller(req);
    if (me.role !== "admin") return S.send(res, 403, { ok: false, error: "Only an admin can do that." });
    const b = S.body(req);
    const who = { uid: me.uid, name: me.name };

    if (b.action === "setPassword" || b.action === "signOut") {
      const ptype = b.ptype === "staff" ? "staff" : "student";
      const state = await S.readState();
      const rec = S.findPerson(state, ptype, b.id);
      if (!rec) return S.send(res, 404, { ok: false, error: "No such account." });
      if (b.action === "setPassword") {
        const pw = String(b.password || "");
        if (pw.length < 4) return S.send(res, 400, { ok: false, error: "Passwords need at least 4 characters." });
        await S.credRef(ptype, rec.id).set({ hash: await S.hashPassword(pw), setAt: Date.now(), setBy: me.name });
      }
      try { await fb.auth().revokeRefreshTokens(S.uidFor(ptype, rec.id)); } catch (e) { /* never signed in yet */ }
      await S.audit(who, b.action, { ptype, id: rec.id, name: S.displayName(ptype, rec) });
      return S.send(res, 200, { ok: true });
    }

    if (b.action === "movePasswords") {
      const state = await S.readState();
      const backupId = new Date().toISOString().replace(/[:.]/g, "-");
      await fb.db().collection("backups").doc(backupId).set({ at: Date.now(), by: me.name, reason: "before moving passwords", state: JSON.stringify(state) });
      let moved = 0;
      for (const [ptype, list] of [["staff", state.staff || []], ["student", state.roster || []]]) {
        for (const rec of list) {
          if (typeof rec.password !== "string" || rec.password === "") continue;
          const ref = S.credRef(ptype, rec.id);
          if (!(await ref.get()).exists) await ref.set({ hash: await S.hashPassword(rec.password), setAt: Date.now(), setBy: "moved from the shared data" });
          moved++;
        }
      }
      await S.changeState((st) => { (st.staff || []).concat(st.roster || []).forEach((r) => { delete r.password; }); return st; });
      await S.audit(who, "movePasswords", { moved, backupId });
      return S.send(res, 200, { ok: true, moved, backupId });
    }

    if (b.action === "resetAllStudents") {
      // A new random 6-digit password for every current student (graduated ones are left alone),
      // each signed out everywhere; the list comes back once, for printing.
      const state = await S.readState();
      const out = [];
      for (const rec of (state.roster || []).filter((r) => r.active !== false)) {
        const pw = String(crypto.randomInt(100000, 1000000));
        await S.credRef("student", rec.id).set({ hash: await S.hashPassword(pw), setAt: Date.now(), setBy: me.name + " (reset all)" });
        try { await fb.auth().revokeRefreshTokens(S.uidFor("student", rec.id)); } catch (e) { /* never signed in */ }
        out.push({ id: rec.id, first: rec.first, last: rec.last, username: rec.username, password: pw });
      }
      await S.audit(who, "resetAllStudents", { count: out.length });
      return S.send(res, 200, { ok: true, students: out });
    }

    if (b.action === "tvKey") {
      const key = crypto.randomBytes(24).toString("base64url");
      await fb.db().collection("secrets").doc("tv").set({ keyHashes: [S.sha256(key)], at: Date.now(), by: me.name });
      await S.audit(who, "tvKey", {});
      return S.send(res, 200, { ok: true, key });
    }

    if (b.action === "log") {
      const snap = await fb.db().collection("audit").orderBy("at", "desc").limit(100).get();
      return S.send(res, 200, { ok: true, entries: snap.docs.map((d) => d.data()) });
    }
    return S.send(res, 400, { ok: false, error: "Unknown action." });
  } catch (e) { return S.fail(res, e); }
};
