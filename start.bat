@echo off
rem 顧客・案件管理システムを開く（初めての場合は 使い方.md の「準備」を先に）
cd /d "%~dp0"
if not exist ".env" (
  echo .env がありません。使い方.md の「準備」の手順で作ってください。
  pause
  exit /b 1
)
if not exist "backend\.venv\Scripts\python.exe" (
  echo 先に 使い方.md の「準備」の手順を行ってください。
  pause
  exit /b 1
)
set "DOCKER=docker"
if exist "C:\Program Files\Docker\Docker\resources\bin\docker.exe" set "DOCKER=C:\Program Files\Docker\Docker\resources\bin\docker.exe"
echo データベース（PostgreSQL）を起動しています…
"%DOCKER%" compose up -d --wait
if errorlevel 1 (
  echo データベースを起動できませんでした。Docker Desktop を起動してから、もう一度開いてください。
  pause
  exit /b 1
)
cd backend
rem テーブルを最新の形にする（変更がなければ何もしない）
".venv\Scripts\python.exe" -m alembic upgrade head
if not exist "static\index.html" (
  echo 画面がまだビルドされていません。使い方.md の「準備」の 5 を行ってください。
  pause
  exit /b 1
)
echo 起動しています。少しするとブラウザが開きます。終わるときは、この窓を閉じてください。
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:8100"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8100
