"""利用者に見せてよいエラー。message は画面にそのまま出す。"""

from __future__ import annotations


class AppError(Exception):
    status_code = 400

    def __init__(self, message: str, status_code: int | None = None, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.field = field
        if status_code is not None:
            self.status_code = status_code


class Unauthorized(AppError):
    status_code = 401


class Forbidden(AppError):
    status_code = 403


class NotFound(AppError):
    status_code = 404


class Conflict(AppError):
    status_code = 409
