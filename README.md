
## Windows Python 시간대 호환성

이 수정본은 `zoneinfo.ZoneInfo("Asia/Seoul")` 또는 외부 `tzdata` 패키지에 의존하지 않습니다.
한국 표준시를 UTC+9 고정 오프셋으로 처리하므로 Windows의 Python 3.15 베타 환경에서도
별도 패키지 설치 없이 검증과 실행이 가능합니다.

# LocalHub 서울안내 — Vue 3 최종 통합본

노년의 부모님 두 분이 자녀의 동행 없이도 서울을 편안하게 여행할 수 있도록 만든 **관광 검색 + 상세정보 + 지도 + 기상청 날씨 + AI 안내** 통합 서비스입니다.

## Netlify 배포

다른 사람은 명령 프롬프트 없이 배포된 웹주소만 열어 사용할 수 있습니다. Netlify용 Vue 정적 화면과 서버리스 API 구성이 포함되어 있습니다. 자세한 절차는 [`NETLIFY_DEPLOY.md`](NETLIFY_DEPLOY.md)를 확인하세요.

운영 주소: <https://stately-begonia-1aaa4b.netlify.app>

## 바로 실행

1. ZIP 파일을 완전히 압축 해제합니다.
2. 기존에 실행 중인 LocalHub 창이 있다면 닫습니다.
3. `start-localhub.cmd`를 더블 클릭합니다.
4. 브라우저가 자동으로 열리지 않으면 `http://127.0.0.1:8000`에 접속합니다.

이 프로젝트는 npm 설치가 필요 없습니다. Python만 있으면 서버가 실행됩니다.  
Vue 3와 Leaflet은 실행 시 CDN 2곳 중 연결 가능한 곳에서 불러옵니다.

## 포함된 원본 데이터

업로드된 TourAPI JSON 7개를 원본 내용 변경 없이 모두 포함했습니다.

| 유형 | 건수 |
|---|---:|
| 관광지 | 783 |
| 문화시설 | 566 |
| 축제공연행사 | 201 |
| 여행코스 | 51 |
| 레포츠 | 126 |
| 숙박 | 423 |
| 쇼핑 | 4,368 |
| **합계** | **6,518** |

음식점 1,632건은 출처 문서에는 기재되어 있지만 이번 대화에 JSON 파일이 제공되지 않아 포함하지 않았습니다.

## 구현 기능

- 전체 6,518건 통합 검색
- 장소명·주소·우편번호·전화번호·분류코드 등 모든 원본 필드 검색
- 유형·자치구·데이터 보유 조건 필터
- 가나다순·등록일·수정일·유형순 정렬
- 페이지네이션
- 카드형 이미지 결과
- 상세 화면에서 TourAPI 원본 필드 25개 전부 표시
- OpenStreetMap 지도와 장소 마커
- 기상청 초단기실황 + 초단기예보
- 찜한 장소 브라우저 저장
- 보통 글씨 / 큰 글씨 전환
- 노년 사용자도 편한 큰 입력창, 최소 44px 버튼, 높은 명도 대비, 키보드 포커스
- 모바일 반응형
- 데이터 출처와 라이선스 표기

## 날씨 API 구조

브라우저가 기상청 API를 직접 호출하지 않습니다.

`Vue 3 화면 → LocalHub Python 백엔드 → 기상청 API`

이 구조를 사용하기 때문에 브라우저 CORS, CSP, HTTP 혼합 콘텐츠, 인증키 노출 문제를 피합니다.

실제 호출 기능:

- `getUltraSrtNcst`: 현재 기온·습도·강수·풍속·풍향
- `getUltraSrtFcst`: 가까운 시간대 예보

기상청 호출이 실패하면 임의의 시연용 날씨를 만들지 않고 실제 오류 원인을 화면에 표시합니다.

### 인증키 변경

`backend/open-weather-key.cmd`를 실행하여 `backend/.env`를 수정합니다.

```env
KMA_SERVICE_KEY=발급받은_일반인증키
```

현재 전달본에는 사용자가 제공한 키가 로컬 `.env`에만 저장되어 있습니다. 프론트엔드 코드에는 들어 있지 않습니다. `.env`는 `.gitignore`에 포함되어 있습니다.

**인증키가 채팅에 노출되었으므로 발표가 끝난 뒤 공공데이터포털에서 재발급하는 것을 권장합니다.**

## 지도 선택

키 없이 빠르게 실행할 수 있도록 Leaflet + OpenStreetMap을 사용했습니다.

- 지도 표시: Leaflet 1.9.4
- 배경 지도: OpenStreetMap 표준 타일
- 지도 하단에 OpenStreetMap 출처를 표시
- 한 번에 최대 300개 마커만 표시하여 부모님이 사용하는 PC와 모바일에서도 성능을 유지

카카오·네이버·VWorld 지도는 각각 별도의 앱 키 또는 도메인 등록이 필요하기 때문에 이번 즉시 실행본에는 사용하지 않았습니다.

## 수정할 주요 파일

```text
frontend/index.html     시작 화면
frontend/loader.js      Vue 3 / Leaflet 로더
frontend/app.js         화면 기능 전체
frontend/styles.css     디자인 전체
backend/server.py       웹 서버와 API
backend/data_store.py   관광 데이터 검색
backend/weather_service.py  기상청 API
data/*.json             TourAPI 원본 데이터
```

프론트 코드를 수정한 뒤 브라우저에서 `Ctrl + F5`만 누르면 반영됩니다. 빌드 과정이 필요 없습니다.

## 문제 해결

### 8000번 포트가 이미 사용 중

`stop-port-8000.cmd`를 실행한 후 `start-localhub.cmd`를 다시 실행합니다.

### 하얀 화면이 아니라 라이브러리 오류 화면이 보임

Vue 3 또는 Leaflet CDN 접속이 차단된 상태입니다. 인터넷 연결을 확인하고 `Ctrl + F5`를 누릅니다. 로더는 jsDelivr 실패 시 unpkg로 자동 재시도합니다.

### 날씨 오류

브라우저에서 다음 주소로 확인합니다.

- `http://127.0.0.1:8000/api/weather/status`
- 장소 상세 화면의 `현재 날씨 확인`

이 버전은 시연용 값으로 숨기지 않고 기상청의 실제 오류 메시지를 표시합니다.

## 검증

`verify-project.cmd`를 실행하면 다음을 검사합니다.

- Python 문법
- 6,518건 데이터 로딩
- 7개 유형 로딩
- 원본 필드 검색 및 상세 표시
- 서울 좌표의 기상청 격자 변환
- 기상청 시간 계산
- 기상청 응답 필드 변환
- JavaScript 문법

## OpenAI 관광 안내 챗봇

기본 설정은 `CHAT_MODE=auto`입니다. OpenAI API 키가 있으면 Responses API를 사용하고, 키가 없거나 API 호출이 실패하면 LocalHub 관광지 원본 기반의 안전 안내로 자동 전환합니다.

화면 오른쪽 아래의 **서울 나들이 도우미**는 노년의 부모님 두 분을 기준으로 이동 부담, 날씨, 휴식과 방문 전 확인사항을 쉬운 존댓말로 안내합니다.

```env
OPENAI_API_KEY=발급받은_API_키
# 선택 사항 (기본값: 비용 효율적인 gpt-5.6-luna)
OPENAI_MODEL=gpt-5.6-luna
CHAT_MODE=auto
```

API 키는 프런트엔드로 전달되지 않으며 로컬에서는 Python 백엔드, 배포에서는 Netlify Functions만 읽습니다. 챗봇은 사용자의 질문과 일치하는 TourAPI 후보를 먼저 선별하고 기상청 실제 날씨를 함께 사용합니다. 운영시간·요금·무장애 시설처럼 데이터에 없는 정보는 임의로 만들지 않도록 제한되어 있습니다.

Netlify에는 `KMA_SERVICE_KEY`, `OPENAI_API_KEY`, 선택적으로 `OPENAI_MODEL`을 환경변수로 설정합니다. `/api/health`에서 `weatherConfigured`와 `openAIConfigured`가 모두 `true`인지 확인하세요.
