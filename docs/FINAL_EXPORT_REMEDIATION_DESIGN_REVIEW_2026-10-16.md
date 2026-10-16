# Final export independent review and remediation design

- 작성일: 2026-10-16 (Asia/Seoul)
- 상태: 읽기 전용 검토 완료, 구현 전 (코드·DB·컨테이너 변경 없음, 테스트 미실행)
- 관련 문서: `docs/FINAL_EXPORT_RISK_REMEDIATION_PLAN_2026-10-16.md` (별도 에이전트 통합 계획)
- 검토 범위: `01_app/final_export_worker.py`, `final_export_queue.py`, `render_server.py`, `staged_ffmpeg_renderer.py`, `auth_store.py`, `assets/steps/step04/step04-render-controller.js`, `web_gateway.py`, `docker-compose.yml`, `Dockerfile.final-export`

핵심 결론: 가장 큰 위험은 실패가 아니라 **잘못된 콘텐츠의 성공 처리**다. 큐 등록 후 리비전이 바뀌거나 미디어가 빠지면 데모 영상(`P1_merged.mp4`)·데모 나레이션이 고객 영상에 섞인 채 succeeded가 될 수 있다(코드 경로 확인, 실제 재현은 하지 않음).

## 1. 추가 위험 목록 (기존 확인 위험 1~11 외)

### 상

| ID | 위험 | 근거 | 영향 | 대책 |
|---|---|---|---|---|
| N1 | 실행 시점 최신 리비전·설정·브랜드 재조회 | `render_server.py:2606`, `auth_store.py:702` (status 무관 최신), 사전검증 `render_server.py:909-960` | 검증하지 않은 입력으로 렌더·등록 | 큐 등록 시 불변 스냅샷 고정 |
| N2 | 장면 미디어 누락 시 데모 영상 대체 | `staged_ffmpeg_renderer.py:204` → `render_server.py:2244`, 워커 이미지에 `P1_merged.mp4` 포함 | 데모 영상이 들어간 영상이 성공 처리 | 운영 대체 경로 제거, 누락 시 실패 |
| N3 | 음성 0개 시 데모 나레이션 대체 | `staged_ffmpeg_renderer.py:457-468` | 다른 목소리·문장이 들어간 영상 성공 (문장 13개일 때) | cue별 클립·`text_hash` 재검증, 데모 트랙 제거 |
| N4 | 재시도 시 이전 리비전 MP4 재사용 | `staged_ffmpeg_renderer.py:544`, `:582` (크기·재생시간만 확인) | 예전 내용이 새 `revision_id`로 등록 | 스냅샷 해시 sidecar 일치 시에만 재사용 |
| N5 | 원본 예외가 progress로 브라우저 노출 | `render_server.py:2806`, `staged_ffmpeg_renderer.py:701`, `/api/render/status`가 progress 전달, 클라이언트 `step04-render-controller.js:140` | stderr·절대경로 노출, 서버 로그엔 원인 없음 | 원본은 서버 로그만, 사용자에겐 분류 코드 |
| N6 | `/04_exports/` 인증·소유자 확인 없음 | `render_server.py:2979`, `web_gateway.py:109` | URL 유출 시 비로그인 다운로드 | 소유자 확인 후 서빙 |

### 중

| ID | 위험 | 근거 | 대책 |
|---|---|---|---|
| N7 | 재클릭 멱등성 없음 | 클릭마다 새 job_id (`step04-render-controller.js:39`) | 서버 job_id, 프로젝트당 진행 중 1개 |
| N8 | 취소 API 없음, FFmpeg kill 없음 | `cancel()` 호출 경로 없음, `staged_ffmpeg_renderer.py:84` | 취소 API·확인 지점·finally kill, 등록 단계 취소 금지 |
| N9 | 게이트웨이·API 대기시간 모두 7200초 | `web_gateway.py:30`, `render_server.py:4790` | 202 즉시 응답 + 폴링 |
| N10 | 클라이언트 복구 루프가 일시 오류에 포기, `cancelled` 미처리 | `step04-render-controller.js:136-143` | 일시 오류 재시도, 모든 종료 상태 처리 |
| N11 | TTS가 큐 밖 HTTP 요청 안에서 동기 실행 | `render_server.py:4776` | job의 voice 단계로 이동 |
| N12 | 음성 매칭 단위 불일치 (오디오 scene_id, 타이밍 cue_id) | `staged_ffmpeg_renderer.py:455`, `timeline_with_voice_durations` | `cue_id + profile + text_hash` 단일 키 |
| N13 | 선택하지 않은 후보 미디어 자동 사용, `media_type` 미검증 | `auth_store.py:1257`, `:1379` | 선택 산출물만 허용 |
| N14 | 비율별 등록·브랜드·캘린더 개별 커밋 | `render_server.py:2757-2777` | 단일 트랜잭션 |
| N15 | 캘린더 정리 잠재 위험 (현재 draft만 존재) | `auth_store.py:906`, `:1204` | draft 외 상태 보호 |
| N16 | 자막 폰트 원격 로드, PNG 재사용 무검증 | `render_server.py:2118`, `:2125` | 로컬 폰트, 원자적 저장 |
| N17 | 사용자 간 공정성 없음 (워커 1개 FIFO) | `final_export_queue.py` claim | 사용자별 동시 제한, 대기 순번 |
| N18 | job_id 정규화로 출력 파일명 충돌 가능 | `staged_ffmpeg_renderer.py:544` | 서버 UUID + user/project 해시 파일명 |

### 하

- N19: 자막 레지스트리 `project_id` 하드코딩(`render_server.py:2356`), 프로세스 간 잠금 없음.
- N20: `.render_work`·`.caption_cache` 미정리, 워커 SIGTERM 처리·`stop_grace_period` 없음.
- N21: 하트비트 스레드가 Conflict 외 예외에 조용히 종료 (워커 2개 이상 시 중복 실행).
- N22: 대기 요청의 0.25초 DB 폴링, FFmpeg 진행률 줄마다 쓰기.

## 2. 해결 순서와 의존 관계

```
5 원본 로그·오류 분류 ─┐ (먼저 배포해야 이후 단계 롤백 판단 가능)
                     ▼
1 스냅샷 ══ 3 사전 검증 (같은 해석기 공유) ─▶ 2 데모 대체 제거
                     │
                     ├─▶ 4 202 즉시 응답 + 폴링
                     │         └─▶ 7 취소 + kill/timeout
                     └─▶ 6 산출물·캘린더 원자적 등록
8 인증된 다운로드: 독립
```

- 2를 3보다 먼저 넣지 않는다. 사전 검증 없이 데모 대체만 끊으면 몇 분 렌더 후 늦게 실패한다.
- 7은 6의 "등록 단계 진입 후 취소 불가" 경계가 필요하다.

## 3. 단계별 설계

### P0

**(5) 원본 로그 + 오류 분류**
- 변경: `final_export_worker.py`(구조화 로그·traceback·`classify(exc)`), `render_server.py:2806`, `staged_ffmpeg_renderer.py:701`.
- 계약: `error_json = {code, category, message, retryable}`; category는 `input_invalid|asset_missing|transient_io|ffmpeg_failed|timeout|internal`. progress `detail`은 사전 정의 문구만.
- 재시도: `transient_io`, `timeout`, SQLite 잠금만.
- 마이그레이션: 없음. 회귀 위험: 하(클라이언트가 `error.message` 사용하도록 동시 수정).
- 롤백 기준: 원인 미기록 실패 1건, 재시도로 인한 중복 등록 발생.
- 테스트: 경로·stderr 비노출, 분류별 재시도 횟수, 로그에 job_id·traceback.

**(1) 불변 스냅샷 + (3) 전체 자산 사전 검증 (동시 진행)**
- 변경: `render_server.py`에 `build_render_snapshot(user, project, overrides)` 신설. 포함: `revision_id`, 문서 해시, 확정 settings, 브랜드 `version_id`·URI, 장면별 선택 미디어, cue별 음성(artifact_id·`text_hash`·profile), 크롭 위치. `execute_render_request`는 스냅샷만 사용.
- 리비전은 확정 리비전 또는 클라이언트 `revision_id`, 불일치 시 409.
- 사전 검증은 같은 해석기로 파일 존재·크기·ffprobe(timeout) 확인. 이미지 상속(`inherit_compatible_media_artifacts`)을 스냅샷 생성 시에도 수행.
- 계약: `POST /render`에 `revision_id`, 실패 응답에 `missing[]`, `contracts/render-snapshot.schema.json` 신설.
- 마이그레이션: `final_export_jobs`에 `snapshot_json`, `snapshot_hash`, `revision_id` 추가(nullable). 배포 전 큐 비우기, 레거시 job은 `legacy_job_resubmit` 실패.
- 회귀 위험: 중(기존에 우연히 통과하던 누락 프로젝트가 거절됨).
- 롤백 기준: 오탐 거절 증가, 스냅샷 해시와 결과 메타데이터 불일치 succeeded 1건.
- 테스트: 등록 후 새 리비전 생겨도 스냅샷 리비전 사용, 자산 종류별 누락 시 렌더 전 실패, 비선택 후보 미사용, `media_type` 일치, 해시 결정성, cue 단위 해석.

**(2) 운영 데모 대체 제거**
- 변경: `scene_video_path`의 `SOURCE_CLIPS`/`MERGED_DEMO_VIDEO` 분기, `NARRATION_TRACKS` 분기, `Dockerfile.final-export`의 데모 파일 복사 제거. `ALLOW_DEMO_MEDIA_FALLBACK` 기본 false(로컬 bat에서만 true).
- 마이그레이션: 없음. 회귀 위험: 중(데모 대체에 의존하는 인수 테스트는 명시적 fixture로 전환).
- 롤백: 하지 않음. 실패 증가 시 (3)의 오탐 수정으로 대응.
- 테스트: 플래그 off에서 누락 시 반드시 failed, 워커 이미지에 데모 파일 없음, 회귀 시나리오.

### P1

**(4) 202 즉시 응답 + 폴링**
- 변경: `/render`는 스냅샷·사전검증 후 202. TTS는 job의 voice 단계로. 클라이언트는 폴링 전용, 대기 순번·종료 상태 처리. 게이트웨이 `/render` timeout 단축.
- 계약: `202 {job_id, status_url, deduplicated}`; job_id 서버 생성, 같은 `(user, project, snapshot_hash)` 진행 중 job 재사용. 롤백용 `FINAL_EXPORT_SYNC_WAIT=1`.
- 마이그레이션: 진행 중 job 부분 유니크 인덱스(기존 중복 정리 선행).
- 회귀 위험: 중(클라이언트·서버 동시 배포, 구 JS 캐시 무효화 필요).
- 롤백 기준: 폴링에서 succeeded 누락 1건.
- 테스트: 세 종료 상태 수신, 두 탭 동일 job_id, 일시 오류 후 폴링 지속, TTS 실패가 job 오류로 표시.

**(6) 산출물 + 캘린더 원자적 등록**
- 변경: `auth_store.py`에 `commit_final_export(job_id, outputs[], brand_snapshot, calendar)` 신설(단일 연결·`BEGIN IMMEDIATE`). `render_server.py:2757-2777` 교체. 출력 sidecar(snapshot_hash) 일치 시에만 재사용. 파일명은 서버 UUID + user/project 해시.
- 멱등성: `final_export_commits(job_id PK, committed_at)`.
- 캘린더 날짜는 job 완료 시각 KST 기준.
- 주의: 캘린더 드래그는 현재 클라이언트 로컬 상태로 보임(서버 `/api/calendar`는 GET만). 서버 정리가 클라이언트 표시를 덮지 않는지 확인.
- 마이그레이션: 테이블 1개. 회귀 위험: 중(트랜잭션 잠금 시간, 실제로는 수 ms 예상).
- 롤백 기준: 커밋 실패율 증가, 캘린더 버전 누락.
- 테스트: 2번째 비율 예외 시 변경 0건, 재등록 중복 없음, 프로젝트 삭제 경합 롤백·고아 MP4 정리, 스냅샷 불일치 재사용 거부, KST 자정 경계.

**(7) 취소 + FFmpeg kill/timeout**
- 변경: 큐 `request_cancel()`, `POST /api/render/cancel`, runner 단계별 timeout(재생시간 비례 + 상한), finally `terminate → kill`(프로세스 그룹), 워커 SIGTERM 처리, compose 워커 `stop_grace_period`.
- status CHECK 제약 재생성을 피하려고 `cancel_requested_at` 컬럼만 추가, 워커가 멈춘 뒤 `cancelled` 확정. 등록 단계 진입 후 취소는 409.
- 마이그레이션: 컬럼 1개. 회귀 위험: 중(timeout 과소 설정 시 정상 작업 종료).
- 롤백 기준: 정상 job timeout 실패율 초과 시 상한 상향, 계속되면 취소 API 비활성.
- 테스트: 취소 후 FFmpeg 자식 0개, 작업 폴더 정리, 등록 단계 취소 거부, 멈춘 FFmpeg timeout 분류, SIGTERM 정리.

**(8) 인증된 영상 다운로드**
- 변경: `/04_exports/`에 세션 확인 + `artifacts.uri`로 소유 확인, Range 유지, `.caption_cache`/`.render_work` 404.
- URL 형식은 유지(캘린더 `settings_json.contentUrl`에 저장되어 있어 변경 시 데이터 마이그레이션 필요).
- 계약: 비로그인 401. 마이그레이션: 없음.
- 회귀 위험: 중(쿠키 없는 외부 업로드·ICS·다운로드 매니저 차단, 필요 시 서명 단기 URL).
- 롤백 기준: 소유자 다운로드·재생 401.
- 테스트: 비로그인 401, 타 사용자 404, 소유자 200·Range, 경로 순회·숨김 폴더 거부, 기존 캘린더 링크 재생.

### P2

- 자막: 로컬 폰트, PNG 원자 저장, 레지스트리 DB 이전 또는 프로세스 간 잠금(하드코딩 project_id 제거, 마이그레이션 필요).
- 정리: 워커 시작 시 `.render_work` 정리, 내보낸 영상 보존 기간.
- 큐 운영: 하트비트 예외 처리, 진행률 쓰기 1초 1회 제한, 사용자별 동시 작업 제한·대기 순번.
- 캘린더: draft 외 상태 보호.
- 각각 독립 배포·롤백 가능, 회귀 위험 낮음.

## 4. 배포 방식

- P0: `5 → 1+3 → 2` 세 번에 나눠 배포. 1+3 전 큐 비우기.
- P1: `6 → 4 → 7` 순서, 8은 독립.
- 매 배포 필수: AGENTS.md 전체 테스트 묶음 통과, 회귀 시나리오 "큐 등록 → 새 리비전 → 미디어·음성 없음 → 반드시 failed"를 16:9, 9:16, 4:5, 1:1 네 비율에서 확인.
