// UXUI §3.3 '선생님한테 질문' — 학습 세션 안에서 카드 컨텍스트 기반 1회성 Q&A를 보여주는 인라인 패널.
// 모달이 아니라 카드 위/옆에 뜨는 패널이며, 질문-답변은 저장되지 않는다(DESIGN §6).
import { useEffect, useRef, useState } from "react";
import type { Card } from "@leitner/core";
import { askTeacher, type AiModel } from "../lib/askTeacher";

interface Props {
  card: Card;
  model: AiModel;
  /** 학습자가 이번 카드에 입력한 답안. 넘기면 선생님이 그 답을 알고 첨삭해준다. */
  userAnswer?: string;
  /** 선택된 모델의 사용자 API 키(설정에서 입력). 없으면 서버 공용 키로 fallback(DESIGN §6). */
  apiKey?: string;
  onClose: () => void;
  /** 답변(성공/실패 모두)을 받은 직후 호출 — 부모가 포커스를 채점 버튼으로 되돌리는 데 쓴다.
   * 안 넘겨주면 질문/답변 후 포커스가 이 패널 안에 남아, 정답 화면의 Enter 채점 단축키가
   * 안 먹는 것처럼 보이는 문제가 생긴다. */
  onAnswered?: () => void;
}

export default function AskTeacherPanel({ card, model, userAnswer, apiKey, onClose, onAnswered }: Props) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 패널이 열리자마자 질문 입력창에 바로 커서가 가 있도록.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 모바일: 키보드가 올라오면 '질문하기' 버튼이 키보드에 가려지므로,
  // 입력창 포커스 시 패널 전체를 화면 안쪽으로 끌어올린다.
  function scrollPanelIntoView() {
    // 키보드 애니메이션이 끝난 뒤 위치가 확정되도록 약간 지연.
    setTimeout(() => {
      inputRef.current
        ?.closest(".ask-teacher-panel")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 300);
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await askTeacher(
        model,
        question.trim(),
        {
          promptKo: card.promptKo,
          answerEn: card.answerEn,
          chunkNote: card.chunkNote,
          userAnswer: userAnswer?.trim() || undefined,
        },
        apiKey
      );
      setAnswer(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      onAnswered?.();
    }
  }

  return (
    <div className="ask-teacher-panel">
      <div className="ask-teacher-header">
        <span>🧑‍🏫 선생님한테 질문</span>
        <button type="button" className="btn ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      <form onSubmit={handleAsk} className="ask-teacher-form">
        <input
          ref={inputRef}
          placeholder={
            userAnswer?.trim()
              ? "'?'만 입력하면 내 답 첨삭 / 또는 궁금한 점을 물어보세요"
              : "이 문장에 대해 궁금한 점을 물어보세요"
          }
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onFocus={scrollPanelIntoView}
          enterKeyHint="send"
          disabled={loading}
        />
        <button className="btn primary" type="submit" disabled={loading || !question.trim()}>
          질문하기
        </button>
      </form>
      {loading && <p className="muted">답변 준비 중...</p>}
      {error && <p className="ask-teacher-error">지금은 답변을 받아올 수 없어요. 잠시 후 다시 시도해 주세요. ({error})</p>}
      {answer && <p className="ask-teacher-answer">{answer}</p>}
    </div>
  );
}
