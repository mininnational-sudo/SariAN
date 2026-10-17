const express = require("express");
const helmet = require("helmet");
const { spawn } = require("node:child_process");
const { URL } = require("node:url");
const dns = require("node:dns").promises;

const app = express();
app.use(helmet());
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const ALLOWED_HOSTS = [
  "youtube.com", "youtu.be", "youtube-nocookie.com",
  "tiktok.com", "instagram.com", "facebook.com", "fb.watch",
  "vimeo.com", "dailymotion.com"
];
const MAX_RUNTIME_MS = 120000;

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    p[0] >= 224;
}
function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") ||
    x.startsWith("fd") || x.startsWith("fe80:") || x.startsWith("::ffff:127.");
}
async function validateUrl(input) {
  let u;
  try { u = new URL(input); } catch { throw new Error("URL tidak valid."); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Hanya URL HTTP/HTTPS yang didukung.");
  if (u.username || u.password) throw new Error("URL dengan kredensial tidak diizinkan.");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Host lokal tidak diizinkan.");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIPv4(host)) {
    throw new Error("Alamat IP privat tidak diizinkan.");
  }
  if (host.includes(":") && isPrivateIPv6(host)) throw new Error("Alamat IP privat tidak diizinkan.");
  try {
    const records = await dns.lookup(host, { all: true });
    for (const r of records) {
      if ((r.family === 4 && isPrivateIPv4(r.address)) ||
          (r.family === 6 && isPrivateIPv6(r.address))) {
        throw new Error("Host mengarah ke alamat jaringan privat dan ditolak.");
      }
    }
  } catch (e) {
    if (e.message.includes("ditolak")) throw e;
    // Some public hosts may not resolve in the deployment environment; yt-dlp will report that later.
  }
  return u;
}
function hostAllowed(host) {
  return ALLOWED_HOSTS.some(d => host === d || host.endsWith("." + d));
}
function runYtDlp(args, res, filename) {
  const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), MAX_RUNTIME_MS);
  child.stderr.on("data", d => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
  child.on("error", () => {
    clearTimeout(timer);
    if (!res.headersSent) res.status(500).json({ error: "Mesin yt-dlp tidak tersedia di server." });
    else res.end();
  });
  child.on("close", code => {
    clearTimeout(timer);
    if (code !== 0 && !res.headersSent) {
      res.status(400).json({ error: "Gagal memproses tautan. Video mungkin privat, dibatasi, atau tidak didukung.", detail: stderr.slice(-1800) });
    } else if (code !== 0) res.end();
  });
  return child;
}
async function prepare(input) {
  const u = await validateUrl(input);
  if (!hostAllowed(u.hostname.toLowerCase())) {
    throw new Error("Domain belum diaktifkan. Untuk keamanan, gunakan platform yang didukung atau tambahkan domain yang sah ke konfigurasi.");
  }
  return u;
}

app.get("/", (_req, res) => {
  res.sendFile(require("node:path").join(__dirname, "index.html"));
});
app.get("/health", (_req, res) => res.json({ ok: true, service: "sarian-backend" }));

app.post("/api/analyze", async (req, res) => {
  try {
    const input = req.body && req.body.url;
    if (typeof input !== "string" || !input.trim()) return res.status(400).json({ error: "Isi kolom url." });
    const u = await prepare(input.trim());
    const child = runYtDlp(["--no-warnings", "--no-playlist", "--dump-single-json", "--skip-download", "--socket-timeout", "15", u.toString()], res);
    let out = "";
    child.stdout.on("data", d => { out += d.toString(); if (out.length > 2_000_000) child.kill("SIGKILL"); });
    child.on("close", code => {
      if (res.headersSent) return;
      if (code !== 0) return;
      try {
        const x = JSON.parse(out);
        res.json({
          ok: true,
          title: x.title || "Media",
          duration: x.duration || null,
          uploader: x.uploader || x.channel || null,
          thumbnail: x.thumbnail || null,
          webpage_url: x.webpage_url || u.toString(),
          formats_available: Array.isArray(x.formats) ? x.formats.length : null
        });
      } catch {
        res.status(502).json({ error: "Respons metadata tidak dapat dibaca." });
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message || "Permintaan tidak valid." });
  }
});

app.post("/api/download", async (req, res) => {
  try {
    const input = req.body && req.body.url;
    if (typeof input !== "string" || !input.trim()) return res.status(400).json({ error: "Isi kolom url." });
    const u = await prepare(input.trim());
    // Stream the selected best MP4-compatible result directly to the client; no permanent file storage.
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'attachment; filename="sarian-video.mp4"');
    const child = runYtDlp([
      "--no-warnings", "--no-playlist", "--no-part",
      "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "-o", "-", u.toString()
    ], res);
    child.stdout.pipe(res);
    child.on("close", code => { if (code !== 0 && !res.writableEnded) res.end(); });
    req.on("close", () => { if (!res.writableEnded) child.kill("SIGTERM"); });
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ error: e.message || "Permintaan tidak valid." });
  }
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: "Kesalahan server." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SariAN backend listening on ${PORT}`);
});
