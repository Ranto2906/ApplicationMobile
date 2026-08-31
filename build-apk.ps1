# ══════════════════════════════════════════════════════════════
# build-apk.ps1 — Rebuild le APK après modification
# Usage: .\build-apk.ps1
# ══════════════════════════════════════════════════════════════

Write-Host "📦 1. Build web..." -ForegroundColor Cyan
npm run build

Write-Host "🔄 2. Sync Capacitor..." -ForegroundColor Cyan
npx cap sync android

Write-Host "🤖 3. Build APK..." -ForegroundColor Cyan
cd android
./gradlew.bat assembleDebug
cd ..

Write-Host "📋 4. Copie du APK..." -ForegroundColor Cyan
Copy-Item "android\app\build\outputs\apk\debug\app-debug.apk" "SEIMAD-debug.apk" -Force

Write-Host ""
Write-Host "✅ Terminé ! APK : $((Get-Item SEIMAD-debug.apk).FullName)" -ForegroundColor Green
Write-Host "   Taille : $([math]::Round((Get-Item SEIMAD-debug.apk).Length / 1MB, 1)) Mo" -ForegroundColor Green
Write-Host ""
Write-Host "📱 Installer :" -ForegroundColor Yellow
Write-Host "   adb install SEIMAD-debug.apk"
