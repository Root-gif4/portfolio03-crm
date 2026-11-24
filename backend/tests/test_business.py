"""顧客・案件・タスク・権限・ステータス・楽観ロック・検索・ダッシュボード・操作履歴（UT-B01〜B24）。"""

from datetime import date, timedelta

from conftest import Api
from sqlalchemy import select

from app.common import today_jst
from app.models import AuditLog, Project, Task


def cust(api, **kw):
    body = {"name": "テスト株式会社", **kw}
    return api.post("/api/customers", json=body)


# B01 顧客の作成・入力の整え・チェック
def test_customer_create_and_validation(login, users):
    api = login("member")
    r = cust(api, name="  ＡＢＣ商事（本社） ", kana="ｴｰﾋﾞｰｼｰ", phone="０３－１２３４－５６７８", email="Info@Example.COM")
    assert r.status_code == 201, r.text
    body = r.json()
    # 全角の英数字と半角カナは直し、全角のかっこはそのまま
    assert (body["name"], body["kana"], body["phone"], body["email"]) == ("ABC商事（本社）", "エービーシー", "03-1234-5678", "info@example.com")
    assert body["owner"]["id"] == users["member"].id and body["can_edit"] and not body["can_delete"]
    bad = [({"name": ""}, "名前"), ({"name": "x" * 101}, "100 文字以内"), ({"email": "abc"}, "メールアドレスの形"),
           ({"phone": "12345"}, "電話番号の形"), ({"name": "a\x00b"}, "制御文字")]
    for kw, msg in bad:
        r = cust(api, **kw)
        assert r.status_code == 422 and msg in r.json()["message"], (kw, r.text)


# B02 メンバーは担当者を他人にできない（マネージャーはできる）
def test_member_cannot_assign_others(login, users):
    r = cust(login("member"), owner_id=users["member2"].id)
    assert r.status_code == 403
    r = cust(login("manager"), owner_id=users["member2"].id)
    assert r.status_code == 201 and r.json()["owner"]["id"] == users["member2"].id


# B03 編集の権限：担当者かマネージャー以上（他人の顧客は番号を変えても編集できない）
def test_customer_edit_permission(login, sample):
    c2 = sample["c2"]
    member = login("member")
    data = member.get(f"/api/customers/{c2.id}").json()   # 見ることはできる
    assert data["can_edit"] is False
    r = member.put(f"/api/customers/{c2.id}", json={"name": "書き換え", "version": data["version"]})
    assert r.status_code == 403
    r = login("member2").put(f"/api/customers/{c2.id}", json={"name": "書き換え", "version": data["version"]})
    assert r.status_code == 200 and r.json()["name"] == "書き換え" and r.json()["version"] == 2


# B04 楽観ロック：古い版では保存しない
def test_optimistic_lock(login, sample):
    api = login("manager")
    c = api.get(f"/api/customers/{sample['c1'].id}").json()
    assert api.put(f"/api/customers/{c['id']}", json={"name": "1回目", "version": c["version"]}).status_code == 200
    r = api.put(f"/api/customers/{c['id']}", json={"name": "2回目", "version": c["version"]})
    assert r.status_code == 409 and "先に更新" in r.json()["message"]


# B05 削除：メンバーは不可、案件のある顧客は不可、削除後は見えない
def test_customer_delete(login, sample, db):
    assert login("member").delete(f"/api/customers/{sample['c1'].id}").status_code == 403
    mgr = login("manager")
    r = mgr.delete(f"/api/customers/{sample['c1'].id}")
    assert r.status_code == 409 and "案件が 1 件" in r.json()["message"]
    assert mgr.delete(f"/api/projects/{sample['p1'].id}").status_code == 204
    assert mgr.delete(f"/api/customers/{sample['c1'].id}").status_code == 204
    assert mgr.get(f"/api/customers/{sample['c1'].id}").status_code == 404
    assert all(c["id"] != sample["c1"].id for c in mgr.get("/api/customers").json()["items"])


# B06 顧客の検索・並び・ページ
def test_customer_search_and_paging(login, users):
    api = login("manager")
    for i in range(25):
        cust(api, name=f"会社{i:02d}", kana=f"カイシャ{i:02d}", industry="IT" if i % 2 else "製造")
    cust(api, name="100%商事")
    r = api.get("/api/customers", params={"per_page": 10, "page": 3}).json()
    assert r["total"] == 26 and len(r["items"]) == 6
    assert api.get("/api/customers", params={"q": "会社1"}).json()["total"] == 10
    assert api.get("/api/customers", params={"q": "%"}).json()["total"] == 1   # % は文字として探す
    assert api.get("/api/customers", params={"industry": "IT"}).json()["total"] == 12
    assert api.get("/api/customers", params={"per_page": 1000}).json()["per_page"] == 100  # 上限
    assert sorted(api.get("/api/customers/industries").json()) == ["IT", "製造"]


# B07 案件の作成とステータス：受注で閉じた日時、進行中に戻すとき消える
def test_project_status_rules(login, sample):
    member = login("member")
    r = member.post("/api/projects", json={"customer_id": sample["c1"].id, "name": "新案件", "amount": 300000})
    assert r.status_code == 201
    p = r.json()
    assert p["status"] == "lead" and p["closed_at"] is None
    r = member.put(f"/api/projects/{p['id']}", json={"customer_id": p["customer"]["id"], "name": p["name"],
                                                    "amount": 300000, "status": "won", "version": p["version"]})
    assert r.status_code == 200 and r.json()["closed_at"] is not None
    won = r.json()
    # メンバーは受注の案件を戻せない
    body = {"customer_id": won["customer"]["id"], "name": won["name"], "amount": 300000, "status": "negotiation",
            "version": won["version"]}
    r = member.put(f"/api/projects/{won['id']}", json=body)
    assert r.status_code == 403 and "マネージャー以上" in r.json()["message"]
    r = login("manager").put(f"/api/projects/{won['id']}", json=body)
    assert r.status_code == 200 and r.json()["closed_at"] is None and r.json()["status"] == "negotiation"


# B08 案件の入力チェック
def test_project_validation(login, sample):
    api = login("member")
    base = {"customer_id": sample["c1"].id, "name": "案件"}
    for kw in ({"amount": -1}, {"amount": 10**13}, {"status": "done"}, {"expected_close_date": "2026-13-01"},
               {"customer_id": 99999}):
        r = api.post("/api/projects", json={**base, **kw})
        assert r.status_code in (404, 422), (kw, r.text)


# B09 案件の編集権限（他人の案件・番号を変えても不可）
def test_project_edit_permission(login, sample):
    p2 = sample["p2"]
    member = login("member")
    data = member.get(f"/api/projects/{p2.id}").json()
    body = {"customer_id": data["customer"]["id"], "name": "乗っ取り", "status": "lead", "version": data["version"]}
    assert member.put(f"/api/projects/{p2.id}", json=body).status_code == 403
    assert member.delete(f"/api/projects/{p2.id}").status_code == 403


# B10 案件の検索・絞り込み
def test_project_filters(login, sample, db):
    api = login("manager")
    sample["p1"].expected_close_date = today_jst() + timedelta(days=10)
    db.commit()
    assert api.get("/api/projects", params={"q": "サンプル"}).json()["total"] == 1      # 顧客名で
    assert api.get("/api/projects", params={"status": ["lead"]}).json()["total"] == 2
    assert api.get("/api/projects", params={"amount_min": 600000}).json()["total"] == 1
    assert api.get("/api/projects", params={"close_to": (today_jst() + timedelta(days=30)).isoformat()}).json()["total"] == 1
    member = login("member")
    assert member.get("/api/projects", params={"mine": True}).json()["total"] == 1
    assert api.get("/api/projects", params={"sort": "amount"}).json()["items"][0]["amount"] == 1_000_000


# B11 案件の削除でタスクも消える
def test_project_delete_cascades_tasks(login, sample):
    mgr = login("manager")
    t = mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "連絡"}).json()
    assert mgr.delete(f"/api/projects/{sample['p1'].id}").status_code == 204
    assert mgr.get(f"/api/tasks/{t['id']}").status_code == 404
    assert mgr.get("/api/tasks").json()["total"] == 0


# B12 タスクの作成権限：案件の担当者・自分を担当者にする・マネージャー
def test_task_create_permission(login, sample, users):
    member = login("member")
    ok = member.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "自分の案件"})
    assert ok.status_code == 201
    r = member.post("/api/tasks", json={"project_id": sample["p2"].id, "title": "他人の案件"})
    assert r.status_code == 403
    r = member.post("/api/tasks", json={"project_id": sample["p2"].id, "title": "手伝う", "assignee_id": users["member"].id})
    assert r.status_code == 201


# B13 タスクのステータス：完了で完了日時、戻すと消える、楽観ロック
def test_task_status(login, sample):
    member = login("member")
    t = member.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "見積"}).json()
    r = member.patch(f"/api/tasks/{t['id']}/status", json={"status": "done", "version": t["version"]})
    assert r.status_code == 200 and r.json()["completed_at"] is not None
    r2 = member.patch(f"/api/tasks/{t['id']}/status", json={"status": "todo", "version": t["version"]})
    assert r2.status_code == 409
    r3 = member.patch(f"/api/tasks/{t['id']}/status", json={"status": "doing", "version": r.json()["version"]})
    assert r3.json()["completed_at"] is None and r3.json()["status"] == "doing"


# B14 タスクの編集権限
def test_task_edit_permission(login, sample, users):
    owner = login("member2")
    t = owner.post("/api/tasks", json={"project_id": sample["p2"].id, "title": "資料"}).json()
    other = login("member")
    assert other.get(f"/api/tasks/{t['id']}").json()["can_edit"] is False
    assert other.patch(f"/api/tasks/{t['id']}/status", json={"status": "done", "version": t["version"]}).status_code == 403
    # 担当者にしてもらえば変えられる
    body = {**{k: t[k] for k in ("title", "priority", "due_date", "description")}, "project_id": sample["p2"].id,
            "status": "todo", "assignee_id": users["member"].id, "version": t["version"]}
    t2 = owner.put(f"/api/tasks/{t['id']}", json=body).json()
    assert other.patch(f"/api/tasks/{t['id']}/status", json={"status": "done", "version": t2["version"]}).status_code == 200


# B15 期限切れと絞り込み
def test_task_overdue_and_filters(login, sample, users):
    mgr = login("manager")
    past = (today_jst() - timedelta(days=2)).isoformat()
    future = (today_jst() + timedelta(days=3)).isoformat()
    mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "期限切れ", "due_date": past,
                                 "assignee_id": users["member"].id, "priority": "high"})
    mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "これから", "due_date": future,
                                 "assignee_id": users["member"].id})
    mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "完了済み", "due_date": past, "status": "done"})
    r = mgr.get("/api/tasks", params={"overdue": True}).json()
    assert [t["title"] for t in r["items"]] == ["期限切れ"] and r["items"][0]["overdue"] is True
    member = login("member")
    assert member.get("/api/tasks", params={"mine": True}).json()["total"] == 2
    assert mgr.get("/api/tasks", params={"status": ["done"]}).json()["total"] == 1
    assert mgr.get("/api/tasks", params={"q": "サンプル"}).json()["total"] == 3   # 顧客名で


# B16 ダッシュボード
def test_dashboard(login, sample, users, db):
    mgr = login("manager")
    p = mgr.get(f"/api/projects/{sample['p1'].id}").json()
    mgr.put(f"/api/projects/{p['id']}", json={"customer_id": p["customer"]["id"], "name": p["name"],
                                              "amount": p["amount"], "status": "won", "version": p["version"]})
    mgr.post("/api/tasks", json={"project_id": sample["p2"].id, "title": "期限切れ",
                                 "due_date": (today_jst() - timedelta(days=1)).isoformat(),
                                 "assignee_id": users["manager"].id})
    d = mgr.get("/api/dashboard").json()
    assert d["kpi"]["customers"] == 2 and d["kpi"]["open_projects"] == 1
    assert d["kpi"]["pipeline_amount"] == 500_000 and d["kpi"]["won_this_month"] == 1_000_000
    assert d["kpi"]["win_rate"] == 100 and d["kpi"]["overdue_tasks"] == 1
    assert len(d["monthly_won"]) == 6 and d["monthly_won"][-1]["amount"] == 1_000_000
    assert [t["title"] for t in d["my_overdue"]] == ["期限切れ"]
    assert {s["status"] for s in d["by_status"]} == {"lead", "proposal", "negotiation", "won", "lost"}
    assert d["recent"]  # マネージャーは全体の動きが見える
    assert login("member").get("/api/dashboard").json()["recent"] == []  # メンバーは自分の操作だけ


# B17 操作履歴：変わった項目だけ記録・パスワードは残さない・マネージャー以上だけ見られる
def test_audit_logs(login, sample, users, db):
    mgr = login("manager")
    c = mgr.get(f"/api/customers/{sample['c1'].id}").json()
    mgr.put(f"/api/customers/{c['id']}", json={"name": "新しい名前", "phone": "03-1111-2222", "version": c["version"]})
    log = db.scalar(select(AuditLog).where(AuditLog.action == "update", AuditLog.entity_type == "customer"))
    assert log.changes == {"name": ["サンプル商事", "新しい名前"], "phone": ["", "03-1111-2222"]}
    assert login("member").get("/api/audit-logs").status_code == 403
    login("admin").post(f"/api/users/{users['member'].id}/password", json={"new_password": "reset-pass-2026"})
    assert all("password" not in str(a.changes) for a in db.scalars(select(AuditLog)))
    r = mgr.get("/api/audit-logs", params={"entity_type": "customer"}).json()
    assert r["total"] == 1 and r["items"][0]["user"]["name"] == "manager"
    assert mgr.get("/api/audit-logs", params={"action": "login"}).json()["total"] >= 1


# B18 想定外のエラーは受付番号だけ（内部の情報を出さない）
def test_unexpected_error_hides_details(login, monkeypatch):
    from app.routers import customers

    def boom(*a, **k):
        raise RuntimeError("SECRET postgresql://crm:pass@db")

    monkeypatch.setattr(customers, "_owner", boom)
    r = login("manager").post("/api/customers", json={"name": "x"})
    assert r.status_code == 500
    assert "受付番号" in r.json()["message"] and "SECRET" not in r.text and "postgresql" not in r.text


# B19 セキュリティのヘッダー
def test_security_headers(login):
    r = login("member").get("/api/auth/me")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"
    assert "default-src 'self'" in r.headers["content-security-policy"] and r.headers["cache-control"] == "no-store"


# B20 DB の制約（API を通さずに入れても弾く）
def test_db_constraints(db, sample):
    import pytest
    from sqlalchemy.exc import IntegrityError
    for bad in (dict(status="won"), dict(status="zzz"), dict(amount=-1)):   # 受注なのに閉じた日時がない 等
        p = Project(customer_id=sample["c1"].id, name="x", owner_id=sample["p1"].owner_id, **bad)
        db.add(p)
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()
    t = Task(project_id=sample["p1"].id, title="x", status="done", created_by_id=sample["p1"].owner_id)
    db.add(t)
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


# B21 ユーザーの選択肢は使用中だけ
def test_user_options(login, users):
    admin = login("admin")
    admin.put(f"/api/users/{users['member2'].id}", json={"name": "member2", "role": "member", "active": False})
    names = [u["name"] for u in login("member").get("/api/users/options").json()]
    assert "member2" not in names and "member" in names


# B22 使用停止の人は担当者にできない
def test_inactive_user_cannot_be_assigned(login, users, sample):
    admin = login("admin")
    admin.put(f"/api/users/{users['member2'].id}", json={"name": "member2", "role": "member", "active": False})
    r = login("manager").post("/api/tasks", json={"project_id": sample["p1"].id, "title": "x",
                                                  "assignee_id": users["member2"].id})
    assert r.status_code == 404 and "使用停止" in r.json()["message"]


# B23 画面（SPA）の配信：/api 以外は index.html、ない API は 404 の JSON
def test_spa_fallback(anon):
    r = anon.get("/api/nothing")
    assert r.status_code == 404 and r.json()["message"]
    r = anon.get("/projects/1")
    assert r.status_code in (200, 404)  # ビルド前は 404 の案内、ビルド後は index.html


# B24 見本データ
def test_seed(Session):
    from app.seed import seed
    with Session() as s:
        stats = seed(s)
    assert stats["ユーザー"] == 4 and stats["顧客"] == 15 and stats["案件"] == 30
    with Session() as s:
        assert s.scalar(select(Project).where(Project.status == "won")) is not None


# B25 開始日：入れなければ今日（期限が前ならその日）、期限・受注予定日は開始日より前にできない、変更で省くと今のまま
def test_start_date(login, users, sample, db):
    mgr = login("manager")
    today = today_jst()
    r = mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "a"})
    assert r.status_code == 201 and r.json()["start_date"] == today.isoformat()
    r = mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "b",
                                     "due_date": (today - timedelta(days=3)).isoformat()})
    assert r.json()["start_date"] == (today - timedelta(days=3)).isoformat()
    r = mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "c", "start_date": "2026-12-10",
                                     "due_date": "2026-12-01"})
    assert r.status_code == 422 and r.json()["field"] == "due_date" and "開始日" in r.json()["message"]
    t = mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "d", "start_date": "2026-11-01",
                                     "due_date": "2026-11-30"}).json()
    t2 = mgr.put(f"/api/tasks/{t['id']}", json={"project_id": t["project"]["id"], "title": "d2",
                                                "due_date": "2026-12-05", "version": t["version"]}).json()
    assert t2["start_date"] == "2026-11-01"
    p = mgr.get(f"/api/projects/{sample['p2'].id}").json()
    r = mgr.put(f"/api/projects/{p['id']}", json={"customer_id": p["customer"]["id"], "name": p["name"],
                                                  "start_date": "2026-12-01", "expected_close_date": "2026-11-01",
                                                  "version": p["version"]})
    assert r.status_code == 422 and r.json()["field"] == "expected_close_date"
    r = mgr.put(f"/api/projects/{p['id']}", json={"customer_id": p["customer"]["id"], "name": p["name"],
                                                  "start_date": "2026-10-01", "expected_close_date": "2026-12-20",
                                                  "version": p["version"]})
    assert r.status_code == 200 and r.json()["start_date"] == "2026-10-01"
    log = db.scalars(select(AuditLog).where(AuditLog.entity_type == "project", AuditLog.action == "update")).first()
    assert "start_date" in log.changes


# B26 開始日の決まりは DB でも守る
def test_period_constraint(db, sample):
    import pytest
    from sqlalchemy.exc import IntegrityError
    db.add(Task(project_id=sample["p1"].id, title="x", start_date=date(2026, 12, 2), due_date=date(2026, 12, 1),
                created_by_id=sample["p1"].owner_id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# B27 ダッシュボードの期限切れ：マネージャー以上は全体、メンバーは自分の担当だけ
def test_dashboard_overdue_scope(login, users, sample):
    mgr = login("manager")
    past = (today_jst() - timedelta(days=2)).isoformat()
    for who in ("member", "member2", "member2"):
        mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": f"遅れ {who}", "due_date": past,
                                     "assignee_id": users[who].id})
    d = mgr.get("/api/dashboard").json()["kpi"]
    assert d["overdue_tasks"] == 3 and d["overdue_scope"] == "all"
    d = login("member").get("/api/dashboard").json()["kpi"]
    assert d["overdue_tasks"] == 1 and d["overdue_scope"] == "mine"


# B28 進行中だけの絞り込み
def test_projects_open_only(login, sample):
    mgr = login("manager")
    p = mgr.get(f"/api/projects/{sample['p1'].id}").json()
    mgr.put(f"/api/projects/{p['id']}", json={"customer_id": p["customer"]["id"], "name": p["name"], "status": "won",
                                              "version": p["version"]})
    r = mgr.get("/api/projects", params={"open_only": True}).json()
    assert [x["id"] for x in r["items"]] == [sample["p2"].id]


# B29 予定表：範囲と重なる案件とそのタスク、自分の（担当の案件か、自分のタスクがある案件）、範囲のチェック
def test_schedule(login, users, sample):
    mgr = login("manager")
    for pid, start, end in ((sample["p1"].id, "2026-11-01", "2026-12-15"), (sample["p2"].id, "2027-03-01", "2027-03-31")):
        p = mgr.get(f"/api/projects/{pid}").json()
        assert mgr.put(f"/api/projects/{pid}", json={"customer_id": p["customer"]["id"], "name": p["name"],
                                                     "start_date": start, "expected_close_date": end,
                                                     "version": p["version"]}).status_code == 200
    mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "見積", "start_date": "2026-11-05",
                                 "due_date": "2026-11-10", "assignee_id": users["member2"].id})
    r = mgr.get("/api/schedule", params={"start": "2026-11-01", "end": "2026-12-31"}).json()
    assert [p["id"] for p in r["projects"]] == [sample["p1"].id]
    assert r["projects"][0]["tasks"][0]["title"] == "見積" and r["projects"][0]["start_date"] == "2026-11-01"
    # メンバー2 の「自分の」：担当の案件は範囲外だが、自分のタスクがある p1 は出る
    r = login("member2").get("/api/schedule", params={"start": "2026-11-01", "end": "2026-12-31", "mine": True}).json()
    assert [p["id"] for p in r["projects"]] == [sample["p1"].id]
    assert mgr.get("/api/schedule", params={"start": "2026-12-01", "end": "2026-11-01"}).status_code == 422
    assert mgr.get("/api/schedule", params={"start": "2026-01-01", "end": "2027-06-01"}).status_code == 422
    assert login("member").get("/api/schedule").status_code == 200


# B30 進み具合の報告：担当者が報告できる、未着手なら対応中になる、見通し・ひとこと・日時が残る、他人は不可、完了は不可
def test_task_report(login, users, sample, db):
    mgr = login("manager")
    t = mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "見積", "assignee_id": users["member"].id}).json()
    member = login("member")
    r = member.patch(f"/api/tasks/{t['id']}/report", json={"progress": 40, "outlook": "at_risk", "note": "先方待ち",
                                                           "version": t["version"]})
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["progress"], b["outlook"], b["report_note"], b["status"]) == (40, "at_risk", "先方待ち", "doing")
    assert b["reported_at"]
    # 見通しだけ（進み具合は今のまま）
    b2 = member.patch(f"/api/tasks/{t['id']}/report", json={"outlook": "on_track", "version": b["version"]}).json()
    assert (b2["progress"], b2["outlook"]) == (40, "on_track")
    log = db.scalars(select(AuditLog).where(AuditLog.entity_type == "task", AuditLog.action == "update")
                     .order_by(AuditLog.id)).first()
    assert "40%" in log.summary and "遅れそう" in log.summary and "先方待ち" in log.summary
    # 古い版・範囲外・他人
    assert member.patch(f"/api/tasks/{t['id']}/report", json={"progress": 50, "version": 1}).status_code == 409
    assert member.patch(f"/api/tasks/{t['id']}/report", json={"progress": 101, "version": b2["version"]}).status_code == 422
    assert login("member2").patch(f"/api/tasks/{t['id']}/report", json={"progress": 50, "version": b2["version"]}).status_code == 403
    # 完了にすると 100%・見通しは消える、完了には報告できない、戻すと 90%
    done = member.patch(f"/api/tasks/{t['id']}/status", json={"status": "done", "version": b2["version"]}).json()
    assert (done["progress"], done["outlook"]) == (100, None)
    assert member.patch(f"/api/tasks/{t['id']}/report", json={"progress": 50, "version": done["version"]}).status_code == 409
    back = member.patch(f"/api/tasks/{t['id']}/status", json={"status": "doing", "version": done["version"]}).json()
    assert back["progress"] == 90


# B31 チームの状況：マネージャーと管理者だけ。メンバーごとの数と、遅れそう・期限切れ・止まっているタスク
def test_team_status(login, users, sample, db):
    from datetime import datetime, timezone
    mgr = login("manager")
    past = (today_jst() - timedelta(days=2)).isoformat()
    a = mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "遅れ", "due_date": past,
                                     "assignee_id": users["member"].id}).json()
    b = mgr.post("/api/tasks", json={"project_id": sample["p1"].id, "title": "危ない", "assignee_id": users["member"].id}).json()
    mgr.patch(f"/api/tasks/{b['id']}/report", json={"progress": 30, "outlook": "at_risk", "version": b["version"]})
    c = mgr.post("/api/tasks", json={"project_id": sample["p2"].id, "title": "止まっている", "assignee_id": users["member2"].id}).json()
    db.execute(Task.__table__.update().where(Task.id == c["id"])
               .values(updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc)))
    db.commit()
    mgr.post("/api/tasks", json={"project_id": sample["p2"].id, "title": "担当なし"})
    for who in ("manager", "admin"):
        r = login(who).get("/api/team/status")
        assert r.status_code == 200
        d = r.json()
        m = {x["name"]: x for x in d["members"]}
        assert (m["member"]["open"], m["member"]["overdue"], m["member"]["at_risk"], m["member"]["doing"]) == (2, 1, 1, 1)
        assert m["member"]["avg_progress"] == 15 and m["member"]["last_report_at"]
        assert m["member2"]["stale"] == 1 and m["（担当者なし）"]["open"] == 1
        assert [t["title"] for t in d["at_risk"]] == ["危ない"]
        assert [t["title"] for t in d["overdue"]] == ["遅れ"]
        assert [t["title"] for t in d["stale"]] == ["止まっている"]
    assert login("member").get("/api/team/status").status_code == 403
    assert login("member").get("/api/auth/me").json()["can_view_team"] is False
    assert login("admin").get("/api/auth/me").json()["can_view_team"] is True
    # 一覧の絞り込み（遅れそう・止まっている）
    assert [t["title"] for t in mgr.get("/api/tasks", params={"at_risk": True}).json()["items"]] == ["危ない"]
    assert [t["title"] for t in mgr.get("/api/tasks", params={"stale": True}).json()["items"]] == ["止まっている"]


# B32 進み具合・見通しの決まりは DB でも守る
def test_report_constraints(db, sample):
    import pytest
    from sqlalchemy.exc import IntegrityError
    for kw in ({"progress": 150}, {"outlook": "maybe"}):
        db.add(Task(project_id=sample["p1"].id, title="x", created_by_id=sample["p1"].owner_id, **kw))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
