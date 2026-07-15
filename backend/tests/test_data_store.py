from pathlib import Path
import sys
import unittest

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from data_store import TourismStore


class DataStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = TourismStore(ROOT / "data")

    def test_all_uploaded_rows_loaded(self):
        self.assertEqual(len(self.store.items), 6518)

    def test_all_seven_categories_loaded(self):
        self.assertEqual(
            set(self.store.categories),
            {"관광지", "문화시설", "축제공연행사", "여행코스", "레포츠", "숙박", "쇼핑"},
        )

    def test_search_returns_original_fields(self):
        result = self.store.search(query="양화한강공원", page_size=10)
        self.assertGreaterEqual(result["total"], 1)
        item = result["items"][0]
        self.assertEqual(item["title"], "양화한강공원")
        self.assertIn("mapx", item)
        self.assertIn("cpyrhtDivCd", item)

    def test_detail_contains_classification_fields(self):
        item = self.store.get("1059877")
        self.assertIsNotNone(item)
        self.assertIn("lclsSystm1", item)
        self.assertIn("createdtime", item)
        self.assertIn("modifiedtime", item)


if __name__ == "__main__":
    unittest.main()
