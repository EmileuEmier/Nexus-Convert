@echo off
title NexusConvert Baslatici
:: Projenin bilgisayarındaki tam klasör yolunu buraya yaz (Örn: C:\Projeler\nexusconvert)
cd /d "C:\Users\zekia\Documents\GitHub\Nexus-Convert"
echo Tarayici hazirlaniyor...
:: 3 saniye bekle ki sunucu tam ayağa kalkabilsin, ardından Google Chrome ile adresi aç
timeout /t 2 /nobreak >nul
start chrome "http://localhost:3000"

echo Proje baslatiliyor...
npm start
pause