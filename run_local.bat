@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
    python serve_local.py
) else (
    py -3 serve_local.py
)
if errorlevel 1 pause
