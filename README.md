# 顧客・案件管理システム（Portfolio 03）

顧客・案件（商談）・タスクを一元管理する、チームで使う業務 Web アプリです。
ログインと権限（管理者・マネージャー・メンバー）、ダッシュボード、検索・絞り込み、操作履歴があります。

| 項目 | 内容 |
| --- | --- |
| 画面 | React 19・TypeScript 7・Vite 8・React Router 8・TanStack Query 5・Recharts 3（ライト／ダーク、スマホ対応） |
| API | FastAPI 0.165（REST）・Pydantic 2・SQLAlchemy 2.1・Alembic（マイグレーション） |
| DB | PostgreSQL 17（Docker） |
| 認証 | Cookie のセッション（HttpOnly・SameSite=Lax）、パスワードは Argon2 |
| テスト | pytest 45 件（API・権限・DB 制約）＋ Vitest 22 件（画面） |

## 構成

```
backend/          API（FastAPI）
  app/
    main.py       入口・エラーの返し方・セキュリティのヘッダー・画面の配信
    models.py     テーブル（SQLAlchemy）
    schemas.py    入力・出力の形と入力チェック（Pydantic）
    security.py   パスワード・セッション・ログインのロック
    permissions.py 権限の決まり（1 か所に集約）
    routers/      auth・users・customers・projects・tasks・dashboard・audit_logs
    seed.py       見本データ
  migrations/     Alembic
  tests/          pytest（PostgreSQL のテスト用 DB を使う）
frontend/         画面（React）。build すると backend/static に出る
docs/             設計書・API 仕様（openapi.json）
compose.yaml      PostgreSQL（127.0.0.1:55433）
start.bat         起動（DB → マイグレーション → API ＋画面）
```

## 動かす

準備と使い方は [使い方.md](使い方.md)。起動後 `http://localhost:8100`、API の仕様は `http://localhost:8100/api/docs`。

## 開発

```powershell
cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8100 --reload
```

```powershell
cd frontend; npm.cmd run dev
```

画面は `http://127.0.0.1:5180`（/api は 8100 へ中継）。テストは `backend` で `.\.venv\Scripts\python.exe -m pytest`、`frontend` で `npm.cmd test`。

## 資料

- [使い方.md](使い方.md)／[ポートフォリオ.md](ポートフォリオ.md)
- [01 要件定義書](docs/01_要件定義書.md)・[02 基本設計書](docs/02_基本設計書.md)（構成図・画面・権限）・[03 DB 設計書](docs/03_DB設計書.md)・[04 API 設計書](docs/04_API設計書.md)・[05 詳細設計書](docs/05_詳細設計書.md)・[06 テスト仕様書](docs/06_テスト仕様書.md)・[07 セキュリティチェック](docs/07_セキュリティチェック.md)

見本データの会社・人・連絡先はすべて架空です。
