// GET /api/health -- "is the server connected to Firebase?" Used once while setting up sign-in.
// Says whether the service-account key is set and whether the shared data can be read, plus the
// project name and how many staff/students it sees. It never returns any of the data itself.
const { db, serviceAccount } = require("./_firebase");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const sa = serviceAccount();
  if (!sa) {
    res.status(200).json({ ok: false, problem: "The FIREBASE_SERVICE_ACCOUNT setting is missing in Vercel (or isn't the whole downloaded file)." });
    return;
  }
  try {
    const snap = await db().collection("app").doc("state").get();
    if (!snap.exists) { res.status(200).json({ ok: false, project: sa.project_id, problem: "Connected, but there's no app/state document in this project." }); return; }
    const s = snap.data() || {};
    res.status(200).json({ ok: true, project: sa.project_id, staff: (s.staff || []).length, students: (s.roster || []).length });
  } catch (e) {
    res.status(200).json({ ok: false, project: sa.project_id, problem: "Couldn't read the data: " + (e.message || String(e)).slice(0, 200) });
  }
};
