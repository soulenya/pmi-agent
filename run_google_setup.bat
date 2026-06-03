@echo off
echo Installing Google API Python dependencies...
cd /d "%~dp0backend"
uv sync
echo.
echo Google dependencies installed.
echo Restart Little Gerry (Stop All Services, then relaunch) for the changes to take effect.
pause
