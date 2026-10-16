"""Bounded FFmpeg child execution with cancellation and group cleanup."""

from __future__ import annotations

import logging
import os
import queue
import signal
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable, Optional, Sequence


LOGGER = logging.getLogger("ffmpeg_process_runner")
LineCallback = Optional[Callable[[str], None]]
CancelCallback = Optional[Callable[[], bool]]


class FfmpegProcessFailed(RuntimeError):
    pass


class FfmpegCancelled(RuntimeError):
    pass


class FfmpegTimeout(TimeoutError):
    pass


@dataclass(frozen=True)
class FfmpegTimeoutPolicy:
    base_seconds: float = 120.0
    duration_factor: float = 12.0
    maximum_seconds: float = 3600.0
    terminate_grace_seconds: float = 5.0

    def deadline_seconds(self, args: Sequence[str]) -> float:
        durations = []
        for index, value in enumerate(args[:-1]):
            if value != "-t":
                continue
            try:
                durations.append(max(0.0, float(args[index + 1])))
            except (TypeError, ValueError):
                continue
        planned = max(durations, default=0.0)
        return min(self.maximum_seconds, self.base_seconds + planned * self.duration_factor)


def policy_from_environment() -> FfmpegTimeoutPolicy:
    def positive(name: str, default: float) -> float:
        try:
            return max(0.1, float(os.environ.get(name, default)))
        except (TypeError, ValueError):
            return default
    return FfmpegTimeoutPolicy(
        base_seconds=positive("FFMPEG_STAGE_TIMEOUT_BASE_SECONDS", 120),
        duration_factor=positive("FFMPEG_STAGE_TIMEOUT_DURATION_FACTOR", 12),
        maximum_seconds=positive("FFMPEG_STAGE_TIMEOUT_MAX_SECONDS", 3600),
        terminate_grace_seconds=positive("FFMPEG_TERMINATE_GRACE_SECONDS", 5),
    )


def _stop_process_group(process: subprocess.Popen, grace: float) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        process.wait(timeout=grace)
        return
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except OSError:
        pass
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        LOGGER.error("FFmpeg child did not exit after forced termination pid=%s", process.pid)


def run_ffmpeg_process(
    args: Sequence[str], stage: str, line_callback: LineCallback = None, *,
    cancel_requested: CancelCallback = None,
    policy: FfmpegTimeoutPolicy | None = None,
) -> None:
    active_policy = policy or policy_from_environment()
    process = subprocess.Popen(
        list(args), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8", errors="replace", bufsize=1,
        start_new_session=os.name == "posix",
    )
    lines: queue.Queue = queue.Queue()
    output_tail: deque[str] = deque(maxlen=24)

    def read_output() -> None:
        try:
            for raw_line in process.stdout or ():
                lines.put(raw_line)
        finally:
            lines.put(None)

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    deadline = time.monotonic() + active_policy.deadline_seconds(args)
    stream_closed = False
    try:
        while process.poll() is None or not stream_closed:
            if cancel_requested and cancel_requested():
                raise FfmpegCancelled(f"{stage} 단계가 취소되었습니다.")
            if time.monotonic() >= deadline:
                raise FfmpegTimeout(f"{stage} 단계 제한시간을 초과했습니다.")
            try:
                raw_line = lines.get(timeout=0.1)
            except queue.Empty:
                continue
            if raw_line is None:
                stream_closed = True
                continue
            line = raw_line.strip()
            if line:
                output_tail.append(line)
                if line_callback:
                    line_callback(line)
    except BaseException:
        _stop_process_group(process, active_policy.terminate_grace_seconds)
        reader.join(timeout=active_policy.terminate_grace_seconds)
        if process.stdout:
            process.stdout.close()
        raise
    return_code = process.wait()
    reader.join(timeout=active_policy.terminate_grace_seconds)
    if process.stdout:
        process.stdout.close()
    if return_code:
        LOGGER.error("FFmpeg failed stage=%s code=%s tail=%s", stage, return_code, " | ".join(output_tail))
        raise FfmpegProcessFailed(f"{stage} 단계 FFmpeg 변환에 실패했습니다.")
