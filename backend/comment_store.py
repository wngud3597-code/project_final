from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class CommentStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()

    def _read(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        return value if isinstance(value, list) else []

    def _write(self, rows: list[dict[str, Any]]) -> None:
        self.path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def _hash(password: str, salt: str) -> str:
        return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

    @staticmethod
    def _public(row: dict[str, Any]) -> dict[str, Any]:
        return {key: row.get(key) for key in ("id", "contentid", "author", "text", "createdAt", "updatedAt")}

    def list(self, contentid: str) -> list[dict[str, Any]]:
        with self.lock:
            return [self._public(row) for row in self._read() if row.get("contentid") == contentid]

    def create(self, contentid: str, author: str, text: str, password: str) -> dict[str, Any]:
        salt = secrets.token_hex(16)
        now = datetime.now(timezone.utc).isoformat()
        row = {"id": str(uuid.uuid4()), "contentid": contentid, "author": author, "text": text,
               "createdAt": now, "updatedAt": None, "passwordSalt": salt,
               "passwordHash": self._hash(password, salt)}
        with self.lock:
            rows = self._read()
            rows.append(row)
            self._write(rows[-5000:])
        return self._public(row)

    def change(self, comment_id: str, contentid: str, password: str, *, text: str | None = None, delete: bool = False) -> dict[str, Any] | None:
        with self.lock:
            rows = self._read()
            index = next((i for i, row in enumerate(rows) if row.get("id") == comment_id and row.get("contentid") == contentid), -1)
            if index < 0:
                return None
            row = rows[index]
            if not hmac.compare_digest(self._hash(password, row["passwordSalt"]), row["passwordHash"]):
                raise PermissionError("비밀번호가 맞지 않습니다.")
            if delete:
                rows.pop(index)
                result = {"deleted": True}
            else:
                row["text"] = text
                row["updatedAt"] = datetime.now(timezone.utc).isoformat()
                result = self._public(row)
            self._write(rows)
            return result
