@echo off
echo ========================================
echo Quick Hosting with ngrok
echo ========================================
echo.
echo STEP 1: Make sure ngrok is installed
echo Download from: https://ngrok.com/download
echo.
echo STEP 2: Starting local server on port 8000...
echo.
start cmd /k "python -m http.server 8000"
timeout /t 2 /nobreak >nul
echo.
echo STEP 3: Starting ngrok tunnel...
echo.
echo After ngrok starts, copy the HTTPS URL (e.g., https://abc123.ngrok.io)
echo Share this URL with your brother!
echo.
echo Both of you should visit: [NGROK_URL]/game.html
echo Or: [NGROK_URL]/menu.html then click Multiplayer
echo.
echo Press any key to start ngrok...
pause >nul
ngrok http 8000

