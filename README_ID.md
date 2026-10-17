# SariAN Backend — starter

Backend Node.js untuk diuji sebelum disambungkan ke website SariAN.

## Endpoint
- `GET /` — status layanan
- `GET /health` — pemeriksaan kesehatan
- `POST /api/analyze` — membaca metadata media
- `POST /api/download` — mencoba mengirim media sebagai unduhan

Contoh body JSON:
```json
{"url":"https://contoh-platform.com/tautan-video"}
```

## Jalankan lokal
Memerlukan Node.js 20+, Docker, dan yt-dlp. Cara termudah:
```bash
docker build -t sarian-backend .
docker run --rm -p 3000:3000 sarian-backend
```
Lalu buka `http://localhost:3000/health`.

## Deploy Render (jalur A1)
1. Unggah isi folder ini ke repositori GitHub baru.
2. Di Render, pilih **New → Web Service** dan hubungkan repositori.
3. Pilih **Docker** sebagai runtime/environment (karena yt-dlp dan ffmpeg dipasang di Dockerfile).
4. Deploy, lalu buka URL layanan + `/health`.
5. Jika `{"ok":true,...}` muncul, backend dasar sudah aktif.

## Penting
- Ini adalah backend starter untuk pengujian, belum disambungkan ke frontend SariAN.
- Unduhan lintas platform dapat gagal karena perubahan platform, login/cookies, DRM, pembatasan wilayah, format, atau batasan hosting. Jangan mengunduh konten yang tidak Anda miliki atau tidak memiliki izin untuk mengunduh.
- Endpoint download mengirim stream langsung dan tidak menyimpan file. Hosting gratis dapat memiliki batas CPU, memori, waktu proses, dan bandwidth.
- Gunakan hanya untuk media yang Anda miliki atau yang secara sah boleh diunduh.
- Sebelum dipakai publik, tambahkan autentikasi/rate limit dan pemantauan penggunaan untuk mencegah penyalahgunaan.
