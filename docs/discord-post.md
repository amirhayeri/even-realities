**Bio HUD — your Apple Watch workout on the G2, with your own Spotify playlists**

Open-source Even Hub app + Cloudflare Worker + watchOS app. One tap on the Watch: your playlist starts on the phone (shuffle), the glasses light up with live heart rate, zone bar, timer, steps, kcal, distance, now playing and next track. Lens sleeps after 15 s and wakes on tap, look-up, zone change or workout start/end. Survives a locked phone as a beta build.

Repo: https://github.com/amirhayeri/even-realities
Setup is one script (`./setup.sh`), needs: G2 + Even app with Developer Mode, Apple Watch, Spotify Premium, a free Cloudflare account, Xcode for the Watch app.

Things learned the hard way, all in the README:
• `createStartUpPageContainer` returns `invalid` unless text containers are SDK class instances with every border field set
• the Even WebView drops the `Authorization` header, send the token as `?token=` too
• space-padded "right aligned" lines wrap on the real firmware, use separate containers
• Tailscale breaks Xcode↔Watch pairing

MIT. Issues and PRs welcome. Glucose/CGM display is behind a config flag; use at your own risk, this is not a medical device.
