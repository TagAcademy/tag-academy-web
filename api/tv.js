// POST /api/tv  { key }  ->  { ok, token }
//
// The hallway TV signs in with its own key (made in Admin > TV Display > "Connect a TV", which
// stores only a scrambled copy in secrets/tv) and gets a "tv" pass: it can read what it shows
// and report that it's online, nothing else.
const fb = require("./_firebase");
const S = require("./_server");

module.exports = async (req, res) => {
  if (req.method !== "POST") return S.send(res, 405, { ok: false, error: "Use POST." });
  const { key } = S.body(req);
  if (!key || String(key).length < 20) return S.send(res, 400, { ok: false, error: "This TV isn’t connected yet." });
  try {
    const snap = await fb.db().collection("secrets").doc("tv").get();
    const keys = snap.exists ? (snap.data().keyHashes || []) : [];
    if (!keys.includes(S.sha256(key))) return S.send(res, 401, { ok: false, error: "This TV’s connection was replaced or removed — connect it again from Admin › TV Display." });
    const token = await fb.auth().createCustomToken("tv_hallway", { role: "tv" });
    return S.send(res, 200, { ok: true, token });
  } catch (e) { return S.fail(res, e); }
};
