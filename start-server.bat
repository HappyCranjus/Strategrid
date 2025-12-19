@echo off
echo Starting game server for mobile access...
echo.
echo Make sure your phone is on the same Wi-Fi network!
echo.
echo Finding your local IP address...
ipconfig | findstr /i "IPv4"
echo.
echo Starting server on port 8000...
echo Access from phone: http://YOUR_IP:8000/game.html
echo.
python -m http.server 8000 --bind 0.0.0.0
pause

