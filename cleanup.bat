@echo off
echo ========================================
echo 清理数据表和上传文件
echo ========================================
echo.
echo 警告：此操作将删除所有数据表和上传文件！
echo 系统表（users等）和用户数据将保留。
echo.
set /p confirm="确定要继续吗？(y/N): "
if /i not "%confirm%"=="y" (
    echo 操作已取消
    pause
    exit /b
)

echo.
echo 正在清理...
cd server
call npm run cleanup
cd ..
echo.
echo 清理完成！
pause

