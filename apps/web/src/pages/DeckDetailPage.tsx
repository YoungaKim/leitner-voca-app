// UXUI §3.4 덱 상세(카드 목록) + 카드 추가 폼.
// 수동 CSV 파일 업로드는 스펙 아웃(2026-08-26) — 콘텐츠 소스는 구글시트 자동 동기화(설정
// 화면, 2d)로 단일화. 이 화면엔 "설정으로 가서 시트 동기화" 안내만 남긴다.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppStore } from "../store";

const BOX_LABEL = ["", "1", "2", "3", "4", "5", "6", "졸업"];

export default function DeckDetailPage() {
  const { deckId } = useParams<{ deckId: string }>();
  // 셀렉터 안에서 .filter()로 새 배열을 만들면 zustand가 매 렌더 "스냅샷이 바뀜"으로
  // 오인해 무한 리렌더에 빠진다(useSyncExternalStore 특성). 원본 배열만 셀렉트하고
  // 파생 목록은 useMemo로 컴포넌트 쪽에서 계산한다.
  const deck = useAppStore((s) => s.decks.find((d) => d.id === deckId));
  const allCards = useAppStore((s) => s.cards);
  const allNewPool = useAppStore((s) => s.newPool);
  const cards = useMemo(() => allCards.filter((c) => c.deckId === deckId), [allCards, deckId]);
  const newPool = useMemo(() => allNewPool.filter((p) => p.deckId === deckId), [allNewPool, deckId]);
  const addCard = useAppStore((s) => s.addCard);
  const deleteCard = useAppStore((s) => s.deleteCard);

  const [search, setSearch] = useState("");
  const [boxFilter, setBoxFilter] = useState<string>("전체");
  const [promptKo, setPromptKo] = useState("");
  const [answerEn, setAnswerEn] = useState("");
  const [chunkNote, setChunkNote] = useState("");

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (boxFilter === "졸업" && c.box !== 7) return false;
      if (boxFilter !== "전체" && boxFilter !== "졸업" && String(c.box) !== boxFilter) return false;
      if (search && !c.answerEn.toLowerCase().includes(search.toLowerCase()) && !c.promptKo.includes(search))
        return false;
      return true;
    });
  }, [cards, boxFilter, search]);

  if (!deck) return <div className="page">덱을 찾을 수 없습니다.</div>;

  async function handleAddCard(e: React.FormEvent) {
    e.preventDefault();
    if (!promptKo.trim() || !answerEn.trim()) return;
    await addCard({ deckId: deck!.id, promptKo: promptKo.trim(), answerEn: answerEn.trim(), chunkNote: chunkNote.trim() || undefined });
    setPromptKo("");
    setAnswerEn("");
    setChunkNote("");
  }

  return (
    <div className="page page-wide">
      <h2>{deck.name}</h2>
      <p className="muted">
        학습 시작한 카드 {cards.length}개 · 저수지(대기) {newPool.length}개
      </p>

      <div className="filters">
        <input placeholder="검색" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={boxFilter} onChange={(e) => setBoxFilter(e.target.value)}>
          {["전체", "1", "2", "3", "4", "5", "6", "졸업"].map((v) => (
            <option key={v} value={v}>
              {v === "전체" ? "전체" : `박스 ${v}`}
            </option>
          ))}
        </select>
      </div>

      <ul className="card-list">
        {filtered.map((c) => (
          <li key={c.id}>
            <span className="card-text">
              <span className="card-en">{c.answerEn}</span>
              <span className="card-ko muted">{c.promptKo}</span>
            </span>
            <span className="box-dot">박스 {BOX_LABEL[c.box]}</span>
            <button className="btn card-delete" onClick={() => deleteCard(c.id)}>
              삭제
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="muted">카드가 없습니다.</li>}
      </ul>

      <h3>카드 추가</h3>
      <form className="card-form" onSubmit={handleAddCard}>
        <input placeholder="한글 문장(제시)" value={promptKo} onChange={(e) => setPromptKo(e.target.value)} required />
        <input placeholder="영어 문장(정답)" value={answerEn} onChange={(e) => setAnswerEn(e.target.value)} required />
        <input placeholder="청크·문법 메모(선택)" value={chunkNote} onChange={(e) => setChunkNote(e.target.value)} />
        <button className="btn primary" type="submit" disabled={!promptKo.trim() || !answerEn.trim()}>
          카드 추가
        </button>
      </form>

      <p className="muted" style={{ marginTop: "1.5rem" }}>
        문장을 대량으로 채우려면 파일 업로드 대신 <Link to="/settings">설정에서 구글시트 동기화</Link>를 등록하세요.
      </p>
    </div>
  );
}
