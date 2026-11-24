# 04 API 設計書

- 形式：REST・JSON。すべて `/api/` から始まる
- 仕様の全体（自動生成）：起動中は `http://localhost:8100/api/docs`、ファイルは [openapi.json](openapi.json)
- 認証：ログインで HttpOnly の Cookie `crm_session` を受け取り、以後は自動で送られる
- CSRF 対策：POST・PUT・PATCH・DELETE はヘッダー `X-Requested-With: crm-app` が必須（ないと 403）
- 知らない項目を送ると 422（`role` を書き換えるなどの「勝手な項目」を受け付けない）

## 1. 共通

### エラーの形

```json
{ "message": "画面に出すメッセージ（日本語）", "field": "email", "errors": [{ "field": "email", "message": "メールアドレス：メールアドレスの形ではありません" }] }
```

| コード | 意味 |
| --- | --- |
| 400 | 業務ルールに合わない（パスワードの決まり、最後の管理者 など） |
| 401 | ログインしていない・ログイン失敗 |
| 403 | 権限がない、CSRF のヘッダーがない |
| 404 | 見つからない（削除済みも含む） |
| 409 | 楽観的ロック（ほかの人が先に更新）、重複、削除できない（案件のある顧客） |
| 422 | 入力の形が違う（文字数・範囲・形式・必須） |
| 500 | 想定外のエラー。`message` は受付番号だけ（詳しくはサーバーのログ） |

### 一覧の形

```json
{ "items": [ ... ], "total": 123, "page": 1, "per_page": 20 }
```

`page`（1 から）・`per_page`（最大 100）。並び順は `sort` で決まった値だけ選べる。

### 変更（PUT）

返事に入っている `version` をそのまま送る。違っていたら 409（ほかの人が先に更新した）。

## 2. 一覧

| メソッド | パス | 権限 | 内容 |
| --- | --- | --- | --- |
| POST | /api/auth/login | だれでも | `{email, password}` → 自分の情報＋ Cookie。5 回失敗で 15 分ロック |
| POST | /api/auth/logout | だれでも | セッションを消す（204） |
| GET | /api/auth/me | ログイン | 自分の情報と `can_manage_users`・`can_view_audit`・`can_delete` |
| POST | /api/auth/password | ログイン | `{current_password, new_password}`。ほかの端末のログインは切れる（204） |
| GET | /api/users/options | ログイン | 担当者の選択肢（使用中のユーザーの id と名前） |
| GET | /api/users | 管理者 | ユーザーの一覧 |
| POST | /api/users | 管理者 | `{email, name, role, password}` |
| PUT | /api/users/{id} | 管理者 | `{name, role, active}`。権限・使用中を変えるとその人のログインは切れる。最後の管理者は外せない |
| POST | /api/users/{id}/password | 管理者 | `{new_password}`。ロックも解除（204） |
| GET | /api/customers | ログイン | `q`（会社名・フリガナ・電話・メール・住所）・`industry`・`owner_id`・`sort`（name／updated_at／created_at／open_amount） |
| GET | /api/customers/industries | ログイン | 使われている業種の一覧 |
| GET | /api/customers/{id} | ログイン | 顧客（`project_count`・`open_amount`・`can_edit`・`can_delete`） |
| POST | /api/customers | ログイン | 作成。メンバーは担当者が自分になる |
| PUT | /api/customers/{id} | 担当者かマネージャー以上 | 変更（`version` 必須） |
| DELETE | /api/customers/{id} | マネージャー以上 | 論理削除。案件があれば 409 |
| GET | /api/projects | ログイン | `q`（案件名・顧客名）・`status`（複数可）・`owner_id`・`mine`・`customer_id`・`amount_min`/`amount_max`・`close_from`/`close_to`・`open_only`（進行中だけ）・`sort`（updated_at／amount／expected_close_date／name／start_date） |
| GET | /api/projects/{id} | ログイン | 案件（`task_total`・`task_open`・`can_edit`・`can_delete`・`can_reopen`） |
| POST | /api/projects | ログイン | 作成 |
| PUT | /api/projects/{id} | 担当者かマネージャー以上 | 変更。受注・失注を進行中に戻すのはマネージャー以上 |
| DELETE | /api/projects/{id} | マネージャー以上 | 論理削除（タスクも） |
| GET | /api/tasks | ログイン | `q`（やること・案件名・顧客名）・`status`（複数可）・`assignee_id`・`mine`・`project_id`・`overdue`・`at_risk`（遅れそう）・`stale`（7 日以上報告も変更もない）・`due_from`/`due_to`・`sort`（due_date／priority／updated_at） |
| GET | /api/tasks/{id} | ログイン | タスク（`overdue`・`can_edit`・`can_delete`） |
| POST | /api/tasks | 案件の担当者・自分を担当者にする・マネージャー以上 | 作成 |
| PUT | /api/tasks/{id} | タスクの担当者・案件の担当者・マネージャー以上 | 変更 |
| PATCH | /api/tasks/{id}/status | 同上 | `{status, version}` 状態だけ変える（「完了にする」「元に戻す」・選択欄用） |
| PATCH | /api/tasks/{id}/report | タスクの担当者・案件の担当者・マネージャー以上 | `{progress?, outlook?, note, version}` 進み具合・見通し・ひとことを報告（省いた項目は今のまま）。完了のタスクは 409 |
| DELETE | /api/tasks/{id} | マネージャー以上 | 論理削除 |
| GET | /api/dashboard | ログイン | `kpi`（`overdue_tasks` はマネージャー以上は全体、メンバーは自分の担当。どちらかを `overdue_scope`＝all／mine で返す）・`by_status`・`monthly_won`（6 か月）・`my_overdue`・`my_due_soon`・`closing_soon`・`recent`（メンバーは自分の操作だけ） |
| GET | /api/team/status | 管理者・マネージャー | `members`（メンバーごとの数・平均の進み具合・最後の報告。担当者なしも 1 行）・`at_risk`・`overdue`・`stale`（各 20 件まで） |
| GET | /api/schedule | ログイン | 予定表。`start`/`end`（既定は今月 1 日から 62 日、370 日まで）・`mine`（担当の案件か、自分のタスクがある案件）・`owner_id`・`include_closed`。期間が重なる案件（最大 200 件、超えたら `truncated`）と、そのタスク |
| GET | /api/audit-logs | マネージャー以上 | `user_id`・`action`・`entity_type`・`entity_id`・`q`・`date_from`/`date_to` |
| GET | /api/health | だれでも | 動いているか |

## 3. 例：案件を受注にする

```http
PUT /api/projects/12
Content-Type: application/json
X-Requested-With: crm-app
Cookie: crm_session=…

{"customer_id": 3, "name": "業務システム導入", "status": "won", "amount": 1500000,
 "expected_close_date": "2026-11-30", "description": "", "owner_id": 2, "version": 4}
```

返事（200）：`"status": "won"`、`"closed_at": "2026-11-23T01:45:00+00:00"`、`"version": 5`。操作履歴に `{"status": ["negotiation", "won"]}` が残る。

## 4. 開始日（start_date）

案件・タスクの作成と変更で `start_date` を送れます（`YYYY-MM-DD`）。

- 作成で省くと今日（終わりの日が今日より前なら、その日）。変更で省くと今の値のまま
- 受注予定日・期限が開始日より前なら 422（`field` は `expected_close_date`／`due_date`）

## 5. 進み具合の報告

タスクの返事に `progress`・`outlook`・`report_note`・`reported_at` が入ります。`/api/auth/me` は `can_view_team`（チームの状況を見られるか）を返します。
