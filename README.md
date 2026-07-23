# Staffing Master — 스태핑 마스터 대시보드

멋쟁이사자처럼 글로벌신사업본부 스태핑 비즈니스의 **경영 요약 대시보드**.
흩어져 있는 시스템(ktc-support, salarymap/FYI, 구글 시트)을 한 화면으로 모은다.

> 구조: **공급(인재) → 매칭 → 성과** — 각 숫자는 화면 하단 "용어 사전"의 정의를 따른다.
> 수요(기업 영업 파이프라인) 블록은 담당 밖이라 v1 에서 제외.

## 화면 구성 (단일 페이지)

| 섹션 | 내용 | 소스 |
|---|---|---|
| 개요 | 입사(North Star)·재직·매출·채용단가·인재풀·오픈 공고 | 종합 |
| 매칭 퍼널 | 지원자 → 스크리닝 합격 → 기업 전달 → 면접 → 오퍼 → 입사 (+ 현재 단계별 진행 인원) | ktc-support DB (라이브) |
| 인재 유입 채널 | 채널별 지원자/지원 건/스크리닝/면접/입사/지출/CPA/채용당 비용 | ktc-support DB + salarymap DB + 비용 시트 |
| 공고 현황 | 공고별 파이프라인 + TO 대비 충원율 | Master 시트 JD EXECUTION + ktc-support DB |
| 기업별 성과 | 기업별 입사·재직·매출·이익 | KTC Ops 시트 (Employee·매출현황) |

집계 로직은 salarymap `pages/api/admin/ktc-jd-funnel.js` 를 이식했고, 스크리닝 합격
판정을 현행 파이프라인 상태값(`ready_to_forward`/`sent_to_company`/`interviewing`/`offer`)
까지 포함하도록 보정했다. 모든 소스는 **read-only** 로만 읽는다.

## 실행

```bash
npm install
cp .env.example .env.local   # 값은 salarymap/.env.local 에서 복사 (주석에 변수명 매핑 있음)
npm run dev
```

환경변수가 없으면 **데모 데이터**로 렌더된다 (상단에 배너 표시). 실데이터 전환에 필요한 값:

- `SALARYMAP_SUPABASE_URL` / `SALARYMAP_SUPABASE_SERVICE_ROLE_KEY` — salarymap 의 `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `KTC_SUPABASE_URL` / `KTC_SUPABASE_SERVICE_ROLE_KEY` — salarymap 의 동일 변수
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` — salarymap 의 동일 변수
- `DASHBOARD_PASSWORD` — 대시보드 잠금 (배포 시 필수; 미설정이면 잠금 없음)

## 배포 (Vercel)

1. GitHub 푸시 후 Vercel 에서 import
2. 위 환경변수를 Vercel 프로젝트에 등록 (`GOOGLE_PRIVATE_KEY` 는 `\n` 이스케이프 그대로)
3. `DASHBOARD_PASSWORD` 설정 후 대표님께 URL + 비밀번호 공유

## 데이터 신선도

- 페이지 접속 시 서버가 모든 소스를 라이브로 읽고 **30분간 캐시** — 헤더의 "새로고침"으로 즉시 갱신
- 단, `ktc_applications`(지원 건)는 salarymap 의 동기화 산출물이라 그쪽 sync 주기에 의존
- 시트 구조(탭 이름·헤더)가 바뀌면 해당 지표만 빠지고 상단에 경고 배너로 표시된다
