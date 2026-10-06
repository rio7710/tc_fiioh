@echo off
chcp 65001 >nul
cd /d "%~dp0"
title P1 미리보기 및 MP4 변환
python "01_app\render_server.py"
if errorlevel 1 pause
