# Regression Prevention Protocol (회귀 예방 필수 수칙)

## 1. 사이드 이펙트 사전 분석 및 교차 검증 (Side-Effect Analysis)
- UI, 상태 관리, 복합 로직 파일(`P1_title_design_preview.html`, `step04-video.js` 등) 수정 시 국소 구문 수정에 그치지 않고 전체 교차 검증을 수행한다.
- 16:9, 1:1, 9:16, 4:5 비율 전환, 자막 랜더링, 아웃트로 프로필 맵핑 등 종단간 연관 기능이 파손되지 않았는지 종합 검증한다.

## 2. 객관적 검증 없는 성공 선언 금지 (Mandatory Verification)
- 코드 수정 후 빌드/테스트를 직접 수행하여 결과를 확인하기 전에는 절대로 완료 보고를 하지 않는다.
- 반드시 전체 테스트 스위트 커맨드를 수행하여 Exit Code 0 및 100% PASS 결과를 직접 확인해야 한다:
  `for f in tests/*.js; do node "$f"; done && python3 -m unittest discover tests && PYTHONPATH=.:01_app python3 tests/test_random_api_e2e.py && PYTHONPATH=.:01_app python3 tests/test_worker_random_e2e.py && node tests/test_randomized_user_lifecycle.js && python3 tools/lint_project.py`

## 3. 증상 은폐 및 임시 우회 금지 (No Superficial Patches)
- 오류 발생 시 스택 트레이스 및 로그를 정밀 분석하여 근본 원인을 수정한다.
- 빈 `try/except` 블록, 실패하는 테스트의 주석 처리, 임의의 0바이트/더미 반환 등 증상 은폐성 코드를 작성하지 않는다.

## 4. 캐시 및 환경 동기화 (Cache-Busting & Environment Sync)
- static asset(CSS/JS) 수정 시 버전 쿼리 스트링(`?v=YYYYMMDD_vN`)을 업데이트하여 Docker 및 브라우저 캐시로 인한 구버전 스타일 고정 현상을 차단한다.
