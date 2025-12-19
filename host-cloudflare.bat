@echo off
echo ========================================
echo Quick Hosting with Cloudflare Tunnel
echo ========================================
echo.
echo STEP 1: Make sure cloudflared is installed
echo Download from: https://github.com/cloudflare/cloudflared/releases
echo (Download cloudflared-windows-amd64.exe and rename to cloudflared.exe)
echo.
echo STEP 2: Starting local server on port 8000...
echo.
start cmd /k "python -m http.server 8000"
timeout /t 2 /nobreak >nul
echo.
echo STEP 3: Starting Cloudflare tunnel...
echo.
echo After tunnel starts, copy the HTTPS URL shown below
echo Share this URL with your brother!
echo.
echo Both of you should visit: [CLOUDFLARE_URL]/game.html
echo Or: [CLOUDFLARE_URL]/menu.html then click Multiplayer
echo.
echo Press any key to start tunnel...
pause >nul
cloudflared tunnel --url http://localhost:8000

