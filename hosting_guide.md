# Hosting Guide for Multiplayer Game

## Network Architecture

Your game uses:
- **PeerJS** (free signaling server at `0.peerjs.com`) - handles initial connection
- **WebRTC** with Google STUN servers - handles peer-to-peer connection
- **Static files only** - no backend server needed

**This means:** Once both players can access your game files, they can play together from anywhere!

---

## 🚀 Option 1: Host TODAY (Simplest - 5 minutes)

### Method A: Using ngrok (Recommended for Windows)

1. **Download ngrok**: https://ngrok.com/download (choose Windows)

2. **Extract and run**:
   ```powershell
   # Navigate to your game directory
   cd "C:\Users\jense\OneDrive\Documents\RTS_Game_RL_Base"
   
   # Start local server (keep this running)
   python -m http.server 8000
   
   # In a NEW terminal, start ngrok (get free account at ngrok.com)
   ngrok http 8000
   ```

3. **Share the ngrok URL** (e.g., `https://abc123.ngrok.io`) with your brother
   - Both of you visit: `https://abc123.ngrok.io/game.html`
   - Or: `https://abc123.ngrok.io/menu.html` then click multiplayer

### Method B: Using Cloudflare Tunnel (Free, no account needed)

1. **Download cloudflared**: https://github.com/cloudflare/cloudflared/releases

2. **Run**:
   ```powershell
   # Start local server
   python -m http.server 8000
   
   # In new terminal, create tunnel
   cloudflared tunnel --url http://localhost:8000
   ```

3. **Share the Cloudflare URL** shown in the terminal

### Method C: Using Surge.sh (Fastest setup)

1. **Install Surge** (requires Node.js):
   ```powershell
   npm install -g surge
   ```

2. **Deploy**:
   ```powershell
   cd "C:\Users\jense\OneDrive\Documents\RTS_Game_RL_Base"
   surge
   # Follow prompts (can use random domain or custom)
   ```

3. **Share the URL** (e.g., `https://your-game.surge.sh`)

---

## 🌟 Option 2: Best Long-Term Solution

### Recommended: Netlify Drop (Zero setup)

1. **Go to**: https://app.netlify.com/drop

2. **Drag and drop** your entire game folder onto the page

3. **Share the URL** (e.g., `https://random-name-12345.netlify.app`)

**Pros:**
- Permanent URL (or you can set a custom domain)
- Free SSL certificate
- Fast CDN globally
- Easy to update (just drag-drop again)

### Alternative: Vercel

1. **Install Vercel CLI**:
   ```powershell
   npm install -g vercel
   ```

2. **Deploy**:
   ```powershell
   cd "C:\Users\jense\OneDrive\Documents\RTS_Game_RL_Base"
   vercel
   ```

### Alternative: GitHub Pages

1. **Create GitHub repository** and push your code

2. **Go to Settings → Pages** in your repo

3. **Select main branch** and deploy

4. **Access at**: `https://yourusername.github.io/repo-name/`

---

## Quick Comparison

| Solution | Setup Time | Cost | Permanence | Best For |
|----------|------------|------|------------|----------|
| **ngrok** | 2 min | Free | Temporary (8h free tier) | Testing today |
| **Cloudflare Tunnel** | 2 min | Free | Temporary | Testing today |
| **Surge.sh** | 3 min | Free | Permanent | Quick permanent host |
| **Netlify Drop** | 1 min | Free | Permanent | Best overall |
| **Vercel** | 5 min | Free | Permanent | Professional projects |
| **GitHub Pages** | 10 min | Free | Permanent | If you use GitHub |

---

## Important Notes

1. **Both players must access the SAME URL** - they need the exact same game code
2. **PeerJS works across networks** - no port forwarding needed!
3. **HTTPS is required** for WebRTC (most hosting solutions provide this automatically)
4. **Room codes are 4 digits** - share the code shown when hosting

---

## Testing the Connection

1. Host creates a room and gets a 4-digit code
2. Client enters the same code to join
3. If connection fails, check browser console for errors
4. Some corporate/school networks block WebRTC - try on different network if issues occur

---

## Recommendation

**For TODAY**: Use **ngrok** or **Cloudflare Tunnel** (fastest)
**For FUTURE**: Use **Netlify Drop** (easiest permanent solution)

