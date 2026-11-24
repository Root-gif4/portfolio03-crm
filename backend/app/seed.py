"""見本データ（すべて架空）。空の DB のときだけ入れる。

    .venv\\Scripts\\python.exe -m app.seed

見本のユーザー（パスワードはすべて同じ。本番で使う前に必ず変える）：
    admin@example.com（管理者）／manager@example.com（マネージャー）／
    member1@example.com・member2@example.com（メンバー）
"""

from __future__ import annotations

import random
import sys
from datetime import datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import audit, security
from .common import JST, today_jst
from .db import get_session_factory
from .models import Customer, Project, Task, User

DEMO_PASSWORD = "demo-pass-2026"

USERS = [("admin@example.com", "山田 花子", "admin"), ("manager@example.com", "佐藤 健一", "manager"),
         ("member1@example.com", "鈴木 美咲", "member"), ("member2@example.com", "高橋 翔太", "member")]

CUSTOMERS = [
    ("株式会社サンプル商事", "サンプルショウジ", "卸売"), ("みどり食品株式会社", "ミドリショクヒン", "食品"),
    ("あおぞら建設株式会社", "アオゾラケンセツ", "建設"), ("ひかり印刷有限会社", "ヒカリインサツ", "印刷"),
    ("株式会社ネクストラボ", "ネクストラボ", "IT"), ("さくら不動産株式会社", "サクラフドウサン", "不動産"),
    ("こはる歯科クリニック", "コハルシカクリニック", "医療"), ("株式会社まるやま製作所", "マルヤマセイサクショ", "製造"),
    ("つばめ運輸株式会社", "ツバメウンユ", "物流"), ("ことり保育園", "コトリホイクエン", "教育"),
    ("株式会社ゆめカフェ", "ユメカフェ", "飲食"), ("しずく化粧品株式会社", "シズクケショウヒン", "小売"),
    ("北斗エンジニアリング株式会社", "ホクトエンジニアリング", "製造"), ("はなまる学習塾", "ハナマルガクシュウジュク", "教育"),
    ("株式会社ほしぞら旅行", "ホシゾラリョコウ", "旅行"),
]

PROJECT_NAMES = ["業務システム導入", "Web サイト リニューアル", "在庫管理の効率化", "顧客管理ツール導入", "予約システム開発",
                 "データ集計の自動化", "社内ポータル構築", "EC サイト改修", "請求書の電子化", "保守契約の更新"]
TASK_TITLES = ["ヒアリングの日程調整", "要件のまとめ", "見積書の作成", "提案資料の作成", "デモの準備", "契約書の確認",
               "キックオフ会議", "画面イメージの共有", "テスト結果の報告", "請求書の送付", "フォローの電話", "議事録の送付"]
REPORT_NOTES = {"on_track": ["予定どおり進んでいます", "先方の確認待ち。来週には終わる見込み", "資料の下書きができました"],
                "at_risk": ["先方の返事が遅れています", "ほかの案件と重なり、手が回っていません", "仕様の確認に時間がかかっています"]}


def seed(db: Session, rng_seed: int = 20261123) -> dict:
    if db.scalar(select(func.count()).select_from(User)):
        raise SystemExit("データがもう入っているため、見本データは入れられません（空の DB のときだけ使えます）。")
    rng = random.Random(rng_seed)
    rng_report = random.Random(rng_seed + 1)  # 報告の分は別にして、ほかの見本データを変えない
    today = today_jst()
    pw = security.hash_password(DEMO_PASSWORD)
    users = [User(email=e, name=n, role=r, password_hash=pw) for e, n, r in USERS]
    db.add_all(users)
    db.flush()
    sales = users[1:]  # 営業担当（マネージャーとメンバー）

    customers = []
    for i, (name, kana, ind) in enumerate(CUSTOMERS, start=1):
        c = Customer(name=name, kana=kana, industry=ind, phone=f"03-0000-{1000 + i:04d}",
                     email=f"info{i:02d}@example.com", address=f"東京都千代田区サンプル町 {i}-{i}",
                     owner_id=rng.choice(sales).id, note="")
        db.add(c)
        customers.append(c)
    db.flush()

    status_plan = (["lead"] * 6 + ["proposal"] * 6 + ["negotiation"] * 5 + ["won"] * 9 + ["lost"] * 4)
    rng.shuffle(status_plan)
    projects = []
    for i, status in enumerate(status_plan):
        cust = customers[i % len(customers)]
        p = Project(customer_id=cust.id, name=f"{PROJECT_NAMES[i % len(PROJECT_NAMES)]}（{cust.name[:6]}）",
                    status=status, amount=rng.choice([30, 50, 80, 120, 150, 200, 300, 450, 600]) * 10_000,
                    owner_id=cust.owner_id, description="")
        if status in ("won", "lost"):
            days_ago = rng.randint(3, 170)
            p.closed_at = datetime.combine(today - timedelta(days=days_ago), time(15, 0), JST)
            p.expected_close_date = (today - timedelta(days=days_ago + rng.randint(0, 10)))
        else:
            p.expected_close_date = today + timedelta(days=rng.randint(-5, 60))
        # 開始日：受注予定日の 3 週間〜3 か月前（進行中の案件は今日より後にしない）
        p.start_date = p.expected_close_date - timedelta(days=rng.randint(21, 90))
        if status not in ("won", "lost"):
            p.start_date = min(p.start_date, today - timedelta(days=rng.randint(0, 20)))
        db.add(p)
        projects.append(p)
    db.flush()

    tasks = 0
    for p in projects:
        n = rng.randint(1, 4) if p.status not in ("won", "lost") else rng.randint(0, 2)
        for _ in range(n):
            closed = p.status in ("won", "lost")
            done = closed or rng.random() < 0.35
            # 受注・失注の案件のタスクは、閉じる前の日付で完了させる
            due = (p.closed_at.astimezone(JST).date() - timedelta(days=rng.randint(1, 10))) if closed \
                else today + timedelta(days=rng.randint(-10, 20))
            due = max(due, p.start_date)
            start = max(p.start_date, due - timedelta(days=rng.randint(2, 14)))
            t = Task(project_id=p.id, title=rng.choice(TASK_TITLES), priority=rng.choice(["high", "medium", "medium", "low"]),
                     start_date=start, due_date=due, assignee_id=rng.choice([p.owner_id, p.owner_id, rng.choice(sales).id]),
                     created_by_id=p.owner_id,
                     status="done" if done else rng.choice(["todo", "todo", "doing"]))
            if done:
                t.completed_at = datetime.combine(min(due, today), time(17, 0), JST)
                t.progress = 100
            elif t.status == "doing" and rng_report.random() < 0.8:
                # 対応中のタスクの一部には、担当者からの報告を入れておく
                t.progress = rng_report.choice([20, 30, 50, 60, 80])
                late = due < today or rng_report.random() < 0.3
                t.outlook = "at_risk" if late else "on_track"
                t.report_note = rng_report.choice(REPORT_NOTES["at_risk" if late else "on_track"])
                t.reported_at = datetime.combine(today - timedelta(days=rng_report.randint(0, 10)), time(18, 0), JST)
            db.add(t)
            tasks += 1
    db.flush()
    audit.record(db, users[0].id, "create", "seed", None, f"見本データを投入（顧客 {len(customers)}・案件 {len(projects)}・タスク {tasks}）")
    db.commit()
    return {"ユーザー": len(users), "顧客": len(customers), "案件": len(projects), "タスク": tasks}


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    with get_session_factory()() as db:
        stats = seed(db)
    print("見本データを入れました：" + "・".join(f"{k} {v}" for k, v in stats.items()))
    print(f"ログイン：admin@example.com など／パスワード：{DEMO_PASSWORD}（見本用。本番で使う前に変えてください）")


if __name__ == "__main__":
    main()
