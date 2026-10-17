const express = require("express");
const helmet = require("helmet");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const { URL } = require("node:url");

const app = express();
app.use(helmet());
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const MAX_RUNTIME_MS = 180000;
const MAX_FILE_SIZE = 500 * 1024 * 1024;

const ALLOWED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "vimeo.com",
  "dailymotion.com"
];

function hostAllowed(host) {
  host = host.toLowerCase().replace(/\.$/, "");

  return ALLOWED_HOSTS.some(
    domain => host === domain || host.endsWith("." + domain)
  );
}

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);

  if (
    p.length !== 4 ||
    p.some(n => !Number.isInteger(n) || n < 0 || n > 255)
  ) return true;

  return (
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    p[0] >= 224
  );
}

async function validateUrl(value) {
  let u;

  try {
    u = new URL(value);
  } catch {
    throw new Error("Tautan tidak valid.");
  }

  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Tautan harus menggunakan HTTP atau HTTPS.");
  }

  if (u.username || u.password) {
    throw new Error("Tautan dengan username atau password ditolak.");
  }

  const host = u.hostname.toLowerCase().replace(/\.$/, "");

  if (!hostAllowed(host)) {
    throw new Error("Platform ini belum didukung.");
  }

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    throw new Error("Alamat lokal tidak diizinkan.");
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIPv4(host)) {
    throw new Error("Alamat IP privat tidak diizinkan.");
  }

  if (host.includes(":")) {
    throw new Error("Alamat IP langsung tidak didukung.");
  }

  try {
    const records = await dns.lookup(host, { all: true });

    if (records.some(record =>
      record.family === 4
        ? isPrivateIPv4(record.address)
        : record.address === "::1" ||
          record.address === "::" ||
          /^(fc|fd|fe80:)/i.test(record.address)
    )) {
      throw new Error("Alamat jaringan privat ditolak.");
    }
  } catch (error) {
    if (error.message.includes("ditolak")) throw error;

    throw new Error(
      "Domain tidak dapat diperiksa dari server. Coba lagi nanti."
    );
  }

  return u;
}

function runDownload(url, directory) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(directory, "sarian.%(ext)s");

    const args = [
      "--no-warnings",
      "--no-playlist",
      "--no-part",
      "--no-progress",
      "--socket-timeout", "20",
      "--max-filesize", String(MAX_FILE_SIZE),
      "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "-o", outputTemplate,
      url
    ];

    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, MAX_RUNTIME_MS);

    function finish(error, file) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (error) reject(error);
      else resolve(file);
    }

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();

      if (stderr.length > 6000) {
        stderr = stderr.slice(-6000);
      }
    });

    child.on("error", error => {
      if (error.code === "ENOENT") {
        finish(new Error(
          "yt-dlp tidak tersedia. Server harus menjalankan lingkungan yang memasang yt-dlp dan FFmpeg."
        ));
      } else {
        finish(new Error("Mesin download gagal dijalankan."));
      }
    });

    child.on("close", async code => {
      if (timedOut) {
        return finish(new Error(
          "Waktu download habis. Coba video yang lebih pendek."
        ));
      }

      if (code !== 0) {
        const detail = stderr.toLowerCase();

        if (
          detail.includes("ffmpeg") &&
          (detail.includes("not found") || detail.includes("not installed"))
        ) {
          return finish(new Error(
            "FFmpeg belum tersedia pada server."
          ));
        }

        if (
          detail.includes("sign in") ||
          detail.includes("login") ||
          detail.includes("private")
        ) {
          return finish(new Error(
            "Video privat atau memerlukan login. Video seperti ini tidak dapat diproses."
          ));
        }

        return finish(new Error(
          "Download gagal. Periksa log server untuk mengetahui penyebabnya."
        ));
      }

      try {
        const files = await fsp.readdir(directory);

        const candidates = files
          .filter(name => /^sarian\./.test(name))
          .map(name => path.join(directory, name));

        let selected = null;

        for (const file of candidates) {
          const stat = await fsp.stat(file);

          if (stat.isFile() && stat.size > 0) {
            selected = file;
            break;
          }
        }

        if (!selected) {
          return finish(new Error(
            "Server selesai memproses, tetapi file video tidak ditemukan."
          ));
        }

        finish(null, selected);
      } catch {
        finish(new Error("Hasil download tidak dapat dibaca."));
      }
    });
  });
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "sarian-backend"
  });
});

app.post("/api/download", async (req, res) => {
  let directory = null;

  try {
    const input = req.body && req.body.url;

    if (typeof input !== "string" || !input.trim()) {
      return res.status(400).json({
        error: "Masukkan tautan video terlebih dahulu."
      });
    }

    const url = await validateUrl(input.trim());

    directory = path.join(
      os.tmpdir(),
      "sarian-" + crypto.randomUUID()
    );

    await fsp.mkdir(directory, { recursive: true });

    console.log("Download dimulai:", url.hostname);

    const file = await runDownload(url.toString(), directory);

    if (res.destroyed) return;

    const stat = await fsp.stat(file);

    res.setHeader(
      "Content-Type",
      file.toLowerCase().endsWith(".mp4")
        ? "video/mp4"
        : "application/octet-stream"
    );

    res.setHeader(
      "Content-Length",
      String(stat.size)
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sarian-video' +
      path.extname(file) +
      '"'
    );

    const stream = fs.createReadStream(file);

    stream.on("error", error => {
      console.error("Kesalahan membaca file:", error.message);

      if (!res.headersSent) {
        res.status(500).json({
          error: "File hasil download gagal dikirim."
        });
      } else {
        res.destroy();
      }
    });

    stream.on("close", async () => {
      if (directory) {
        await fsp.rm(directory, {
          recursive: true,
          force: true
        }).catch(() => {});
      }
    });

    res.on("close", () => {
      if (!res.writableEnded) {
        stream.destroy();
      }
    });

    stream.pipe(res);

  } catch (error) {
    console.error("Download gagal:", error.message);

    if (!res.headersSent && !res.destroyed) {
      res.status(400).json({
        error: error.message || "Download gagal diproses."
      });
    }

    if (directory) {
      await fsp.rm(directory, {
        recursive: true,
        force: true
      }).catch(() => {});
    }
  }
});

app.use((error, _req, res, _next) => {
  console.error("Kesalahan server:", error.message);

  if (!res.headersSent) {
    res.status(500).json({
      error: "Terjadi kesalahan pada server."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SariAN backend listening on " + PORT);
});
