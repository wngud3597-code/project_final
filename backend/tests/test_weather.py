from datetime import datetime
from pathlib import Path
import sys
import unittest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from weather_service import (
    _current_summary,
    _forecast_summary,
    current_base_candidates,
    forecast_base_candidates,
    latlon_to_grid,
    KST,
)


class WeatherTests(unittest.TestCase):
    def test_kst_uses_fixed_utc_plus_nine(self):
        now = datetime(2026, 7, 15, 9, 0, tzinfo=KST)
        self.assertEqual(now.utcoffset().total_seconds(), 9 * 60 * 60)

    def test_seoul_grid(self):
        self.assertEqual(latlon_to_grid(37.5665, 126.9780), (60, 127))

    def test_current_time_before_cutoff_uses_previous_hour(self):
        now = datetime(2026, 7, 15, 9, 20, tzinfo=KST)
        self.assertEqual(current_base_candidates(now, 1)[0], ("20260715", "0800"))

    def test_forecast_time_after_cutoff_uses_current_hour_30(self):
        now = datetime(2026, 7, 15, 9, 50, tzinfo=KST)
        self.assertEqual(forecast_base_candidates(now, 1)[0], ("20260715", "0930"))

    def test_current_mapping_uses_all_core_categories(self):
        items = [
            {"category": "T1H", "obsrValue": "28.2"},
            {"category": "REH", "obsrValue": "71"},
            {"category": "RN1", "obsrValue": "0"},
            {"category": "PTY", "obsrValue": "0"},
            {"category": "WSD", "obsrValue": "2.6"},
            {"category": "VEC", "obsrValue": "180"},
            {"category": "UUU", "obsrValue": "0.1"},
            {"category": "VVV", "obsrValue": "-2.5"},
        ]
        result = _current_summary(items)
        self.assertEqual(result["temperature"], 28.2)
        self.assertEqual(result["humidity"], 71.0)
        self.assertEqual(result["description"], "강수 없음")
        self.assertEqual(result["windDirectionLabel"], "남")

    def test_forecast_grouping(self):
        items = [
            {"fcstDate": "20260715", "fcstTime": "1000", "category": "T1H", "fcstValue": "29"},
            {"fcstDate": "20260715", "fcstTime": "1000", "category": "SKY", "fcstValue": "3"},
            {"fcstDate": "20260715", "fcstTime": "1000", "category": "PTY", "fcstValue": "0"},
        ]
        result = _forecast_summary(items)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["description"], "구름 많음")


if __name__ == "__main__":
    unittest.main()
