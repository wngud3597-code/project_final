LOCALHUB_FIXED_20260715 실행 안내
================================

현재 발생했던 오류는 기존 프로젝트의 weather_service.py에
ZoneInfo("Asia/Seoul") 코드가 남아 있어서 발생했습니다.

이번 폴더는 이름부터 다릅니다.

반드시 사용할 폴더:
LOCALHUB_FIXED_20260715

사용하지 말아야 할 기존 폴더:
localhub_seoul_complete

실행 순서:
1. 기존 LocalHub 검은 창과 VS Code를 모두 닫습니다.
2. LOCALHUB_FIXED_20260715.zip을 새 빈 폴더에 압축 해제합니다.
3. 압축 해제된 LOCALHUB_FIXED_20260715 폴더를 VS Code로 엽니다.
4. VERIFY_FINAL.cmd를 실행합니다.
5. PASS가 나오면 START_FINAL.cmd를 실행합니다.
6. http://127.0.0.1:8000 에 접속합니다.

이 버전의 한국시간 처리:
UTC+09:00 고정 오프셋
외부 tzdata 패키지 불필요
ZoneInfo 사용하지 않음

START_FINAL.cmd는 실행 전에 구버전 ZoneInfo 코드가 남아 있는지
자동 검사하고, 발견하면 서버를 실행하지 않습니다.
