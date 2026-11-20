@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Day ban giao dien MagicZ OTA [Strix Hardened] len GitHub Pages ===
set "GIT_SSH_COMMAND=ssh -i %USERPROFILE%/.ssh/id_ed25519_magiczzz07 -o IdentitiesOnly=yes -o IdentityAgent=none -o StrictHostKeyChecking=accept-new"
git add -A
git diff --cached --quiet || git commit -m "sec(strix): harden MagicZ OTA portal against scraping, SSRF, XSS and brute-force"
git push git@github.com:magiczzz07/magiczzz07.github.io.git master
echo.
if %ERRORLEVEL% EQU 0 (
  echo [THANH CONG] Trang https://magiczzz07.github.io se cap nhat sau ~20-30 giay.
) else (
  echo [LOI] Chua xac thuc duoc Deploy Key tren GitHub. Hay kiem tra Settings -^> Deploy keys cua repo magiczzz07/magiczzz07.github.io.
)
pause
