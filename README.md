# Toon It! — AI Photo Transformations

**[toonit.ai](https://toonit.ai)** — Turn any photo into a stunning animated character in seconds.

Toon It! is a production AI web app that transforms user photos into stylized artwork (3D cartoon, anime, comic, renaissance, and 20+ more styles) and animates the result into a short talking/moving video — all in under a minute, with no signup required for the first transformation.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS (single-page app, zero framework), PWA with service worker |
| AI — Image editing | Venice AI (`grok-imagine-edit`) |
| AI — Video generation | Venice AI (`grok-imagine` image-to-video with native lip-sync speech) |
| Orchestration | n8n cloud workflows (webhook-driven pipeline: analysis → smart prompt → image edit → video) |
| Backend / DB / Auth / Storage | Supabase (Postgres, RLS, Edge Functions, Storage) |
| Payments | Stripe (credits + subscriptions) |
| Mobile | Capacitor hybrid app — Android on Google Play, iOS build via Codemagic |
| Hosting | GitHub Pages + Cloudflare DNS |

## Key Engineering Highlights

- **Zero-backend frontend**: the entire app is static; all logic flows through n8n webhooks and Supabase RLS-secured endpoints — no app server to maintain or breach.
- **Anonymous-first UX**: first transformation works without an account (anonymous session tokens, RLS-safe polling via a minimized status webhook).
- **Smart prompting pipeline**: a multimodal model analyzes each uploaded photo (subjects, scene, composition) to generate context-aware style prompts before transformation.
- **In-browser video compositing**: before/after side-by-side videos are rendered client-side with Canvas API — no server-side ffmpeg needed for user sharing.
- **Native share loop**: Web Share API with file-level sharing on mobile, download fallback on desktop, viral `#ToonItChallenge` share overlay.
- **SEO**: 25+ indexed guide/blog pages, structured sitemap, programmatic style landing pages.

## Repository Structure

```
index.html          Main single-page app (capture → transform → video → share)
dashboard.html      User account dashboard
gallery.html        Public transformation gallery
myvideos.html       User video library
blog/               SEO content pages
ops/                Internal ops dashboard (password-gated)
supabase/           Edge Functions & DB schema
sql/                Schema migrations
sw.js               Service worker (offline/PWA)
manifest.json       PWA manifest
```

## Environments

| Env | URL | Repo |
|-----|-----|------|
| Production | [toonit.ai](https://toonit.ai) | **this repo** |
| Staging | staging.toonit.ai | [Toon_It_Staging](https://github.com/marcopolovene/Toon_It_Staging) |
| Dev | dev preview | [Toon_It_Dev](https://github.com/marcopolovene/Toon_It_Dev) |

## Mobile App

The Android app (Google Play) is a Capacitor wrapper around this codebase with native bridges for camera, share, and download handling. Release artifacts are built and signed locally, then uploaded to Play Console.

---

*Built and operated by a solo founder — full product lifecycle: AI pipeline design, frontend, mobile, payments, SEO, ops monitoring, and growth automation.*
