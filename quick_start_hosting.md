# 🎮 Quick Start: Host Your Game TODAY

## TL;DR - Fastest Option (2 minutes)

### Option A: Cloudflare Tunnel (NO account needed)

1. Download: https://github.com/cloudflare/cloudflared/releases (get `cloudflared-windows-amd64.exe`)
2. Rename to `cloudflared.exe` and put it in your game folder
3. Run: `host-cloudflare.bat`
4. Copy the HTTPS URL and share with your brother!

### Option B: ngrok (requires free account)

1. Download: https://ngrok.com/download
2. Sign up for free account (optional for basic use)
3. Run: `host-ngrok.bat`
4. Copy the HTTPS URL and share with your brother!

---

## Both Players Then:

1. Visit the shared URL (e.g., `https://abc123.ngrok.io/game.html`)
2. Or visit `https://abc123.ngrok.io/menu.html` → Click "Multiplayer"
3. Host clicks "Host Game" → Gets a 4-digit code
4. Client clicks "Join Game" → Enters the 4-digit code
5. Play!

---

## For Permanent Hosting (Best for Friends)

Run: `deploy-netlify.bat` (opens Netlify Drop)

Or manually:
1. Go to: https://app.netlify.com/drop
2. Drag your entire game folder onto the page
3. Share the permanent URL!

---

## Troubleshooting

**Connection fails?**
- Make sure both players use the SAME URL
- Check browser console (F12) for errors
- Try refreshing the page
- Some corporate/school networks block WebRTC - try on mobile data

**Game loads but can't connect?**
- Both players need to access the game from the same hosted URL
- PeerJS signaling server is public, so this should work from anywhere

---

See `HOSTING_GUIDE.md` for detailed options and explanations!

