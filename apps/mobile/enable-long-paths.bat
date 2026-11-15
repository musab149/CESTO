@echo off
REM Run this as Administrator to enable Windows long path support
echo Enabling Windows long path support...
echo.

REM Check if running as admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script must be run as Administrator
    echo.
    echo Right-click this file and select "Run as Administrator"
    pause
    exit /b 1
)

REM Enable long paths in registry
echo Adding registry key: HKLM\SYSTEM\CurrentControlSet\Control\FileSystem
reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f

if %errorlevel% equ 0 (
    echo.
    echo ✓ SUCCESS: Long paths enabled
    echo.
    echo IMPORTANT: You must RESTART YOUR COMPUTER for changes to take effect
    echo.
) else (
    echo.
    echo ERROR: Failed to modify registry
    echo.
)

pause
