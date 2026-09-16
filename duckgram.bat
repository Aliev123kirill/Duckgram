@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Duckgram - сборка со всеми изменениями

cd /d "%~dp0"

echo.
echo  ============================================
echo   Duckgram - полная сборка клиента
echo   Все изменения: звук, эмодзи, тема, иконки
echo  ============================================
echo.

:: ==========================================
:: Шаг 1: Остановка запущенных экземпляров
:: ==========================================
echo  [1/8] Остановка Duckgram...
taskkill /F /IM Duckgram.exe >nul 2>&1
timeout /t 3 /nobreak >nul
echo      Готово.

:: ==========================================
:: Шаг 2: Очистка кэша Service Worker (старый звук)
:: ==========================================
echo  [2/8] Очистка временных данных приложения...
if exist "%APPDATA%\tweb"     rmdir /S /Q "%APPDATA%\tweb"
if exist "%APPDATA%\electron" rmdir /S /Q "%APPDATA%\electron"
if exist "%LOCALAPPDATA%\electron" rmdir /S /Q "%LOCALAPPDATA%\electron"
for /d %%D in ("%TEMP%\electron-download-*") do rmdir /S /Q "%%D" 2>nul
echo      Готово.

:: ==========================================
:: Шаг 3: Новый звук (ass.mp3) в исходники
:: ==========================================
echo  [3/8] Установка нового звука...
set "ASS=%~dp0Звуковые материалы\ass.mp3"
if not exist "%ASS%" (
    echo      ОШИБКА: нет "Звуковые материалы\ass.mp3"
    pause
    exit /b 1
)
copy /Y "%ASS%" "%~dp0public\assets\audio\icq_notification.mp3" >nul
copy /Y "%ASS%" "%~dp0public\assets\audio\notification.mp3" >nul
echo      Звук установлен (ass.mp3).

:: ==========================================
:: Шаг 4: Зависимости
:: ==========================================
echo  [4/8] pnpm install...
call pnpm install >nul 2>&1
if %errorlevel% neq 0 (
    echo      ОШИБКА: pnpm install
    pause
    exit /b 1
)
echo      Готово.

:: ==========================================
:: Шаг 5: Полная сборка (typecheck + vite + assets)
:: ==========================================
echo  [5/8] pnpm build (около 2 мин)...
rem Удаляем старые dist/electron-dist для чистой сборки
if exist "%~dp0dist"        rmdir /S /Q "%~dp0dist"
if exist "%~dp0electron-dist" rmdir /S /Q "%~dp0electron-dist"
call pnpm build
if %errorlevel% neq 0 (
    echo      ОШИБКА: сборка
    pause
    exit /b 1
)
echo      Готово.

:: ==========================================
:: Шаг 6: Портативная сборка (.exe)
:: ==========================================
echo  [6/8] pnpm run package (portable .exe)...
call pnpm run package
if %errorlevel% neq 0 (
    echo      ОШИБКА: package
    pause
    exit /b 1
)
echo      Готово.

:: ==========================================
:: Шаг 7: Обновление файлов в уже собранных версиях
:: ==========================================
echo  [7/8] Обновление звука в собранных версиях...
set "TARGETS=%~dp0electron-dist\win-unpacked\resources\app\dist\assets\audio\icq_notification.mp3 %~dp0electron-dist\win-unpacked\resources\app\dist\assets\audio\notification.mp3"
for %%T in (%TARGETS%) do if exist "%%T" copy /Y "%ASS%" "%%T" >nul 2>&1
echo      Готово.

:: ==========================================
:: Шаг 8: Запуск
:: ==========================================
echo.
echo  ============================================
echo   Сборка завершена!
echo  ============================================
echo.
if exist "%~dp0electron-dist\win-unpacked\Duckgram.exe" (
    start "" "%~dp0electron-dist\win-unpacked\Duckgram.exe"
) else (
    echo  [err] Не найден собранный Duckgram.exe
)
echo.
pause
