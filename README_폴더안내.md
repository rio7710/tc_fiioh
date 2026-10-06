# P1 데모 폴더 안내

현재 데모 브랜드는 **생각담 | ThinkCast**이며, `AI SOCIAL CONTENT STUDIO` 콘셉트로 구성되어 있습니다.

`P1_미리보기_및_변환_실행.bat`를 더블클릭하면 데모가 실행됩니다.

## 다른 PC 또는 갤럭시에서 확인

1. 이 폴더가 있는 PC에서 실행 배치 파일을 한 번 실행합니다.
2. 검은 창에 표시되는 `다른 PC/갤럭시에서 열기` 주소를 확인합니다.
3. 같은 Wi-Fi에 연결된 다른 기기의 브라우저에 그 주소를 입력합니다.

접속하는 기기에는 Python이나 FFmpeg가 필요하지 않습니다. 서버를 실행한 PC의 창은 닫지 않아야 하며, Windows 방화벽 창이 나오면 개인 네트워크 액세스를 허용해야 합니다.

- `01_app`: HTML 화면, Python 서버, JSON 데이터
- `02_media/video`: 원본 클립과 합본 영상
- `02_media/music`: 클래식 배경음악
- `02_media/narration`: STT 내레이션 음원
- `03_docs`: 스토리보드, 자막, 편집용 설정
- `04_exports`: MP4 최종 변환 결과
- `05_archive`: 전달받은 ZIP 원본

폴더명과 파일 경로는 프로그램에 연결되어 있으므로 임의로 변경하지 않는 것을 권장합니다.

## 웹 배포

루트의 `Dockerfile`과 `render.yaml`은 공개 데모 UI를 실행하는 Render 설정입니다. 현재 Render 공개 미리보기에서는 `/render` FFmpeg 출력을 명시적으로 차단하며, 실제 MP4 변환은 로컬 실행 주소에서만 지원합니다. 원본 클립·ZIP·기존 결과물은 배포 대상에서 제외됩니다.

- 공개 데모: https://greenhill-content-demo.onrender.com/01_app/P1_title_design_preview.html
- 내부 가격 페이지: https://greenhill-content-demo.onrender.com/01_app/P0_pricing_preview.html
- GitHub `main` 브랜치에 푸시하면 Render가 자동으로 새 버전을 배포합니다.
- 배포 완료 여부는 Render 배포 상태가 `live`인지 확인합니다.
- 자세한 접속·인증·배포 규칙은 `docs/DEPLOYMENT.md`를 따릅니다.

무료 서버에서는 저장한 JSON과 생성된 MP4가 서버 재시작 시 초기화될 수 있습니다. 장기 저장이 필요하면 별도의 데이터베이스와 파일 저장소 또는 영구 디스크를 연결해야 합니다.
