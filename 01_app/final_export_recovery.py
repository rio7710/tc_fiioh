"""At-most-once final-export submission with durable status recovery."""

from __future__ import annotations

import time

from automation_errors import AdapterFailure, RenderResultUnknown, RenderTerminalFailure


class FinalExportRecoveryAdapter:
    def __init__(
        self, submit, status, *, initial_job_id=None,
        poll_interval_seconds: float, recovery_timeout_seconds: float,
    ):
        self.submit = submit
        self.status = status
        self.job_id = initial_job_id
        self.poll_interval_seconds = poll_interval_seconds
        self.recovery_timeout_seconds = recovery_timeout_seconds

    def _status(self):
        try:
            result = self.status(self.job_id)
        except AdapterFailure:
            return None
        return result if isinstance(result, dict) and result.get("status") else None

    @staticmethod
    def _terminal(status):
        state = status.get("status")
        if state == "succeeded":
            response = status.get("response")
            if not isinstance(response, dict) or response.get("ok") is not True:
                raise RenderResultUnknown("완료된 렌더 작업의 저장 응답을 확인하지 못했습니다.")
            return {"value": response}
        if state in ("failed", "cancelled"):
            message = (status.get("error") or {}).get("message")
            raise RenderTerminalFailure(message or "최종 영상 합성 작업이 실패했습니다.")
        return None

    def _recover(self):
        deadline = time.monotonic() + self.recovery_timeout_seconds
        while True:
            status = self._status()
            if status:
                terminal = self._terminal(status)
                if terminal:
                    return terminal
            if time.monotonic() >= deadline:
                raise RenderResultUnknown(
                    "렌더 응답이 끊겨 저장된 작업 상태만 확인 중입니다. "
                    "동일 작업을 다시 제출하지 않았습니다."
                )
            time.sleep(self.poll_interval_seconds)

    def run(self, job):
        status = self._status()
        if status:
            terminal = self._terminal(status)
            return terminal or self._recover()
        if job.get("attempt", 1) > 1:
            raise RenderResultUnknown("이전 렌더 제출 여부를 확인할 수 없어 중복 실행을 차단했습니다.")
        try:
            submitted = self.submit()
        except AdapterFailure:
            return self._recover()
        if isinstance(submitted, dict) and (
            submitted.get("status") in {"queued", "running"} or submitted.get("status_url")
        ):
            self.job_id = str(submitted.get("job_id") or self.job_id or "")
            return self._recover()
        return {"value": submitted}
