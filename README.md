# StableAlt

A local, encrypted Roblox account manager for Windows. Add your accounts, give each one its own
game and launch options, and run several clients side by side without them eating your machine.

Everything lives on your PC in an encrypted vault tied to your Windows account. There is no
server, no sign-in, and no telemetry.

## What it does

**Accounts**
- Add accounts by pasting a `.ROBLOSECURITY` cookie, one at a time or a whole pasted list at once
- Per-account note, tags, avatar, Robux balance and session health
- Refresh a single account or all of them; expired sessions are flagged, not silently ignored
- Swap in a fresh cookie for an account without losing its settings

**Launching**
- Give each account its own game to join, or leave it blank to open the Roblox home page
- Launch one account, a picked batch, or all of them
- Multi-instance, so each account gets its own client window
- Per-account graphics and frame-rate override, or follow the global settings
- Background anti-AFK

**Performance**
- Lowest graphics for alts through Roblox's own allowlisted client flags — texture quality,
  geometry detail, render quality, no MSAA, no grass, flat sky
- Frame-rate cap written to Roblox's own `GlobalBasicSettings_13.xml`, then your own setting is
  restored
- Presets: Max alts, Balanced, Roblox defaults

**Monitor**
- Live list of every running client and which account owns it
- Reads the place each client is actually in, and resolves the game's name and icon
- Session monitoring that checks whether cookies are still alive

**Friends**
- See incoming and outgoing requests per account, accept, decline or cancel

## Building

Requires Node 18+, Rust, and the WebView2 runtime (present on Windows 10/11 by default).

```bash
npm install
npm run tauri dev      # development
npm run tauri build    # release installer
```

The release bundle lands in `src-tauri/target/release/bundle/`. Builds are not code-signed, so
Windows SmartScreen will warn on first run.

## How it works

- **Vault.** Accounts are stored in an encrypted file owned by the current Windows user. Your
  master password unlocks it for the session.
- **Multi-instance.** Roblox guards its client with a named mutex and a protocol hander. StableAlt
  takes that lock before a launch so a second client can start, and gives it back on exit.
- **Graphics flags.** Written to `%LOCALAPPDATA%\Roblox\Versions\version-*\ClientSettings\ClientAppSettings.json`.
  Ours are merged on top of yours, the original file is backed up first and restored byte for byte.
- **Launching.** Each account's cookie is exchanged for a launch ticket with Roblox, then passed to
  the client through its normal `roblox-player:` protocol.

## Notes

- A cookie *is* the login. Only ever add your own.
- This is not an exploit, a script, or a cheat. It does not touch Roblox's anti-cheat, doesn't
  inject into the client, and doesn't automate gameplay beyond pressing a key to stay online.
- Signing out, changing your password, or logging in elsewhere can invalidate a cookie. Use Refresh
  to see which sessions are still alive.
- Windows only.
