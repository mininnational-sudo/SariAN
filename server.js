const express = require("express");
const helmet = require("helmet");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const MAX_RUNTIME_MS = 180000;
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const YTDLP = path.join(__dirname, "yt-dlp");
const FFMPEG = require("@ffmpeg-installer/ffmpeg").path;

function validateYouTube(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Tautan tidak valid.");
  }

  const host = url.hostname.toLowerCase();

  if (
    !["youtube.com", "www.youtube.com", "m.youtube.com",
      "youtu.be", "www.youtube-nocookie.com",
      "youtube-nocookie.com"].includes(host)
  ) {
    throw new Error("Masukkan tautan YouTube yang valid.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Tautan harus HTTP atau HTTPS.");
  }

  return url;
}

function runDownload(url, directory) {
  return new Promise((resolve, reject) => {
    const output = path.join(directory, "sarian.%(ext)s");

    const args = [
      "--no-warnings",
      "--no-playlist",
      "--no-part",
      "--no-progress",
      "--socket-timeout", "20",
      "--max-filesize", String(MAX_FILE_SIZE),
      "--ffmpeg-location", FFMPEG,
      "-f", "best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "-o", output,
      url
    ];

    let stderr = "";
    let finished = false;

    const child = spawn(YTDLP, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, MAX_RUNTIME_MS);

    function done(error, file) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(file);
    }

    child.stderr.on("data", chunk => {
      stderr = (stderr + chunk.toString()).slice(-5000);
    });

    child.on("error", error => {
      done(new Error(
        "yt-dlp gagal dijalankan: " + error.message
      ));
    });

    child.on("close", async code => {
      if (code !== 0) {
        return done(new Error(
          "Download gagal: " + (stderr.split("\n")[0] || "periksa log server")
        ));
      }

      try {
        const files = await fsp.readdir(directory);

        for (const name of files) {
          if (!name.startsWith("sarian.")) continue;

          const file = path.join(directory, name);
          const stat = await fsp.stat(file);

          if (stat.isFile() && stat.size > 0) {
            return done(null, file);
          }
        }

        done(new Error("File hasil download tidak ditemukan."));
      } catch (error) {
        done(error);
      }
    });
  });
}

app.get("/", (_req, res) => {
  const index = path.join(__dirname, "index.html");

  if (fs.existsSync(index)) return res.sendFile(index);

  res.send("SariAN YouTube Downloader aktif.");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sarian-backend" });
});

app.get("/api/check-tools", (_req, res) => {
  let ytdlp = false;
  let ffmpeg = false;
  let version = "";

  try {
    version = execFileSync(YTDLP, ["--version"], {
      encoding: "utf8",
      timeout: 10000
    }).trim();
    ytdlp = true;
  } catch {}

  try {
    execFileSync(FFMPEG, ["-version"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: "ignore"
    });
    ffmpeg = true;
  } catch {}

  res.json({
    ok: ytdlp && ffmpeg,
    tools: {
      "yt-dlp": ytdlp ? version : "TIDAK TERSEDIA",
      ffmpeg: ffmpeg ? "TERPASANG" : "TIDAK TERSEDIA"
    }
  });
});

app.post("/api/download", async (req, res) => {
  let directory;

  try {
    if (!fs.existsSync(YTDLP)) {
      throw new Error("yt-dlp belum terpasang. Periksa log deployment.");
    }

    const input = req.body?.url;

    if (typeof input !== "string" || !input.trim()) {
      throw new Error("Masukkan tautan YouTube.");
    }

    const url = validateYouTube(input.trim());

    directory = path.join(os.tmpdir(), "sarian-" + crypto.randomUUID());
    await fsp.mkdir(directory, { recursive: true });

    const file = await runDownload(url.toString(), directory);
    const stat = await fsp.stat(file);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sarian-video' + path.extname(file) + '"'
    );

    const stream = fs.createReadStream(file);

    stream.on("error", () => res.destroy());

    stream.on("close", () => {
      fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
    });

    res.on("close", () => {
      if (!res.writableEnded) stream.destroy();
    });

    stream.pipe(res);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      res.status(400).json({ error: error.message });
    }

    if (directory) {
      await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SariAN backend running on port " + PORT);
});
