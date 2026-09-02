@echo off
chcp 65001 >nul
title 🦆 Duckgram — Activation

echo.
echo.
echo        ╔══════════════════════════════════╗
echo        ║                                  ║
echo        ║     🦆  D U C K G R A M  🦆      ║
echo        ║     ═══════════════════════       ║
echo        ║                                  ║
echo        ║   Утиная пародия на Telegram     ║
echo        ║   Activation Service v1.0        ║
echo        ║                                  ║
echo        ╚══════════════════════════════════╝
echo.
echo  [🔌] Инициализация...
ping 127.0.0.1 -n 2 >nul

echo  [🛠️]  Проверка зависимостей...
call pnpm install >nul 2>&1
if %errorlevel% neq 0 (
    echo  [❌] Ошибка: зависимости не установлены
    pause
    exit /b 1
)
echo  [✅] Зависимости в порядке

echo  [🦆] Активация Duckgram...
echo.
echo  ┌─────────────────────────────────────────────┐
echo  │                                             │
echo  │    ╱ ╲       🦆  DUCKGRAM ACTIVATED         │
echo  │   ╱   ╲                                     │
echo  │  ╱  🦆  ╲    Сервер запускается на :8080   │
echo  │  ╲      ╱                                  │
echo  │   ╲    ╱     Жми Ctrl+C чтобы выключить     │
echo  │    ╲  ╱                                     │
echo  │                                             │
echo  └─────────────────────────────────────────────┘
echo.
echo  Открываю в браузере...
start http://localhost:8080/

call pnpm start
pause
