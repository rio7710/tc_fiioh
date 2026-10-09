import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "01_app"
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

import render_server


class CaptionStylesheetSourceTests(unittest.TestCase):
    def test_extracted_stylesheets_supply_caption_rules(self):
        css = render_server.caption_stylesheet_text()
        self.assertIn(".stage", css)
        self.assertIn(".title-card", css)
        self.assertIn(".stage.type-editorial .title-text", css)

    def test_preview_html_no_longer_needs_inline_style(self):
        source = (APP / "P1_title_design_preview.html").read_text(encoding="utf-8")
        self.assertNotIn("<style>", source)
        self.assertGreater(len(render_server.caption_stylesheet_text()), 1000)


if __name__ == "__main__":
    unittest.main()
