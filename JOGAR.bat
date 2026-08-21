@echo off
chcp 65001 >nul
title Go Master - Iniciando Jogo...
cd /d "%~dp0"

echo ======================================================
echo             GO MASTER - INICIALIZADOR
echo ======================================================
echo.

:: Verifica se o Node.js esta instalado
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js e npm nao foram encontrados no sistema!
    echo Por favor, certifique-se de ter o Node.js instalado (https://nodejs.org/).
    echo.
    pause
    exit /b 1
)

:: Verifica se as dependencias foram instaladas
if not exist "node_modules" (
    echo [INFO] Instalando dependencias pela primeira vez...
    echo Isso pode levar alguns segundos.
    call npm install
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar dependencias.
        pause
        exit /b 1
    )
    echo [OK] Dependencias instaladas com sucesso!
    echo.
)

echo [INFO] Iniciando o servidor e abrindo o jogo no seu navegador...
echo [DICA] Deixe esta janela aberta enquanto joga. Para encerrar, basta fecha-la.
echo.

:: Inicia o servidor Vite e abre o navegador automaticamente
call npm run dev -- --open

pause
