@echo off
REM PostgreSQL 初始化和启动脚本

REM 设置 PostgreSQL 路径
set PGHOME=E:\pgsql\pgsql
set PATH=%PGHOME%\bin;%PATH%
set PGDATA=E:\pgsql\data

REM 初始化数据库（仅首次需要）
if not exist "%PGDATA%" (
    echo 正在初始化 PostgreSQL 数据库...
    initdb -D "%PGDATA%" -U postgres -E UTF8 --locale=C
    echo 初始化完成！
)

REM 启动 PostgreSQL
echo 正在启动 PostgreSQL...
pg_ctl -D "%PGDATA%" -l E:\pgsql\pg.log start

REM 等待启动
timeout /t 3 /nobreak >nul

REM 创建数据库
echo 正在创建 item_manager 数据库...
createdb -U postgres item_manager 2>nul

echo PostgreSQL 已启动，数据库 item_manager 已创建
echo 连接信息: host=localhost port=5432 user=postgres password=123 dbname=item_manager