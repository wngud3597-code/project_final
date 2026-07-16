from __future__ import annotations

import json
import mimetypes
import os
import socket
import threading
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from data_store import TourismStore
from weather_service import WeatherError, WeatherService, load_env
from chat_service import ChatError, TourismChatService
from comment_store import CommentStore


ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
DATA_DIR = ROOT / "data"

env = load_env(BACKEND / ".env")
HOST = env.get("HOST", "127.0.0.1")
PORT = int(env.get("PORT", "8000"))

STORE = TourismStore(DATA_DIR)
WEATHER = WeatherService(BACKEND / ".env")
CHAT = TourismChatService(BACKEND / ".env", STORE, WEATHER)
COMMENTS = CommentStore(BACKEND / "comments.local.json")


def one(params: dict[str, list[str]], key: str, default: str = "") -> str:
    values = params.get(key)
    return values[0] if values else default


def integer(value: str, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return min(maximum, max(minimum, parsed))


class Handler(BaseHTTPRequestHandler):
    server_version = "LocalHubSeoul/2.0"

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        super().end_headers()

    def json_response(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def file_response(self, path: Path, *, no_cache: bool = False) -> None:
        try:
            resolved = path.resolve(strict=True)
        except FileNotFoundError:
            self.send_error(404)
            return

        frontend_root = FRONTEND.resolve()
        if resolved != frontend_root and frontend_root not in resolved.parents:
            self.send_error(403)
            return

        content = resolved.read_bytes()
        content_type, _ = mimetypes.guess_type(resolved.name)
        if resolved.suffix == ".js":
            content_type = "text/javascript"
        elif resolved.suffix == ".css":
            content_type = "text/css"

        self.send_response(200)
        self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store" if no_cache else "public, max-age=3600")
        self.end_headers()
        self.wfile.write(content)

    def read_json_body(self, maximum: int = 20000) -> Any:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("잘못된 Content-Length입니다.") from exc
        if length <= 0 or length > maximum:
            raise ValueError("요청 본문 크기가 올바르지 않습니다.")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query, keep_blank_values=True)

        try:
            if path == "/api/health":
                self.json_response(
                    200,
                    {
                        "status": "ok",
                        "loadedItems": len(STORE.items),
                        "weatherConfigured": WEATHER.configured,
                        "chatConfigured": CHAT.configured,
                        "openAIConfigured": CHAT.openai_configured,
                        "chatMode": "openai" if CHAT.mode in {"auto", "openai"} and CHAT.openai_configured else "guided-fallback",
                        "openAIModel": CHAT.model if CHAT.openai_configured else None,
                        "vue": "Vue 3 global production build loaded by frontend loader",
                    },
                )
                return

            if path == "/api/stats":
                self.json_response(200, STORE.stats())
                return

            if path == "/api/search":
                result = STORE.search(
                    query=one(params, "q"),
                    category=one(params, "category", "전체"),
                    district=one(params, "district", "전체"),
                    completeness=one(params, "completeness", "전체"),
                    sort=one(params, "sort", "title"),
                    page=integer(one(params, "page", "1"), 1, 1, 100000),
                    page_size=integer(one(params, "pageSize", "24"), 24, 1, 60),
                )
                self.json_response(200, result)
                return

            if path == "/api/map":
                result = STORE.map_points(
                    query=one(params, "q"),
                    category=one(params, "category", "전체"),
                    district=one(params, "district", "전체"),
                    limit=integer(one(params, "limit", "300"), 300, 1, 500),
                )
                self.json_response(200, result)
                return


            if path == "/api/bookmarks":
                ids = [value for value in one(params, "ids").split(",") if value]
                self.json_response(200, {"items": STORE.get_many(ids[:200])})
                return

            if path == "/api/comments":
                contentid = one(params, "contentid").strip()
                if not contentid:
                    self.json_response(400, {"error": "contentid가 필요합니다."})
                else:
                    items = COMMENTS.list(contentid)
                    self.json_response(200, {"items": items, "count": len(items), "persistence": "local-json"})
                return

            if path.startswith("/api/items/"):
                content_id = path.removeprefix("/api/items/").strip("/")
                item = STORE.get(content_id)
                if not item:
                    self.json_response(404, {"error": "장소를 찾을 수 없습니다."})
                else:
                    self.json_response(200, item)
                return

            if path == "/api/weather/status":
                self.json_response(
                    200,
                    {
                        "configured": WEATHER.configured,
                        "provider": "기상청",
                        "service": "단기예보 조회서비스",
                        "mode": "실제 API만 사용하며 시연용 값을 생성하지 않습니다.",
                    },
                )
                return

            if path == "/api/weather":
                lat_text = one(params, "lat")
                lon_text = one(params, "lon")
                try:
                    latitude = float(lat_text)
                    longitude = float(lon_text)
                except ValueError:
                    self.json_response(400, {"error": "유효한 lat, lon 좌표가 필요합니다."})
                    return

                try:
                    weather = WEATHER.get(latitude, longitude)
                except WeatherError as exc:
                    self.json_response(
                        502,
                        {
                            "error": str(exc),
                            "provider": "기상청",
                            "isLive": False,
                            "notice": "시연용 데이터로 대체하지 않았습니다. 오류 원인을 그대로 표시합니다.",
                        },
                    )
                    return

                self.json_response(200, weather)
                return

            if path == "/":
                self.file_response(FRONTEND / "index.html", no_cache=True)
                return

            relative = path.lstrip("/")
            target = FRONTEND / relative
            if target.is_file():
                self.file_response(target, no_cache=target.suffix in {".js", ".css", ".html"})
                return

            # SPA-style fallback.
            self.file_response(FRONTEND / "index.html", no_cache=True)

        except BrokenPipeError:
            pass
        except Exception as exc:
            traceback.print_exc()
            self.json_response(500, {"error": f"서버 오류: {exc}"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/comments":
            try:
                payload = self.read_json_body()
                contentid = str(payload.get("contentid", "")).strip()
                author = str(payload.get("author", "")).strip()
                text = str(payload.get("text", "")).strip()
                password = str(payload.get("password", ""))
                if not STORE.get(contentid):
                    raise ValueError("댓글을 남길 장소를 찾을 수 없습니다.")
                if not 2 <= len(author) <= 30 or not 2 <= len(text) <= 500 or not 4 <= len(password) <= 50:
                    raise ValueError("작성자 2~30자, 댓글 2~500자, 비밀번호 4~50자로 입력해 주세요.")
                item = COMMENTS.create(contentid, author, text, password)
                self.json_response(201, {"item": item})
            except (ValueError, json.JSONDecodeError) as exc:
                self.json_response(400, {"error": str(exc)})
            return
        if parsed.path != "/api/chat":
            self.json_response(404, {"error": "API 경로를 찾을 수 없습니다."})
            return
        try:
            payload = self.read_json_body()
            message = str(payload.get("message", "")).strip()
            if not message or len(message) > 1000:
                self.json_response(400, {"error": "질문은 1~1,000자로 입력해 주세요."})
                return
            history = payload.get("history", [])
            if not isinstance(history, list):
                history = []
            self.json_response(200, CHAT.ask(message, history))
        except (ValueError, json.JSONDecodeError) as exc:
            self.json_response(400, {"error": str(exc)})
        except ChatError as exc:
            self.json_response(502, {"error": str(exc)})
        except Exception as exc:
            traceback.print_exc()
            self.json_response(500, {"error": f"서버 오류: {exc}"})

    def _change_comment(self, delete: bool = False) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/comments/"):
            self.json_response(404, {"error": "API 경로를 찾을 수 없습니다."})
            return
        try:
            payload = self.read_json_body()
            comment_id = parsed.path.removeprefix("/api/comments/").strip("/")
            contentid = str(payload.get("contentid", "")).strip()
            password = str(payload.get("password", ""))
            text = str(payload.get("text", "")).strip()
            if not contentid or len(password) < 4 or (not delete and not 2 <= len(text) <= 500):
                raise ValueError("댓글 정보와 비밀번호를 올바르게 입력해 주세요.")
            item = COMMENTS.change(comment_id, contentid, password, text=text, delete=delete)
            if item is None:
                self.json_response(404, {"error": "댓글을 찾을 수 없습니다."})
            else:
                self.json_response(200, item if delete else {"item": item})
        except PermissionError as exc:
            self.json_response(403, {"error": str(exc)})
        except (ValueError, json.JSONDecodeError) as exc:
            self.json_response(400, {"error": str(exc)})

    def do_PUT(self) -> None:
        self._change_comment(delete=False)

    def do_DELETE(self) -> None:
        self._change_comment(delete=True)


def open_browser() -> None:
    webbrowser.open(f"http://{HOST}:{PORT}")


def main() -> None:
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        if getattr(exc, "errno", None) in (48, 98, 10048):
            print(f"ERROR: Port {PORT} is already in use.")
            print("Close the older LocalHub window or run stop-port-8000.cmd.")
            return
        raise

    print("=" * 60)
    print("LocalHub Seoul started")
    print(f"URL: http://{HOST}:{PORT}")
    print(f"Loaded tourism items: {len(STORE.items):,}")
    print(f"Weather API configured: {WEATHER.configured}")
    print("Press Ctrl+C to stop.")
    print("=" * 60)

    threading.Timer(1.2, open_browser).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping LocalHub...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
