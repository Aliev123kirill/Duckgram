@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Восстанавливаем исходные main.js и preload.js...

if not exist "backup\main.js" (
    echo ОШИБКА: не найден backup\main.js
    pause
    exit /b 1
)
if not exist "backup\preload.js" (
    echo ОШИБКА: не найден backup\preload.js
    pause
    exit /b 1
)

copy /Y "backup\main.js" "..\electron\main.js" >nul
copy /Y "backup\preload.js" "..\electron\preload.js" >nul

echo Готово. Duckgram вернулся к исходному поведению.
echo Папку login-notify можно удалить вручную — она больше не используется.
pause
