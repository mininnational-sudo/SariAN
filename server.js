const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function isPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (!["http:", "https:"].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) return false;
  return true;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "SariAN", mode: "direct-media-only" });
});

/*
 * This endpoint only redirects to a direct media file URL supplied by the user.
 * It does not extract protected streaming pages, bypass DRM, or scrape platform pages.
 */
app.post("/api/direct-download", (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!isPublicHttpUrl(url)) {
    return res.status(400).json({ error: "Masukkan URL HTTPS/HTTP publik yang valid." });
  }
  const pathname = new URL(url).pathname;
  const allowed = /\.(mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg|flac|srt|vtt|txt)$/i.test(pathname);
  if (!allowed) {
    return res.status(400).json({
      error: "URL ini bukan tautan file media langsung yang dikenali. Tautan halaman YouTube/TikTok/Instagram/Facebook belum didukung."
    });
  }
  return res.json({ ok: true, downloadUrl: url });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SariAN running on port ${PORT}`);
});
