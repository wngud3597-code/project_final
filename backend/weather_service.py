from __future__ import annotations

import json
import math
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


# 대한민국은 현재 서머타임을 사용하지 않으므로 UTC+9 고정 오프셋을 사용합니다.
# 이 방식은 Windows에 IANA tzdata가 없어도 정상 작동합니다.
KST = timezone(timedelta(hours=9), name="Asia/Seoul")
CURRENT_ENDPOINTS = [
    "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst",
    "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst",
]
FORECAST_ENDPOINTS = [
    "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst",
    "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst",
]

PTY_LABELS = {
    "0": "강수 없음",
    "1": "비",
    "2": "비 또는 눈",
    "3": "눈",
    "5": "빗방울",
    "6": "빗방울 또는 눈날림",
    "7": "눈날림",
}
SKY_LABELS = {"1": "맑음", "3": "구름 많음", "4": "흐림"}


class WeatherError(RuntimeError):
    pass


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def latlon_to_grid(latitude: float, longitude: float) -> tuple[int, int]:
    re_value = 6371.00877
    grid = 5.0
    slat1 = 30.0
    slat2 = 60.0
    olon = 126.0
    olat = 38.0
    xo = 43.0
    yo = 136.0

    degrad = math.pi / 180.0
    re_grid = re_value / grid
    slat1_rad = slat1 * degrad
    slat2_rad = slat2 * degrad
    olon_rad = olon * degrad
    olat_rad = olat * degrad

    sn = math.tan(math.pi * 0.25 + slat2_rad * 0.5) / math.tan(
        math.pi * 0.25 + slat1_rad * 0.5
    )
    sn = math.log(math.cos(slat1_rad) / math.cos(slat2_rad)) / math.log(sn)
    sf = math.tan(math.pi * 0.25 + slat1_rad * 0.5)
    sf = math.pow(sf, sn) * math.cos(slat1_rad) / sn
    ro = math.tan(math.pi * 0.25 + olat_rad * 0.5)
    ro = re_grid * sf / math.pow(ro, sn)

    ra = math.tan(math.pi * 0.25 + latitude * degrad * 0.5)
    ra = re_grid * sf / math.pow(ra, sn)
    theta = longitude * degrad - olon_rad
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn

    x = int(math.floor(ra * math.sin(theta) + xo + 0.5))
    y = int(math.floor(ro - ra * math.cos(theta) + yo + 0.5))
    return x, y


def current_base_candidates(now: datetime | None = None, count: int = 4) -> list[tuple[str, str]]:
    now = (now or datetime.now(KST)).astimezone(KST)
    reference = now if now.minute >= 45 else now - timedelta(hours=1)
    reference = reference.replace(minute=0, second=0, microsecond=0)
    return [
        (
            (reference - timedelta(hours=offset)).strftime("%Y%m%d"),
            (reference - timedelta(hours=offset)).strftime("%H00"),
        )
        for offset in range(count)
    ]


def forecast_base_candidates(now: datetime | None = None, count: int = 4) -> list[tuple[str, str]]:
    now = (now or datetime.now(KST)).astimezone(KST)
    reference = now if now.minute >= 45 else now - timedelta(hours=1)
    reference = reference.replace(minute=30, second=0, microsecond=0)
    return [
        (
            (reference - timedelta(hours=offset)).strftime("%Y%m%d"),
            (reference - timedelta(hours=offset)).strftime("%H30"),
        )
        for offset in range(count)
    ]


def _normalize_service_key(service_key: str) -> str:
    return urllib.parse.unquote(service_key.strip())


def _build_url(endpoint: str, service_key: str, params: dict[str, Any]) -> str:
    query_items = [("serviceKey", _normalize_service_key(service_key))]
    query_items.extend((key, str(value)) for key, value in params.items())
    return endpoint + "?" + urllib.parse.urlencode(query_items)


def _parse_error_payload(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    try:
        payload = json.loads(text)
        header = payload.get("response", {}).get("header", {})
        return f"{header.get('resultCode', '')} {header.get('resultMsg', '')}".strip()
    except Exception:
        pass

    try:
        root = ET.fromstring(text)
        code = root.findtext(".//returnReasonCode") or root.findtext(".//resultCode") or ""
        message = root.findtext(".//returnAuthMsg") or root.findtext(".//resultMsg") or ""
        return f"{code} {message}".strip() or text[:300]
    except Exception:
        return text[:300]


def _request_json(url: str, timeout: int = 12) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "LocalHub-Seoul/1.0",
        },
    )
    context = ssl.create_default_context()

    try:
        with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        raise WeatherError(f"기상청 HTTP {exc.code}: {_parse_error_payload(raw)}") from exc
    except urllib.error.URLError as exc:
        raise WeatherError(f"기상청 서버 연결 실패: {exc.reason}") from exc
    except TimeoutError as exc:
        raise WeatherError("기상청 서버 응답 시간이 초과되었습니다.") from exc

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise WeatherError(f"JSON이 아닌 응답: {_parse_error_payload(raw)}") from exc

    header = payload.get("response", {}).get("header", {})
    result_code = str(header.get("resultCode", ""))
    result_message = str(header.get("resultMsg", ""))
    if result_code != "00":
        raise WeatherError(f"기상청 오류 {result_code}: {result_message}")

    return payload


def _items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    body = payload.get("response", {}).get("body", {})
    items = body.get("items", {})
    if isinstance(items, dict):
        value = items.get("item", [])
    else:
        value = []
    if isinstance(value, dict):
        return [value]
    return value if isinstance(value, list) else []


def _call_with_candidates(
    endpoints: list[str],
    service_key: str,
    candidates: list[tuple[str, str]],
    nx: int,
    ny: int,
    *,
    rows: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    errors: list[str] = []

    for base_date, base_time in candidates:
        params = {
            "pageNo": 1,
            "numOfRows": rows,
            "dataType": "JSON",
            "base_date": base_date,
            "base_time": base_time,
            "nx": nx,
            "ny": ny,
        }
        for endpoint in endpoints:
            url = _build_url(endpoint, service_key, params)
            try:
                payload = _request_json(url)
                values = _items(payload)
                if values:
                    return values, {
                        "baseDate": base_date,
                        "baseTime": base_time,
                        "nx": nx,
                        "ny": ny,
                        "endpoint": endpoint.replace("http://", "https://"),
                    }
                errors.append(f"{base_date} {base_time}: 데이터 없음")
            except WeatherError as exc:
                errors.append(f"{base_date} {base_time}: {exc}")

    raise WeatherError(" / ".join(errors[-6:]) or "기상청 데이터가 없습니다.")


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _wind_direction_label(value: float | None) -> str:
    if value is None:
        return "정보 없음"
    labels = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"]
    index = int((value + 22.5) // 45) % 8
    return labels[index]


def _current_summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    values = {
        str(item.get("category", "")): item.get("obsrValue")
        for item in items
    }
    temperature = _number(values.get("T1H"))
    humidity = _number(values.get("REH"))
    rain = _number(values.get("RN1"))
    wind_speed = _number(values.get("WSD"))
    wind_direction = _number(values.get("VEC"))
    pty_code = str(values.get("PTY", "0"))
    description = PTY_LABELS.get(pty_code, f"강수형태 코드 {pty_code}")

    return {
        "temperature": temperature,
        "humidity": humidity,
        "rain1h": rain,
        "precipitationTypeCode": pty_code,
        "description": description,
        "windSpeed": wind_speed,
        "windDirection": wind_direction,
        "windDirectionLabel": _wind_direction_label(wind_direction),
        "windEastWest": _number(values.get("UUU")),
        "windNorthSouth": _number(values.get("VVV")),
        "rawCategories": values,
    }


def _forecast_summary(items: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}

    for item in items:
        key = (str(item.get("fcstDate", "")), str(item.get("fcstTime", "")))
        grouped.setdefault(key, {})[str(item.get("category", ""))] = item.get("fcstValue")

    forecasts = []
    for (date, time), values in sorted(grouped.items())[:limit]:
        pty_code = str(values.get("PTY", "0"))
        sky_code = str(values.get("SKY", ""))
        if pty_code != "0":
            description = PTY_LABELS.get(pty_code, f"강수형태 코드 {pty_code}")
        else:
            description = SKY_LABELS.get(sky_code, "날씨 정보")

        forecasts.append(
            {
                "date": date,
                "time": time,
                "displayTime": f"{time[:2]}:{time[2:4]}",
                "temperature": _number(values.get("T1H")),
                "humidity": _number(values.get("REH")),
                "rain1h": _number(values.get("RN1")),
                "precipitationTypeCode": pty_code,
                "skyCode": sky_code,
                "description": description,
                "windSpeed": _number(values.get("WSD")),
                "windDirection": _number(values.get("VEC")),
                "windDirectionLabel": _wind_direction_label(_number(values.get("VEC"))),
            }
        )
    return forecasts


def _outdoor_advice(current: dict[str, Any]) -> str:
    temperature = current.get("temperature")
    rain = current.get("rain1h")
    wind = current.get("windSpeed")
    pty = current.get("precipitationTypeCode")

    if pty and pty != "0":
        return "비나 눈이 관측됩니다. 미끄럽지 않은 신발과 우산을 준비하세요."
    if rain is not None and rain > 0:
        return "강수가 관측됩니다. 우산과 미끄럼 방지 신발을 준비하세요."
    if temperature is not None and temperature >= 30:
        return "매우 덥습니다. 물을 자주 마시고 그늘에서 충분히 쉬세요."
    if temperature is not None and temperature <= 5:
        return "기온이 낮습니다. 보온이 잘 되는 겉옷을 준비하세요."
    if wind is not None and wind >= 8:
        return "바람이 강합니다. 모자와 가벼운 물건이 날리지 않도록 주의하세요."
    return "외출하기 전 기온과 이동 거리를 확인하고 중간중간 쉬어가세요."


class WeatherService:
    def __init__(self, env_path: Path):
        env = load_env(env_path)
        self.service_key = env.get("KMA_SERVICE_KEY") or os.environ.get("KMA_SERVICE_KEY", "")

    @property
    def configured(self) -> bool:
        return bool(self.service_key.strip())

    def get(self, latitude: float, longitude: float) -> dict[str, Any]:
        if not self.configured:
            raise WeatherError("backend/.env에 KMA_SERVICE_KEY가 없습니다.")

        nx, ny = latlon_to_grid(latitude, longitude)
        current_items, current_meta = _call_with_candidates(
            CURRENT_ENDPOINTS,
            self.service_key,
            current_base_candidates(),
            nx,
            ny,
            rows=1000,
        )
        current = _current_summary(current_items)

        forecast: list[dict[str, Any]] = []
        forecast_meta: dict[str, Any] | None = None
        forecast_error: str | None = None
        try:
            forecast_items, forecast_meta = _call_with_candidates(
                FORECAST_ENDPOINTS,
                self.service_key,
                forecast_base_candidates(),
                nx,
                ny,
                rows=1000,
            )
            forecast = _forecast_summary(forecast_items)
        except WeatherError as exc:
            forecast_error = str(exc)

        return {
            "source": "기상청 단기예보 조회서비스",
            "isLive": True,
            "observedAt": f"{current_meta['baseDate']} {current_meta['baseTime']}",
            "grid": {"nx": nx, "ny": ny},
            "current": current,
            "forecast": forecast,
            "forecastError": forecast_error,
            "advice": _outdoor_advice(current),
            "requestMeta": {
                "current": current_meta,
                "forecast": forecast_meta,
            },
        }
