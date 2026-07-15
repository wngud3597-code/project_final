import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from chat_service import TourismChatService
from data_store import TourismStore


class FakeWeather:
    configured = False


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps({
            "output": [{"content": [{"type": "output_text", "text": "추천입니다 [장소ID:123]"}]}]
        }).encode("utf-8")


class ChatServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = TourismStore(ROOT / "data")

    def make_service(self, *, openai=True):
        temp = tempfile.TemporaryDirectory()
        env_path = Path(temp.name) / ".env"
        lines = ["OPENAI_API_KEY=test-key", "OPENAI_MODEL=test-model"]
        if openai:
            lines.append("CHAT_MODE=openai")
        env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return temp, TourismChatService(env_path, self.store, FakeWeather())

    def test_candidates_are_local_items(self):
        temp, service = self.make_service()
        self.addCleanup(temp.cleanup)
        candidates = service._candidates("종로 문화시설 추천")
        self.assertTrue(candidates)
        self.assertTrue(all(item["contentid"] in self.store.by_id for item in candidates))

    @patch("chat_service.urlopen", return_value=FakeResponse())
    def test_responses_api_output_is_parsed(self, mocked_urlopen):
        temp, service = self.make_service()
        self.addCleanup(temp.cleanup)
        result = service.ask("서울 관광지 추천")
        self.assertEqual(result["answer"], "추천입니다 [장소ID:123]")
        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.openai.com/v1/responses")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")

    def test_free_mode_needs_no_openai_call(self):
        temp, service = self.make_service(openai=False)
        self.addCleanup(temp.cleanup)
        with patch("chat_service.urlopen") as mocked_urlopen:
            result = service.ask("비 오는 날 종로구 실내 문화시설 추천")
        self.assertEqual(result["model"], "local-rules-v1")
        self.assertEqual(len(result["places"]), 3)
        self.assertTrue(all(place["자치구"] == "종로구" for place in result["places"]))
        self.assertTrue(all(place["유형"] == "문화시설" for place in result["places"]))
        self.assertIn("운영시간", result["answer"])
        mocked_urlopen.assert_not_called()

    def test_follow_up_uses_previous_user_condition(self):
        temp, service = self.make_service(openai=False)
        self.addCleanup(temp.cleanup)
        result = service.ask("그중 문화시설로 알려줘", [
            {"role": "user", "content": "강남구에서 아이와 갈 곳 추천"},
            {"role": "assistant", "content": "이전 추천"},
        ])
        self.assertTrue(all(place["자치구"] == "강남구" for place in result["places"]))
        self.assertTrue(all(place["유형"] == "문화시설" for place in result["places"]))


if __name__ == "__main__":
    unittest.main()
