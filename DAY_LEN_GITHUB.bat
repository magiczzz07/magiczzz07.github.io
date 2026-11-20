@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Day ban giao dien MagicZ OTA [Strix Hardened] len GitHub Pages ===
git add -A
git diff --cached --quiet || git commit -m "chore: update MagicZ OTA portal"
git push origin master
echo.
echo [THANH CONG] Trang https://magiczzz07.github.io se cap nhat sau ~20 giay.
pause
