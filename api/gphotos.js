// GET /api/gphotos?url=<Google Photos shared-album link>
//
// Reads a Google Photos album that's shared by link and returns its photos, for the hallway TV
// (index.html, TV mode). Google no longer lets outside apps read albums through its API, and a web
// page can't fetch the album page itself (no CORS), so this small Vercel function does it: it
// loads the album's public share page and picks out the photo addresses Google puts in it. Those
// addresses (lh3.googleusercontent.com/pw/...) serve each photo already turned upright, at any
// size the TV asks for (e.g. "=w1920-h1080").
//
// Only Google Photos share links are fetched (photos.app.goo.gl/... or photos.google.com/share/...),
// so this can't be used to fetch anything else.
const ALLOWED = /^https:\/\/(photos\.app\.goo\.gl\/[A-Za-z0-9_-]+|photos\.google\.com\/(u\/\d+\/)?share\/[A-Za-z0-9_-]+(\?key=[A-Za-z0-9_-]+)?)\/?$/;

module.exports = async (req, res) => {
  const url = String((req.query && req.query.url) || "").trim();
  if (!ALLOWED.test(url)) {
    res.status(400).json({ ok: false, reason: "bad-link" });
    return;
  }
  let html, finalUrl;
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    finalUrl = r.url || url;
    if (!/^https:\/\/photos\.google\.com\//.test(finalUrl)) {
      res.status(400).json({ ok: false, reason: "not-an-album" });
      return;
    }
    if (!r.ok) {
      res.status(502).json({ ok: false, reason: "http-" + r.status });
      return;
    }
    html = await r.text();
  } catch (e) {
    res.status(502).json({ ok: false, reason: "network" });
    return;
  }

  // Each photo appears in the page's data as ["https://lh3.googleusercontent.com/pw/<id>",width,height,...].
  // (The album owner's picture is lh3.../a/..., not /pw/, so it's left out.)
  const seen = new Set();
  const photos = [];
  const re = /\["(https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]{20,})",(\d+),(\d+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    photos.push({ url: m[1], w: Number(m[2]), h: Number(m[3]) });
  }
  // Fallback if Google changes the layout: any /pw/ address at all, in page order.
  if (!photos.length) {
    const re2 = /"(https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]{20,})"/g;
    while ((m = re2.exec(html))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      photos.push({ url: m[1], w: 0, h: 0 });
    }
  }
  const t = /<title>([^<]*)<\/title>/.exec(html);
  const title = t ? t[1].replace(/\s*[-–—]\s*Google Photos\s*$/i, "").trim() : "";
  if (!photos.length) {
    res.status(200).json({ ok: false, reason: "no-photos", title });
    return;
  }
  // Cached at Vercel's edge for 5 minutes, so the TV and every phone checking the album share one fetch.
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({ ok: true, title, photos });
};
