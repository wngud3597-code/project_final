# LocalHub를 Netlify에 배포하기

배포된 사이트 이용자는 명령 프롬프트나 Python을 실행하지 않습니다. 웹브라우저에서 Netlify 주소만 열면 됩니다.

## 현재 운영 주소

```text
https://stately-begonia-1aaa4b.netlify.app
```

공개 페이지, 관광 데이터 6,518건, 조건 검색, 상세정보 API, 기상청 날씨와 안전한 챗봇 대체 모드의 외부 접속을 검증합니다.

## 준비된 배포 구조

- `frontend/`: Vue 3 화면
- `netlify/functions/api.mjs`: 검색, 상세정보, 지도, 기상청 날씨, OpenAI 및 안전 대체 챗봇 API
- `@netlify/blobs`: 장소별 커뮤니티 댓글 영구 저장
- `data/`: 한국관광공사 원본 데이터 6,518건
- `netlify.toml`: 배포 폴더, API 연결, 보안·캐시 설정

Windows의 `.cmd` 파일과 `backend/`는 로컬 실행 및 검증용입니다. Netlify에서는 실행되지 않습니다.

## 권장 방법: GitHub 연결 배포

1. 이 프로젝트 전체를 GitHub 저장소에 올립니다. `backend/.env`는 `.gitignore`에 포함되어 있으므로 커밋하지 않습니다.
2. Netlify에 로그인하고 **Add new project → Import an existing project**를 선택합니다.
3. GitHub 저장소를 연결합니다.
4. Netlify가 저장소의 `netlify.toml`을 감지하도록 기본 설정 그대로 배포합니다.
5. 배포가 끝나면 `https://사이트이름.netlify.app` 주소를 엽니다.

별도의 Build command는 필요하지 않습니다. Publish directory와 Functions directory는 `netlify.toml`에 이미 설정되어 있습니다.

## Windows에서 클릭하여 안전하게 배포

`DEPLOY_NETLIFY.cmd`를 더블클릭하면 다음 작업을 자동으로 수행합니다.

1. Node.js 버전과 필수 파일 확인
2. 관광 데이터 JSON 7개 확인
3. Vue·Netlify 함수 JavaScript 문법 검사
4. 데이터 6,518건, 검색, 무료 챗봇 사전 테스트
5. 미리보기 배포 또는 운영 배포 선택

처음 실행할 때 Netlify 로그인이 필요하면 브라우저 로그인 화면이 열립니다. 먼저 **Preview deploy**를 선택해 임시 주소에서 확인한 뒤, 이상이 없을 때만 **Production deploy**를 사용하세요. 운영 배포는 실수를 막기 위해 `DEPLOY` 확인 문구를 추가로 입력해야 합니다.

Node.js 18.14 이상이 필요하며 Netlify CLI는 배포할 때 공식 npm 패키지를 자동으로 실행합니다. `.cmd` 파일 자체가 웹서버가 되는 것은 아니며, 검증과 Netlify 업로드 과정을 안전하게 자동화합니다.

## 기상청 날씨 키 설정

Netlify 관리 화면에서 **Project configuration → Environment variables**로 이동해 다음 변수를 추가합니다.

```text
KMA_SERVICE_KEY=발급받은_기상청_키
OPENAI_API_KEY=발급받은_OpenAI_API_키
OPENAI_MODEL=gpt-5.6-luna
```

키를 추가한 뒤 GitHub에 새 커밋을 push하거나 Netlify에서 새 배포를 실행합니다. 키는 브라우저나 GitHub에 노출되지 않습니다. OpenAI 키가 없거나 호출이 실패해도 관광 데이터 기반 안내는 계속 작동합니다.

## 변경 사항 배포

GitHub 연결 방식에서는 수정한 파일을 저장소에 push하면 Netlify가 자동으로 다시 배포합니다. 배포 후에는 사용자에게 새 파일을 전달할 필요 없이 같은 웹주소를 계속 사용합니다.

## 배포 후 확인 주소

아래 주소가 모두 정상이어야 합니다.

```text
https://사이트이름.netlify.app/
https://사이트이름.netlify.app/api/health
https://사이트이름.netlify.app/api/stats
https://사이트이름.netlify.app/api/comments?contentid=장소ID
```

`/api/health` 응답의 `status`가 `ok`, `loadedItems`가 `6518`, `weatherConfigured`가 `true`이면 날씨가 정상입니다. OpenAI까지 연결하려면 `openAIConfigured`가 `true`, `chatMode`가 `openai`여야 합니다.

## 다른 사람에게 전달하는 방법

가장 안전한 방법은 ZIP 파일보다 배포된 Netlify 주소를 전달하는 것입니다.

```text
https://사이트이름.netlify.app
```

상대방은 Chrome, Edge, Safari 등 일반 브라우저로 주소를 열기만 하면 됩니다. Python, 명령 프롬프트, Codex, OpenAI API 키가 필요하지 않습니다.
