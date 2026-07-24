# 스태핑 마스터 대시보드

> 글로벌신사업본부 스태핑 비즈니스 통합 현황 대시보드
> 최초 배포: 2026-07-23 · 담당: 위승주

## 1. 배경 및 목적

- KTC 채용 파이프라인(ktc-support), 자체 플랫폼 FYI(salary-fyi.com), 공고·입사·비용 구글 시트 등 데이터가 시스템별로 분산되어 전체 사업 현황 파악이 어려웠음
- 대표 보고 및 스쿼드 운영에 공통으로 사용할 단일 화면 필요
- 시스템별로 다르던 지표 용어와 집계 기준을 통일하는 것을 함께 목표로 함

## 2. 접속 정보

- URL: https://staffing-master.vercel.app
- 비밀번호: `lion-19cd1920` (변경 시 Vercel 환경변수 `DASHBOARD_PASSWORD` 수정 후 재배포)
- 권한: 본부 구성원 공용 (열람 전용, 데이터 수정 기능 없음)

## 3. 화면 구성

| 탭 | 내용 |
| --- | --- |
| 개요 | 성과 요약(입사·재직·매출·채용당 비용) / 트랙×스쿼드 매트릭스 / 지원→입사 퍼널 |
| 한국 매칭 | 단계별 진행 인원, 공고별 파이프라인·충원율, 기업별 입사·재직·매출 |
| 베트남 매칭 | FYI 자체 공고 기반 베트남 로컬 매칭 (공고·기업·지원·기업 열람) |
| 인재·채널 | FYI 인재풀, 유입 채널별 성과·비용(CPA·채용당 비용), 월별 지원 추이 |
| 용어 | 전 지표의 정의 사전 |

- 개요의 매트릭스는 사업 구조도 그대로: **[한국기업(KTC 경유) / 베트남 로컬(FYI 직접)] × [유입(기업 확보) / 인재(지원 모집) / 매칭(채용 성사)]**
- 상단 기간 필터: 누적 / 이번 달 / 최근 30일 (지원일 코호트 기준)

## 4. 데이터 소스 및 갱신

| 데이터 | 소스 | 방식 |
| --- | --- | --- |
| 채용 파이프라인 (지원~입사 상태) | ktc-support DB | 실시간 조회 |
| 지원 건 원본 | salarymap DB (ktc_applications) | salarymap 동기화 산출물 |
| FYI 인재풀·베트남 매칭 | salarymap DB | 실시간 조회 |
| 공고 원장·면접 | Master 시트 (JD EXECUTION / INTERVIEW) | 실시간 조회 |
| 입사·재직·매출 | KTC Ops 시트 (Employee / 매출현황) | 실시간 조회 |
| 채널별 지출 | 비용 시트 (통합 비교표·invoice·캠페인별) | 실시간 조회 |

- 접속 시 원본을 읽어 30분간 캐시, 우상단 "새로고침"으로 즉시 갱신
- 모든 소스는 읽기 전용으로만 접근 (대시보드가 원본 데이터를 변경하지 않음)
- 시트 구조(탭명·헤더) 변경 시 해당 지표만 제외되고 상단에 경고 배너 표시

## 5. 집계 기준 (핵심 원칙)

- **입사** = 파이프라인을 거쳐 최종 입사한 인원만 집계. 별도 경로 입사(파이프라인 미귀속 22명)는 전 화면에서 제외하며, 기업별 성과 하단에 제외 인원만 표기
- **지원자**(고유 인재 1명, 최초 유입 채널 귀속)와 **지원 건**(공고×인재 1건)을 구분
- 재직·이탈·매출·이익 역시 파이프라인 경유 입사자 기준
- 기간 필터는 지원일 코호트 기준(해당 기간 지원자의 현재 도달 단계). 스톡 지표(입사 누적·재직·매출·인재풀·오픈 공고)와 비용은 항상 누적
- 채널 비용 지표: CPA = 지출 ÷ 지원자, 채용당 비용 = 지출 ÷ 입사. 비용 시트에 시간 축이 없어 기간 보기에서는 비용 열 미표시
- 세부 정의는 대시보드 "용어" 탭 참조

## 6. 데이터 정합성 검증 (2026-07-23)

- 대시보드 집계와 별개 경로로 원본을 재집계하여 29개 항목 대조 → **전 항목 일치**
- 검증 범위: 퍼널 6단계, 채널 합계 일관성, 지원 건, 진행 단계별 인원, 공고 수·TO, 재직·매출, 인재풀, 베트남 전 지표
- 재검증: 로그인 상태에서 `/api/verify` 접속 시 JSON 대조표 반환

### 검증 중 발견된 운영 데이터 이슈 — 2026-07-24 전건 조치 완료

- 이슈 1 (Employee 탭): Châu Đức Mạnh 기입 확인(13행, 이메일 없이 기입) · Võ Huỳnh Duy Thắng 은 지원/온보딩 이메일 2개 병용으로 확인 → 대시보드 귀속 로직에 **이름 매칭 폴백** 추가로 대응 (이메일이 달라도 파이프라인 입사자로 정상 귀속)
- 이슈 2 (구 상태값): Designbook·Camon Social·Man Man Market 지원자 20명 전원 현행 상태(Screening Passed)로 정리 완료 → 잔존 0명
- 이슈 3 (매출현황): 미기입 15명은 누락이 아니라 **매출이 발생하지 않아 기입하지 않는 운영 방침**으로 확인. Trịnh Ngọc Mai 표기 통일 완료
- 조치 반영 후 재검증: 29개 항목 전 항목 일치 (재직 19명 · 귀속 입사자 24명 · 매출 $5,721 로 갱신)

이하는 최초 점검(2026-07-23) 당시 기록:

**이슈 1 — 입사자 기입 누락·불일치 (KTC Ops 시트 › Employee 탭)**

| 인원 | 이메일 | 기업 / 공고 | 상태 | 필요 조치 |
| --- | --- | --- | --- | --- |
| Châu Đức Mạnh | cdmanh1108@gmail.com | Nexacode / NX501 | Employee 탭에 행 없음 (매출현황 탭에는 있음) | Employee 탭에 행 추가 |
| Võ Huỳnh Duy Thắng | wjncm1993@gmail.com | MNF Solution / MNF1201 | Employee 탭 이메일이 파이프라인 기록과 다름 | 이메일 통일 |

**이슈 2 — 구 상태값 잔존 20명 (ktc-support › pipeline_status = ai_interview_passed)**

- 폐지된 AI 인터뷰 플로우에서 멈춘 인원. 디자인교과서 DB2401/2402 (9명) · Camon Social CS2202/2203 (5명) · Man Man Market MA3201 (3명) 등에 집중. 채널: ITviec 7 · FYI 5 · 랜딩 5 · Glints 2 · 기타 1
- 명단: Việt Hoàng Nguyễn, Phạm Tuấn Khoa, Hoà Lê, Trần Lệ Minh, Nghĩa Vũ, Trần Văn Long, Việt Hải Nguyễn, Linh Nguyễn, Đỗ Tuyết Anh, Nguyễn Huy Chương, Vũ Trần Đăng Khánh Hằng, Phùng Xuân Nam, Khanh Hoang, Văn Thắng Nguyễn, La Xuan Loc, Trần Việt Hòa, My Doan, Dao Thi My Tam (Riley), Dang Tran Hieu, Phan Anh Hiếu
- 조치: ktc-support 관리자 화면에서 현행 상태(불합격/마감 등)로 일괄 정리

**이슈 3 — 매출현황 미기입 (KTC Ops 시트 › 매출현황 탭)**

- 귀속 입사자 22명 중 기입 7명 / 미기입 15명 (기입 7명 합계 = 현재 대시보드 매출 $4,754)
- 미기입 15명: twinpluspartners 9명 전원(Đặng Hồng Nguyên, Võ Hùng Cường, Nguyễn Trung Nguyên, Nguyễn Thị Mỹ Nhi, Nguyễn Thị Lan, Hoàng Lê Nguyên Khang, Võ Thị Tuyết Ngân, Võ Thị Ngọc Hạnh, Trần Minh Tuấn) · Hello Science Edu 2명(Đào Trung Kiên, Phạm Bảo Phúc An) · Yellow Dr. 2명(Trần Lý Ngọc Nghi, Nguyễn Nhựt Quỳnh) · Metainnotech 1명(Đào Thị Hải Yến) · Wellpod 1명(Nguyen Thi Nhu Y)
- 추가: 매출현황 탭의 Trịnh Ngọc Mai 행이 Employee 탭과 이름 매칭 안 됨 (표기 확인 필요)
- 조치 확인 방법: 시트 정리 후 `/api/verify` 접속 시 details 목록이 비면 완료

## 7. 운영 정보

- 저장소: GitHub SeungjuWI/Staffing-Master (main 푸시 시 Vercel 자동 배포)
- 호스팅: Vercel, vn-newbiz 팀 / 프로젝트 staffing-master
- 환경변수: salarymap·ktc-support DB 키, 구글 서비스 계정, 대시보드 비밀번호 (Vercel 프로젝트 설정에서 관리)
- 지원 건 수치는 salarymap의 KTC 동기화 실행 주기에 의존 (그 외 지표는 항상 실시간)

## 8. 향후 과제

- 베트남 매칭 채용 단계 연동: FYI 지원 상태값 운영 도입 시 한국 매칭과 동일한 퍼널(스크리닝→전달→면접→오퍼→입사)로 확장
- 유입(기업 영업) 파이프라인 데이터 연결: 유입 스쿼드의 BD 단계(리드→미팅→계약) 데이터가 생기면 매트릭스 유입 열 확장
- 일일 스냅샷 저장을 통한 추세 비교 (주간·월간 변화량)
