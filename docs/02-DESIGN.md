# 라이트너 문장 암기장 앱 — 설계 (DESIGN)

> **이 문서 = 어떻게** (구현 레퍼런스). 개발 중 갱신되는 살아있는 문서.
> 제품 결정 근거 → `01-PRD.md` · 화면 스펙 → `03-UXUI.md`
> 학습 단위 = **문장 카드**(한글 제시 → 영어 생산).

---

## 1. 라이트너 알고리즘

### 1.1 카드 상태값

```
box            : 0 = 신규(기한 없음, §1.3b) · 1~6 = 복습 칸, 7 = 졸업(마스터)
nextReviewDate : 다음에 큐에 등장할 날짜
lastReviewedAt : 마지막 학습일
correctStreak  : 연속 정답 수
lapseCount     : 누적 오답 수 (취약 판정용)
introducedAt   : 처음 학습 시작한 날
```

핵심 두 값: `box`(얼마나 잘 아는가) + `nextReviewDate`(언제 다시 볼까).

### 1.2 박스 구조와 복습 주기

망각곡선에 맞춘 2배 증가(기하급수) 방식. 상수 배열로 분리해 교체 가능.

```
intervals = [1, 2, 4, 8, 16, 32]   // 일 단위
```

| 박스 | 주기 | 성격 |
|---|---|---|
| 0 | 없음(항상 due) | 신규 도입 직후, 아직 한 번도 채점 안 됨(§1.3b) |
| 1 | 1일 | 신규 / 방금 틀린 문장 |
| 2 | 2일 | 익숙해지는 중 |
| 3 | 4일 | 꽤 앎 |
| 4 | 8일 | 거의 외움 |
| 5 | 16일 | 장기기억 진입 |
| 6 | 32일 | 안정화 |
| 졸업(7) | — | 마스터. 평소 큐 제외 |

> 마감 촉박 시 4칸 "속성 모드" `[1,2,4,8]`로 교체.

### 1.3 정답/오답 처리

기본값은 **완화(soft)**, 순수 리셋은 토글.

```pseudo
onAnswer(card, correct):
    if correct:
        card.box = min(card.box + 1, 7)
        card.correctStreak += 1
    else:
        card.box = 1                       # 순수 리셋 모드
        # (완화 모드: card.box = max(1, card.box - 2))
        card.correctStreak = 0
        card.lapseCount += 1

    if card.box == 7:
        card.nextReviewDate = null         # 졸업 → 큐 제외
    else:
        card.nextReviewDate = today + intervals[card.box - 1]
    card.lastReviewedAt = today
```

**`correct` 판정 (생산 + 힌트 사다리):**
```
correct = (사용된 힌트레벨 ≤ 1) AND (사용자가 [알았어] 선택)
힌트레벨 ≥ 2 → correct = false 강제  ([알았어] 버튼 비활성)
```
힌트 사다리 상세(레벨 0~3)와 화면 집행은 UXUI §3.3.

**완화 옵션:** 오답 시 `box = max(1, box-2)` — 기본값. 순수 리셋(`box=1`, 책 원본)은 설정 토글.

**취약(leech):** `lapseCount >= 5` → "취약" 태그 → 집중 세션 대상.

### 1.3a 텍스트 정답 입력 & 채점

자기채점([몰랐어]/[알았어]) 버튼은 그대로 두고, **텍스트로 영어 정답을 직접 입력**하는 옵션을 병행 제공한다. 관사(a/an/the)·대소문자·구두점 같은 사소한 차이는 오답으로 치지 않는다.

```pseudo
ARTICLES = {"a", "an", "the"}

normalizeAnswerTokens(text):
    tokens = lowercase(text)
        .replace(모든 구두점, " ")
        .split(공백)
    return tokens.filter(t -> t not in ARTICLES and t != "")

matchesAnswer(userText, answerEn):
    return normalizeAnswerTokens(userText) == normalizeAnswerTokens(answerEn)   # 토큰 시퀀스 정확 일치
```

> 편집거리(Levenshtein) 등 모호한 유사도 임계값은 쓰지 않는다 — "관사 정도의 사소한 차이"만 봐주는 결정적 규칙을 유지해 실제 오답을 정답으로 오판하지 않게 한다.

**기존 채점 로직과의 합성 — `isCorrect`는 변경하지 않는다:**
```pseudo
typedCorrect = userText가 있으면 matchesAnswer(userText, card.answerEn), 없으면 userClaimedKnew
correct = isCorrect(hintLevel, typedCorrect, settings)
```
즉 텍스트가 정답과 정확히 일치해도, 힌트레벨 ≥ 2를 사용했다면 §1.3 규칙대로 `correct = false`가 그대로 강제된다.

**오답 시 설명:** LLM 호출 없이 **규칙 기반 word-diff**로 생성한다 — 사용자가 입력한 문장과 `answerEn`을 단어 단위로 비교해 다른 부분을 표시하고, 카드의 기존 `chunkNote`(청크·문법 메모)를 함께 노출한다. 추가 비용·API 키 관리가 필요 없다.

### 1.3b 박스0 — 신규 카드 초기 도입

저수지(NewPool)에서 카드를 승격시킬 때 곧바로 박스1로 만들면, 한 번도 안 본 문장이 "복습 기한"(nextReviewDate)에 걸려 그날 못 보면 다음날까지 못 보는 문제가 생긴다. 그래서 신규 카드는 **박스0**으로 도입한다.

- **화면은 그대로**: 박스0 카드도 기존 제시→힌트→정답확인→자기채점(§1.3) 화면을 똑같이 쓴다. 별도 학습 전용 화면 없음.
- **복습 기한 없음**: `buildTodayQueue`의 due 필터(`box < 7 && nextReviewDate <= today`)는 손대지 않는다 — 박스0 카드는 도입 시 `nextReviewDate = 오늘`로 잡히고, 그날 못 보면 "지난 날짜는 계속 due"이므로 자연히 다음에 열 때도 계속 큐에 남는다. 예외 처리 불필요.
- **채점 결과와 무관하게 박스1로 착지**: `onAnswer`도 수정하지 않는다. 기존 박스 계산식을 박스0에 그대로 적용하면 이미 원하는 동작이 나온다.
  ```pseudo
  onAnswer(card{box:0}, correct=true):  box = min(0+1, 7) = 1
  onAnswer(card{box:0}, correct=false): box = max(1, 0-2) = 1
  ```
  즉 [몰랐어]/[알았어] 어느 쪽을 눌러도 결과는 항상 박스1 — "일단 한 번 보면 정식 라이트너 사이클(§1.3)에 진입한다"는 규칙을 함수 수정 없이 만족한다.
- 구현: `introduceFromPool`이 `box: 1` 대신 `box: 0`(=`NEW_CARD_BOX`)을 반환하도록만 바꾸면 된다.

### 1.4 "오늘의 복습 큐" 생성

```pseudo
buildTodayQueue():
    due = cards where nextReviewDate <= today AND box < 7
    정렬: (1) box 오름차순           # 낮은 박스(급한 것) 먼저 ← 라이트너 원조 우선순위
          (2) nextReviewDate 오름차순  # 오래 밀린 것 먼저
    # 세션당 분량 상한은 없다 — 오늘 기한이 된 복습은 전부 큐에 넣는다.

    여력 = dailyGoal - due.size
    newCards = pullFromNewPool(min(여력, newCap))   # §3 신규 저수지에서
    return due + newCards
```

- **복습 > 신규 우선** (밀린 복습 폭발 방지).
- **낮은 박스 우선** — "칸이 여러 개 찼을 때 뭐부터?"의 답. 낮은 칸일수록 잊기 직전 + 비워야 위로 흐름.
- **세션당 상한 없음** — 오늘 due는 전부 큐에 담고, 사용자가 원하는 만큼 풀다 닫으면 남은 건 다음에 다시 잡힌다. `dailyGoal`은 완료 표시·진척도의 기준이자 신규 유입 억제 기준일 뿐, 복습 개수를 자르지 않는다. (구 `reviewCap` 파라미터 폐기.)

### 1.5 신규 도입 · 밀린 카드 · 파라미터

**확정 기본값(문장 기준):** `dailyGoal = 30`, `newCap = 8`, `maxActiveCards = 150`
> 문장은 단어보다 카드당 노력이 크므로 단어 시절(50/80/15)에서 하향 조정.
> 예: 한가한 날 15복습 → 8신규(23) / 보통 25복습 → 5신규(30) / 바쁜 45복습 → 신규 0.

**`maxActiveCards`(WIP 상한) — 신규 유입의 예방적 안전장치:**
`newCap`은 "하루에 몇 개 새로 배울까"만 제한할 뿐, 박스1~6에 떠 있는 **누적 학습 중 카드 총량**은 제한하지 않는다. 오답이 쌓여 정체되면 신규가 계속 유입되면서 밀린 복습이 눈덩이처럼 불어날 수 있음 — 이를 막기 위한 상한.

```pseudo
buildTodayQueue():
    due = cards where nextReviewDate <= today AND box < 7
    정렬: (1) box 오름차순 (2) nextReviewDate 오름차순
    # 세션당 분량 상한 없음 — due 전부 유지

    activeCount = count(cards where box < 7)          # 박스1~6 누적 총량
    여력 = min(dailyGoal - due.size, maxActiveCards - activeCount)
    newCards = pullFromNewPool(max(0, min(여력, newCap)))
    return due + newCards
```

- `activeCount`가 `maxActiveCards`에 도달하면 신규는 자동 0 → 정체 상태에서 더 이상 부하가 커지지 않고, 기존 카드가 졸업(box=7)하며 빠져야 다시 신규가 들어옴.
- 기본값 150은 `dailyGoal=30` 기준 대략 5일치 버퍼 — 실사용 중 정체 빈도 보고 조정.
- **밀린 카드:** 기한 지난 카드는 오래 밀린 것부터 큐 앞쪽에 배치. 한 번에 다 풀 필요는 없고 나눠 앉아 소화하면 된다.
- **세션 내 오답 재시도:** 틀린 카드는 세션 **끝에 1회 재노출**. box/nextReviewDate에는 미반영(즉시 재노출은 너무 쉽고, 재시도 승급은 당일 승급 모순).

### 1.6 시험 대비 특화

**① D-day 주기 압축** — 시험 이후 주기는 무의미 → 클램프.
```pseudo
effectiveInterval = min(intervals[box-1], max(1, daysUntilExam / 2))
```
**② 막판 총복습** — D-3쯤 켜면 졸업 카드까지 전부 훑는 final 큐.
**③ 진척 예측** — "시험까지 박스 5+ 도달 예상 문장 수" 대시보드.

---

## 2. 데이터 구조 (초안)

```
Deck(덱)
  id, name, description, examDate?(D-day), createdAt

Card
  id, deckId(FK), sourceId?(원천 시트 id, dedupe/추적)
  promptKo(한글 제시), answerEn(영어 정답)
  chunkNote(청크·문법 메모), audioUrl?
  box(0=신규/기한없음, 1~6=복습, 7=졸업, §1.3b), nextReviewDate, lastReviewedAt
  correctStreak, lapseCount, introducedAt, tags

NewPool(신규 저수지)  ← §3.1
  id(=원천 시트 id), deckId(FK)
  promptKo, answerEn, chunkNote, level, topic
  status(pending), importedAt

SyncState(동기화 상태)  ← §3.2
  sourceUrl, importedIds[], lastSyncAt, lastSyncResult

ReviewLog(통계/디버깅)
  id, cardId(FK), date, result(correct/wrong), boxBefore, boxAfter, hintLevel
  inputMethod?(grade|text)   ← §1.3a, 자기채점/텍스트 입력 중 무엇으로 채점됐는지(선택, 통계용)

Settings
  intervals[], dailyGoal, newCap, maxActiveCards
  lapseMode(reset|soft), hintFreeLevel(기본 1)
  notifyTime, recoveryEase(on/off)
  contentSourceUrl, autoSyncEnabled, refillThresholdDays(기본 3)
  ttsAutoPlay(on/off)
  preferredAiModel(claude|gemini|gpt, 기본 claude)   ← §6, '선생님한테 질문' 기능에서 사용할 모델
  aiApiKeys{claude?,gemini?,gpt?}   ← §6, 모델별 사용자 API 키(입력 시 서버 공용 키 대신 사용)
```

### 2.1 Supabase 스키마 (동기화 대상) **[확정]**

로컬(Room/IndexedDB)이 원본 캐시, Supabase Postgres는 기기 간 동기화용 미러. 1인 사용자지만 확장성·안전을 위해 모든 테이블에 `user_id`(FK `auth.users.id`) + **RLS(Row Level Security)**를 건다 — "본인 행만 select/insert/update/delete".

```sql
-- decks
decks (
  id uuid pk, user_id uuid fk, name text, description text,
  exam_date date, created_at timestamptz, updated_at timestamptz
)

-- cards  (핵심 동기화 대상: box/nextReviewDate가 자주 바뀜)
cards (
  id uuid pk, user_id uuid fk, deck_id uuid fk, source_id text,
  prompt_ko text, answer_en text, chunk_note text, audio_url text,
  box int, next_review_date date, last_reviewed_at timestamptz,
  correct_streak int, lapse_count int, introduced_at timestamptz,
  tags text[], updated_at timestamptz  -- LWW 충돌 해결 기준(§3.7)
)

-- new_pool  (신규 저수지, id = 원천 시트 id 그대로 사용)
new_pool (
  id text pk, user_id uuid fk, deck_id uuid fk,
  prompt_ko text, answer_en text, chunk_note text, level text, topic text,
  status text default 'pending', imported_at timestamptz
)

-- sync_state  (사용자당 1행)
sync_state (
  user_id uuid pk fk, source_url text, imported_ids text[],
  last_sync_at timestamptz, last_sync_result text
)

-- review_log  (append-only, 통계/복구용 — LWW 충돌 무관)
review_log (
  id uuid pk, user_id uuid fk, card_id uuid fk, date date,
  result text, box_before int, box_after int, hint_level int,
  created_at timestamptz
)

-- settings  (사용자당 1행)
settings (
  user_id uuid pk fk, intervals int[], daily_goal int, review_cap int, new_cap int, max_active_cards int,
  lapse_mode text, hint_free_level int, notify_time time,
  recovery_ease boolean, content_source_url text, auto_sync_enabled boolean,
  refill_threshold_days int, tts_auto_play boolean,
  preferred_ai_model text, ai_api_keys jsonb default '{}',  -- §6 모델별 사용자 API 키
  updated_at timestamptz
)
```

**RLS 정책 (모든 테이블 공통 패턴):**
```sql
alter table cards enable row level security;
create policy "own rows only" on cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- 나머지 테이블도 동일 패턴 반복
```

**설계 근거:**
- `updated_at`을 `cards`·`settings`에 둔 이유 = §3.7 LWW(Last-Write-Wins) 충돌 해결에 그대로 사용.
- `review_log`는 append-only라 충돌 개념이 없음 — 항상 insert만, update/delete 정책 제외 권장.
- `new_pool.id`를 시트 원본 id 그대로 써서 §3.4 dedupe 키와 일치시킴(별도 uuid 불필요).
- `auth.users`는 Supabase Auth가 자동 관리 — 별도 `profiles` 테이블은 지금 불필요(닉네임 등 부가 정보 생기면 그때 추가).

---

## 3. 콘텐츠 동기화 & 보충 파이프라인

### 3.1 두 저장소 모델

"박스1이 비는 것"과 "만들 자료가 떨어지는 것"은 다른 사건.

- **신규 저수지(NewPool)** — 임포트됐지만 아직 학습 시작 전 문장. 박스 배정 대기.
- **박스 1** — 실제 학습 시작한 최하위 칸.

매일 저수지 → `newCap`개 → 박스1. 박스1이 비는 건 정상(승급). 보충이 필요한 건 **저수지 바닥**.

### 3.2 보충 트리거

```
남은 신규 문장 < newCap × refillThresholdDays(기본 3)  →  "자료 보충 필요" 알림
```
소비 속도 기준 적응형.

### 3.3 동기화 방식 = 구글시트 공유 링크 + 서버 프록시(Sheets API) **[확정]**

> **변경 이력:** 원안은 "웹에 게시 > CSV" 고정 URL을 앱이 직접 fetch하는 방식이었으나, 구글이 서버·브라우저 IP의 pub CSV 요청을 안티스크래핑성으로 자주 차단(pubhtml 뷰어 페이지로 응답)해 실사용 불가로 판명. → **평범한 공유/편집 링크**를 받아 **Supabase Edge Function `content-sync-proxy`가 공식 Google Sheets API(v4)로 읽어** CSV 텍스트로 변환해 돌려주는 구조로 교체. "웹에 게시"는 더 이상 쓰지 않는다.

```
[교사/사용자 생성] → 구글 시트에 문장 append
       │  (공유 > 일반 액세스 > "링크가 있는 모든 사용자 = 뷰어" → /d/{ID}/edit 링크 복사)
       ▼
[구글시트 공유 링크] ──(앱 실행 시 / 하루 1회)──▶ [Edge Function: content-sync-proxy]
       │                                              │  Sheets API v4 (GOOGLE_SHEETS_API_KEY)
       │                                              ▼
       │                                        [CSV 텍스트] ──▶ [앱]
       └── 새 id 행만 → NewPool로 흡수 ────────────────────────────┘
                    │
            저수지 → 매일 newCap → 박스1 → 라이트너 순환
                    │
            저수지 < 임계 → 보충 알림
```

- 진실의 원천 = 공유된 시트 1개. **클라이언트는 인증 불필요**(모델을 URL 문자열 하나만 넘김) — 실제 읽기는 Edge Function이 `GOOGLE_SHEETS_API_KEY` 시크릿으로 수행한다.
- 시트는 "링크가 있는 모든 사용자(뷰어)" 공유가 필수(API 키만으로 읽으려면 필요). "웹에 게시" 설정과는 무관.
- 로컬 전용 모드(비로그인, `supabase == null`)에선 프록시를 못 쓰므로 콘텐츠 동기화 불가 — 이 소스는 클라우드 계정 전제.

### 3.4 시트 스키마 (열 고정)

```
id | 한글 문장 | 영어 문장 | 청크·문법 메모 | level | topic | added_at
```
- **`id` = dedupe 키.** 앱은 `SyncState.importedIds`로 이미 가져온 id 기억 → 새 id만 흡수. id 없으면 매번 전체 재임포트.

### 3.5 보충 방식 = Tier 1 · 버퍼 + 알림 **[확정]**

- 큰 버퍼(예: 300문장 ≈ 20일치) 미리 채움 → 저수지 낮아지면 알림 → 사람이 배치 추가 → 다음 동기화 흡수.
- **Tier 2(무인)** = 향후: 클라우드 함수가 저수지 감시 → LLM API로 레벨·취약 패턴 맞춤 생성 → 시트 자동 append. 구조 동일, 생성 주체만 사람→함수(서버·API 비용·키 관리 추가).
- **품질 조건:** 생성 입력에 사용자 레벨 + 취약 문장 데이터 필수(난이도 표류 방지).

### 3.6 최초 설정 & 운영

- **설정(1회):** 시트 생성+헤더 → `공유 > 일반 액세스 > 링크가 있는 모든 사용자(뷰어)` → `/d/{ID}/edit` 링크 복사 → 앱 설정(§Settings `contentSourceUrl` + 대상 덱) 등록 → [지금 동기화].
- **운영:** 평소 무개입 자동 흡수 → 저수지 낮으면 알림 → 배치 추가.

### 3.7 기기 간 동기화(필수)

앱은 단일 사용자 기준으로 **갤럭시 S24와 PC(Windows/macOS 웹브라우저) 어디서나 같은 학습 상태를 공유**해야 한다. 핵심 원칙은 다음과 같다.

```text
[갤럭시 S24 Android 앱] --\
                         > [Supabase (Auth + Postgres + REST)] <-- [PC 웹앱 (Windows/macOS 브라우저)]
```

- **로컬 우선 캐시**: 각 기기에서 오프라인 학습은 즉시 가능.
- **중앙 동기화 서버**: 카드 상태(Box/nextReviewDate), 학습 로그, 설정, 덱 메타데이터는 클라우드에서 관리.
- **콘텐츠 원천은 여전히 구글 시트**: 문장 데이터는 시트 → 앱 동기화 → 로컬 저장. 사용자는 폰/PC 어디서나 같은 문제를 보게 된다.
- **충돌 해결**: 같은 카드에 양쪽에서 동시에 수정한 경우 마지막 작성 시각이 최신인 값으로 우선(LWW). 두 기기가 동시에 오프라인 학습할 확률은 낮아 우선 이 단순 규칙으로 시작하고, 실사용 중 데이터 꼬임이 관찰되면 필드별 병합(예: box는 더 낮은 값 우선 등 보수적 규칙)으로 정교화한다. 리뷰 로그는 append-only로 누적되어 항상 사후 복구 가능.
- **첫 로그인**: Google 계정으로 1회 로그인 후 모든 기기에서 재사용(Supabase Auth의 Google OAuth 사용). 콘텐츠 동기화(§3.3)는 사용자 인증과는 별개 체계 — 클라이언트는 로그인만 돼 있으면 되고(프록시 호출용), 시트 읽기 권한은 서버 시크릿 `GOOGLE_SHEETS_API_KEY` + 시트의 "뷰어" 공유로 해결. "콘텐츠 읽기"와 "내 진행 상태 저장"은 서로 다른 인증 레벨임에 유의.

### 3.8 구현 주의점

- `id` 기준 dedupe.
- Sheets API는 시트 저장 즉시 반영되지만, 흡수 트리거는 앱 시작 시 하루 1회 → 즉시 반영이 필요하면 [지금 동기화] 수동 버튼.
- 오프라인/URL 오류 시 조용히 스킵 후 재시도(로컬 우선).
- 기기 간 동기화는 익명 사용자 대신 **개인 계정 1개**를 기준으로 운영. 같은 계정이면 폰/PC가 같은 덱을 보고 같은 큐를 계산한다.
- 프라이버시: 시트를 "링크가 있는 모든 사용자(뷰어)"로 공유 → 링크 아는 사람은 열람 가능(문장이라 무방, 비공개 필요 시 드라이브 OAuth로 승급).

### 3.9 진행 상태 동기화 트리거 (Supabase push/pull 시점) **[확정]**

§3.3~3.8은 "콘텐츠(시트→앱)" 동기화 트리거였다. 이 절은 "진행 상태(카드 box·설정 등, 앱↔Supabase)" 동기화가 **언제 일어나는가**를 정의한다.

**Pull (서버 → 로컬):**
- 앱 시작/포그라운드 복귀 시 1회.
- 그 외엔 pull 안 함 — 세션 도중 다른 기기가 push해도 실시간 반영은 하지 않는다(동시 사용 시나리오가 드물어 실시간 구독은 과설계로 판단, 필요해지면 Supabase Realtime으로 승급 가능).

**Push (로컬 → 서버):**
- `onAnswer` 등 카드 상태 변경 → **디바운스 배치**: 즉시 쓰지 않고 로컬에 먼저 반영 후, 2~3초 무입력 또는 세션 종료 시점에 변경분을 모아 한 번에 push. (문항마다 즉시 push하면 네트워크 요청이 과도하고, 카드 하나하나의 실시간성은 필요 없음 — "세션 끝나면 딴 기기에 반영"이면 충분.)
- 설정 변경(§Settings) → 저장 즉시 push(빈도 낮아 배치 불필요).
- 덱/카드 CRUD(추가·수정·삭제) → 저장 즉시 push.
- **로그아웃 또는 앱 종료 직전** → 남은 push 큐 강제 flush 시도.

**오프라인 큐잉:**
- push 실패(오프라인/네트워크 에러) 시 로컬에 "미동기화 변경 큐"로 보관, 로컬 값은 그대로 사용 가능(로컬 우선 원칙 유지).
- 재연결 감지(온라인 이벤트) 또는 다음 앱 포그라운드 시 큐 자동 flush 재시도.
- flush 시 §3.7 LWW(`updated_at` 비교) 규칙 그대로 적용.

**수동 동기화:**
- §3.3 콘텐츠용 [지금 동기화] 버튼과 별개로, 설정 화면에 "진행 상태 지금 동기화" 버튼을 둬 pull+flush를 수동으로도 트리거 가능하게 한다(기기 바꾸기 직후 등 즉시 반영이 필요할 때 대비).

---

## 4. 기술 스택 (Android + PC 웹)

- **Android 앱**: Kotlin + Jetpack Compose
- **PC 웹앱**: React + Vite + TypeScript (PWA) — Windows/macOS 브라우저 공통, OS 종속 없음
  - **오프라인 지원 범위 [확정]**: **PC 웹은 오프라인을 고려하지 않는다** — 항상 온라인 사용을 전제로 설계(Service Worker precache, 오프라인 큐잉 등 구현 불필요). IndexedDB는 오프라인 대비가 아니라 단순 로컬 캐시(빠른 재로딩용)로만 쓴다. 오프라인 지원은 Android(Room, 이동 중 사용 전제)에서만 필요 — §3.9의 "오프라인 큐잉"도 Android 기준으로 읽는다.
- **공통 로직**: 학습 스케줄러와 규칙 계산은 공통 모듈로 추출해 폰/PC가 같은 로직 사용
- **로컬 저장**:
  - Android: Room (SQLite)
  - PC 웹: IndexedDB 기반 캐시
- **동기화 계층**: **Supabase [확정]** — Postgres(카드/박스/로그 등 관계형 데이터에 적합) + 내장 Auth(Google OAuth) + 자동 REST API를 한 번에 제공해 별도 백엔드 서버 구축이 불필요. 1인 프로젝트 규모에서 무료 티어로 충분.
- **복습 알림**: Android: WorkManager + Notifications / PC 웹: 브라우저 알림(선택)
- **MVVM / 상태관리**: Android: MVVM / Web: React Query 또는 Zustand + 전역 상태
- 가져오기(MVP): **CSV 전용**(수동 파서 또는 OpenCSV) + 템플릿 제공. `.xlsx`는 Phase 3.
- 동기화: **HTTP GET**(HttpURLConnection/Retrofit/Ktor 택1) → CSV 파싱 → id dedupe → NewPool 적재. 별도로 사용자 진행 상태는 클라우드 DB에 동기화.
- 기본 덱: 공개 라이선스(NGSL/NAWL/AWL) 또는 사용자·교사 생성. 상용 교재 복사 금지.
- 발음: TTS(Phase 2). **Android = OS 내장 TTS 엔진 / PC 웹 = 브라우저 내장 Web Speech API [확정]** — 둘 다 무료·키 불필요·서버 호출 없음. 음질은 Google Cloud TTS 등 유료 API보다 기계적이나 1인 학습 보조용으로 충분, 비용·인프라 부담이 없어 MVP에 적합. Tier 2 무인 생성은 클라우드 함수 + LLM API(향후).

### 4.0 최소 지원 브라우저 **[확정]**

**Chrome 최신 버전만 공식 지원** (PC·모바일 모두 사용자가 Chrome 사용). Safari/Firefox 등은 별도 QA·폴리필 대상 아님 — Web Speech API·IndexedDB 등 브라우저별 편차를 신경 쓸 필요가 없어 개발 범위가 줄어든다. 추후 다른 브라우저 사용자가 생기면 그때 지원 범위를 넓힌다.

### 4.1 플랫폼별 운영 규칙

- **갤럭시 S24**: 이동 중 학습, 짧은 세션, 푸시 알림 중심 사용
- **PC(Windows/macOS 웹브라우저)**: 장시간 학습, 카드 편집, 통계 확인, 자료 정리 중심 사용
- **동일 계정**: 기기별 세션이 별개로 보이지 않고, 복습 큐·상태·통계·설정이 동일하게 보인다.
- **오프라인 동작**: 온라인이 끊긴 상태에서도 각 기기 로컬 데이터로 학습 가능하고, 다시 연결되면 자동 동기화된다.

### 4.2 개발 우선순위

1. Supabase 프로젝트 셋업 + 동기화 프로토콜 설계(Google 로그인 + 카드 상태 sync)
2. Android + Web 공통 데이터 모델 정리
3. 학습 스케줄러 공용 모듈화
4. CSV/시트 문장 흡수 유지
5. PC 웹(Windows/macOS 공통) 브라우저 환경에서 동일 UX 검증

---

## 5. 구현 순서 (권장)

1. 데이터 레이어(Room 엔티티: Deck/Card/NewPool/SyncState/ReviewLog/Settings)
2. **라이트너 스케줄러(§1)를 순수 함수로** — 유닛 테스트 먼저(정답 승급 / 오답 강등 / 힌트 fail / 큐 정렬 / maxActiveCards 상한 도달 시 신규 0 / D-day 클램프)
3. 학습 화면(생산 + 힌트) → 홈 → 덱 관리 → 세션 요약
4. 구글시트 공유 링크 동기화(§3, 서버 프록시 경유) → 보충 알림
5. 통계 → 시험 대비 모드
* 04-PLAN.md 문서 참조 

---

## 6. AI 질문 프록시 ("선생님한테 질문")

학습 중 막히는 카드에 대해 자유 질문을 던지면 AI(Gemini 무료 / Claude 유료 / ChatGPT 유료 중 선택)가 답하는 기능. **1회성 Q&A**(질문 1개 → 답변 1개, 대화 히스토리 저장 없음).

**API 키 = 사용자별 입력 우선, 앱 공용 키 fallback.** 설정 화면에서 `preferredAiModel`을 고르면 그 모델의 API 키 입력란이 나타난다. 입력한 키는 `Settings.aiApiKeys[model]`에 저장돼 계정 단위로 기기 간 동기화되며(settings 테이블 `ai_api_keys` jsonb, RLS로 본인만 접근), 질문 시 프록시 요청 body에 실려 그 키로 상위 API를 호출한다. 키를 비워두면 기존대로 Edge Function 시크릿(`ANTHROPIC_API_KEY` 등)으로 fallback. → 가족 등 다른 사용자에게 앱을 공유해도 각자 자기 키(특히 무료인 Gemini)로 쓰면 앱 소유자에게 API 비용이 전가되지 않는다.

**방식 — 서버 프록시 + 앱 관리 키**, `supabase/functions/content-sync-proxy`와 동일한 패턴의 새 Edge Function을 둔다.

```
[PC 웹 (학습 세션)]
   │  질문 텍스트 + 카드 컨텍스트(promptKo, answerEn, chunkNote)
   ▼
[Supabase Edge Function: ask-teacher-proxy]
   │  Settings.preferredAiModel 값에 따라 분기
   ├─ "claude" → Anthropic Messages API (secret: ANTHROPIC_API_KEY)
   ├─ "gemini" → Gemini generateContent API (secret: GEMINI_API_KEY)
   └─ "gpt" → OpenAI Chat Completions API (secret: OPENAI_API_KEY)
   ▼
{ answer: string }  또는  { error: string } + status code
```

- **요청**: `{ model: "claude" | "gemini" | "gpt", question: string, context: { promptKo, answerEn, chunkNote? }, apiKey?: string }`
- **응답**: 성공 시 `{ answer: string }`, 실패 시 `{ error: string }` + 4xx/5xx (키 미설정 500, 잘못된 `model` 값 400, 상위 API 실패 502 등 — `content-sync-proxy`의 에러 응답 스타일을 따른다).
- **키 관리**: 요청 `apiKey`(사용자가 설정에 입력, `Settings.aiApiKeys[model]`)가 있으면 그 키로 호출. 없으면 Supabase Edge Function 시크릿(`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY`)으로 fallback. 사용자 키는 저장·로그하지 않고 그 요청에서만 상위 API로 넘긴다.
- **범위 제한**: 대화 히스토리는 저장하지 않는다. 매 질문은 현재 카드 컨텍스트를 새로 포함한 독립 요청이며, 멀티턴 채팅 UI는 두지 않는다(§PRD 비목표).
- **오류 시 사용자 경험**: 키 미설정/네트워크 실패 시 학습 흐름 자체를 막지 않고, 질문 패널 안에서만 에러 메시지를 보여준다(§UXUI §4).
