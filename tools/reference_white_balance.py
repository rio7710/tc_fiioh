"""Deterministic bounded white-balance transform for location reference photos."""

from __future__ import annotations

import math
from pathlib import Path


def percentile(values: list[float], ratio: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * ratio))]


def regrade(source: Path, target: Path) -> dict:
    from PIL import Image

    with Image.open(source) as opened:
        info = dict(opened.info)
        rgb = opened.convert("RGB")
    sample = rgb.copy()
    sample.thumbnail((512, 512), Image.Resampling.LANCZOS)
    pixels = list(sample.getdata())
    cutoff = percentile([sum(value) / 3 for value in pixels], 0.62)
    highlights = []
    midtones = []
    for value in pixels:
        maximum, minimum = max(value), min(value)
        lightness = sum(value) / 3
        saturation = (maximum - minimum) / max(maximum, 1)
        if lightness >= cutoff and maximum < 251 and saturation < 0.42:
            highlights.append(value)
        if 45 <= lightness <= 220 and saturation < 0.38:
            midtones.append(value)
    if len(highlights) < 500:
        highlights = pixels
    white = [percentile([value[channel] / 255 for value in highlights], 0.78) for channel in range(3)]
    neutral = sum(white) / 3
    raw = [neutral / max(value, 0.001) for value in white]
    strength = min(0.78, max(0.35, (((white[0] + white[1]) / 2 - white[2]) * 2.8)))
    gains = [1 + (value - 1) * strength for value in raw]
    floors, ceilings = (0.88, 0.94, 1.0), (1.0, 1.04, 1.18)
    gains = [min(ceilings[index], max(floors[index], value)) for index, value in enumerate(gains)]
    yellow = sum(((value[0] + value[1]) / 2) - value[2] for value in midtones) / max(1, len(midtones))
    extra = min(15.0, max(0.0, (yellow - 3.0) * 0.9))
    adjusted = []
    for index, channel in enumerate(rgb.split()):
        delta = -0.42 * extra if index == 0 else extra if index == 2 else 0
        table = [
            min(255, max(0, round(value * gains[index] + delta * math.sin(math.pi * value / 255))))
            for value in range(256)
        ]
        adjusted.append(channel.point(table))
    result = Image.merge("RGB", adjusted)
    save_options = {"format": "PNG", "compress_level": 6}
    if info.get("icc_profile"):
        save_options["icc_profile"] = info["icc_profile"]
    result.save(target, **save_options)
    return {"width": result.width, "height": result.height, "gains": [round(x, 5) for x in gains],
            "yellow_score": round(yellow, 3), "midtone_shift": round(extra, 3)}
