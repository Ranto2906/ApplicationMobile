@echo off
REM ══════════════════════════════════════════════════════════════
REM build-apk.bat — Rebuild le APK après modification
REM Usage: build-apk.bat
REM ══════════════════════════════════════════════════════════════

setlocal enabledelayedexpansion

echo.
echo 📦 1. Build web...
call npm run build

echo.
echo 🔄 2. Sync Capacitor...
call npx cap sync android

echo.
echo 🤖 3. Build APK...
cd android
call gradlew.bat assembleDebug
cd ..

echo.
echo 📋 4. Copie du APK...
copy "android\app\build\outputs\apk\debug\app-debug.apk" "SEIMAD-debug.apk"

echo.
echo ✅ Terminé !
for %%A in (SEIMAD-debug.apk) do (
    set size=%%~zA
    set /a sizeInMB=!size! / 1048576
    echo    APK: !CD!\%%A
    echo    Taille: !sizeInMB! Mo
)

echo.
echo 📱 Installer :
echo    adb install SEIMAD-debug.apk
echo.

endlocal
