# ThinkCast 사이트 격리 및 최적화 임시 계획

- 작성일: 2026-10-06
- 상태: 검토용 임시 문서
- 범위: 계획 정리만 수행하며 실행 코드 변경은 포함하지 않음
- 원칙: 기존 기능과 API 호환성을 유지하면서 단계적으로 분리한다.

## 1. 현재 진단

- 작성 당시에는 `01_app/P1_title_design_preview.html`에 Step UI, 상태, 이벤트, 미리보기 로직이 집중되어 있었다. 2026-10-09의 프론트 shell 분절로 이 진단은 역사적 기준점이 되었으며, 현재 P1은 mount point와 공유 modal root를 제공하는 얇은 shell이다.
- `01_app/render_server.py`에 HTTP, 인증, 저장, 외부 모델 호출, FFmpeg 로직이 혼재한다.
- Step 간 DOM과 전역 상태를 직접 참조해 한 Step 수정이 다른 Step에 영향을 준다.
- 아웃트로 비율별 파일이 하나의 논리 버전이 아니라 숨겨진 버전과 파일명 규칙으로 연결된다.
- Compose의 `web`, `api`, `worker`는 실행 단위만 나뉘었고 책임 분리가 완성되지 않았다.
- API가 `host.docker.internal`의 Arun TTS 워커를 참조해 완전 격리 원칙과 어긋난다.
- 동일 worktree를 여러 창에서 동시에 수정하면 변경 충돌과 덮어쓰기가 발생할 수 있다.
- Git 기준점이 불명확하고 프로젝트 내부 백업 파일이 검색과 테스트를 오염시켰다.

## 2. 목표 구조

```text
tc_temp/
├─ frontend/
│  ├─ index.html
│  ├─ core/
│  │  ├─ api-client.js
│  │  ├─ project-store.js
│  │  ├─ event-bus.js
│  │  └─ router.js
│  ├─ steps/
│  │  ├─ step01-keyword/
│  │  ├─ step02-script/
│  │  ├─ step03-scenes/
│  │  ├─ step04-video/
│  │  │  ├─ scene-navigation.js
│  │  │  ├─ timeline-preview.js
│  │  │  ├─ brand-settings.js
│  │  │  ├─ outro-editor.js
│  │  │  └─ render-panel.js
│  │  └─ step05-calendar/
│  └─ shared/
├─ backend/
│  ├─ app.py
│  ├─ routes/
│  ├─ services/
│  └─ repositories/
├─ worker/
│  ├─ runner.py
│  ├─ steps/
│  └─ providers/
├─ contracts/
├─ migrations/
├─ tests/
│  ├─ unit/
│  ├─ contract/
│  ├─ integration/
│  └─ e2e/
└─ deployment/
```

## 3. 스텝 파이프라인 계약

각 Step은 이전 화면이나 DOM을 직접 읽지 않고 버전이 있는 결과 계약만 전달받는다.

```text
Step 1 키워드       → keyword-selection.v1
Step 2 대본         → script-manifest.v1
Step 3 음성·장면    → timeline-manifest.v1 + scene-manifest.v1
Step 4 비디오       → render-manifest.v1 + export artifacts
Step 5 배포 일정    → distribution-manifest.v1
```

작업의 공통 필드:

```json
{
  "job_id": "uuid",
  "project_id": "uuid",
  "stage": "scene",
  "input_version": 3,
  "input_hash": "sha256...",
  "status": "queued",
  "attempt": 1,
  "progress": 0,
  "output_manifest_uri": null
}
```

- 상태: `pending → queued → running → succeeded/failed/cancelled`
- 이전 단계 입력 변경 시 뒤 단계는 `stale`로 전환한다.
- 같은 `project_id + stage + input_hash` 작업은 하나만 생성한다.
- 워커는 멱등성을 보장하고 재실행 시 같은 논리 결과를 재사용하거나 안전하게 교체한다.

## 4. 단계별 실행 계획

### Phase 0 — 복구 가능한 기준점

- DB, 업로드, 렌더 결과, 비밀키, 캐시를 `.gitignore`로 제외한다.
- 현재 정상 상태를 기준 커밋과 태그로 고정한다.
- `tc_temp_data` 볼륨과 SQLite를 백업한다.
- 운영 브랜치는 단일 창만 수정한다.
- 병렬 작업은 별도 브랜치와 Git worktree를 사용한다.
- 프로젝트 내부 수동 백업은 소스 트리 밖으로 이전한다.

완료 조건:

- `git status`에서 실제 변경만 식별된다.
- 운영 브랜치의 작성자가 하나로 제한된다.
- 5분 안에 기준 버전으로 복구할 수 있다.

### Phase 1 — 현재 동작 테스트 동결

필수 E2E 범위:

- 로그인 없이 사이트 접근
- 콘텐츠 생성 및 저장
- Step 이동과 새로고침 복구
- 장면 순서 이동
- `OUT → 장면 → OUT` 내비게이션
- 모바일 장면 선택 동기화
- 워터마크 비율별 위치와 크기 저장
- 아웃트로 비율별 자산, 배경, 알파 저장
- 씬/렌더 중복 실행 방지
- 콘텐츠 삭제 시 관련 리소스 처리 정책

완료 조건:

- 기존 테스트 전체 통과
- 신규 핵심 E2E 통과
- `python3 tools/lint_project.py` 통과
- 실패 상태에서는 배포하지 않는다.

### Phase 2 — 브랜드 및 아웃트로 모델 정리

```text
brand_asset
  asset_id, role, name

brand_asset_version
  version_id, asset_id, version, created_at

brand_asset_variant
  variant_id, version_id, format, uri,
  width, height, media_type, checksum
```

- 사용자에게는 `아웃트로 v4` 하나만 표시한다.
- 그 아래에 `16x9`, `9x16`, `4x5`, `1x1` 변형을 연결한다.
- 파일명으로 비율이나 버전을 추측하지 않는다.

완료 조건:

- UI에 논리 버전 하나만 표시된다.
- 네 비율을 명시적으로 조회할 수 있다.
- 파일명 변경이 기능에 영향을 주지 않는다.
- 기존 데이터 자동 마이그레이션과 롤백이 가능하다.

### Phase 3 — Step 4 프론트엔드 우선 분리

분리 순서:

1. API 클라이언트
2. 프로젝트 상태 저장소
3. 장면 내비게이션
4. 타임라인 미리보기
5. 워터마크 설정
6. 아웃트로 설정
7. 렌더 진행 화면

규칙:

- 다른 Step의 DOM을 직접 조회하지 않는다.
- 전역 변수 대신 명시적인 프로젝트 상태 저장소를 사용한다.
- 상태 변경은 이벤트와 명시적 함수 인자로 전달한다.
- 미리보기와 실제 렌더는 동일한 설정 스냅샷을 사용한다.

완료 조건:

- Step 4 인라인 이벤트 로직이 제거된다.
- Step 4 변경 전후 Step 1~3 결과가 동일하다.
- 프리뷰 설정과 FFmpeg 입력 설정이 일치한다.
- 데스크톱 및 모바일 내비게이션 테스트를 통과한다.

### Phase 4 — 백엔드 점진 분리

기존 URL과 응답 계약을 유지한 채 내부 구현부터 교체한다.

```text
기존 URL → 호환 라우터 → 신규 서비스 → 저장소/워커
```

분리 순서:

1. 브랜드 자산 API
2. 렌더 작업 API
3. 프로젝트 저장 API
4. 인증 및 사용자 설정
5. 콘텐츠 생성 API

완료 조건:

- 기존 URL과 응답 형식이 유지된다.
- 서버 진입점에는 부팅과 공통 라우팅만 남는다.
- 서비스 단위 테스트가 가능하다.
- `sys.path.insert()`를 제거하고 정식 패키지 import를 사용한다.

### Phase 5 — 워커 및 스텝 실행 격리

```text
Browser → API → jobs DB → Worker
                ↑          ↓
                └─ status/output
```

- API는 작업을 등록하고 즉시 `job_id`를 반환한다.
- 대본, 음성, 장면, 렌더 작업을 워커에서 실행한다.
- 스텝별 재시도, 취소, 실패 지점 재개를 지원한다.
- 입력 해시를 기준으로 중복 생성과 중복 렌더를 차단한다.
- 큰 결과는 파일 경로가 아니라 URI와 메타데이터로 전달한다.

완료 조건:

- 브라우저 연결이 끊겨도 작업이 지속된다.
- 실행 버튼을 연속 클릭해도 작업은 하나만 생성된다.
- Step 3 실패 시 Step 1~2는 다시 실행되지 않는다.
- 워커 재시작 후 작업 상태를 복구한다.

### Phase 6 — 실행환경 격리와 성능 최적화

- 외부에는 `fiioh.co.kr → Caddy → 127.0.0.1:43110`만 노출한다.
- API와 worker 포트는 외부에 공개하지 않는다.
- TC 전용 네트워크, 볼륨, DB, 로그, 비밀키를 사용한다.
- 완전 격리가 목표라면 Arun TTS 대신 TC 전용 TTS 워커를 Compose에 둔다.
- 개발, 스테이징, 운영의 DB와 볼륨 이름을 분리한다.

성능 작업 우선순위:

1. 씬과 렌더 중복 작업 제거
2. FFmpeg를 API 요청 처리에서 완전히 분리
3. 입력 해시 기반 결과 재사용
4. 동일 비율 플랫폼 간 렌더 결과 공유
5. SQLite WAL과 `busy_timeout` 적용
6. 이미지, 폰트, 브랜드 자산 캐시 적용
7. 현재 Step 모듈만 지연 로딩
8. 진행 상태 UI 갱신을 100~200ms 단위로 병합

## 5. 배포 및 롤백

```text
현재 운영 버전
  → 신규 컨테이너를 별도 포트에서 실행
  → health check
  → 핵심 smoke test
  → Caddy 대상 전환
  → 기존 컨테이너를 일정 시간 유지
```

DB 변경 절차:

1. 백업
2. 추가형 마이그레이션
3. 이전 코드도 새 DB를 읽을 수 있는 호환 기간 유지
4. 검증 완료 후에만 구 컬럼 제거

- 각 Phase를 별도 커밋과 태그로 배포한다.
- 영구적인 신·구 이중 코드는 만들지 않는다.
- Phase별 단기 호환 어댑터만 두고 검증 후 제거한다.

## 6. 테스트 게이트

모든 Phase는 다음 순서로 검증한다.

```text
Python/JS 문법
  → JSON Schema
  → 단위 테스트
  → 파이프라인 계약 테스트
  → 핵심 E2E
  → tools/lint_project.py
  → 스테이징 smoke test
```

배포 차단 조건:

- 스키마 불일치
- 기존 API 응답 계약 변경
- 프리뷰와 렌더 설정 불일치
- 중복 작업 생성
- Step 간 상태 유실
- 관련 E2E 또는 품질 게이트 실패

## 7. 우선 실행 순서

1. Phase 0: Git 및 작업 창 격리
2. Phase 1: 현재 기능 E2E 동결
3. Phase 2: 아웃트로 버전/비율 모델 정상화
4. Phase 3: Step 4 프론트엔드 분리
5. Phase 5 중 중복 실행 방지 부분 우선 적용
6. 나머지 Step과 백엔드 순차 분리
7. 실행환경 완전 격리 및 성능 튜닝

## 8. 작업 운영 규칙

- 운영 worktree는 한 창만 수정한다.
- 다른 창은 읽기와 검토만 수행한다.
- 병렬 구현이 필요하면 작업별 별도 worktree를 만든다.
- 하나의 Phase 안에서도 작은 커밋으로 나눈다.
- 수정 전 계약 테스트를 먼저 추가한다.
- 구조 분리와 기능 추가를 같은 커밋에 섞지 않는다.
- 각 Phase 완료 후 사용자 확인을 받고 다음 Phase로 이동한다.

## 9. 병렬 개발 운영안

현재 결합도를 기준으로 안전한 구성은 **구현 스트림 3개와 통합 리드 1개**다. 구현 스트림을 4개 이상 동시에 운영하면 단일 HTML, 단일 서버 파일, DB 계약에서 발생하는 통합 비용이 병렬화 이득보다 커질 가능성이 높다.

### 역할과 소유권

| 역할 | 단독 소유 영역 | 수정 금지 영역 |
|---|---|---|
| 통합 리드 | 기존 `P1_title_design_preview.html`, 기존 `render_server.py`, `contracts/`, DB migration, Compose/Dockerfile, 품질 도구 | 기능 스트림 구현을 임의로 병행하지 않음 |
| Stream A — Frontend | 신규 `frontend/core`, `frontend/steps`, `frontend/shared`, 프론트 단위 테스트 | 기존 HTML shell, Python, DB, contracts |
| Stream B — Backend | 신규 `backend/services`, `backend/repositories`, 백엔드 단위 테스트 | 기존 서버 진입점, 프론트, Compose, migration |
| Stream C — Worker/Media | 신규 `worker/steps`, `worker/providers`, 미디어 계약 테스트 | 기존 서버 진입점, 프론트, DB schema, Compose |

공유 hotspot은 통합 리드만 수정한다. 각 스트림은 신규 모듈과 테스트를 만들고, 기존 shell이나 router에 연결하는 작업은 통합 리드가 병합 단계에서 수행한다.

### Worktree 배치

```text
/Users/rio_ax/Developer/tc_temp           main/integration
/Users/rio_ax/Developer/tc_temp_frontend  feature/frontend-isolation
/Users/rio_ax/Developer/tc_temp_backend   feature/backend-isolation
/Users/rio_ax/Developer/tc_temp_worker    feature/worker-isolation
```

- worktree마다 `.env`와 SQLite 경로, Compose project name, 테스트 출력 경로를 다르게 사용한다.
- 운영 볼륨과 운영 DB를 개발 worktree에서 마운트하지 않는다.
- 계약 변경은 통합 리드가 먼저 커밋하고 각 스트림이 그 커밋을 기준으로 시작한다.

### 병합 순서

1. 통합 리드: 계약, fixture, 현재 동작 회귀 테스트
2. Stream B: 저장소와 서비스 계층
3. Stream C: 작업 실행과 자산 variant 처리
4. Stream A: Step 4 UI 및 상태 모듈
5. 통합 리드: 기존 HTML/router 연결
6. 전체 단위·계약·통합 테스트
7. 실제 브라우저 E2E 및 다중 비율 렌더
8. 통합 리드 최종 코드 검토와 릴리스 승인

각 스트림은 작은 커밋 단위로 제출하며, 앞 스트림 전체가 끝날 때까지 기다리는 대신 계약이 확정된 신규 디렉터리에서 병렬 구현한다. 병합은 위 순서대로 직렬 처리한다.

## 10. 원격 Git 롤백 기준점 — 병렬 작업 전 필수 게이트

현재 확인 상태:

- `main` 브랜치에 아직 커밋이 없다.
- 연결된 Git remote가 없다.
- 프로젝트 대부분이 untracked 상태다.
- `.env.backup-*`, `.env.save` 등 비밀정보 포함 가능 파일이 작업 폴더에 있다.

따라서 현재 상태에서 바로 `git add .` 또는 원격 push를 하면 안 된다. 다음 절차를 먼저 수행한다.

### 안전한 최초 Push 절차

1. `.env*`, API 키, 인증서, SQLite 및 런타임 JSON을 전수 검사한다.
2. 생성 영상, 업로드, 캐시, 로그, DB, 백업 폴더를 `.gitignore`에 추가한다.
3. 추적 예정 파일 목록을 검토해 비밀정보와 대용량 산출물이 없는지 확인한다.
4. lint, 단위 테스트, 핵심 E2E를 실행한다.
5. 최초 기준 커밋 `baseline: stable before isolation refactor`를 생성한다.
6. 주석 태그 `pre-isolation-2026-10-06`을 생성한다.
7. 사용자 소유의 **비공개 원격 저장소**를 만든 뒤 `origin`을 연결한다.
8. `main`과 기준 태그를 push한다.
9. 원격에서 새 clone을 받아 동일 테스트가 통과하는지 확인한다.
10. 그 뒤에만 세 개의 feature branch와 worktree를 생성한다.

### Phase별 롤백 지점

```text
pre-isolation-2026-10-06
phase-1-contract-tests
phase-2-brand-model
phase-3-step4-frontend
phase-4-backend-services
phase-5-worker-isolation
release-candidate
```

- 각 Phase는 원격 branch에 push한 뒤 PR 또는 비교 검토를 거친다.
- Phase 병합 전에 DB 백업 ID와 migration 버전을 기록한다.
- 코드 롤백과 DB 롤백은 별도로 검증한다.
- 강제 push는 금지하고, 운영 롤백은 revert commit 또는 이전 태그 재배포로 수행한다.
- 최종 승인 전까지 기존 안정 컨테이너 이미지를 삭제하지 않는다.

## 11. 2026-10-09 P1 shell 5단계 분절 완료

초기 2,153줄이던 `01_app/P1_title_design_preview.html`을 기능 계약을 유지한 채 204줄의 root shell로 축소했다. 현재 P1은 정적 자산 로드, Step/partial mount point, 여러 화면이 함께 쓰는 modal root만 소유한다. 앱 상태, controller composition, partial load와 boot 순서는 `01_app/assets/core/app-bootstrap.js`가 소유한다.

완료된 경계:

1. 인라인 CSS를 `01_app/assets/core/app-shell.css`로 이동 — 기준 커밋 `b3b6b48`
2. 사용자 설정/서버 자동화 markup과 lifecycle을 partial/controller로 이동 — 기준 커밋 `6296a1b`
3. AI workflow progress modal과 구성 책임을 partial/controller로 이동 — 기준 커밋 `4edd403`
4. 남은 async IIFE, 상태, bridge, controller composition, boot를 `app-bootstrap.js`로 기계적 이동 — 기준 커밋 `9de6cce`
5. shell 크기·mount point·공유 modal·외부 CSS/JS 진입점·금지 state marker를 architecture contract로 고정

유지보수 원칙:

- P1에는 기능 상태, API 호출, 이벤트 orchestration, controller 생성 코드를 다시 넣지 않는다.
- Step별 화면은 `pages/steps`, 공통 modal은 `pages/components`, 동작은 `assets/core` 또는 `assets/steps`에서 소유한다.
- `app-bootstrap.js`는 조립과 부팅 호환 경계이며, 각 기능 본체는 전용 controller에 둔다.
- 변경 시 `test_app_shell_css_extraction.js`, `test_user_settings_partial.js`, `test_workflow_progress_partial.js`, `test_app_bootstrap_extraction.js`, strict pre-partial VM, pipeline contract, `tools/lint_project.py`를 유지한다.
- 위 네 커밋은 단계별 rollback 기준점이며, 최종 통합 커밋 해시는 통합 리드가 병합 후 기록한다.
