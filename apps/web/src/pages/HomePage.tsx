// UXUI §3.2 홈/상자 대시보드 — 빈 상태 / 복습 있음 / 복습 완료 3가지 상태를 처리한다.
// 스트릭·D-day 배지는 통계(§3.5)·시험대비(§1.6) 범위라 이번 MVP에서는 생략.
// 박스 시각화는 docs/screen-home-pc.html 목업(계단형 채움 차트)을 따른다: 박스1→졸업으로 갈수록
// 칸 높이(용량)가 커지고, 칸 바닥부터 색이 차오른 정도(=가장 카드가 많은 박스를 100%로 한 상대값)로
// "전체 상자 대비 이 박스에 카드가 얼마나 몰려있는지"를 형태로 직관 전달한다.
// 칸 위 숫자는 절대 개수, %는 채움 높이와 반드시 같은 기준(가장 많은 박스=100%)이어야
// "칸은 꽉 차 보이는데 %는 낮다" 같은 모순이 안 생긴다. 빈 박스는 점선 테두리만.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GRADUATED_BOX, NEW_CARD_BOX, buildTodayQueue, today as todayStr } from "@leitner/core";
import { useAppStore } from "../store";
import { needsRefill } from "../lib/contentSync";
import { getRetryPendingIds } from "../lib/retryPending";
import { reviewLogRepo } from "../lib/db";

// index0 = 박스0(신규, DESIGN §1.3b) · index1~6 = 박스1~6 · index7 = 졸업
const BOX_COLORS = ["#94a3b8", "#ef4444", "#f97316", "#eab308", "#a3e635", "#22c55e", "#14b8a6", "#dca512"];
// 창 높이가 낮을 때 "학습 시작" 버튼이 스크롤 없이 보이도록 전체 차트 높이를 억제
// (예전 [60,80,...,180]보다 계단 낙차는 유지하되 절대 높이를 줄임). 박스0은 아직 채점 전이라
// 박스1보다도 작게(체류 시간이 가장 짧은 칸이라는 인상을 주도록).
const STEP_HEIGHTS = [24, 36, 48, 60, 72, 84, 96, 108];
const CHART_W = 350;
const TOP_MARGIN = 26; // 가장 높은 칸 위에 개수/% 텍스트 두 줄 들어갈 여유
const BOTTOM_LABEL_H = 18; // 박스 번호를 칸 안쪽이 아니라 x축 라벨처럼 바깥 아래에 따로 둘 공간
const BASELINE = TOP_MARGIN + Math.max(...STEP_HEIGHTS);
const CHART_H = BASELINE + BOTTOM_LABEL_H;
const COL_GAP = 4;
const COL_W = (CHART_W - COL_GAP * 7) / 8;

export default function HomePage() {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  async function startSession() {
    if (starting) return;
    setStarting(true);
    try {
      await useAppStore.getState().syncNow();
      if (!useAppStore.getState().cloudError) navigate("/session");
    } finally { setStarting(false); }
  }
  const decks = useAppStore((s) => s.decks);
  const cards = useAppStore((s) => s.cards);
  const newPool = useAppStore((s) => s.newPool);
  const settings = useAppStore((s) => s.settings);

  // buildTodayQueue는 호출마다 새 배열을 만들기 때문에 zustand 셀렉터로 직접 쓰면
  // 매 렌더 "스냅샷이 바뀜"으로 인식돼 무한 리렌더에 빠진다. useMemo로 감싸서
  // cards/newPool/settings가 실제로 바뀔 때만 재계산한다.
  const { leftoverNew, newFromPool } = useMemo(
    () => buildTodayQueue(cards, newPool, settings, todayStr()),
    [cards, newPool, settings]
  );

  // "오늘 복습할 카드" = 오늘 복습 예정일이 된 박스1~6 카드 전체 + 신규(박스0 잔류 + 도입분).
  // 세션당 분량 상한은 없다 — 원하는 만큼 풀다 닫으면 남은 건 다음에 다시 잡힌다.
  const dueToday = useMemo(() => {
    const t = todayStr();
    return cards.filter(
      (c) => c.box >= 1 && c.box < GRADUATED_BOX && c.nextReviewDate !== null && c.nextReviewDate <= t
    );
  }, [cards]);

  const queueNewCount = leftoverNew.length + newFromPool.length;
  const todayCount = dueToday.length + queueNewCount;
  const dueByBox = Array.from({ length: 6 }, (_, i) =>
    dueToday.filter((c) => c.box === i + 1).length
  );
  const queueBreakdown = [
    `남은 신규 ${queueNewCount}`,
    ...dueByBox.map((n, i) => (n > 0 ? `박스${i + 1} ${n}` : null)).filter(Boolean),
  ].join(" · ");

  const reviewedToday = useMemo(
    () => cards.filter((c) => (c.lastReviewedAt ?? "").slice(0, 10) === todayStr()).length,
    [cards]
  );
  // All devices derive the same goal from synchronized cards/pool; no per-origin snapshot.
  const goalTotal = todayCount + reviewedToday;
  const goalPct = Math.min(100, Math.round((reviewedToday / Math.max(1, goalTotal)) * 100));
  const goalBreakdown = queueBreakdown;
  // 세션에서 저장하는 localStorage 값이라 zustand 구독이 안 돼 홈에 다시 돌아올 때(포커스 복귀)
  // 마다 다시 읽어야 한다 — 세션 갔다가 몰랐어를 누르고 바로 나와도 이 값이 반영되게.
  const [pendingRetryCount, setPendingRetryCount] = useState(0);
  // 승급/강등 개수도 세션 컴포넌트의 tallyRef(로컬 state)에만 있어서 세션을 나가면 사라진다.
  // reviewLog(IndexedDB)에 boxBefore/boxAfter가 남아있으니 오늘자 로그를 다시 세서 구한다
  // (하루 안에 세션을 여러 번 나눠 해도 전체 합이 맞다).
  const [boxTally, setBoxTally] = useState({ up: 0, down: 0, flat: 0, newCount: 0 });
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      setPendingRetryCount(getRetryPendingIds().length);
      const logs = await reviewLogRepo.all();
      if (cancelled) return;
      const t = todayStr();
      let up = 0;
      let down = 0;
      let flat = 0; // 승급도 강등도 아닌 경우 — 예: 박스1에서 틀리면 더 못 내려가 그대로 박스1 유지
      let newCount = 0; // 신규(박스0)에서 시작해 오늘 처음 채점된 카드 수
      for (const l of logs) {
        if (l.date !== t) continue;
        if (l.boxBefore === NEW_CARD_BOX) {
          // 신규는 정답이든 오답이든 박스가 무조건 1 이상으로 올라가(박스0 밑이 없음) 항상
          // "승급"으로 잡히는데, 그러면 신규가 승급의 부분집합이 돼 따로 더할 때 총합이
          // 안 맞는다. 신규→박스1은 "승급"이 아니라 그냥 "신규"로 따로 센다.
          newCount += 1;
        } else if (l.boxAfter > l.boxBefore) {
          up += 1;
        } else if (l.boxAfter < l.boxBefore) {
          down += 1;
        } else {
          flat += 1;
        }
      }
      setBoxTally({ up, down, flat, newCount });
    }
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [cards]);
  // 위 CTA 세 갈래(진행 중/다시보기/완전 종료)에서 공통으로 쓰는 "신규 A · 승급 B · 강등 C · 유지 D"
  // 한 줄 — 넷 다 서로 겹치지 않게 셌으니(신규→박스1은 승급이 아니라 신규로만 집계) 그대로
  // 다 더하면 오늘 채점 총량과 같다.
  const boxTallyLine = (
    <>
      신규 <b>{boxTally.newCount}</b>개 · 승급 <b style={{ color: "#22c55e" }}>{boxTally.up}</b>개 · 강등{" "}
      <b style={{ color: "#ef4444" }}>{boxTally.down}</b>개
      {boxTally.flat > 0 && (
        <>
          {" "}
          · 유지 <b>{boxTally.flat}</b>개
        </>
      )}
    </>
  );
  const newCount = cards.filter((c) => c.box === NEW_CARD_BOX).length;
  const mastered = cards.filter((c) => c.box === GRADUATED_BOX).length;
  const boxCounts = Array.from({ length: 6 }, (_, i) =>
    cards.filter((c) => c.box === i + 1).length
  );
  const stepCounts = [newCount, ...boxCounts, mastered]; // index0=신규(박스0), index7=졸업

  // 칸 채움 높이는 "가장 카드가 많은 박스"를 100%로 한 상대 비교(막대그래프처럼 형태로 비교).
  const maxCount = Math.max(1, ...stepCounts);
  const weakPct = cards.length ? Math.round(((boxCounts[0] + boxCounts[1]) / cards.length) * 100) : 0;
  const gradPct = cards.length ? Math.round((mastered / cards.length) * 100) : 0;

  // §3.2 보충 트리거 — 콘텐츠 소스가 등록돼있을 때만 의미 있음(수동 CSV만 쓰는 사용자에겐 노이즈).
  const pendingPoolCount = newPool.filter((p) => p.status === "pending").length;
  const showRefillBanner =
    Boolean(settings.contentSourceUrl) && needsRefill(pendingPoolCount, settings.newCap, settings.refillThresholdDays);

  if (cards.length === 0 && decks.length === 0) {
    return (
      <div className="page empty-state">
        <h2>첫 단어장을 만들어 볼까요?</h2>
        <p>덱을 만들고 문장 카드를 추가하거나 CSV로 가져오세요.</p>
        <Link className="btn primary" to="/decks">
          단어장 관리로 이동
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      {showRefillBanner && (
        <div className="refill-banner">
          저수지에 신규 문장이 {pendingPoolCount}개 남았어요. 곧 바닥나요 —{" "}
          <Link to="/settings">설정에서 시트 동기화</Link>하거나 문장을 보충해주세요.
        </div>
      )}
      <section className="box-chart-card">
        <h3 className="box-chart-title">내 상자 현황</h3>
        <svg
          className="box-chart"
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          role="img"
          aria-label="박스별 카드 분포"
        >
          <line x1="0" y1={BASELINE} x2={CHART_W} y2={BASELINE} stroke="#2a2d34" strokeWidth="1" />
          {stepCounts.map((count, i) => {
            const h = STEP_HEIGHTS[i];
            const top = BASELINE - h;
            const x = i * (COL_W + COL_GAP);
            // % 텍스트는 반드시 채움 높이(fillRatio)와 같은 기준이어야 한다 — 기준이 다르면
            // "칸은 꽉 차 보이는데 텍스트는 32%"처럼 눈에 보이는 것과 숫자가 안 맞아 혼란스러움.
            const fillRatio = Math.min(1, count / maxCount);
            const pct = Math.round(fillRatio * 100);
            const fillH = h * fillRatio;
            const isEmpty = count === 0;
            const color = BOX_COLORS[i];
            // index0=신규(박스0), index1~6=박스1~6, index7=졸업
            const label = i === 0 ? "신규" : i === 7 ? "졸업" : String(i);
            const fullLabel = i === 0 ? "신규(박스0)" : i === 7 ? "졸업" : `박스 ${i}`;
            return (
              <g key={i}>
                <title>
                  {fullLabel} {count}개 · 가장 많은 박스 대비 {pct}%
                </title>
                {isEmpty ? (
                  <rect
                    x={x}
                    y={top}
                    width={COL_W}
                    height={h}
                    fill="none"
                    stroke={color}
                    strokeDasharray="4 3"
                    rx="4"
                  />
                ) : (
                  <>
                    <rect x={x} y={top} width={COL_W} height={h} fill="#171a21" rx="4" />
                    <rect
                      x={x}
                      y={BASELINE - fillH}
                      width={COL_W}
                      height={fillH}
                      fill={color}
                      rx={fillH < 6 ? 2 : 4}
                    />
                  </>
                )}
                <text
                  x={x + COL_W / 2}
                  y={top - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill="#e8eaed"
                >
                  {count}
                </text>
                <text x={x + COL_W / 2} y={top + 9} textAnchor="middle" fontSize="8.5" fill="#9aa0a6">
                  {pct}%
                </text>
                {/* 박스 번호는 칸 개수(위 굵은 숫자)와 헷갈리지 않도록 칸 안이 아니라
                    x축 라벨처럼 기준선 바깥 아래에 작고 흐리게 별도 배치한다. */}
                <text
                  x={x + COL_W / 2}
                  y={BASELINE + 13}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#9aa0a6"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="box-chart-foot">
          <span>
            총 <b>{cards.length}</b>문장
          </span>
          <span>
            취약(박스1~2) <b style={{ color: "#ef4444" }}>{weakPct}%</b>
          </span>
          <span>
            졸업 <b style={{ color: "#dca512" }}>{gradPct}%</b>
          </span>
        </div>
      </section>

      {todayCount > 0 ? (
        <section className="cta">
          <div className="cta-number">
            오늘 목표 {goalTotal}개 · 완료 {reviewedToday}개
          </div>
          <div className="cta-progress" aria-hidden>
            <i style={{ width: `${goalPct}%` }} />
          </div>
          {/* 실시간 잔여 학습 내역 */}
          <div className="cta-breakdown" style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>
            {goalBreakdown}
          </div>
          <div className="cta-breakdown" style={{ color: "#9aa0a6", fontSize: "0.85rem", marginBottom: 12 }}>
            {boxTallyLine}
          </div>
          <button className="btn primary large" disabled={starting} onClick={startSession}>
            {starting ? "동기화 중..." : "학습 시작"}
          </button>
        </section>
      ) : pendingRetryCount > 0 ? (
        // 오늘 채점할 신규/복습은 다 끝났지만, 지난 세션에서 틀려서 "다시 보기"(채점 미반영
        // 재노출)를 못 끝낸 카드가 남아있는 경우. 이걸 "목표 달성"이라고만 하면 다시 볼 방법이
        // 없어져서(세션은 홈에 새로 due 카드가 없으면 안 열림) 여기서 따로 계속 열어준다.
        <section className="cta">
          <div className="cta-number">오늘 목표 달성! 🎉</div>
          <div className="cta-breakdown" style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>
            {boxTallyLine}
          </div>
          <div className="cta-breakdown" style={{ color: "#9aa0a6", fontSize: "0.85rem", marginBottom: 12 }}>
            아직 다 못 본 오늘 틀린 카드 {pendingRetryCount}개 — 채점엔 반영 안 돼요
          </div>
          <button className="btn primary large" disabled={starting} onClick={startSession}>
            다시 보기
          </button>
        </section>
      ) : (
        <section className="cta">
          <div className="cta-number">오늘 목표 달성! 🎉</div>
          <div className="cta-breakdown" style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>
            오늘 {reviewedToday}개 학습 완료 · {boxTallyLine}
          </div>
          <Link className="btn secondary" to="/decks">
            단어장 관리
          </Link>
        </section>
      )}

      <section className="summary-card">
        <div>총 카드 {cards.length}</div>
        <div>마스터 {mastered}</div>
      </section>
    </div>
  );
}
