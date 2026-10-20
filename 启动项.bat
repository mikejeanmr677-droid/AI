@echo off
title AI 钱包余额监控 - 启动项
cd /d E:\XKZOOM\LLMApiManageBalance

:menu
cls
echo ==================================
echo       AI 钱包余额监控 启动项
echo ==================================
echo   1. 启动 / 查看监控服务
echo   2. 打开汇总页
echo   0. 退出
echo ==================================
set /p choice=请输入选项（1/2/0）:

if "%choice%"=="1" goto start
if "%choice%"=="2" goto summary
if "%choice%"=="0" exit /b 0
echo 无效选项，请重新输入。
pause
goto menu

:start
echo 正在检查监控服务...
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 3; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 (
  echo 监控服务已在运行，打开汇总页。
  start http://localhost:3000
  pause
  goto menu
)
echo 正在启动监控服务...
start "AI钱包余额监控" /min D:\node\node.exe src\server.js
echo 等待服务就绪...
powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){ try { $r=Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { Start-Sleep -Seconds 1 } } ; exit 1" >nul 2>nul
if %errorlevel%==0 (
  echo 服务已就绪：http://localhost:3000
  start http://localhost:3000
) else (
  echo 服务启动失败或超时，请稍后重试。
)
pause
goto menu

:summary
start http://localhost:3000
pause
goto menu