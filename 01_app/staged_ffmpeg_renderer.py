"""Memory-bounded staged FFmpeg compositor.

The HTTP server owns validation, artifact lookup and caption generation.  This
module owns only deterministic editorial composition.  Keeping those concerns
behind :class:`StagedRenderDependencies` lets render_server use the compositor
without importing it back (and makes the FFmpeg command plan testable).
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import tempfile
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping, Optional, Sequence


ProgressCallback = Callable[..., None]
LineCallback = Optional[Callable[[str], None]]
CommandRunner = Callable[[Sequence[str], str, LineCallback], None]


@dataclass(frozen=True)
class StagedRenderDependencies:
    ffmpeg: str
    root: Path
    exports_dir: Path
    platform_formats: Mapping[str, tuple[int, int, str]]
    music: Mapping[str, Path | None]
    narration_tracks: Sequence[tuple[float, str]]
    render_defaults: Mapping[str, Any]
    timeline_from_data: Callable[[dict], list[dict]]
    timed_script_scenes: Callable[[dict], list[dict]]
    storyboard_image_path: Callable[[Any], Path | None]
    scene_video_path: Callable[[dict, int, Any], Path]
    voice_audio_path: Callable[[Any], Path | None]
    brand_asset_path: Callable[[Any], Path | None]
    media_duration: Callable[[Path], float]
    prepare_caption_overlays: Callable[[dict, str | None, int, int, dict], list[tuple[Path, float, float]]]
    update_progress: ProgressCallback
    merged_demo_video: Path
    ffmpeg_threads: int = 2
    render_preset: str = "medium"
    hosted_mode: bool = False
    command_runner: CommandRunner | None = None
    minimum_output_bytes: int = 1_000_000


class StagedRenderError(RuntimeError):
    """Raised when one isolated FFmpeg stage fails."""


def _valid_output(
    path: Path,
    expected_duration: float,
    dependencies: StagedRenderDependencies,
) -> bool:
    if not path.is_file() or path.stat().st_size < dependencies.minimum_output_bytes:
        return False
    try:
        actual_duration = float(dependencies.media_duration(path))
    except (OSError, RuntimeError, TypeError, ValueError):
        return False
    return actual_duration > 0 and abs(actual_duration - expected_duration) <= (1 / 30 + 0.01)


def _default_command_runner(
    args: Sequence[str], stage: str, line_callback: LineCallback
) -> None:
    process = subprocess.Popen(
        list(args),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    output_tail: deque[str] = deque(maxlen=24)
    for raw_line in process.stdout or ():
        line = raw_line.strip()
        if line:
            output_tail.append(line)
            if line_callback:
                line_callback(line)
    return_code = process.wait()
    if return_code:
        detail = "\n".join(output_tail)
        raise StagedRenderError(f"{stage} 단계 FFmpeg 변환에 실패했습니다.\n{detail}".rstrip())


def _run(
    dependencies: StagedRenderDependencies,
    args: Sequence[str],
    stage: str,
    line_callback: LineCallback = None,
) -> None:
    runner = dependencies.command_runner or _default_command_runner
    runner(tuple(str(value) for value in args), stage, line_callback)


def _encoding_args(preset: str, threads: int) -> list[str]:
    return [
        "-an", "-c:v", "libx264", "-preset", preset, "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", "30", "-threads", str(threads),
    ]


def _ffmpeg_prefix(dependencies: StagedRenderDependencies) -> list[str]:
    threads = 1 if dependencies.hosted_mode else max(1, dependencies.ffmpeg_threads)
    return [
        dependencies.ffmpeg, "-y", "-filter_threads", str(threads),
        "-filter_complex_threads", str(threads),
    ]


def _concat_file(destination: Path, paths: Sequence[Path]) -> None:
    # Every path is generated below the private temporary directory.  Escaping
    # still makes the concat manifest correct if its parent contains a quote.
    rows = ["file '" + str(path).replace("'", "'\\''") + "'" for path in paths]
    destination.write_text("\n".join(rows) + "\n", encoding="utf-8")


def _artifact_for_scene(scene_id: str, artifacts: Any) -> dict | None:
    if isinstance(artifacts, dict):
        value = artifacts.get(scene_id)
        return value if isinstance(value, dict) else None
    if isinstance(artifacts, list):
        return next(
            (item for item in artifacts if isinstance(item, dict) and str(item.get("scene_id")) == scene_id),
            None,
        )
    return None


def _still_image_pan_bounds(
    scene_id: str,
    format_label: str,
    anchor: float,
    travel: float,
) -> tuple[float, float]:
    """Return deterministic, bounded crop positions for a still image.

    Python's built-in hash is randomized per process, so a digest keeps the
    chosen direction stable when the same project is rendered again.
    """
    anchor = min(1.0, max(0.0, anchor))
    travel = min(1.0, max(0.0, travel))
    lower = min(max(anchor - travel / 2, 0.0), 1.0 - travel)
    upper = lower + travel
    direction = hashlib.sha256(f"{scene_id}:{format_label}".encode("utf-8")).digest()[0] & 1
    return (lower, upper) if direction == 0 else (upper, lower)


def _resolve_brand_inputs(
    config: dict,
    format_label: str,
    dependencies: StagedRenderDependencies,
) -> dict[str, dict]:
    resolved: dict[str, dict] = {}
    for original in config.get("brand_selections") or []:
        if not isinstance(original, dict) or not original.get("enabled") or not original.get("uri"):
            continue
        item = dict(original)
        if item.get("role") == "outro":
            settings = item.get("settings") or {}
            profiles = settings.get("profiles") if isinstance(settings.get("profiles"), dict) else {}
            profile = profiles.get(format_label) if isinstance(profiles.get(format_label), dict) else {}
            if profile.get("uri"):
                item.update(
                    uri=profile["uri"],
                    media_type=profile.get("media_type", item.get("media_type")),
                    mime_type=profile.get("mime_type", item.get("mime_type")),
                )
        path = dependencies.brand_asset_path(item.get("uri"))
        if not path:
            raise ValueError(f"{item.get('role')} 브랜드 파일을 찾을 수 없습니다.")
        duration = 2.0 if item.get("media_type") == "image" else dependencies.media_duration(path)
        resolved[str(item.get("role"))] = {**item, "path": path, "duration": duration}
    return resolved


def _render_scene(
    dependencies: StagedRenderDependencies,
    config: dict,
    scene: dict,
    index: int,
    width: int,
    height: int,
    format_label: str,
    destination: Path,
) -> None:
    duration = float(scene["end"]) - float(scene["start"])
    scene_id = str(scene.get("id", ""))
    video_artifact = _artifact_for_scene(scene_id, config.get("scene_videos"))
    image_artifacts = config.get("scene_images") or {}
    image_artifact = image_artifacts.get(scene_id) if isinstance(image_artifacts, dict) else None
    image_path = dependencies.storyboard_image_path((image_artifact or {}).get("uri"))
    args = _ffmpeg_prefix(dependencies)
    if not video_artifact and image_path:
        args += ["-loop", "1", "-i", str(image_path)]
    else:
        source_path = dependencies.scene_video_path(scene, index, config.get("scene_videos"))
        if source_path.resolve() == dependencies.merged_demo_video.resolve():
            args += ["-ss", f"{float(scene['start']):.6f}"]
        args += ["-i", str(source_path)]
    playback_rate = max(0.1, float((video_artifact or {}).get("playback_rate", 1)))
    crop_positions = config.get("scene_crop_positions") or {}
    pan_x = 0.5 if format_label == "16x9" else float(
        (crop_positions.get(scene_id) or {}).get(format_label, config["video_pan_x"])
    )
    crop_x = f"(iw-ow)*{pan_x:.5f}"
    is_still_image = not video_artifact and image_path is not None
    pan_enabled = bool(dependencies.render_defaults.get("still_image_pan_enabled", True))
    if is_still_image and format_label != "16x9" and pan_enabled:
        travel = float(dependencies.render_defaults.get("still_image_pan_travel_ratio", 0.175))
        pan_start, pan_end = _still_image_pan_bounds(scene_id, format_label, pan_x, travel)
        crop_x = (
            f"(iw-ow)*({pan_start:.6f}+({pan_end - pan_start:.6f})"
            f"*t/{duration:.6f})"
        )
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}:x='{crop_x}':y='(ih-oh)/2',"
        f"setsar=1,fps=30,format=yuv420p,setpts=PTS/{playback_rate:.6f},"
        f"tpad=stop_mode=clone:stop_duration={duration:.6f},trim=duration={duration:.6f},"
        "setpts=PTS-STARTPTS"
    )
    threads = 1 if dependencies.hosted_mode else max(1, dependencies.ffmpeg_threads)
    preset = "ultrafast" if dependencies.hosted_mode else dependencies.render_preset
    args += ["-vf", vf, "-t", f"{duration:.6f}"] + _encoding_args(preset, threads) + [str(destination)]
    _run(dependencies, args, f"scene-{index + 1:03d}")


def _render_transition(
    dependencies: StagedRenderDependencies,
    previous: Path,
    current: Path,
    previous_duration: float,
    duration: float,
    destination: Path,
) -> None:
    frozen = destination.with_name(destination.stem + "-previous.png")
    freeze_args = _ffmpeg_prefix(dependencies) + [
        "-sseof", "-1", "-i", str(previous), "-vf", "reverse",
        "-frames:v", "1", str(frozen),
    ]
    _run(dependencies, freeze_args, "scene-transition-frame")
    graph = (
        f"[0:v]trim=duration={duration:.6f},setpts=PTS-STARTPTS,"
        f"fps=30,settb=AVTB,format=yuv420p[old];"
        f"[1:v]trim=duration={duration:.6f},setpts=PTS-STARTPTS,fps=30,settb=AVTB,format=yuv420p[new];"
        f"[old][new]xfade=transition=fade:duration={duration:.6f}:offset=0,format=yuv420p[v]"
    )
    threads = 1 if dependencies.hosted_mode else max(1, dependencies.ffmpeg_threads)
    preset = "ultrafast" if dependencies.hosted_mode else dependencies.render_preset
    args = _ffmpeg_prefix(dependencies) + [
        "-loop", "1", "-i", str(frozen), "-i", str(current), "-filter_complex", graph,
        "-map", "[v]", "-t", f"{duration:.6f}",
    ] + _encoding_args(preset, threads) + [str(destination)]
    _run(dependencies, args, "scene-transition")


def _render_remainder(
    dependencies: StagedRenderDependencies,
    source: Path,
    start: float,
    duration: float,
    destination: Path,
) -> None:
    threads = 1 if dependencies.hosted_mode else max(1, dependencies.ffmpeg_threads)
    preset = "ultrafast" if dependencies.hosted_mode else dependencies.render_preset
    args = _ffmpeg_prefix(dependencies) + [
        "-i", str(source), "-vf", f"trim=start={start:.6f}:duration={duration:.6f},setpts=PTS-STARTPTS",
        "-t", f"{duration:.6f}",
    ] + _encoding_args(preset, threads) + [str(destination)]
    _run(dependencies, args, "scene-remainder")


def _concat_video(
    dependencies: StagedRenderDependencies,
    paths: Sequence[Path],
    manifest: Path,
    destination: Path,
    stage: str,
) -> None:
    _concat_file(manifest, paths)
    args = _ffmpeg_prefix(dependencies) + [
        "-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", str(destination),
    ]
    _run(dependencies, args, stage)


def _position(settings: dict, width: int, height: int) -> tuple[str, str]:
    vertical, _, horizontal = str(settings.get("position", "top-right")).partition("-")
    margin_x, margin_y = round(width * 0.035), round(height * 0.035)
    x = str(margin_x) if horizontal == "left" else "(W-w)/2" if horizontal == "center" else f"W-w-{margin_x}"
    y = str(margin_y) if vertical == "top" else "(H-h)/2" if vertical == "center" else f"H-h-{margin_y}"
    return x, y


def _decorate_body(
    dependencies: StagedRenderDependencies,
    raw_body: Path,
    caption_overlays: Sequence[tuple[Path, float, float]],
    watermark: dict | None,
    width: int,
    height: int,
    format_label: str,
    duration: float,
    work: Path,
) -> Path:
    if not caption_overlays and not watermark:
        return raw_body
    boundaries = {0.0, duration}
    for _, start, end in caption_overlays:
        boundaries.add(max(0.0, min(duration, float(start))))
        boundaries.add(max(0.0, min(duration, float(end))))
    ordered = sorted(boundaries)
    chunks: list[Path] = []
    threads = 1 if dependencies.hosted_mode else max(1, dependencies.ffmpeg_threads)
    preset = "ultrafast" if dependencies.hosted_mode else dependencies.render_preset
    for index, (start, end) in enumerate(zip(ordered, ordered[1:])):
        chunk_duration = end - start
        if chunk_duration <= 0.0001:
            continue
        midpoint = start + chunk_duration / 2
        captions = [Path(path) for path, cue_start, cue_end in caption_overlays if float(cue_start) <= midpoint < float(cue_end)]
        if len(captions) > 1:
            raise ValueError("같은 시간에 둘 이상의 자막이 겹쳐 있어 단계형 합성을 진행할 수 없습니다.")
        output = work / f"decorated-{index:04d}.mp4"
        args = _ffmpeg_prefix(dependencies) + ["-ss", f"{start:.6f}", "-i", str(raw_body)]
        filters: list[str] = ["[0:v]setpts=PTS-STARTPTS[base]"]
        labels = "[base]"
        input_index = 1
        if captions:
            args += ["-loop", "1", "-i", str(captions[0])]
            filters.append(f"[{input_index}:v]format=rgba[caption]")
            filters.append(f"{labels}[caption]overlay=0:0:shortest=1[captioned]")
            labels = "[captioned]"
            input_index += 1
        if watermark:
            args += ["-loop", "1", "-i", str(watermark["path"])]
            settings = watermark.get("settings") or {}
            profiles = settings.get("profiles") if isinstance(settings.get("profiles"), dict) else {}
            profile = profiles.get(format_label) if isinstance(profiles.get(format_label), dict) else {}
            opacity = max(0.1, min(1.0, float(settings.get("opacity", 0.8))))
            width_ratio = max(0.06, min(1.0, float(profile.get("width_ratio", settings.get("width_ratio", 0.15)))))
            logo_width = max(48, round(width * width_ratio))
            x, y = _position({**settings, **profile}, width, height)
            filters.append(f"[{input_index}:v]scale={logo_width}:-1,format=rgba,colorchannelmixer=aa={opacity:.3f}[watermark]")
            filters.append(f"{labels}[watermark]overlay={x}:{y}:shortest=1[decorated]")
            labels = "[decorated]"
        filters.append(f"{labels}format=yuv420p[v]")
        args += [
            "-filter_complex", ";".join(filters), "-map", "[v]", "-t", f"{chunk_duration:.6f}",
        ] + _encoding_args(preset, threads) + [str(output)]
        _run(dependencies, args, f"body-decoration-{index + 1:03d}")
        chunks.append(output)
    decorated = work / "body-decorated.mp4"
    _concat_video(dependencies, chunks, work / "decorated-concat.txt", decorated, "body-decoration-concat")
    return decorated


def _render_brand_clip(
    dependencies: StagedRenderDependencies,
    brand: dict,
    width: int,
    height: int,
    destination: Path,
) -> None:
    args = _ffmpeg_prefix(dependencies)
    if brand.get("media_type") == "image":
        args += ["-loop", "1"]
    args += ["-i", str(brand["path"])]
    duration = float(brand["duration"])
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,"
        f"format=yuv420p,trim=duration={duration:.6f},setpts=PTS-STARTPTS"
    )
    threads = 1 if dependencies.hosted_mode else max(1, dependencies.ffmpeg_threads)
    preset = "ultrafast" if dependencies.hosted_mode else dependencies.render_preset
    args += ["-vf", vf, "-t", f"{duration:.6f}"] + _encoding_args(preset, threads) + [str(destination)]
    _run(dependencies, args, "brand-intro")


def _render_outro(
    dependencies: StagedRenderDependencies,
    body: Path,
    outro: dict,
    width: int,
    height: int,
    format_label: str,
    body_duration: float,
    destination: Path,
) -> None:
    settings = outro.get("settings") or {}
    profiles = settings.get("profiles") if isinstance(settings.get("profiles"), dict) else {}
    profile = profiles.get(format_label) if isinstance(profiles.get(format_label), dict) else {}
    merged = {**settings, **profile}
    width_ratio = max(0.06, min(1.0, float(merged.get("width_ratio", 1.0))))
    logo_width = max(48, round(width * width_ratio))
    x, y = _position({"position": merged.get("position", "center-center")}, width, height)
    background = str(merged.get("background", "none"))
    if background not in {"none", "white", "black"}:
        background = "none"
    opacity = max(0.0, min(1.0, float(merged.get("background_opacity", 0.8))))
    background_filter = f",drawbox=color={background}@{opacity:.3f}:t=fill" if background != "none" and opacity > 0 else ""
    duration = float(outro["duration"])
    args = _ffmpeg_prefix(dependencies) + [
        "-ss", f"{max(0.0, body_duration - 1 / 30):.6f}", "-i", str(body),
    ]
    if outro.get("media_type") == "image":
        args += ["-loop", "1"]
    args += ["-i", str(outro["path"])]
    graph = (
        f"[0:v]trim=duration={1 / 30:.6f},setpts=PTS-STARTPTS,"
        f"tpad=stop_mode=clone:stop_duration={duration:.6f},trim=duration={duration:.6f}"
        f"{background_filter}[bg];"
        f"[1:v]scale={logo_width}:-1,format=rgba,fps=30,trim=duration={duration:.6f},"
        f"setpts=PTS-STARTPTS[layer];[bg][layer]overlay={x}:{y}:shortest=1,format=yuv420p[v]"
    )
    threads = 1 if dependencies.hosted_mode else max(1, dependencies.ffmpeg_threads)
    preset = "ultrafast" if dependencies.hosted_mode else dependencies.render_preset
    args += [
        "-filter_complex", graph, "-map", "[v]", "-t", f"{duration:.6f}",
    ] + _encoding_args(preset, threads) + [str(destination)]
    _run(dependencies, args, "brand-outro")


def _narration_sources(
    dependencies: StagedRenderDependencies,
    config: dict,
    title_scenes: Sequence[dict],
) -> list[tuple[float, float, Path]]:
    if not config["narration"]:
        return []
    clips = {str(item.get("scene_id")): item for item in config.get("voice_clips") or [] if isinstance(item, dict)}
    sources: list[tuple[float, float, Path]] = []
    if clips:
        for scene in title_scenes:
            clip = clips.get(str(scene.get("id")))
            path = dependencies.voice_audio_path((clip or {}).get("uri"))
            if not path:
                raise ValueError(f"{scene.get('name', scene.get('id'))} 장면의 나레이션 파일을 찾을 수 없습니다.")
            sources.append((float(scene["cue_start"]), 1.0, path))
        return sources
    if len(dependencies.narration_tracks) != len(title_scenes):
        raise ValueError("음성 파일과 대본 타임라인의 개수가 일치하지 않습니다.")
    for scene, (rate, filename) in zip(title_scenes, dependencies.narration_tracks):
        sources.append((float(scene["cue_start"]), float(rate), dependencies.root / "02_media" / "narration" / filename))
    return sources


def _mux_audio(
    dependencies: StagedRenderDependencies,
    config: dict,
    silent_video: Path,
    narration: Sequence[tuple[float, float, Path]],
    intro_duration: float,
    output_duration: float,
    output: Path,
    progress_line: Callable[[str], None],
) -> None:
    args = _ffmpeg_prefix(dependencies) + ["-i", str(silent_video)]
    filters: list[str] = []
    labels: list[str] = []
    input_index = 1
    music_path = dependencies.music[config["music"]]
    if music_path is not None:
        args += ["-stream_loop", "-1", "-i", str(music_path)]
        music_start = max(0.0, float(dependencies.render_defaults.get("music_start_offset_seconds", 3.0)))
        fadein_duration = max(0.0, float(dependencies.render_defaults.get("music_fade_in_seconds", 2.0)))
        fadeout_duration = max(0.0, float(dependencies.render_defaults.get("music_fade_out_seconds", 2.0)))
        fadeout_start = max(0.0, output_duration - fadeout_duration)
        filters.append(
            f"[{input_index}:a:0]atrim=start={music_start:.6f}:duration={output_duration:.6f},asetpts=PTS-STARTPTS,"
            f"volume={float(config['volume']):.3f},afade=t=in:st=0:d={fadein_duration:.6f},"
            f"afade=t=out:st={fadeout_start:.6f}:d={fadeout_duration:.6f}[bg]"
        )
        labels.append("[bg]")
        input_index += 1
    for number, (start, rate, path) in enumerate(narration):
        args += ["-i", str(path)]
        delay = round((start + intro_duration) * 1000)
        filters.append(f"[{input_index}:a:0]atempo={rate:.3f},volume=0.95,adelay={delay}|{delay}[n{number}]")
        labels.append(f"[n{number}]")
        input_index += 1
    if len(labels) > 1:
        filters.append(
            "".join(labels) + f"amix=inputs={len(labels)}:duration=longest:dropout_transition=0,"
            f"atrim=duration={output_duration:.6f},apad=whole_dur={output_duration:.6f},"
            "alimiter=limit=0.95[aout]"
        )
    elif labels:
        filters.append(labels[0] + f"atrim=duration={output_duration:.6f},apad=whole_dur={output_duration:.6f}[aout]")
    else:
        filters.append(f"anullsrc=r=44100:cl=stereo,atrim=duration={output_duration:.6f}[aout]")
    args += [
        "-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[aout]",
        "-t", f"{output_duration:.6f}", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(output),
    ]
    _run(dependencies, args, "audio-mux", progress_line)


def render_video_staged(
    config: dict,
    job_id: str | None = None,
    *,
    dependencies: StagedRenderDependencies,
) -> dict:
    """Render one ratio with bounded high-resolution FFmpeg input fan-in.

    The callable deliberately mirrors ``render_server.render_video``.  Its
    returned dictionary is wire-compatible, so the server can switch the
    implementation without changing API or worker consumers.
    """
    platform = config["preview_platform"]
    width, height, format_label = dependencies.platform_formats[platform]
    exports = dependencies.exports_dir
    exports.mkdir(parents=True, exist_ok=True)
    style, music = config["type"], config["music"]
    if job_id:
        job_token = re.sub(r"[^A-Za-z0-9_-]", "-", str(job_id)).strip("-")[:80] or "job"
        stamp = f"job_{job_token}"
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    output_name = f"P1_final_{style}_{platform}_{format_label}_{music}_{stamp}.mp4"
    output_path = exports / output_name
    data = config.get("content_data")
    if not isinstance(data, dict):
        raise ValueError("단계형 렌더러에는 content_data가 필요합니다.")
    scenes = dependencies.timeline_from_data(data)
    title_scenes = dependencies.timed_script_scenes(data)
    body_duration = float(scenes[-1]["end"])
    caption_overlays = config.get("prepared_caption_overlays")
    if caption_overlays is None:
        caption_overlays = dependencies.prepare_caption_overlays(config, job_id, width, height, data)
    brand = _resolve_brand_inputs(config, format_label, dependencies)
    intro_duration = float((brand.get("intro") or {}).get("duration", 0.0))
    outro_duration = float((brand.get("outro") or {}).get("duration", 0.0))
    output_duration = intro_duration + body_duration + outro_duration
    narration = _narration_sources(dependencies, config, title_scenes)
    dissolve = max(0.0, min(5.0, float(config.get(
        "scene_dissolve_seconds", dependencies.render_defaults["scene_dissolve_seconds"]
    ))))
    if _valid_output(output_path, output_duration, dependencies):
        dependencies.update_progress(
            job_id, status="succeeded", progress=1.0, rendered_seconds=output_duration,
            completed_scenes=len(scenes), scene_total=len(scenes),
            detail="동일 작업의 기존 최종 MP4를 재사용했습니다.",
        )
        return {
            "filename": output_name,
            "path": output_path,
            "duration": output_duration,
            "width": width,
            "height": height,
            "scene_count": len(scenes),
        }
    dependencies.update_progress(
        job_id, status="running", phase="staged_scenes", progress=0.01,
        rendered_seconds=0.0, completed_scenes=0, scene_total=len(scenes),
        format_id=config.get("format_id"), format_index=config.get("format_index", 1),
        format_total=config.get("format_total", 1), detail="장면별 FFmpeg 합성을 시작했습니다.",
    )
    work_parent = exports / ".render_work"
    work_parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix="staged-", dir=work_parent) as temporary:
            work = Path(temporary)
            normalized: list[Path] = []
            for index, scene in enumerate(scenes):
                target = work / f"scene-{index:04d}.mp4"
                _render_scene(dependencies, config, scene, index, width, height, format_label, target)
                normalized.append(target)
                dependencies.update_progress(
                    job_id, status="running", phase="staged_scenes",
                    progress=max(0.01, min(0.55, 0.55 * (index + 1) / len(scenes))),
                    rendered_seconds=float(scene["end"]), completed_scenes=index + 1,
                    scene_total=len(scenes), detail=f"장면 {index + 1:02d} / {len(scenes):02d} 정규화 완료",
                )
            parts: list[Path] = [normalized[0]]
            for index in range(1, len(scenes)):
                duration = float(scenes[index]["end"]) - float(scenes[index]["start"])
                blend = min(dissolve, duration)
                if blend > 0:
                    transition = work / f"transition-{index:04d}.mp4"
                    previous_duration = float(scenes[index - 1]["end"]) - float(scenes[index - 1]["start"])
                    _render_transition(
                        dependencies, normalized[index - 1], normalized[index],
                        previous_duration, blend, transition,
                    )
                    parts.append(transition)
                remainder_duration = duration - blend
                if remainder_duration > 0.0001:
                    remainder = work / f"remainder-{index:04d}.mp4"
                    _render_remainder(dependencies, normalized[index], blend, remainder_duration, remainder)
                    parts.append(remainder)
            raw_body = work / "body-raw.mp4"
            _concat_video(dependencies, parts, work / "body-concat.txt", raw_body, "body-concat")
            decorated = _decorate_body(
                dependencies, raw_body, caption_overlays, brand.get("watermark"),
                width, height, format_label, body_duration, work,
            )
            video_parts: list[Path] = []
            if brand.get("intro"):
                intro = work / "intro.mp4"
                _render_brand_clip(dependencies, brand["intro"], width, height, intro)
                video_parts.append(intro)
            video_parts.append(decorated)
            if brand.get("outro"):
                outro = work / "outro.mp4"
                _render_outro(
                    dependencies, decorated, brand["outro"], width, height,
                    format_label, body_duration, outro,
                )
                video_parts.append(outro)
            silent = work / "silent-final.mp4"
            _concat_video(dependencies, video_parts, work / "final-concat.txt", silent, "brand-concat")
            scene_ends = tuple(float(scene["end"]) for scene in scenes)

            def progress_line(line: str) -> None:
                if not line.startswith("out_time_ms="):
                    return
                try:
                    rendered = int(line.split("=", 1)[1]) / 1_000_000
                except (TypeError, ValueError):
                    return
                completed = sum(rendered >= end + intro_duration for end in scene_ends)
                dependencies.update_progress(
                    job_id, status="running", phase="audio_mux",
                    progress=max(0.56, min(0.98, rendered / output_duration)),
                    rendered_seconds=round(rendered, 1), completed_scenes=completed,
                    scene_total=len(scenes), detail=(
                        f"장면 {completed:02d} / {len(scenes):02d} 완료 · "
                        f"{rendered:.1f}초 / {output_duration:.1f}초 합성 중"
                    ),
                )

            staged_output = work / "final-output.mp4"
            _mux_audio(
                dependencies, config, silent, narration, intro_duration,
                output_duration, staged_output, progress_line,
            )
            if not _valid_output(staged_output, output_duration, dependencies):
                raise StagedRenderError("출력 MP4가 정상적으로 생성되지 않았습니다.")
            os.replace(staged_output, output_path)
        if not _valid_output(output_path, output_duration, dependencies):
            raise StagedRenderError("출력 MP4가 정상적으로 생성되지 않았습니다.")
        dependencies.update_progress(
            job_id, status="succeeded", progress=1.0, rendered_seconds=output_duration,
            completed_scenes=len(scenes), scene_total=len(scenes),
            detail=f"장면 {len(scenes):02d} / {len(scenes):02d} 완료 · 최종 MP4 합성이 완료됐습니다.",
        )
        return {
            "filename": output_name,
            "path": output_path,
            "duration": output_duration,
            "width": width,
            "height": height,
            "scene_count": len(scenes),
        }
    except Exception as exc:
        if output_path.exists():
            output_path.unlink()
        dependencies.update_progress(job_id, status="failed", detail=str(exc))
        raise
