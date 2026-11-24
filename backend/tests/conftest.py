"""テストは PostgreSQL のテスト用 DB（crm_test）を使い、テストごとに中身を空にする。"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import security  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Customer, Project, User  # noqa: E402

PASSWORD = "test-pass-123"
HEADERS = {"X-Requested-With": "crm-app"}


@pytest.fixture(scope="session")
def engine():
    url = get_settings().test_database_url
    if not url or not url.rstrip("/").endswith("_test"):
        pytest.exit("TEST_DATABASE_URL（名前が _test で終わる DB）を .env に設定してください。本番の DB では実行しません。")
    eng = create_engine(url)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def Session(engine):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE audit_logs, sessions, tasks, projects, customers, users RESTART IDENTITY CASCADE"))
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture
def db(Session):
    s = Session()
    yield s
    s.close()


@pytest.fixture
def app_client(Session):
    def _get_db():
        s = Session()
        try:
            yield s
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def users(db):
    """管理者・マネージャー・メンバー 2 人。"""
    pw = security.hash_password(PASSWORD)
    out = {}
    for key, role in (("admin", "admin"), ("manager", "manager"), ("member", "member"), ("member2", "member")):
        u = User(email=f"{key}@example.com", name=key, role=role, password_hash=pw)
        db.add(u)
        out[key] = u
    db.commit()
    return out


class Api:
    """ログイン済みのクライアント。書き換えの API には CSRF 対策のヘッダーを付ける。"""

    def __init__(self, email: str | None = None):
        self.c = TestClient(app, raise_server_exceptions=False)
        if email:
            r = self.c.post("/api/auth/login", json={"email": email, "password": PASSWORD}, headers=HEADERS)
            assert r.status_code == 200, r.text

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, json=None, headers=HEADERS, **kw):
        return self.c.post(url, json=json, headers=headers, **kw)

    def put(self, url, json=None, headers=HEADERS, **kw):
        return self.c.put(url, json=json, headers=headers, **kw)

    def patch(self, url, json=None, headers=HEADERS, **kw):
        return self.c.patch(url, json=json, headers=headers, **kw)

    def delete(self, url, headers=HEADERS, **kw):
        return self.c.delete(url, headers=headers, **kw)


@pytest.fixture
def login(app_client, users):
    def _login(key: str) -> Api:
        return Api(f"{key}@example.com")
    return _login


@pytest.fixture
def anon(app_client):
    return Api()


@pytest.fixture
def sample(db, users):
    """メンバーが担当の顧客と案件、メンバー2が担当の顧客と案件。"""
    c1 = Customer(name="サンプル商事", owner_id=users["member"].id)
    c2 = Customer(name="みどり食品", owner_id=users["member2"].id)
    db.add_all([c1, c2])
    db.flush()
    p1 = Project(customer_id=c1.id, name="システム導入", amount=1_000_000, owner_id=users["member"].id)
    p2 = Project(customer_id=c2.id, name="Web 改修", amount=500_000, owner_id=users["member2"].id)
    db.add_all([p1, p2])
    db.commit()
    return {"c1": c1, "c2": c2, "p1": p1, "p2": p2}
