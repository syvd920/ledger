# 건축물대장 내부 조회기
GitHub Pages(화면) + Cloudflare Worker(API 키 보호) + 국토교통부 건축HUB 건축물대장정보 서비스

## 제공 기능
- 아파트 / 빌라 / 오피스텔 / 상가 / 일반 건축물 조회
- 법정동+지번 주소 자동 분석
- 시군구코드/법정동코드/본번/부번 직접 조회
- 표제부: 건물명, 주용도, 구조, 층수, 면적, 건폐율, 용적률, 주차, 사용승인일 등
- 층별개요: 층, 용도, 구조, 면적
- 집합건물: 동/호, 층, 전유면적, 공용면적, 공급면적, 계약면적
- ㎡ → 평 자동 환산
- 표 검색 및 CSV 다운로드
- 공공데이터 API 키는 Cloudflare Worker Secret에만 저장

## 1. 공공데이터포털 API 신청
공공데이터포털(data.go.kr)에서
`국토교통부_건축HUB_건축물대장정보 서비스`(데이터셋 15134735)를 찾아 활용신청 후 일반 인증키를 발급받습니다.

이 앱에서 사용하는 주요 endpoint:
- /1613000/BldRgstHubService/getBrRecapTitleInfo
- /1613000/BldRgstHubService/getBrTitleInfo
- /1613000/BldRgstHubService/getBrFlrOulnInfo
- /1613000/BldRgstHubService/getBrExposInfo
- /1613000/BldRgstHubService/getBrExposPubuseAreaInfo

주소의 법정동코드 자동 확인:
- /1741000/StanReginCd/getStanReginCdList

## 2. Cloudflare Worker 배포
Node.js가 설치된 PC/Mac에서 worker 폴더로 이동:

```bash
cd worker
npm install -g wrangler
wrangler login
wrangler secret put DATA_GO_KR_SERVICE_KEY
```

프롬프트가 나오면 공공데이터포털에서 발급받은 **일반 인증키(Decoding)** 를 붙여 넣습니다.

그다음:
```bash
wrangler deploy
```

완료되면 다음과 비슷한 주소가 나옵니다.
`https://building-ledger-proxy.계정명.workers.dev`

### API 키가 안 먹는 경우
공공데이터포털은 화면에 Encoding/Decoding 키를 둘 다 보여주는 경우가 있습니다.
이 Worker는 URLSearchParams가 값을 인코딩하므로 우선 **Decoding(원문) 인증키**를 Secret에 넣으세요.

## 3. GitHub Pages 연결
루트의 `config.js` 열기:

```js
window.BUILDING_LEDGER_CONFIG = {
  WORKER_URL: "https://building-ledger-proxy.계정명.workers.dev"
};
```

YOUR-WORKER 주소를 방금 받은 Worker URL로 교체합니다.

그 후 GitHub 저장소에 아래 4개 파일을 올립니다.
- index.html
- styles.css
- app.js
- config.js

GitHub 저장소 → Settings → Pages → Deploy from a branch → main / root → Save

## 4. Worker 접근을 GitHub 주소로만 제한(권장)
`worker/src/index.js` 상단:

```js
const ALLOWED_ORIGINS = [
  "https://깃허브아이디.github.io"
];
```

저장 후 다시:
```bash
wrangler deploy
```

주의: Origin 제한은 브라우저에서 다른 사이트의 호출을 차단하는 CORS 장치입니다.
Worker URL 자체를 완전한 사설망처럼 만드는 인증 기능은 아닙니다.
내부 사용자 로그인까지 필요하면 Cloudflare Access를 추가하는 것을 권장합니다.

## 5. 사용 방법
### 주소 조회
`서울특별시 강남구 역삼동 123-4`
처럼 **법정동명 + 지번**으로 입력합니다.

현재 버전은 추가 지도/주소 API 키를 만들지 않기 위해 도로명주소 → 지번 변환 기능은 넣지 않았습니다.
도로명주소만 아는 경우 건축물대장/지도에서 지번을 확인하거나 코드 직접 조회를 사용하세요.

### 코드 조회
- 시군구코드: 5자리
- 법정동코드: 5자리
- 본번/부번
- 대지/산 선택

## 호별 면적에 대한 중요 설명
건축HUB의 `전유공용면적` 자료를 기준으로 계산합니다.
- 전유면적 = 전유 행 합계
- 주거공용 = 복도/계단/승강기 등 일반 공용부로 판단되는 행
- 기타공용 = 주차/기계/전기/관리/경비 등으로 판단되는 행
- 공급면적 = 전유 + 주거공용
- 계약면적 = 공급 + 기타공용

건축물대장의 용도 문자열과 자료 상태에 따라 공용면적 분류가 실제 분양계약서의 면적 구분과 다를 수 있습니다.
공식 확인이 필요한 업무에서는 건축물대장 원문 및 계약서와 대조하세요.

## 보안
`DATA_GO_KR_SERVICE_KEY`는 GitHub 파일 어디에도 적지 않습니다.
Cloudflare Worker Secret에만 저장합니다.

절대 하지 말 것:
```js
const serviceKey = "실제API키";
```

## 오류 확인
- `Worker 연결 안 됨`: config.js Worker 주소 확인
- `API 키 미설정`: wrangler secret put 명령 재실행
- `JSON이 아닌 응답`: 인증키 종류 또는 활용승인 상태 확인
- 주소 법정동코드를 찾지 못함: 코드로 조회 사용
- 호별 정보 없음: 일반 건축물이거나 해당 건축물대장에 전유부가 없는 경우
