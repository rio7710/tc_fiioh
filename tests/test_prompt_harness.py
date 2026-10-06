import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "01_app" / "prompt_harness.py"
SPEC = importlib.util.spec_from_file_location("prompt_harness", MODULE_PATH)
HARNESS = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = HARNESS
SPEC.loader.exec_module(HARNESS)


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return b'{"candidates":[{"content":{"parts":[{"text":"isolated output"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2},"modelVersion":"gemini-test","responseId":"response-test"}'


class FakeImageResponse(FakeResponse):
    def read(self):
        return b'{"candidates":[{"content":{"parts":[{"text":"generated"},{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":4},"modelVersion":"gemini-image-test"}'


class PromptHarnessTests(unittest.TestCase):
    def test_isolated_prompt_requires_input(self):
        with self.assertRaisesRegex(ValueError, "프롬프트"):
            HARNESS.test_gemini_prompt("test", "   ")

    def test_isolated_prompt_returns_output_and_trace(self):
        with mock.patch.object(HARNESS, "urlopen", return_value=FakeResponse()):
            result = HARNESS.test_gemini_prompt("test", "hello", model="gemini-test")
        self.assertEqual("isolated output", result["output"])
        self.assertEqual("gemini-test", result["trace"]["model"])
        self.assertEqual(3, result["trace"]["usage"]["promptTokenCount"])

    def test_stream_request_uses_sse_endpoint(self):
        with mock.patch.object(HARNESS, "urlopen", return_value=FakeResponse()) as mocked:
            response, model = HARNESS.open_gemini_stream("test", "hello", model="gemini-test")
        self.assertIsInstance(response, FakeResponse)
        self.assertEqual("gemini-test", model)
        self.assertIn("streamGenerateContent?alt=sse", mocked.call_args.args[0].full_url)

    def test_image_prompt_returns_browser_safe_data_url(self):
        with mock.patch.object(HARNESS, "urlopen", return_value=FakeImageResponse()) as mocked:
            result = HARNESS.test_gemini_image("test", "draw a scene", model="gemini-image-test")
        request_body = mocked.call_args.args[0].data.decode("utf-8")
        self.assertIn('"IMAGE"', request_body)
        self.assertEqual("data:image/png;base64,aW1hZ2U=", result["image_data_url"])
        self.assertEqual("gemini-image-test", result["trace"]["model"])


if __name__ == "__main__":
    unittest.main()
