"""API の入口。作った画面（frontend/dist を backend/static に写したもの）も同じアドレスで返す。"""

from __future__ import annotations

import logging
import uuid
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import ROOT
from .errors import AppError
from .routers import audit_logs, auth, customers, dashboard, projects, schedule, tasks, team, users

STATIC = Path(__file__).resolve().parents[1] / "static"
LOG_DIR = ROOT / "logs"

log = logging.getLogger("crm")
if not log.handlers:
    LOG_DIR.mkdir(exist_ok=True)
    handler = RotatingFileHandler(LOG_DIR / "app.log", maxBytes=1_000_000, backupCount=5, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)

app = FastAPI(title="顧客・案件管理システム API", version=__version__,
              docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")

for r in (auth, users, customers, projects, tasks, schedule, team, dashboard, audit_logs):
    app.include_router(r.router)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if not request.url.path.startswith("/api/docs"):
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(AppError)
async def app_error(_: Request, exc: AppError):
    return JSONResponse({"message": exc.message, "field": exc.field}, status_code=exc.status_code)


FIELD_LABELS = {"name": "名前", "email": "メールアドレス", "phone": "電話番号", "title": "タイトル", "amount": "金額",
                "password": "パスワード", "new_password": "新しいパスワード", "kana": "フリガナ", "address": "住所",
                "industry": "業種", "note": "メモ", "description": "内容", "due_date": "期限", "start_date": "開始日", "progress": "進み具合", "outlook": "見通し",
                "expected_close_date": "受注予定日", "customer_id": "顧客", "project_id": "案件", "status": "ステータス",
                "priority": "優先度", "role": "権限", "version": "版"}


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    """入力の誤りを日本語で返す（どの項目かも返す）。"""
    errors = []
    for e in exc.errors():
        loc = [str(x) for x in e.get("loc", []) if x not in ("body", "query", "path")]
        field = loc[-1] if loc else ""
        t, ctx = e.get("type", ""), e.get("ctx") or {}
        if t == "string_too_long":
            msg = f"{ctx.get('max_length')} 文字以内にしてください"
        elif t in ("greater_than_equal", "less_than_equal"):
            msg = "範囲外の値です"
        elif t in ("int_parsing", "int_type"):
            msg = "整数で入力してください"
        elif t in ("date_parsing", "date_from_datetime_parsing", "date_type"):
            msg = "日付の形ではありません"
        elif t == "missing":
            msg = "入力してください"
        elif t == "extra_forbidden":
            msg = "使えない項目です"
        elif t in ("literal_error", "enum"):
            msg = "選べない値です"
        elif t == "value_error":
            msg = str(e.get("msg", "")).removeprefix("Value error, ")
        else:
            msg = "値が正しくありません"
        errors.append({"field": field, "message": f"{FIELD_LABELS.get(field, field)}：{msg}" if field else msg})
    first = errors[0]["message"] if errors else "入力が正しくありません"
    return JSONResponse({"message": first, "field": errors[0]["field"] if errors else None, "errors": errors},
                        status_code=422)


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    messages = {404: "見つかりません。", 405: "この操作はできません。"}
    return JSONResponse({"message": messages.get(exc.status_code, "エラーが起きました。")}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def unexpected(request: Request, exc: Exception):
    """想定外のエラー：画面には受付番号だけ。詳しい内容はログへ。"""
    ticket = uuid.uuid4().hex[:8]
    log.exception("想定外のエラー（受付番号 %s）%s %s", ticket, request.method, request.url.path)
    return JSONResponse({"message": f"想定外のエラーが起きました。何も保存していません。（受付番号 {ticket}）"},
                        status_code=500)


@app.get("/api/health", include_in_schema=False)
def health():
    return {"status": "ok"}


# ---- 画面（ビルド済みの React）。/api 以外は index.html を返し、画面側のルーターに任せる
if (STATIC / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        return JSONResponse({"message": "見つかりません。"}, status_code=404)
    candidate = (STATIC / path).resolve()
    if path and candidate.is_file() and STATIC.resolve() in candidate.parents:
        return FileResponse(candidate)
    index = STATIC / "index.html"
    if index.is_file():
        return FileResponse(index)
    return JSONResponse({"message": "画面がまだビルドされていません（README の手順を参照）。"}, status_code=404)
