# Morning HUD

A two-minute briefing on the glasses: today's meetings, mail from the last
24 hours across your Google accounts, texts, missed calls. Swipe through four
cards, tap to keep an item for today, menu › Read to open it.

Everything comes from the same Cloudflare Worker as Bio HUD. Nothing from
Google is stored: mail previews and calendar events are read live on each
pull and cached for 60 seconds. Texts, calls and "kept" flags live in KV with
a 24-hour expiry.

## 1. Google (once, ~5 minutes)

1. https://console.cloud.google.com → new project, e.g. "HUD".
2. APIs & Services → Library → enable **Gmail API** and **Google Calendar API**.
3. APIs & Services → OAuth consent screen → External → add yourself as a test
   user (your Workspace and personal Gmail addresses, if you want both; each
   links separately, see below).
4. Credentials → Create credentials → OAuth client ID → **Web application**.
   Authorised redirect URI: `https://<your-worker>.workers.dev/google/callback`.
5. Copy the client ID and secret into the Worker:

```
cd ~/even-realities/endpoint
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

6. In `wrangler.toml` set `TZ` (your IANA zone) and `VIP_EMAILS`
   (comma list of addresses or `@domains`). Deploy: `npm run deploy`.
7. Link, in a browser: `https://<your-worker>.workers.dev/google/login?token=<HUD_TOKEN>`
   (`app/hud token` prints it). Approve read-only Gmail and Calendar.

Check: `https://<your-worker>.workers.dev/morning?token=<HUD_TOKEN>` returns
`events` and `items`.

One Google login covers every calendar you have ticked in Google Calendar.
iCloud mail and a second Google account are the next step, not in yet.

## 2. Texts from the iPhone (once, ~2 minutes)

Shortcuts → Automation → **+** → Message → "When I get a message from
*Anyone*" → Run Immediately → New Blank Automation:

1. **Get Contents of URL**
   URL `https://<your-worker>.workers.dev/morning/text?token=<HUD_TOKEN>`
   Method POST, Request Body JSON:
   `who` = Shortcut Input › Sender, `text` = Shortcut Input › Content.

That is the whole automation. Missed calls have no iPhone hook; they arrive
only from a Mac agent later.

## 3. The glasses app

```
cd ~/even-realities/morning
cp app.example.json app.json        # set package_id to your reverse domain, and the Worker URL in whitelist
npm install
npm run dev                         # browser preview on mock data
```

Release to your phone the same way as Bio HUD:

```
npx evenhub login
npm run release -- "first morning build"
```

It shares `app/.env` with Bio HUD, so the endpoint and token are already set.

## Controls

| Gesture | Cards 1 and 4 | Today (2) | Needs you (3) | Reading |
|---|---|---|---|---|
| swipe | next / previous card | move row, past the end goes to the next card | move row | scroll |
| tap | next card | next card | keep / unkeep for today | back |
| menu › Read | | event details and mail from its guests | open the message | |
| menu › Refresh | pull now | | | |
| double tap | exit | | | |

The lens goes dark after 45 seconds without input; any touch brings it back
with a fresh pull.

## Security

- Google scopes are read-only. The refresh token is a Cloudflare secret-grade KV value, never in the glasses bundle.
- The glasses receive previews (subject, sender, first 160 characters). Full bodies are fetched on demand and never stored.
- Texts, calls and kept flags expire after 24 hours.
- One bearer token, the same as Bio HUD. Rotate with `app/set-token.sh`.
