@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Первый запуск: устанавливаю зависимости, нужен интернет...
    python -m venv .venv || goto :nopython
    ".venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt || goto :failed
)

".venv\Scripts\python.exe" manage.py migrate --noinput --verbosity 0 || goto :failed

echo.
echo  ПОЛИГОН запущен. Не закрывайте это окно.
echo  На этом компьютере откройте:  http://localhost:8000
echo  Адрес для друзей будет показан на главной странице сайта.
echo.
".venv\Scripts\python.exe" manage.py runserver 0.0.0.0:8000 --noreload --nostatic
pause
exit /b

:nopython
echo Не найден Python. Установите его с python.org и запустите этот файл снова.
pause
exit /b 1

:failed
echo Не удалось подготовить игру. Проверьте интернет и запустите файл снова.
pause
exit /b 1
