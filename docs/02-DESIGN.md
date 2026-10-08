# 라이트너 문장 암기장 앱 — 설계 (DESIGN)

> **이 문서 = 어떻게** (구현 레퍼런스). 개발 중 갱신되는 살아있는 문서.
> 제품 결정 근거 → `01-PRD.md` · 화면 스펙 → `03-UXUI.md`
> 학습 단위 = **문장 카드**(한글 제시 → 영어 생산).
> 공통 pool·서버 기준 저장 설계 갱신: 2026-10-08.

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
- **도입 시 즉시 학습 가능**: 박스0 카드는 `nextReviewDate = 오늘`로 생성한다. 큐에서는 박스1~6 복습(due)과 분리한 `leftoverNew`에 넣어 복습 뒤에 배치한다. 그날 못 채점하면 다음날에도 잔류 신규로 남는다.
- **채점 결과와 무관하게 박스1로 착지**: `onAnswer`도 수정하지 않는다. 기존 박스 계산식을 박스0에 그대로 적용하면 이미 원하는 동작이 나온다.
  ```pseudo
  onAnswer(card{box:0}, correct=true):  box = min(0+1, 7) = 1
  onAnswer(card{box:0}, correct=false): box = max(1, 0-2) = 1
  ```
  즉 [몰랐어]/[알았어] 어느 쪽을 눌러도 결과는 항상 박스1 — "일단 한 번 보면 정식 라이트너 사이클(§1.3)에 진입한다"는 규칙을 함수 수정 없이 만족한다.
- 구현: `introduceFromPool`은 `box: 0`(=`NEW_CARD_BOX`)을 만들고, 로그인 상태에서는 `introduce_shared_card` RPC로 pool 소비와 카드 생성을 함께 확정한다(§3.9).

### 1.4 "오늘의 복습 큐" 생성

```pseudo
buildTodayQueue(cards, pool, settings, today):
    isDue = nextReviewDate != null AND nextReviewDate <= today
    due = cards where 1 <= box < 7 AND isDue
    정렬: box → nextReviewDate → id (모두 오름차순)
    leftoverNew = cards where box == 0 AND isDue
    정렬: introducedAt → id (오름차순)
    reviewedToday = count(cards where lastReviewedAt 앞 10자리 == today)
    newFromPool = §1.5의 부하·누적량·하루 신규 한도로 선택
    return due + leftoverNew + newFromPool
```

- 복습 → 미채점 신규 → pool 신규 순서. 오늘 due 복습에는 개수 상한을 적용하지 않는다(`reviewCap` 폐기).
- 날짜/id가 같은 우선순위를 해소하는 정렬 키를 양 플랫폼에 적용한다. pool은 `importedAt → id` 순서이며 id는 로케일에 의존하지 않는 문자열 순서로 비교한다.
- **오늘 목표** = 큐 길이 + `reviewedToday`. 별도 서버 목표 행이나 기기별 `dayGoal` 스냅샷은 쓰지 않는다. 동일 계정·날짜·서버 데이터·설정으로 계산하면 같은 목표가 나온다. 카드 추가/삭제·설정 변경 시 목표가 달라질 수 있다.
- 홈의 `남은 신규 · 박스1 …` 내역은 **남은 큐**의 구성이다. 완료 수는 오늘 마지막 채점을 한 카드 수이며, 승급/강등/유지/신규는 오늘 review_log 이벤트 수다. 같은 카드를 여러 번 채점하면 로그 합계와 완료 카드 수는 다를 수 있다.
- 날짜 비교는 현재 구현의 `YYYY-MM-DD`/타임스탬프 앞 10자리 기준이다. 별도의 사용자 시간대·자정 전환 정책은 이번 변경 범위에 포함하지 않는다.

### 1.5 신규 도입 · 밀린 카드 · 파라미터

**확정 기본값(문장 기준):** `dailyGoal = 30`, `newCap = 8`, `maxActiveCards = 150`
> 문장은 단어보다 카드당 노력이 크므로 단어 시절(50/80/15)에서 하향 조정.
> 예: 한가한 날 15복습 → 8신규(23) / 보통 25복습 → 5신규(30) / 바쁜 45복습 → 신규 0.

**`maxActiveCards`(WIP 상한) — 신규 유입의 예방적 안전장치:**
`newCap`은 "하루에 몇 개 새로 배울까"만 제한할 뿐, 박스1~6에 떠 있는 **누적 학습 중 카드 총량**은 제한하지 않는다. 오답이 쌓여 정체되면 신규가 계속 유입되면서 밀린 복습이 눈덩이처럼 불어날 수 있음 — 이를 막기 위한 상한.

```pseudo
reviewedToday = count(cards where lastReviewedAt 앞 10자리 == today)
activeCount = count(cards where box < 7)
capacity = max(0, dailyGoal - reviewedToday - due.size - leftoverNew.size)
room = max(0, maxActiveCards - activeCount)
introducedToday = count(cards where box != 0 AND introducedAt 앞 10자리 == today)
newBudget = max(0, newCap - leftoverNew.size - introducedToday)
newFromPool = pending pool 정렬(importedAt, id)의 앞 min(capacity, room, newBudget)개
```

- `newCap`은 박스0 잔류분과 오늘 도입 후 채점한 카드 수를 함께 차감한다. 다른 기기나 새 세션에서도 이미 소비한 하루 신규 한도가 다시 생기지 않는다.
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
  correctStreak, lapseCount, introducedAt, tags, updatedAt(채점 충돌 검사용 버전)

NewPool(신규 저수지)  ← §3.1
  id(=원천 시트 id), deckId(FK)
  promptKo, answerEn, chunkNote, level, topic
  status(pending), importedAt

SyncState(동기화 상태)  ← §3.2
  sourceUrl, importedIds[], lastSyncAt, lastSyncResult

ReviewLog(통계/디버깅)
  id, cardId(카드 id 참조, DB FK 아님), date, result(correct/wrong), boxBefore, boxAfter, hintLevel
  inputMethod?(grade|text)   ← §1.3a, 자기채점/텍스트 입력 중 무엇으로 채점됐는지(선택, 통계용)

Settings
  intervals[], dailyGoal, newCap, maxActiveCards
  lapseMode(reset|soft), hintFreeLevel(기본 1)
  notifyTime, recoveryEase(on/off)
  contentSourceUrl, contentSourceDeckId(공통 대상 덱), autoSyncEnabled, refillThresholdDays(기본 3)
  ttsAutoPlay(on/off)
  preferredAiModel(claude|gemini|gpt, 기본 claude)   ← §6, '선생님한테 질문' 기능에서 사용할 모델
  aiApiKeys{claude?,gemini?,gpt?}   ← §6, 모델별 사용자 API 키(입력 시 서버 공용 키 대신 사용)
```

### 2.1 Supabase 스키마 (동기화 대상) **[확정]**

Supabase Postgres가 계정별 학습 상태의 기준이며, 로컬(Room/IndexedDB)은 서버를 읽어 교체하는 캐시이다. 1인 사용자지만 확장성·안전을 위해 모든 테이블에 `user_id`(FK `auth.users.id`) + **RLS(Row Level Security)**를 건다 — "본인 행만 select/insert/update/delete".

```sql
-- decks
decks (
  id uuid pk, user_id uuid fk, name text, description text,
  exam_date date, created_at timestamptz, updated_at timestamptz
)

-- cards  (핵심 동기화 대상: box/nextReviewDate가 자주 바뀜)
cards (
  id text pk, user_id uuid fk, deck_id uuid fk, source_id text,
  prompt_ko text, answer_en text, chunk_note text, audio_url text,
  box int, next_review_date date, last_reviewed_at timestamptz,
  correct_streak int, lapse_count int, introduced_at timestamptz,
  tags text[], updated_at timestamptz  -- 채점 시 expected_updated_at과 비교
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

-- review_log  (채점과 함께 insert, log id로 재요청 중복 방지)
review_log (
  id uuid pk, user_id uuid fk, card_id text, date date,
  result text, box_before int, box_after int, hint_level int, input_method text,
  created_at timestamptz
)

-- settings  (사용자당 1행)
settings (
  user_id uuid pk fk, intervals int[], daily_goal int, review_cap int /* 기존 컬럼, 큐 계산에서 미사용 */, new_cap int, max_active_cards int,
  lapse_mode text, hint_free_level int, notify_time text,
  recovery_ease boolean, content_source_url text, content_source_deck_id uuid, auto_sync_enabled boolean,
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
- 카드 `updated_at`은 채점 시 기대 버전과 비교해 오래된 상태의 저장을 거절한다. 설정은 서버 저장 후 반영하며 필드별 충돌 병합은 하지 않는다.
- `review_log`는 앱 채점 시 insert로 누적한다. 카드 id에는 FK를 걸지 않아 카드 삭제 후에도 로그가 남는다. RPC는 동일 로그 id의 재요청을 중복 저장하지 않는다. 현재 RLS는 본인 행만 접근하도록 제한한다.
- `new_pool.id`를 시트 원본 id 그대로 써서 §3.4 dedupe 키와 일치시킴(별도 uuid 불필요).
- `auth.users`는 Supabase Auth가 자동 관리 — 별도 `profiles` 테이블은 지금 불필요(닉네임 등 부가 정보 생기면 그때 추가).

---

## 3. 콘텐츠 동기화 & 보충 파이프라인

### 3.1 두 저장소 모델

"박스1이 비는 것"과 "만들 자료가 떨어지는 것"은 다른 사건.

- **신규 저수지(NewPool)** — 임포트됐지만 아직 학습 시작 전 문장. 박스 배정 대기.
- **박스 1** — 실제 학습 시작한 최하위 칸.

매일 저수지 → 신규 한도 내 박스0 도입 → 첫 채점 후 박스1. 박스1이 비는 건 정상(승급). 보충이 필요한 건 **저수지 바닥**.

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
            저수지 → 신규 한도 내 박스0 → 첫 채점 후 박스1 → 라이트너 순환
                    │
            저수지 < 임계 → 보충 알림
```

- 콘텐츠 공급 원천 = 공유된 시트 1개. 계정의 pool·진행 상태 기준 = Supabase. **클라이언트는 인증 불필요**(모델을 URL 문자열 하나만 넘김) — 실제 읽기는 Edge Function이 `GOOGLE_SHEETS_API_KEY` 시크릿으로 수행한다.
- 시트는 "링크가 있는 모든 사용자(뷰어)" 공유가 필수(API 키만으로 읽으려면 필요). "웹에 게시" 설정과는 무관.
- 로컬 전용 모드(비로그인, `supabase == null`)에선 프록시를 못 쓰므로 콘텐츠 동기화 불가 — 이 소스는 클라우드 계정 전제.

### 3.4 시트 스키마 (열 고정)

```
id | 한글 문장 | 영어 문장 | 청크·문법 메모 | level | topic | added_at
```
- **`id`와 문장 키로 중복 방지.** 공통 `SyncState.importedIds`와 계정 전체 카드/pool의 문장 키를 확인한다. 같은 응답 안의 동일 문장도 첫 행만 흡수한다. 서로 다른 id·덱으로 공급한 동일 문장 역시 건너뛴다. `schema.sql`에는 계정별 문장 유일 인덱스가 포함되며, 기존 데이터 정리는 `supabase/dedupe-cards-by-sentence.sql`로 별도 수행한다. 공통 상태 마이그레이션만 실행한다고 중복 정리까지 수행되는 것은 아니다.
- **`id` 열은 선택.** 열이 없거나 칸이 비면 파서가 문장 내용(한글+영어) FNV-1a 해시로 결정적 id(`h…`)를 생성한다(`csv.ts` `contentId`). 랜덤 uuid를 쓰면 매 동기화가 전체 재임포트가 되므로 반드시 내용 기반이어야 한다. 시트에서 문장을 수정하면 해시가 바뀌어 그 행이 새 항목으로 다시 들어올 수 있으나(기존 카드는 `importedIds`에 남아 유지), 시트는 최초 대량 공급용이고 이후 문장 교정은 **앱의 단어장 상세에서 카드 `수정`**으로 처리하는 것을 기본으로 한다 — 새로 들어온 중복 대기 문장은 대기 목록에서 삭제.

### 3.5 보충 방식 = Tier 1 · 버퍼 + 알림 **[확정]**

- 큰 버퍼(예: 300문장 ≈ 20일치) 미리 채움 → 저수지 낮아지면 알림 → 사람이 배치 추가 → 다음 동기화 흡수.
- **Tier 2(무인)** = 향후: 클라우드 함수가 저수지 감시 → LLM API로 레벨·취약 패턴 맞춤 생성 → 시트 자동 append. 구조 동일, 생성 주체만 사람→함수(서버·API 비용·키 관리 추가).
- **품질 조건:** 생성 입력에 사용자 레벨 + 취약 문장 데이터 필수(난이도 표류 방지).

### 3.6 최초 설정 & 운영

- **설정(1회):** 시트 생성+헤더 → `공유 > 일반 액세스 > 링크가 있는 모든 사용자(뷰어)` → `/d/{ID}/edit` 링크 복사 → 앱 설정(§Settings `contentSourceUrl` + 대상 덱) 등록 → [지금 동기화].
- **운영:** 평소 무개입 자동 흡수 → 저수지 낮으면 알림 → 배치 추가.

### 3.7 기기 간 동기화(필수) — 서버 기준 **[2026-10-08 변경]**

```text
Android(Room 캐시) ← 읽기 / 저장 성공 후 반영 → Supabase(Auth + Postgres)
웹(IndexedDB 캐시) ← 읽기 / 저장 성공 후 반영 → 동일 Supabase
```

- 같은 계정의 decks/cards/new_pool/review_log/settings/sync_state를 공유한다. 시트는 공급 채널이고, 신규 대상 덱(`content_source_deck_id`)·가져오기 이력도 계정 단위로 저장한다.
- `fullSync`는 서버만 읽는다. 기기 캐시를 union/LWW 병합해 재업로드하지 않는다. 서버에서 삭제한 행은 다음 pull에서 캐시에서도 제거한다.
- 카드/덱 추가는 insert, 기존 카드 문장 편집·덱 이름 변경은 소유자/id에 대한 update이다. 기존 카드 편집은 박스·복습일 등 진행 필드를 덮어쓰지 않으며, 삭제된 행을 upsert로 부활시키지 않는다.
- 카드 채점은 기대 버전으로 충돌 검사하고 진행 상태와 로그를 한 트랜잭션에서 저장한다. 같은 카드의 오래된 채점은 오류로 반환한다. 일반 설정/메타데이터 편집에 필드별 병합이나 동일한 채점 버전 검사를 적용한다는 뜻은 아니다.
- 같은 날짜의 최신 서버 데이터를 불러온 뒤 pool·박스 현황·목표·완료·기록 기반 집계가 일치해야 한다. Realtime 구독은 없으므로 이미 열린 다른 기기의 화면은 다음 pull 때 갱신된다.
- Google 로그인과 사용자별 RLS를 사용한다. 콘텐츠 프록시의 시트 읽기는 서버 API 키와 시트 뷰어 공유 권한으로 처리한다.
- 로그인한 웹·Android 모두 저장에 인터넷 연결이 필요하다. 오프라인 변경 큐와 나중에 자동 업로드하는 모드는 구현하지 않는다.

### 3.8 구현 주의점

- `id`와 문장 키(한글/영어 공백 정리, 영어 대소문자 정규화) 기준 dedupe. 서로 다른 덱·id여도 같은 문장을 다시 적재하지 않는다.
- Sheets API는 시트 저장 즉시 반영되지만, 흡수 트리거는 앱 시작 시 하루 1회 → 즉시 반영이 필요하면 [지금 동기화] 수동 버튼.
- 읽기/저장 실패는 오류를 표시하고 재시도할 수 있게 한다. 실패한 데이터를 성공처럼 처리하거나 기존 캐시를 빈 데이터로 교체하지 않는다.
- 기기 간 동기화는 익명 사용자 대신 **개인 계정 1개**를 기준으로 운영. 같은 계정이면 폰/PC가 같은 덱을 보고 같은 큐를 계산한다.
- 프라이버시: 시트를 "링크가 있는 모든 사용자(뷰어)"로 공유 → 링크 아는 사람은 열람 가능(문장이라 무방, 비공개 필요 시 드라이브 OAuth로 승급).

### 3.9 진행 상태 읽기·저장 시점 **[2026-10-08 변경]**

**Pull (서버 → 캐시):**

| 트리거 | 웹 | Android |
|---|---|---|
| 로그인/앱 시작, 포그라운드 복귀 | 실행 | 실행 |
| 학습 시작 직전 | 성공 후 세션 진입 | 성공 후 세션 진입 |
| 화면이 보이는 동안 30초 주기 | 세션 밖에서 실행 | 미구현 |
| 온라인 복귀 이벤트 | 세션 밖에서 실행 | 별도 이벤트 미구현(복귀/학습 시작 시 읽기) |
| 학습 세션 도중 | 자동 pull 중단 | 포그라운드 pull 중단 |

- 테이블 조회는 id 순서로 500행씩 페이지를 읽어 완료한다. 1,000행 이상 학습 로그도 누락 없이 가져온다. pending pool 중 이미 카드화된 id는 제외한다.
- 서버 읽기 성공 후 웹 IndexedDB·Android Room 트랜잭션으로 덱/카드/pool/로그 캐시를 교체하고 설정·syncState를 반영한다. 실패 시 이전 캐시를 보존한다(계정 전환의 캐시 격리는 별도).
- 웹 최초 서버 로딩 중에는 홈 수치를 확정하지 않고 로딩/실패 재시도를 표시한다. 이후 실패는 공통 오류 표시로 알린다.
- 앱 내부 데이터 작업은 웹 promise 큐·Android Mutex로 직렬화해 pull과 저장의 경쟁을 줄인다. 여러 테이블을 읽는 전체 pull 자체가 단일 서버 트랜잭션 스냅샷인 것은 아니다.

**저장 (서버 확정 → 캐시/UI):**

- CRUD·설정·채점은 서버 성공을 기다린 뒤 로컬에 반영한다. 디바운스 배치, 종료 직전 flush, 오프라인 outbox는 쓰지 않는다.
- `introduce_shared_card(card_data, pool_id)`: pool별 잠금을 잡고 카드 생성과 pool 삭제를 원자적으로 처리한다. 이미 도입된 카드이면 현재 서버 카드를 반환해 진행을 초기화하지 않는다.
- `save_shared_review(card_data, log_data, expected_updated_at)`: 카드 행을 잠그고 `updated_at` 및 `box_before`를 검사한 뒤 진행 변경+로그 insert를 함께 처리한다. 같은 로그 id는 재요청해도 중복 기록하지 않는다.
- 두 RPC는 `security invoker`, 인증 사용자에게만 실행 권한, `auth.uid()`와 입력 소유자 검증 및 RLS를 적용한다.
- 실패/충돌 시 학습은 현재 카드에 머무른다. 오류를 확인하고 홈으로 돌아가 최신 큐로 다시 시작한다. pool 도입 실패도 오류와 홈 복귀 경로를 제공한다.
- Android SDK 예외에는 Authorization 등 요청 헤더가 포함될 수 있으므로 예외 message/toString을 UI나 공유 syncState에 전달하지 않는다. 저장 충돌은 허용된 고정 안내로 변환하고, 로그인·읽기·질문·시트 요청 실패도 고정된 복구 안내를 사용한다. 기존 시트 파싱의 행별 형식 오류는 별도 유지한다.
- 별도 진행 상태 수동 동기화 버튼은 두지 않는다. 설정의 [지금 동기화]는 시트 콘텐츠 가져오기용이며, 시작 전 서버 읽기도 수행한다.

### 3.10 마이그레이션·배포 범위 **[2026-10-08]**

- 기존 DB에는 [`supabase/shared-state.sql`](../supabase/shared-state.sql)을 적용한다. 대상 덱 컬럼과 두 RPC를 추가하며 기존 카드/로그를 삭제하거나 과거 캐시를 복구하지 않는다. 신규 DB 스키마에는 [`supabase/schema.sql`](../supabase/schema.sql)로 포함한다.
- 서버에 대상 덱이 없고 기존 기기 설정의 대상 덱이 서버에 존재하면 그 필드만 최초 이관한다. 전체 캐시 설정/카드를 업로드하는 절차가 아니다.
- 서버 기준 캐시로 처음 교체하기 전 웹은 IndexedDB `cacheBackup`에, Android는 앱 전용 SharedPreferences에 덱/카드/pool/로그 등을 1회 보관한다. 자동 병합/재업로드하지 않으며 플랫폼별 백업 범위는 다르다. 기존 기기별 `dayGoal` 스냅샷은 더 이상 목표 계산에 사용하지 않는다.
- 웹 로그인 반환 주소는 현재 origin을 사용한다. Supabase Auth의 Redirect URLs에 `http://localhost:5173` 및 `http://localhost:5173/**`를 등록했다. Site URL은 Vercel로 유지하며 로컬 로그인은 localhost에 복귀한다.
- DB 적용·로컬 웹 확인·웹/Android 빌드까지 완료했다. **Vercel 운영 웹·Android 0.1.25 서명 APK의 Firebase 배포 완료**(코드 커밋 2932f80). 운영 JS가 로컬 production 빌드와 동일함을 확인했다. 기기 연결이 없어 로컬 설치는 생략했고 다기기 전체 회귀 검증은 남아 있다. 기존 union/LWW 방식 클라이언트가 남아 있으면 캐시 재업로드 문제가 계속 발생할 수 있으므로 양쪽 갱신 후 기기 간 검증을 완료해야 한다.
- 세션의 화면 위치·입력 중인 답·힌트 상태는 기기별이다. 웹의 채점 미반영 오답 다시보기 목록도 origin별 localStorage로 남아 있으며 공통 pool 동기화 대상이 아니다.

---

## 4. 기술 스택 (Android + PC 웹)

- **Android 앱**: Kotlin + Jetpack Compose
- **PC 웹앱**: React + Vite + TypeScript (PWA) — Windows/macOS 브라우저 공통, OS 종속 없음
  - **온라인 사용 전제(2026-10-08)**: 로그인한 웹과 Android 모두 서버 저장 성공 후 진행한다. IndexedDB/Room은 캐시이며 로딩된 데이터 열람에 사용할 수 있지만, 오프라인 채점·편집·변경 큐 업로드는 제공하지 않는다.
- **공통 로직**: 학습 스케줄러와 규칙 계산은 공통 모듈로 추출해 폰/PC가 같은 로직 사용
- **로컬 저장**:
  - Android: Room (SQLite)
  - PC 웹: IndexedDB 기반 캐시
- **동기화 계층**: **Supabase [확정]** — Postgres(카드/박스/로그 등 관계형 데이터에 적합) + 내장 Auth(Google OAuth) + 자동 REST API를 한 번에 제공해 별도 백엔드 서버 구축이 불필요. 1인 프로젝트 규모에서 무료 티어로 충분.
- **복습 알림**: Android: WorkManager + Notifications / PC 웹: 브라우저 알림(선택)
- **MVVM / 상태관리**: Android: MVVM / Web: React Query 또는 Zustand + 전역 상태
- 가져오기: 구글시트 → 프록시 CSV 변환 → 내부 CSV 파서. 수동 파일 업로드 UI는 제외(2026-08-26). `.xlsx`는 Phase 3.
- 동기화: **HTTP GET**(HttpURLConnection/Retrofit/Ktor 택1) → CSV 파싱 → id dedupe → NewPool 적재. 별도로 사용자 진행 상태는 클라우드 DB에 동기화.
- 기본 덱: 공개 라이선스(NGSL/NAWL/AWL) 또는 사용자·교사 생성. 상용 교재 복사 금지.
- 발음: TTS(Phase 2). **Android = OS 내장 TTS 엔진 / PC 웹 = 브라우저 내장 Web Speech API [확정]** — 둘 다 무료·키 불필요·서버 호출 없음. 음질은 Google Cloud TTS 등 유료 API보다 기계적이나 1인 학습 보조용으로 충분, 비용·인프라 부담이 없어 MVP에 적합. Tier 2 무인 생성은 클라우드 함수 + LLM API(향후).

### 4.0 최소 지원 브라우저 **[확정]**

**Chrome 최신 버전만 공식 지원** (PC·모바일 모두 사용자가 Chrome 사용). Safari/Firefox 등은 별도 QA·폴리필 대상 아님 — Web Speech API·IndexedDB 등 브라우저별 편차를 신경 쓸 필요가 없어 개발 범위가 줄어든다. 추후 다른 브라우저 사용자가 생기면 그때 지원 범위를 넓힌다.

### 4.1 플랫폼별 운영 규칙

- **갤럭시 S24**: 이동 중 학습, 짧은 세션, 푸시 알림 중심 사용
- **PC(Windows/macOS 웹브라우저)**: 장시간 학습, 카드 편집, 통계 확인, 자료 정리 중심 사용
- **동일 계정**: 최신 서버 데이터를 읽은 뒤 같은 날짜의 pool·복습 큐·상태·학습 설정·기록 기반 집계를 공유한다. 세션 화면 위치와 미저장 입력은 기기별로 유지한다(§3.10).
- **연결 끊김**: 저장 오류를 표시하고 다음 카드로 진행하지 않는다. 온라인 복귀 후 최신 상태를 읽어 이어간다. 미저장 채점을 백그라운드에서 자동 업로드하지 않는다.

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
