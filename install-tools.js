const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { spawnSync } = require("node:child_process");

const FILE = path.join(__dirname, "yt-dlp");
const URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) {
      return reject(new Error("Terlalu banyak redirect."));
    }

    https.get(url, response => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();

        const next = new URL(
          response.headers.location,
          url
        ).toString();

        return resolve(download(next, redirects + 1));
      }

      if (response.statusCode !== 200) {
        response.resume();

        return reject(
          new Error("Download gagal: HTTP " + response.statusCode)
        );
      }

      const temp = FILE + ".download";

      pipeline(
        response,
        fs.createWriteStream(temp, { mode: 0o755 })
      ).then(() => {
        const size = fs.statSync(temp).size;

        if (size < 1000000) {
          fs.rmSync(temp, { force: true });
          return reject(new Error("File binary tidak lengkap."));
        }

        fs.renameSync(temp, FILE);
        fs.chmodSync(FILE, 0o755);

        resolve();
      }).catch(reject);
    }).on("error", reject);
  });
}

(async () => {
  try {
    if (!fs.existsSync(FILE)) {
      console.log("Mengunduh yt-dlp untuk Linux...");
      await download(URL);
    }

    const result = spawnSync(FILE, ["--version"], {
      encoding: "utf8",
      timeout: 15000
    });

    if (result.error || result.status !== 0) {
      throw new Error(
        result.error?.message ||
        result.stderr ||
        "Binary tidak dapat dijalankan."
      );
    }

    console.log("yt-dlp siap:", result.stdout.trim());
  } catch (error) {
    console.error("INSTALL TOOLS GAGAL:", error.message);
    process.exitCode = 1;
  }
})();
