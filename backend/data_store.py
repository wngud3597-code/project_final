from __future__ import annotations

import json
import re
import threading
from collections import Counter
from pathlib import Path
from typing import Any


CONTENT_TYPE_ORDER = {
    "관광지": 1,
    "문화시설": 2,
    "축제공연행사": 3,
    "여행코스": 4,
    "레포츠": 5,
    "숙박": 6,
    "쇼핑": 7,
}

FIELD_LABELS = {
    "contentid": "콘텐츠 고유 ID",
    "contenttypeid": "콘텐츠 유형 ID",
    "title": "장소명",
    "addr1": "주소",
    "addr2": "상세 주소",
    "zipcode": "우편번호",
    "tel": "전화번호",
    "mapx": "경도(WGS84)",
    "mapy": "위도(WGS84)",
    "mlevel": "지도 확대 레벨",
    "areacode": "지역 코드",
    "sigungucode": "시군구 코드",
    "lDongRegnCd": "법정동 지역 코드",
    "lDongSignguCd": "법정동 시군구 코드",
    "cat1": "기존 대분류 코드",
    "cat2": "기존 중분류 코드",
    "cat3": "기존 소분류 코드",
    "lclsSystm1": "신분류 체계 1",
    "lclsSystm2": "신분류 체계 2",
    "lclsSystm3": "신분류 체계 3",
    "firstimage": "대표 이미지 URL",
    "firstimage2": "썸네일 이미지 URL",
    "cpyrhtDivCd": "이미지 저작권 구분",
    "createdtime": "최초 등록 시각",
    "modifiedtime": "최종 수정 시각",
}


def _safe_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result else None


def _district_from_address(address: str) -> str:
    match = re.search(r"서울특별시\s+([가-힣]+구)", address or "")
    return match.group(1) if match else "주소 미제공"


def _format_timestamp(value: str) -> str:
    value = str(value or "")
    if len(value) != 14 or not value.isdigit():
        return value
    return (
        f"{value[0:4]}-{value[4:6]}-{value[6:8]} "
        f"{value[8:10]}:{value[10:12]}:{value[12:14]}"
    )


class TourismStore:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self._lock = threading.RLock()
        self.items: list[dict[str, Any]] = []
        self.by_id: dict[str, dict[str, Any]] = {}
        self.categories: list[str] = []
        self.districts: list[str] = []
        self.load()

    def load(self) -> None:
        items: list[dict[str, Any]] = []

        for path in sorted(self.data_dir.glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            content_type = str(payload.get("contentType", "")).strip()
            region = str(payload.get("region", "서울")).strip()

            for original in payload.get("items", []):
                raw = {key: "" if value is None else value for key, value in original.items()}
                content_id = str(raw.get("contentid", "")).strip()
                longitude = _safe_float(raw.get("mapx"))
                latitude = _safe_float(raw.get("mapy"))
                address = " ".join(
                    part.strip()
                    for part in (str(raw.get("addr1", "")), str(raw.get("addr2", "")))
                    if part and part.strip()
                )
                district = _district_from_address(str(raw.get("addr1", "")))

                searchable = " ".join(
                    str(value)
                    for value in [
                        content_type,
                        district,
                        *raw.values(),
                    ]
                    if value not in (None, "")
                ).lower()

                item = {
                    **raw,
                    "contentid": content_id,
                    "region": region,
                    "contentType": content_type,
                    "district": district,
                    "fullAddress": address,
                    "longitude": longitude,
                    "latitude": latitude,
                    "hasImage": bool(str(raw.get("firstimage", "")).strip()),
                    "hasPhone": bool(str(raw.get("tel", "")).strip()),
                    "hasCoordinates": longitude is not None and latitude is not None,
                    "createdtimeFormatted": _format_timestamp(str(raw.get("createdtime", ""))),
                    "modifiedtimeFormatted": _format_timestamp(str(raw.get("modifiedtime", ""))),
                    "_search": searchable,
                    "_sourceFile": path.name,
                }
                items.append(item)

        items.sort(
            key=lambda row: (
                CONTENT_TYPE_ORDER.get(row["contentType"], 99),
                row.get("title", ""),
                row["contentid"],
            )
        )

        with self._lock:
            self.items = items
            self.by_id = {item["contentid"]: item for item in items}
            self.categories = sorted(
                {item["contentType"] for item in items},
                key=lambda value: CONTENT_TYPE_ORDER.get(value, 99),
            )
            districts = {item["district"] for item in items}
            self.districts = sorted(
                districts,
                key=lambda value: (value == "주소 미제공", value),
            )

    def stats(self) -> dict[str, Any]:
        with self._lock:
            category_counts = Counter(item["contentType"] for item in self.items)
            district_counts = Counter(item["district"] for item in self.items)
            return {
                "total": len(self.items),
                "withImage": sum(item["hasImage"] for item in self.items),
                "withCoordinates": sum(item["hasCoordinates"] for item in self.items),
                "withPhone": sum(item["hasPhone"] for item in self.items),
                "categories": [
                    {"name": name, "count": category_counts[name]}
                    for name in self.categories
                ],
                "districts": [
                    {"name": name, "count": count}
                    for name, count in sorted(
                        district_counts.items(),
                        key=lambda pair: (-pair[1], pair[0]),
                    )
                ],
                "fieldLabels": FIELD_LABELS,
                "source": {
                    "provider": "한국관광공사",
                    "dataset": "국문 관광정보 서비스 (TourAPI 4.0)",
                    "license": "공공누리 제3유형",
                    "loadedTypes": 7,
                    "note": "업로드된 7개 JSON 원본을 내용 변경 없이 사용합니다.",
                },
            }

    def search(
        self,
        *,
        query: str = "",
        category: str = "전체",
        district: str = "전체",
        completeness: str = "전체",
        sort: str = "title",
        page: int = 1,
        page_size: int = 24,
    ) -> dict[str, Any]:
        normalized_query = query.strip().lower()
        page = max(1, page)
        page_size = min(60, max(1, page_size))

        with self._lock:
            results = []
            for item in self.items:
                if category != "전체" and item["contentType"] != category:
                    continue
                if district != "전체" and item["district"] != district:
                    continue
                if completeness == "이미지 있음" and not item["hasImage"]:
                    continue
                if completeness == "좌표 있음" and not item["hasCoordinates"]:
                    continue
                if completeness == "전화번호 있음" and not item["hasPhone"]:
                    continue
                if normalized_query and normalized_query not in item["_search"]:
                    continue
                results.append(item)

        if sort == "modified_desc":
            results.sort(
                key=lambda row: (str(row.get("modifiedtime", "")), row.get("title", "")),
                reverse=True,
            )
        elif sort == "created_desc":
            results.sort(
                key=lambda row: (str(row.get("createdtime", "")), row.get("title", "")),
                reverse=True,
            )
        elif sort == "category":
            results.sort(
                key=lambda row: (
                    CONTENT_TYPE_ORDER.get(row["contentType"], 99),
                    row.get("title", ""),
                )
            )
        else:
            results.sort(key=lambda row: (row.get("title", ""), row["contentid"]))

        total = len(results)
        start = (page - 1) * page_size
        selected = results[start : start + page_size]
        return {
            "total": total,
            "page": page,
            "pageSize": page_size,
            "totalPages": max(1, (total + page_size - 1) // page_size),
            "items": [self._public_item(item, include_raw=False) for item in selected],
        }

    def map_points(
        self,
        *,
        query: str = "",
        category: str = "전체",
        district: str = "전체",
        limit: int = 300,
    ) -> dict[str, Any]:
        normalized_query = query.strip().lower()
        limit = min(500, max(1, limit))
        points = []

        with self._lock:
            for item in self.items:
                if not item["hasCoordinates"]:
                    continue
                if category != "전체" and item["contentType"] != category:
                    continue
                if district != "전체" and item["district"] != district:
                    continue
                if normalized_query and normalized_query not in item["_search"]:
                    continue

                points.append(
                    {
                        "contentid": item["contentid"],
                        "title": item.get("title", ""),
                        "contentType": item["contentType"],
                        "district": item["district"],
                        "address": item["fullAddress"],
                        "latitude": item["latitude"],
                        "longitude": item["longitude"],
                        "firstimage2": item.get("firstimage2", ""),
                    }
                )
                if len(points) >= limit:
                    break

        return {"totalShown": len(points), "limit": limit, "points": points}


    def get_many(self, content_ids: list[str]) -> list[dict[str, Any]]:
        with self._lock:
            return [
                self._public_item(self.by_id[content_id], include_raw=False)
                for content_id in content_ids
                if content_id in self.by_id
            ]

    def get(self, content_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self.by_id.get(str(content_id))
            return self._public_item(item, include_raw=True) if item else None

    @staticmethod
    def _public_item(item: dict[str, Any], *, include_raw: bool) -> dict[str, Any]:
        excluded = {"_search"}
        public = {key: value for key, value in item.items() if key not in excluded}
        if not include_raw:
            raw_only = {
                "areacode",
                "cat1",
                "cat2",
                "cat3",
                "sigungucode",
                "lDongRegnCd",
                "lDongSignguCd",
                "lclsSystm1",
                "lclsSystm2",
                "lclsSystm3",
                "_sourceFile",
            }
            public = {key: value for key, value in public.items() if key not in raw_only}
        return public
