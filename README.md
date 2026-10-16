# SariAN starter

This is a small Node.js + Express web app starter intended for deployment as a Render Web Service.

## Deploy on Render
- Create a public GitHub repository and upload all project files/folders (keep `server.js`, `package.json`, and `public/index.html` at the repository root / expected paths).
- In Render, create a **Web Service** and connect this repository.
- Runtime: Node.
- Build command: `npm install`
- Start command: `npm start`
- No environment variables are required; Render supplies `PORT`.

## Important limitations
- This version only accepts direct public media file URLs ending in common media extensions. It does NOT download from YouTube/TikTok/Instagram/Facebook page URLs.
- It does not bypass DRM, login walls, private content, or platform access restrictions.
- It does not include a database, accounts, payments, premium tiers, ad integration, automated subtitle extraction, or real media transcoding.
- Only use media you own or are authorized to download. Follow each platform's terms and applicable law.
