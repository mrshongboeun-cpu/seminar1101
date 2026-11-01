# 전면 검수 (세미나 전 필수)

> **왜 있나** — 미니 원서 앱 세미나 때 "내 시스템을 그대로 가져와 미니 버전을 만들었는데
> 계속 오류가 났다". 그 고생을 반복하지 않으려고, **진짜 PostgreSQL + 진짜 브라우저**로
> 전 화면·전 API를 한 번에 돌려보는 검수를 만들어 뒀습니다.

```bash
cd attendance-report
bash scripts/verify/verify.sh
```

마지막 줄이 **`✅ 전면 검수 통과`** 면 됩니다.

---

## 무엇을 검사하나 (5단계)

| 단계 | 무엇을 | 잡는 사고 |
|---|---|---|
| 0 | 깨끗한 DB에 `sql/setup.sql` 실행 | **SQL 문법 오류** · 샘플 데이터 깨짐 |
| 1 | 코드가 쓰는 표·컬럼 ↔ 실제 스키마 대조 | "컬럼이 없어요" 400 에러 |
| 2 | 앱을 **진짜 PostgreSQL** 위에 띄움 | — |
| 3 | 모든 API 액션을 실제 SQL로 실행 (30여 항목) | 쿼리 문법·타입 오류, 권한 오류 |
| 4 | **모든 화면을 브라우저로 열고 조작** | JS 오류, 빈 화면, 깨진 요소 |
| 5 | 단위 점검 + 개인정보 점검 | 로직 회귀, 실키 유출 |

### 실제로 이 검수가 잡은 것
- **`sql/setup.sql` 에 `service_role` 권한 부여가 없었음** — 미니 원서 앱 때 42501
  (permission denied)로 전부 막혔던 바로 그 사고. 세 SQL 파일 모두에 추가함.
- **`import.html` 의 `$` 가 혼자 `getElementById`** 였는데 호출은 전부 `$("#id")` 형태 →
  17곳 전부 `null` → **노션 이관 화면의 자바스크립트가 통째로 죽어 있었음.**
  (화면은 떠서 눈으로는 멀쩡해 보였습니다. 브라우저 검사라서 잡혔습니다.)

---

## 준비물

```bash
# PostgreSQL (한 번만)
apt-get install -y postgresql
# 테스트용 서버 띄우기 (포트 5433)
PGDATA=/tmp/pgtest
rm -rf $PGDATA && mkdir -p $PGDATA && chown postgres:postgres $PGDATA
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -A trust -U postgres"
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o '-p 5433 -k /tmp' -l $PGDATA/log start"

# Node 패키지 (검수용)
npm i pg playwright
```
브라우저 경로가 다르면 `CHROME=/경로/chrome bash scripts/verify/verify.sh`

> ⚠️ 이 폴더는 **검수 전용**입니다. Vercel 배포에는 영향이 없습니다(서버리스가 아니라 스크립트).

---

## 파일

| 파일 | 역할 |
|---|---|
| `verify.sh` | 0~5단계를 순서대로 실행 |
| `pgrest.mjs` | 아주 작은 PostgREST 흉내 — `api/*.js` 의 쿼리를 **실제 SQL**로 번역 |
| `app-server.mjs` | 앱을 진짜 PostgreSQL 위에 띄움 (알림톡·AI 키는 **일부러 없이** — 승인 전 수강생과 같은 상태) |
| `audit-schema.mjs` | 코드가 쓰는 표·컬럼을 실제 스키마와 대조 |
| `e2e-api.mjs` | 모든 API 액션 실행 |
| `browser-check.mjs` | 12개 화면 로드 + 실제 조작 |

## 기능을 추가했다면
클로드에게 이렇게 말하세요:
```
방금 추가한 기능도 scripts/verify/e2e-api.mjs 와 browser-check.mjs 에 점검을 추가해줘.
그리고 scripts/verify/verify.sh 를 돌려서 전부 통과하는지 확인해줘.
```

## 시나리오 검수 (`scenarios/`)

전면 검수는 **되는 길**을 봅니다. 사고는 그 바깥에서 납니다 — 날짜를 잘못 치고,
없는 걸 지우고, 수기 진도를 적어두고, 같은 PIN 을 두 명에게 주고, 남의 링크를 열어보는 자리.
실제로 여기서 **여덟 건**이 나왔습니다 (500 에러 7건 · 수기 진도가 목차로 끌려간 것 1건).

```bash
bash scripts/verify/scenarios/run.sh      # 따로 돌리기 (verify.sh 안에서도 돕니다)
```

| | 무엇을 깨보나 |
|---|---|
| 1 진도규칙 | 첫 수업 · 한 칸 · 하루 2칸 · 목차 끝 · **수기 진도** · 목차 없음 · 교재명 한 글자 차이 · 복습 줄 |
| 2 유닛과제 | 집만/학원만/없음 · 진도 다섯 번 바꾸기 · 같은 진도 네 번 저장 · 체크 보존 · 삭제 |
| 3 권한과비밀값 | 남의 과제·평가서 · 틀린 번호 · 토큰만으로 열기 · 선생님 필터 · 화면 8곳에 키 유출 |
| 4 엉뚱한입력 | 이상한 날짜·id·연월 · 빈 요청 · 따옴표/태그 이름 · 3000자 · PIN 4가지 |
| 5 등록과평가서 | 일괄등록 빠진 칸 · PIN 중복 · 퇴원 학생 · 평가서 두 번 저장 |
| 6~9 전원 | 샘플 12명 × 진도·과제·학생앱·출결·선생님앱·월말평가서·학생카드·실제 화면 |

**자기 DB(`tapp_sc`)와 자기 포트(4332)** 를 씁니다 — 본 검수 데이터를 흐리지 않게.
시나리오마다 DB 를 새로 깝니다. 앞 시나리오가 만든 상태가 뒤에 섞이면
실패가 떠도 그게 버그인지 순서 탓인지 알 수 없습니다 (실제로 겪었습니다).

> 🔎 **검사를 추가할 때**: 응답에서 **칸 이름을 먼저 찍어 보고** 쓰세요.
> 짐작으로 쓰면 틀린 쪽이 느슨할 때 **통과한 것처럼 보입니다** — 그게 제일 위험합니다.
> `lib.mjs` 의 `모양()` 이 그 용도입니다.
