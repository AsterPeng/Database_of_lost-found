@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

set "PORT=3000"
if not "%~1"=="" set "PORT=%~1"

echo ============================================
echo    校园失物招领平台  启动脚本
echo ============================================
echo.

if not exist ".env" (
  echo [错误] 当前目录下找不到 .env 文件。
  echo        它保存了数据库密码和加密密钥，必须和代码放在一起。
  echo        如果是从备份恢复，请确认 .env 已经一起复制过来。
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js。
  echo        请先安装 Node.js 20 或更高版本：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] 首次运行，正在安装依赖包，约需 1-5 分钟，请耐心等待...
  call npm install
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络连接后重新双击本脚本。
    echo.
    pause
    exit /b 1
  )
  echo.
) else (
  echo [1/3] 依赖已就绪
)

echo [2/3] 准备数据库...
call npx prisma generate >nul 2>nul
call npx prisma migrate deploy
if errorlevel 1 (
  echo.
  echo [警告] 数据库连接或迁移失败。
  echo        请确认本机 PostgreSQL 服务已启动，服务名通常是 postgresql-x64-18。
  echo.
) else (
  echo       数据库已就绪
)

echo.
echo [3/3] 正在启动服务（端口 %PORT%）...
echo.
echo   启动后浏览器会自动打开 http://localhost:%PORT%
echo   若提示暂时打不开，等 10 秒刷新一次即可。
echo.
echo   ★ 请保持本窗口开着，关掉窗口就等于停止服务。
echo.

start "" cmd /c "timeout /t 12 >nul & start http://localhost:%PORT%"
call npm run dev -- -p %PORT%

echo.
echo 服务已停止。
pause
