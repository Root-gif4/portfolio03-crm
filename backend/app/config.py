"""設定。環境変数、なければリポジトリ直下の .env から読む（.env は Git に入れない）。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


@dataclass(frozen=True)
class Settings:
    database_url: str
    test_database_url: str
    cookie_secure: bool
    session_hours: int = 12
    max_failed_logins: int = 5
    lock_minutes: int = 15
    cookie_name: str = "crm_session"
    csrf_header: str = "X-Requested-With"
    csrf_value: str = "crm-app"


@lru_cache
def get_settings() -> Settings:
    env = {**_load_dotenv(ROOT / ".env"), **os.environ}
    url = env.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL が設定されていません。.env.example をコピーして .env を作ってください。")
    return Settings(
        database_url=url,
        test_database_url=env.get("TEST_DATABASE_URL", ""),
        cookie_secure=env.get("COOKIE_SECURE", "false").lower() == "true",
    )
