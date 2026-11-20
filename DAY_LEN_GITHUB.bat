@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Day ban giao dien MagicZ OTA len GitHub Pages ===
ssh -o StrictHostKeyChecking=accept-new -T git@github-magiczzz07 2>nul
git add -A
git diff --cached --quiet || git commit -m "feat: redesign MagicZ iOS OTA installer portal"
git push origin master
echo.
echo Hoan tat! Trang https://magiczzz07.github.io se cap nhat sau ~20-30 giay.
pause
