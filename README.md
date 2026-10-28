# Even Realities — G2 notes and apps

- **`app/`** — Bio HUD, an Even Hub app (Workout D). See `app/README.md` to test it in a browser, the simulator, or on the glasses.
- **`docs/even-hub-reference.md`** — SDK, limits, CLI and hardware quirks compiled from the shipped packages.
- Below: the Even Terminal runbook.

---

# Even Terminal setup (G2 glasses + R1 ring)

Runbook for driving Claude Code from Even Realities G2 glasses via
`@evenrealities/even-terminal`. Verified against v0.10.5 on 2026-10-28.

## Requirements

- Node.js 18+ (`node --version`)
- Even Realities **G2** glasses + **R1** ring, paired in the Even app (iOS/Android)
- `claude` CLI installed and logged in on the laptop
- Optional, recommended: Tailscale signed in on both laptop and phone

Note: the package targets G2 + R1. G1 is not supported.

## Install

```bash
npm i -g @evenrealities/even-terminal
even-terminal --version   # expect 0.10.5
```

Use a plain ASCII `@`. A fullwidth `＠` pasted from a chat client makes npm
report "not found".

## First run

```bash
even-terminal --cwd ~/bioconscious.tech
```

A four-step wizard runs once:

1. Default agent: `claude`
2. Project directory: the repo path, not `~`. The wizard echoes the resolved
   absolute path after confirmation; check it before moving on.
3. Network: `lan` for same Wi-Fi, `tailscale` for anywhere
4. Pairing token: auto-generated and persisted

Config lands in `~/.even-terminal/config.json` (mode 0600). The server then
starts in the foreground on port 3456 and prints a URL, the token, and a QR
code.

## Pair the phone

1. Even app → Settings → enable **Terminal Mode**
2. Scan the QR printed in the terminal, or paste URL + token manually
3. Glasses and ring connect to the app over BLE. Agent output renders on the
   576×288 canvas; ring gestures go back as keystrokes.

## Daily use

```bash
# terminal 1: server
even-terminal

# terminal 2: normal Claude UI, mirrored to the glasses
even-terminal claude
even-terminal claude --resume <session-id>
```

Ring: tap to approve simple actions, tap-and-hold to record a short voice
instruction.

## Persistent config (no wizard rerun)

```bash
even-terminal config                       # interactive menu
even-terminal config cwd ~/bioconscious.tech
even-terminal config network tailscale     # lan | tailscale | interface:en0 | expose:pinggy
even-terminal config port 4567
even-terminal config token '<new-token>'   # rotates pairing; rescan QR
even-terminal config claudeAllowedTools Read,Glob,Grep,ToolSearch
even-terminal config --reset               # rerun wizard, keep token
```

Precedence: CLI flag > env var > config file > built-in default.

## Useful flags

| Flag | Purpose |
|---|---|
| `--tailscale` | Bind external access to the Tailscale IPv4. Stable across networks. |
| `--lan` | Advertise the detected LAN address (default). |
| `-i <iface>` | Bind to a named interface. |
| `--expose pinggy` | Temporary public tunnel over SSH, no install. Also `bore`, `ngrok`. |
| `--provider codex` | Default to Codex instead of Claude. |
| `--claude-allowed-tools <csv\|none>` | Replace the auto-approved tool list. Default includes WebSearch and WebFetch. |
| `--use-original-claude` | Plain Agent SDK provider, no terminal/app sync. |
| `--claude-use-system-cli` | Use the system `claude` binary instead of the SDK-bundled one. |
| `--log-level info` | Smaller log file. `--verbose` only affects stdout. |

## Shell completion

```bash
source <(even-terminal complete zsh)    # or bash
even-terminal complete fish > ~/.config/fish/completions/even-terminal.fish
```

## Lessons from the first setup (2026-10-27)

- **Log in first.** `even-terminal claude` showed "Not logged in" in the corner.
  Run `/login` inside that window. Phone sessions use the same credentials,
  so nothing works until this is done.
- **Input without the ring = the laptop keyboard.** Anything spoken to the
  glasses or typed in the app's chat goes to Even AI, not Claude. Drive from
  the `even-terminal claude` window; the glasses mirror it.
- **"Exit Even AI" on the phone:** double-tap the right temple touchpad,
  single-tap to confirm. A single press or hold reopens Even AI.
- **Server log shows only `/api/info` and `/api/sessions` polling** means the
  app hasn't opened a session. Open Terminal in the app and tap the session.
- **Tailscale "probe failed" on the phone** with both devices Connected:
  `tailscale set --shields-up` was on. Turn it off:
  `tailscale set --shields-up=false`. The App Store build lives at
  `/Applications/Tailscale.app/Contents/MacOS/Tailscale` if `tailscale` is
  not on PATH.
- **Tailscale VPN prompt** on Mac and iPhone is Apple boilerplate. Only
  `100.x.x.x` traffic uses the tunnel. Verify with `netstat -rn | grep default`:
  the first IPv4 default must stay on `en0`. Never enable an exit node.
- **tmux detach** is Ctrl+B, release, then **D** alone. Ctrl+D does nothing.

## Persistent server

```bash
brew install tmux
tmux new -s even      # then run: even-terminal
# detach: Ctrl+B, then D     reattach: tmux attach -t even
```

## Troubleshooting

- `claude-sync` (default shared-session mode) is experimental. If input,
  resume, or permissions misbehave, start with `--use-original-claude` or
  `--claude-use-system-cli`.
- `even-terminal claude` errors with "no server" when the foreground server
  is not running. Start `even-terminal` first.
- Wrapper on a non-default port: `EVEN_TERMINAL_PORT=4567 even-terminal claude`.
- Quick-expose tunnels are for temporary sharing only. Use Tailscale for
  anything regular.

## References

- npm: https://www.npmjs.com/package/@evenrealities/even-terminal
- Even Realities Terminal: https://www.evenrealities.com/terminal
- Glasses-native apps instead of mirroring: `@evenrealities/even_hub_sdk`
