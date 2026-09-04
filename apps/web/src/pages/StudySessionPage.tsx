// UXUI §3.3 학습 세션 — 전체화면, 제시(한글) → 힌트(선택) → 정답 확인 → 자기 채점.
// DESIGN §1.3 onAnswer / 힌트 채점 규칙을 그대로 집행한다.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  NEW_CARD_BOX,
  buildTodayQueue,
  diffWords,
  introduceFromPool,
  isCorrect,
  matchesAnswer,
  onAnswer,
  today as todayStr,
} from "@leitner/core";
import type { Card, InputMethod, ReviewLog } from "@leitner/core";
import { v4 as uuid } from "uuid";
import { useAppStore } from "../store";
import AskTeacherPanel from "../components/AskTeacherPanel";
import { speakEnglish } from "../lib/tts";

type Phase = "prompt" | "hint" | "answer";

const HINT_LADDER = [
  "한글만",
  "단어 수 + 첫 단어",
  "모든 단어 첫 글자",
  "대부분 공개, 빈칸 1~2개",
];

function buildHintText(answerEn: string, level: number): string {
  const words = answerEn.split(" ");
  if (level === 0) return "";
  if (level === 1) return `${words.length}단어 · "${words[0]} ..."`;
  if (level === 2) return words.map((w) => w[0] + "_".repeat(Math.max(0, w.length - 1))).join(" ");
  // level 3: 대부분 공개, 마지막 단어만 가림
  return words.map((w, i) => (i === words.length - 1 ? w[0] + "_".repeat(Math.max(0, w.length - 1)) : w)).join(" ");
}

interface Tally {
  studied: number;
  correct: number;
  boxUp: number;
  boxDown: number;
}

export default function StudySessionPage() {
  const navigate = useNavigate();
  const cardsInStore = useAppStore((s) => s.cards);
  const newPoolInStore = useAppStore((s) => s.newPool);
  const introduceCard = useAppStore((s) => s.introduceCard);
  const applyReview = useAppStore((s) => s.applyReview);
  const settings = useAppStore((s) => s.settings);

  // 세션 시작 시점의 오늘 큐를 한 번만 계산해서 고정한다(§1.4). 이후 답변으로
  // cards가 바뀌어도 세션 도중 큐 자체가 다시 섞이지 않도록 useMemo에 담는다.
  const { due: dueCards, leftoverNew, newFromPool } = useMemo(
    () => buildTodayQueue(cardsInStore, newPoolInStore, settings, todayStr()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [queue, setQueue] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("prompt");
  const [hintLevel, setHintLevel] = useState(0);
  const [retryQueue, setRetryQueue] = useState<Card[]>([]);
  const [inRetryPass, setInRetryPass] = useState(false);
  const [done, setDone] = useState(false);
  const tallyRef = useRef<Tally>({ studied: 0, correct: 0, boxUp: 0, boxDown: 0 });
  const [, forceRender] = useState(0);

  // DESIGN §1.3a 텍스트 정답 입력 — 자기채점 버튼과 병행. userText가 비어있으면 기존 흐름 그대로.
  const [userText, setUserText] = useState("");
  const [typedMatch, setTypedMatch] = useState<boolean | null>(null);
  const [showAskTeacher, setShowAskTeacher] = useState(false);
  const knewBtnRef = useRef<HTMLButtonElement>(null);
  const didntKnowBtnRef = useRef<HTMLButtonElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  // 세션 시작 시 저수지 신규 카드를 박스0(신규, 복습 기한 없음)으로 승격한 뒤 오늘 큐를 확정한다
  // (DESIGN §1.3b / §3.1). 채점(몰랐어/알았어)하면 onAnswer가 그대로 박스1로 착지시킨다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const introduced: Card[] = [];
      for (const pool of newFromPool) {
        // 카드 id = pool.id (introduceFromPool). 랜덤 uuid를 쓰면 같은 저수지 항목이 두 기기
        // (또는 웹/안드로이드)에서 각각 승격될 때 id가 달라 중복 카드가 남는다 — id가 pool.id면
        // 어디서 승격하든 같은 id라 클라우드 병합(mergeByUpdatedAt)이 하나로 합친다.
        const card = introduceFromPool(pool, todayStr());
        await introduceCard(card, pool.id);
        introduced.push(card);
      }
      // 복습(박스1~6) → 박스0 잔류 신규 → 이번 세션 신규 도입 순.
      if (!cancelled) setQueue([...dueCards, ...leftoverNew, ...introduced]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = useMemo(() => {
    if (!queue) return null;
    const q = inRetryPass ? retryQueue : queue;
    return q[index] ?? null;
  }, [queue, retryQueue, inRetryPass, index]);

  // UXUI §0-2 PC 키보드 접근성 — H=힌트, Enter=정답 확인, Esc=나가기.
  // Space는 쓰지 않는다 — 입력창에 포커스를 안 준 채로 답을 구상하며 스페이스만 눌러도
  // 의도치 않게 정답이 열려버릴 수 있어서(단어 사이 띄어쓰기 습관 등) 제외.
  // 텍스트 입력 필드에 포커스가 있을 때는 가로채지 않는다(§접근성 예외, Esc는 예외 없이 항상 동작).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        navigate("/");
        return;
      }

      const target = e.target as HTMLElement | null;
      const isTextField = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (isTextField || !current || phase === "answer") return;

      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        setHintLevel((l) => Math.min(l + 1, 3));
        setPhase("hint");
      } else if (e.key === "Enter") {
        e.preventDefault();
        setPhase("answer");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, current, navigate]);

  // UXUI §0-2 — [몰랐어]/[알았어] 중 하나에 기본 포커스를 준다. 정답 확인 직후는 물론,
  // '선생님한테 질문' 패널을 쓰고 나서도(그 안의 입력창/버튼에 포커스가 남아 Enter가
  // 채점 버튼을 못 누르는 문제) 다시 불러서 포커스를 되돌리는 데 재사용한다.
  function focusRecommendedGradeButton() {
    if (!current) return;
    const canClaim = hintLevel <= settings.hintFreeLevel;
    // 알았어가 비활성화(canClaim=false)면 항상 몰랐어로, 아니면 텍스트 채점 추천값을 따르고,
    // 텍스트 입력이 없었으면 문서 규칙대로 기본은 알았어.
    const preferKnew = canClaim && (typedMatch !== null ? typedMatch : true);
    (preferKnew ? knewBtnRef.current : didntKnowBtnRef.current)?.focus();
  }

  useEffect(() => {
    if (phase !== "answer") return;
    focusRecommendedGradeButton();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, current, hintLevel, settings.hintFreeLevel, typedMatch]);

  // DESIGN §4 / UXUI §3.3 — 정답 확인 상태에 진입하면 발음을 자동재생.
  // 설정에서 켰으면 모든 카드에서, 꺼져 있어도 신규(박스0) 카드는 첫 노출이라 항상 자동재생한다
  // (처음 보는 문장일수록 발음을 바로 들려주는 게 도움이 되므로).
  useEffect(() => {
    if (phase !== "answer" || !current) return;
    const shouldAutoPlay = settings.ttsAutoPlay || current.box === NEW_CARD_BOX;
    if (!shouldAutoPlay) return;
    speakEnglish(current.answerEn);
  }, [phase, current, settings.ttsAutoPlay]);

  // 새 카드가 뜰 때마다 텍스트 정답 입력창에 바로 커서가 가 있도록 자동 포커스.
  useEffect(() => {
    if (!current) return;
    textInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!queue) return <div className="page session">불러오는 중...</div>;

  if (done) {
    const t = tallyRef.current;
    return (
      <div className="page session summary">
        <h2>오늘 학습 끝! 🎉</h2>
        <ul className="summary-stats">
          <li>학습한 카드: {t.studied}개</li>
          <li>정답률: {t.studied > 0 ? Math.round((t.correct / t.studied) * 100) : 0}%</li>
          <li>박스 승급: {t.boxUp}개</li>
          <li>박스 강등: {t.boxDown}개</li>
          <li>신규 도입: {newFromPool.length + leftoverNew.length}개</li>
        </ul>
        <Link className="btn primary" to="/">
          홈으로
        </Link>
      </div>
    );
  }

  if (!current) {
    // 메인 큐를 다 돌았다면 오답 재노출 패스로 한 번 더(§1.5), 없으면 종료.
    if (!inRetryPass && retryQueue.length > 0) {
      setInRetryPass(true);
      setIndex(0);
      setPhase("prompt");
      setHintLevel(0);
      return <div className="page session">다시 볼 카드로 넘어갑니다...</div>;
    }
    setDone(true);
    return <div className="page session">정리 중...</div>;
  }

  const total = inRetryPass ? retryQueue.length : queue.length;

  function goToNext() {
    setIndex((i) => i + 1);
    setPhase("prompt");
    setHintLevel(0);
    setUserText("");
    setTypedMatch(null);
    setShowAskTeacher(false);
  }

  function handleHint() {
    setHintLevel((l) => Math.min(l + 1, 3));
    setPhase("hint");
  }

  function handleShowAnswer() {
    setPhase("answer");
  }

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!current || !userText.trim()) return;
    setTypedMatch(matchesAnswer(userText, current.answerEn));
    setPhase("answer");
  }

  async function handleGrade(userClaimedKnew: boolean, inputMethod: InputMethod = "grade") {
    if (!current) return;
    if (inRetryPass) {
      // 재노출 패스는 box/nextReviewDate에 반영하지 않음(DESIGN §1.5) — 카운트만 없이 다음으로.
      goToNext();
      return;
    }
    const correct = isCorrect(hintLevel, userClaimedKnew, settings);
    const updated = onAnswer(current, correct, settings, todayStr());
    const log: ReviewLog = {
      id: uuid(),
      cardId: current.id,
      date: todayStr(),
      result: correct ? "correct" : "wrong",
      boxBefore: current.box,
      boxAfter: updated.box,
      hintLevel,
      inputMethod,
    };
    await applyReview(current.id, updated, log);

    const t = tallyRef.current;
    t.studied += 1;
    if (correct) t.correct += 1;
    if (updated.box > current.box) t.boxUp += 1;
    if (updated.box < current.box) t.boxDown += 1;
    forceRender((n) => n + 1);

    if (!correct) setRetryQueue((q) => [...q, current]);
    goToNext();
  }

  const hintDisabledAlways = phase === "answer";
  const canClaimKnew = hintLevel <= settings.hintFreeLevel;
  const typedInputMethod: InputMethod = userText.trim() ? "text" : "grade";

  return (
    <div className="page session">
      <div className="session-top">
        <Link to="/" className="close-btn">
          ✕
        </Link>
        <div className="progress">
          {index + 1} / {total} {inRetryPass && "(다시 보기)"}
        </div>
        <div className="box-badge">{current.box === NEW_CARD_BOX ? "신규" : `박스 ${current.box}`}</div>
      </div>

      <div className="card-face">
        <p className="prompt-ko">{current.promptKo}</p>

        {phase !== "answer" && (
          <form className="text-answer-form" onSubmit={handleTextSubmit}>
            <input
              ref={textInputRef}
              placeholder="영어로 답을 입력해보세요 (선택)"
              value={userText}
              onChange={(e) => setUserText(e.target.value)}
              lang="en"
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="btn secondary" type="submit" disabled={!userText.trim()}>
              제출
            </button>
          </form>
        )}

        {phase !== "prompt" && phase !== "answer" && hintLevel > 0 && (
          <div className="hint-box">
            <p className="hint-level-label">
              힌트 {hintLevel}/3 · {HINT_LADDER[hintLevel]} ·{" "}
              {hintLevel <= settings.hintFreeLevel ? "채점 영향 없음" : "채점 영향 있음(자동 오답)"}
            </p>
            <p className="hint-text">{buildHintText(current.answerEn, hintLevel)}</p>
          </div>
        )}

        {phase === "answer" && (
          <div className="answer-box">
            {typedMatch !== null && (
              <p className="answer-diff">
                {diffWords(userText, current.answerEn).map((w, i) => (
                  <span key={i} className={`diff-word diff-${w.status}`}>
                    {w.word}{" "}
                  </span>
                ))}
              </p>
            )}
            <p className="answer-en">
              {current.answerEn}
              <button
                type="button"
                className="btn ghost speak-btn"
                onClick={() => speakEnglish(current.answerEn)}
                title="발음 듣기"
                aria-label="발음 듣기"
              >
                🔊
              </button>
            </p>
            {current.chunkNote && <p className="chunk-note muted">{current.chunkNote}</p>}

            <button
              type="button"
              className="btn ghost ask-teacher-toggle"
              onClick={() => setShowAskTeacher((v) => !v)}
            >
              🧑‍🏫 질문
            </button>
            {showAskTeacher && (
              <AskTeacherPanel
                card={current}
                model={settings.preferredAiModel}
                userAnswer={userText}
                apiKey={settings.aiApiKeys?.[settings.preferredAiModel]}
                onClose={() => {
                  setShowAskTeacher(false);
                  focusRecommendedGradeButton();
                }}
                onAnswered={focusRecommendedGradeButton}
              />
            )}
          </div>
        )}
      </div>

      <div className="session-bottom">
        {phase !== "answer" ? (
          <>
            {!hintDisabledAlways && hintLevel === settings.hintFreeLevel && (
              <p className="hint-warning">여기서부턴 다시 볼 카드로 분류돼요</p>
            )}
            <button className="btn ghost" onClick={handleHint} disabled={hintLevel >= 3}>
              힌트
            </button>
            <button className="btn primary" onClick={handleShowAnswer}>
              정답 확인
            </button>
          </>
        ) : (
          <>
            <button
              ref={didntKnowBtnRef}
              className={`btn danger${typedMatch === false ? " recommended" : ""}`}
              onClick={() => handleGrade(false, typedInputMethod)}
            >
              몰랐어
            </button>
            <button
              ref={knewBtnRef}
              className={`btn success${typedMatch === true ? " recommended" : ""}`}
              onClick={() => handleGrade(true, typedInputMethod)}
              disabled={!canClaimKnew}
              title={!canClaimKnew ? "힌트를 많이 써서 다시 볼게요" : undefined}
            >
              알았어
            </button>
          </>
        )}
      </div>
    </div>
  );
}
