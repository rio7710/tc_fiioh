"""Use the same durable storyboard queue as the interactive editor."""
import time
from urllib.parse import quote

from automation_errors import AdapterFailure, ContentRepairExhausted
from automation_recovery import is_content_repair_failure


def generate_via_script_job(api, payload, *, sleep=time.sleep, poll_seconds=3):
    # Never replay a submission when its outcome is unknown. The API client
    # deliberately does not treat POST /api/script/jobs as replay-safe.
    submitted = api.call('/api/script/jobs', payload)
    job_id = submitted.get('job_id')
    if not isinstance(job_id, str) or not job_id:
        raise AdapterFailure('대본 작업 식별자를 확인하지 못했습니다. 중복 생성 방지를 위해 중단합니다.')
    path = '/api/script/job-status?job_id=' + quote(job_id, safe='')
    while True:
        # Only status reads may be retried. No provider invocation occurs here.
        for attempt in range(api.settings.api_retry_count):
            try:
                job = api.call(path, None)
                break
            except AdapterFailure:
                if attempt + 1 == api.settings.api_retry_count:
                    raise
                sleep(api.settings.api_retry_backoff_seconds * (2 ** attempt))
        status = job.get('status')
        if status == 'succeeded':
            result = job.get('response')
            if not isinstance(result, dict) or result.get('ok') is not True:
                raise AdapterFailure('완료된 대본 작업 결과를 확인하지 못했습니다.')
            return result
        if status == 'failed':
            message = str((job.get('error') or {}).get('message') or '대본 생성 작업이 실패했습니다.')
            if is_content_repair_failure('/api/script/generate', 400, message):
                raise ContentRepairExhausted(message)
            raise AdapterFailure(message)
        if status == 'cancelled':
            raise InterruptedError('대본 생성 작업이 취소되었습니다.')
        if status not in ('queued', 'running'):
            raise AdapterFailure('대본 작업 상태를 확인할 수 없습니다. 작업 기록을 확인해 주세요.')
        sleep(poll_seconds)
