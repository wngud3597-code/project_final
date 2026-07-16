from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from data_store import TourismStore
from weather_service import WeatherError, WeatherService, load_env


class ChatError(RuntimeError):
    pass


class TourismChatService:
    def __init__(self, env_path: Path, store: TourismStore, weather: WeatherService):
        env = load_env(env_path)
        self.api_key = env.get("OPENAI_API_KEY", "").strip()
        self.model = env.get("OPENAI_MODEL", "gpt-5.6-luna").strip()
        self.mode = env.get("CHAT_MODE", "auto").strip().lower()
        self.store = store
        self.weather = weather

    @property
    def configured(self) -> bool:
        return True

    @property
    def openai_configured(self) -> bool:
        return bool(self.api_key)

    CATEGORY_HINTS = {
        "관광": "관광지", "명소": "관광지", "궁": "관광지", "공원": "관광지",
        "박물관": "문화시설", "미술관": "문화시설", "전시": "문화시설", "문화": "문화시설",
        "공연": "축제공연행사", "축제": "축제공연행사", "행사": "축제공연행사",
        "코스": "여행코스", "산책": "여행코스", "데이트": "여행코스",
        "레포츠": "레포츠", "체험": "레포츠", "운동": "레포츠",
        "숙소": "숙박", "호텔": "숙박", "숙박": "숙박",
        "쇼핑": "쇼핑", "시장": "쇼핑", "백화점": "쇼핑",
    }
    STOP_WORDS = {
        "추천", "추천해줘", "알려줘", "어디", "서울", "여행", "관광지", "가볼만한곳",
        "좋은", "곳을", "장소", "오늘", "내일", "지금", "하고", "싶어", "해줘",
    }

    def _intent(self, message: str) -> dict[str, Any]:
        lowered = message.lower()
        districts = [district for district in self.store.districts if district != "주소 미제공" and district in message]
        categories = {category for hint, category in self.CATEGORY_HINTS.items() if hint in lowered}
        indoor = any(word in lowered for word in ("실내", "비 오는", "비오는", "우천", "더울", "추울", "미세먼지"))
        outdoor = any(word in lowered for word in ("야외", "산책", "공원", "걷기", "등산", "자연"))
        accessible = any(word in lowered for word in ("어르신", "노인", "부모님", "휠체어", "걷기 힘", "많이 안 걷"))
        family = any(word in lowered for word in ("아이", "아기", "어린이", "가족"))
        couple = any(word in lowered for word in ("데이트", "연인", "커플"))
        return {
            "districts": districts, "categories": categories, "indoor": indoor,
            "outdoor": outdoor, "accessible": accessible, "family": family, "couple": couple,
        }

    def _candidates(self, message: str, limit: int = 8) -> list[dict[str, Any]]:
        intent = self._intent(message)
        words = [
            word for word in re.findall(r"[0-9A-Za-z가-힣]+", message.lower())
            if len(word) >= 2 and word not in self.STOP_WORDS and word not in self.CATEGORY_HINTS
        ]
        scored = []
        for item in self.store.items:
            searchable = item.get("_search", "")
            title = str(item.get("title", "")).lower()
            score = sum(7 if word in title else 2 for word in words if word in searchable)
            if intent["categories"]:
                score += 9 if item.get("contentType") in intent["categories"] else -3
            if intent["districts"]:
                score += 12 if item.get("district") in intent["districts"] else -8
            if intent["indoor"]:
                score += 7 if item.get("contentType") in {"문화시설", "쇼핑", "숙박"} else -2
            if intent["outdoor"]:
                score += 6 if item.get("contentType") in {"관광지", "여행코스", "레포츠"} else 0
            if intent["family"] and any(word in searchable for word in ("어린이", "키즈", "가족", "체험", "과학")):
                score += 5
            if intent["couple"] and any(word in searchable for word in ("공원", "거리", "문화", "미술", "전망")):
                score += 3
            if item.get("hasCoordinates"):
                score += 0.2
            if item.get("hasImage"):
                score += 0.1
            if score > -1:
                scored.append((score, item))

        if not scored:
            scored = [(0, item) for item in self.store.items if item.get("contentType") == "관광지"]
        scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("title", ""))))
        return [item for _, item in scored[:limit]]

    @staticmethod
    def _public_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{
            "contentid": item.get("contentid"), "이름": item.get("title"),
            "유형": item.get("contentType"), "자치구": item.get("district"),
            "주소": item.get("fullAddress"), "전화": item.get("tel"),
        } for item in candidates]

    def _rule_answer(self, message: str, history: list[dict[str, str]] | None) -> dict[str, Any]:
        previous_users = [row.get("content", "") for row in (history or [])[-4:] if row.get("role") == "user"]
        search_message = " ".join(previous_users[-1:] + [message])
        intent = self._intent(search_message)
        candidates = self._candidates(search_message, limit=3)
        places = self._public_candidates(candidates)
        weather = self._weather_context(candidates)

        conditions = []
        if intent["districts"]:
            conditions.append("·".join(intent["districts"]))
        if intent["categories"]:
            conditions.append("·".join(sorted(intent["categories"])))
        if intent["indoor"]:
            conditions.append("실내 중심")
        if intent["outdoor"]:
            conditions.append("야외 활동")
        if intent["family"]:
            conditions.append("가족 동행")
        if intent["accessible"]:
            conditions.append("이동 부담 고려")

        lines = [f"말씀하신 조건({', '.join(conditions) if conditions else '서울 관광'})에 맞춰 LocalHub 원본 데이터에서 골랐어요."]
        current = weather.get("현재", {}) if weather else {}
        description = str(current.get("description") or "")
        temperature = current.get("temperature")
        rain = current.get("rain1h")
        if weather:
            weather_bits = [description or "현재 날씨"]
            if temperature not in (None, ""):
                weather_bits.append(f"{temperature}℃")
            if rain not in (None, "", 0, "0"):
                weather_bits.append(f"1시간 강수 {rain}mm")
            lines.append(f"날씨 기준: {weather.get('기준장소')} 인근은 {' · '.join(weather_bits)}입니다.")

        for index, item in enumerate(candidates, 1):
            reasons = [f"{item.get('district')}의 {item.get('contentType')}"]
            if intent["indoor"] and item.get("contentType") in {"문화시설", "쇼핑", "숙박"}:
                reasons.append("날씨 영향을 비교적 덜 받는 유형")
            if item.get("hasPhone"):
                reasons.append("전화 정보 확인 가능")
            if item.get("hasCoordinates"):
                reasons.append("지도 위치 확인 가능")
            lines.append(f"{index}. {item.get('title')} — {', '.join(reasons)}. 주소: {item.get('fullAddress') or '정보 미제공'} [장소ID:{item.get('contentid')}]")

        if weather and ("비" in description or (isinstance(rain, (int, float)) and rain > 0)):
            lines.append("비가 관측되어 실내 장소부터 방문하고 우산을 챙기는 편이 안전합니다.")
        elif intent["indoor"]:
            lines.append("실내 여부와 운영시간은 원본 데이터에 없어 방문 전에 전화나 공식 홈페이지로 확인해 주세요.")
        if intent["accessible"]:
            lines.append("무장애 출입·엘리베이터·휴식 공간 정보는 제공 데이터에 없으므로 방문 전 전화 확인이 필요합니다.")
        lines.append("운영시간·휴무일·요금은 LocalHub 데이터에 없는 항목이라 임의로 안내하지 않았습니다.")
        return {"answer": "\n\n".join(lines), "model": "local-rules-v1", "places": places, "weatherUsed": bool(weather)}

    def _weather_context(self, candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not self.weather.configured:
            return None
        location = next((item for item in candidates if item.get("hasCoordinates")), None)
        if not location:
            return None
        try:
            result = self.weather.get(float(location["latitude"]), float(location["longitude"]))
        except WeatherError:
            return None
        return {
            "기준장소": location.get("title"),
            "관측시각": result.get("observedAt"),
            "현재": result.get("current"),
            "예보": result.get("forecast", [])[:4],
        }

    def _safe_fallback(
        self, message: str, history: list[dict[str, str]] | None, reason: str
    ) -> dict[str, Any]:
        result = self._rule_answer(message, history)
        result["fallbackReason"] = reason
        result["mode"] = "guided"
        return result

    def ask(self, message: str, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
        if self.mode not in {"auto", "openai"} or not self.openai_configured:
            return self._rule_answer(message, history)

        candidates = self._candidates(message)
        public_candidates = self._public_candidates(candidates)
        context = {"관광지후보": public_candidates, "날씨": self._weather_context(candidates)}
        safe_history = [
            {"role": row["role"], "content": row["content"][:1500]}
            for row in (history or [])[-6:]
            if row.get("role") in {"user", "assistant"} and isinstance(row.get("content"), str)
        ]
        input_messages = safe_history + [{"role": "user", "content": message}]
        payload = {
            "model": self.model,
            "instructions": (
                "당신은 LocalHub의 차분하고 배려 깊은 서울 관광 안내원입니다. 한국어로 간결하고 읽기 쉽게 답하세요. "
                "주 사용자는 노년의 부모님 두 분이며 자녀가 동행한다고 가정하지 마세요. "
                "반드시 제공된 관광지 후보만 구체적인 장소로 추천하고, 이름을 정확히 쓰세요. "
                "사용자의 조건을 반영해 최대 3곳과 추천 이유를 제시하세요. 날씨 데이터가 있으면 복장·우산·실내외 동선을 조언하세요. "
                "데이터에 없는 운영시간, 요금, 교통편을 지어내지 말고 확인이 필요하다고 밝히세요. "
                "각 추천 장소 끝에 [장소ID:contentid] 형식을 붙이세요.\n\n현재 LocalHub 데이터:\n"
                + json.dumps(context, ensure_ascii=False)
            ),
            "input": input_messages,
            "max_output_tokens": 700,
            "store": False,
        }
        request = Request(
            "https://api.openai.com/v1/responses",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=45) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("error", {}).get("message", "")
            except Exception:
                detail = ""
            return self._safe_fallback(
                message,
                history,
                f"AI 연결 오류({exc.code})로 검증된 관광 데이터 안내를 사용했습니다.",
            )
        except (URLError, TimeoutError) as exc:
            return self._safe_fallback(
                message,
                history,
                "AI 연결이 원활하지 않아 검증된 관광 데이터 안내를 사용했습니다.",
            )

        text = result.get("output_text", "")
        if not text:
            text = "".join(
                part.get("text", "")
                for item in result.get("output", [])
                for part in item.get("content", [])
                if part.get("type") == "output_text"
            )
        if not text:
            return self._safe_fallback(
                message,
                history,
                "AI가 답변을 만들지 못해 검증된 관광 데이터 안내를 사용했습니다.",
            )
        return {"answer": text, "model": self.model, "mode": "openai", "places": public_candidates}
