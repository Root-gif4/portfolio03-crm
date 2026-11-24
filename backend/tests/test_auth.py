"""認証・セッション・CSRF・ユーザー管理（UT-A01〜A12）。"""

from datetime import timedelta

from conftest import HEADERS, PASSWORD, Api
from sqlalchemy import select

from app import security
from app.models import AuditLog, User, UserSession


# A01 ログインとログアウト
def test_login_logout(login, db):
    api = login("member")
    me = api.get("/api/auth/me").json()
    assert me["email"] == "member@example.com" and me["role"] == "member"
    assert me["can_manage_users"] is False and me["can_delete"] is False
    cookie = api.c.cookies.get("crm_session")
    # DB には Cookie の値そのものではなく、ハッシュだけが入っている
    stored = db.scalars(select(UserSession.token_hash)).all()
    assert cookie not in stored and len(stored[0]) == 64
    assert api.post("/api/auth/logout").status_code == 204
    assert api.get("/api/auth/me").status_code == 401


# A02 Cookie の属性
def test_cookie_flags(app_client, users):
    api = Api()
    r = api.post("/api/auth/login", json={"email": "member@example.com", "password": PASSWORD})
    sc = r.headers["set-cookie"].lower()
    assert "httponly" in sc and "samesite=lax" in sc and "path=/" in sc


# A03 間違ったパスワード・存在しないメールは同じメッセージ
def test_login_failure_message_is_same(app_client, users):
    api = Api()
    a = api.post("/api/auth/login", json={"email": "member@example.com", "password": "wrong-pass-1"})
    b = api.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-pass-1"})
    assert a.status_code == b.status_code == 401
    assert a.json()["message"] == b.json()["message"]


# A04 続けて失敗するとロック。正しいパスワードでも入れない
def test_lockout(app_client, users, db):
    api = Api()
    for _ in range(5):
        api.post("/api/auth/login", json={"email": "member@example.com", "password": "wrong-pass-1"})
    r = api.post("/api/auth/login", json={"email": "member@example.com", "password": PASSWORD})
    assert r.status_code == 401 and "一時的に止めています" in r.json()["message"]
    # ロックが切れたら入れる
    u = db.scalar(select(User).where(User.email == "member@example.com"))
    u.locked_until = security.now() - timedelta(seconds=1)
    db.commit()
    assert api.post("/api/auth/login", json={"email": "member@example.com", "password": PASSWORD}).status_code == 200
    assert db.scalar(select(AuditLog).where(AuditLog.action == "login_failed")) is not None


# A05 メールアドレスは大文字小文字を区別しない
def test_email_case_insensitive(app_client, users):
    r = Api().post("/api/auth/login", json={"email": " Member@Example.COM ", "password": PASSWORD})
    assert r.status_code == 200


# A06 使用停止のユーザーは入れない・セッションも切れる
def test_inactive_user(login, users, db):
    api = login("member")
    admin = login("admin")
    m = users["member"]
    r = admin.put(f"/api/users/{m.id}", json={"name": "member", "role": "member", "active": False})
    assert r.status_code == 200
    assert api.get("/api/auth/me").status_code == 401
    r = Api().post("/api/auth/login", json={"email": "member@example.com", "password": PASSWORD})
    assert r.status_code == 401


# A07 CSRF：独自ヘッダーのない書き換えは拒否
def test_csrf_header_required(login, sample):
    api = login("manager")
    r = api.post("/api/customers", json={"name": "テスト"}, headers={})
    assert r.status_code == 403
    r = api.c.post("/api/auth/login", json={"email": "member@example.com", "password": PASSWORD})
    assert r.status_code == 403
    assert api.get("/api/customers").status_code == 200  # 読むだけなら要らない


# A08 ログインしていないと API は使えない
def test_requires_login(anon):
    for url in ("/api/customers", "/api/projects", "/api/tasks", "/api/dashboard", "/api/schedule", "/api/team/status", "/api/users/options"):
        assert anon.get(url).status_code == 401
    assert anon.post("/api/customers", json={"name": "x"}).status_code == 401


# A09 ユーザー管理は管理者だけ
def test_user_admin_only(login):
    for key in ("manager", "member"):
        api = login(key)
        assert api.get("/api/users").status_code == 403
        assert api.post("/api/users", json={"email": "x@example.com", "name": "x", "password": "abcdefg123"}).status_code == 403


# A10 ユーザーの追加とパスワードの決まり
def test_create_user_and_password_rules(login):
    admin = login("admin")
    r = admin.post("/api/users", json={"email": "new@example.com", "name": "新人", "role": "member", "password": "short1"})
    assert r.status_code == 400 and "10 文字以上" in r.json()["message"]
    r = admin.post("/api/users", json={"email": "new@example.com", "name": "新人", "role": "member", "password": "abcdefghijk"})
    assert r.status_code == 400 and "英字と数字" in r.json()["message"]
    r = admin.post("/api/users", json={"email": "new@example.com", "name": "新人", "role": "member", "password": "new-user-pass-1"})
    assert r.status_code == 201 and "password" not in r.json() and "password_hash" not in r.json()
    r = admin.post("/api/users", json={"email": "NEW@example.com", "name": "重複", "password": "new-user-pass-1"})
    assert r.status_code == 409
    api = Api()
    assert api.post("/api/auth/login", json={"email": "new@example.com", "password": "new-user-pass-1"}).status_code == 200
    assert api.get("/api/auth/me").json()["name"] == "新人"


# A11 最後の管理者は外せない
def test_last_admin_protected(login, users):
    admin = login("admin")
    r = admin.put(f"/api/users/{users['admin'].id}", json={"name": "admin", "role": "member", "active": True})
    assert r.status_code == 400 and "管理者" in r.json()["message"]


# A12 パスワード変更：今のパスワードが必要・ほかの端末のログインは切れる
def test_change_password(login):
    a = login("member")
    b = login("member")
    r = a.post("/api/auth/password", json={"current_password": "wrong", "new_password": "next-pass-2026"})
    assert r.status_code == 400
    r = a.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "next-pass-2026"})
    assert r.status_code == 204
    assert a.get("/api/auth/me").status_code == 200       # 変えた端末は使える
    assert b.get("/api/auth/me").status_code == 401       # ほかの端末は切れる


# A13 権限の書き換え（知らない項目）は受け付けない
def test_extra_fields_rejected(login, sample):
    api = login("member")
    r = api.post("/api/customers", json={"name": "x", "role": "admin"})
    assert r.status_code == 422
