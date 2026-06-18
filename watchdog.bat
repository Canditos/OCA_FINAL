@echo off
set IP=10.20.17.14
echo A monitorizar SUT (%IP%)... Pressione Ctrl+C para parar.
echo.

:loop
ping -n 1 -w 1000 %IP% | find "TTL=" >nul
if errorlevel 1 (
    echo [%time%] ERRO: O carregador %IP% esta OFFLINE ou a fazer Reboot!
) else (
    echo [%time%] ONLINE: O carregador %IP% esta a responder.
)
timeout /t 1 >nul
goto loop
