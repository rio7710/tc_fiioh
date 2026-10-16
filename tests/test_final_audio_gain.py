"""Measure music gain before/after narration ends using the real mux graph."""
import array
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '01_app'))
from staged_ffmpeg_renderer import _mux_audio


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required')
class FinalAudioGainTests(unittest.TestCase):
    def test_narration_end_never_boosts_music_and_tail_fades(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def generate(name, source):
                path = root / name
                subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', source,
                                '-y', str(path)], check=True)
                return path
            music = generate('music.wav', 'sine=frequency=440:duration=12:sample_rate=48000')
            voice = generate('voice.wav', 'anullsrc=r=48000:cl=mono:d=4')
            deps = SimpleNamespace(ffmpeg='ffmpeg', ffmpeg_threads=1, hosted_mode=False,
                                   music={'test': music}, render_defaults={})
            with patch('staged_ffmpeg_renderer._run') as run:
                _mux_audio(deps, {'music': 'test', 'volume': 0.5}, root/'silent.mp4',
                           [(0, 1, voice)], 0, 2, 8, root/'result.mp4', None)
            args = run.call_args.args[1]
            graph = args[args.index('-filter_complex') + 1]
            raw = subprocess.check_output([
                'ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=d=8',
                '-stream_loop', '-1', '-i', str(music), '-i', str(voice),
                '-filter_complex', graph, '-map', '[aout]', '-t', '8',
                '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'])
            samples = array.array('f', raw)
            def rms(start, end):
                values = samples[round(start*48000):round(end*48000)]
                return math.sqrt(sum(v*v for v in values)/len(values))
            early, late, tail = rms(2.5, 3), rms(5, 5.5), rms(7.5, 7.9)
            self.assertAlmostEqual(late/early, 1, delta=0.02)
            self.assertLess(tail/late, 0.3)


if __name__ == '__main__':
    unittest.main()
