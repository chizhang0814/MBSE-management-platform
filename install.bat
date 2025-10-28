@echo off
echo Installing EICD Platform...
echo.

echo Installing root dependencies...
call npm install

echo.
echo Installing server dependencies...
cd server
call npm install
cd ..

echo.
echo Installing client dependencies...
cd client
call npm install
cd ..

echo.
echo Installation complete!
echo.
echo To start the application, run:
echo   npm run dev
pause


