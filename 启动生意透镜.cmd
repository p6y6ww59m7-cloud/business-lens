@echo off
chcp 65001 >nul
where node >nul 2>&1
if errorlevel 1 (
  echo 请先安装 Node.js，然后重新打开本文件。
  pause
  exit /b 1
)
node "%~dp0server\launch.mjs"
