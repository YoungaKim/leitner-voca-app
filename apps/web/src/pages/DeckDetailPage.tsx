// UXUI §3.4 덱 상세(카드 목록) + 카드 추가 폼.
// 수동 CSV 파일 업로드는 스펙 아웃(2026-08-26) — 콘텐츠 소스는 구글시트 자동 동기화(설정
// 화면, 2d)로 단일화. 이 화면엔 "설정으로 가서 시트 동기화" 안내만 남긴다.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Card, NewPoolItem } from "@leitner/core";
import { useAppStore } from "../store";

const BOX_LABEL = ["신규", "1", "2", "3", "4", "5", "6", "졸업"];

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
  const updateCard = useAppStore((s) => s.updateCard);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPromptKo, setEditPromptKo] = useState("");
  const [editAnswerEn, setEditAnswerEn] = useState("");
  const [editChunkNote, setEditChunkNote] = useState("");

  function startEdit(c: Card) {
    setEditingId(c.id);
    setEditPromptKo(c.promptKo);
    setEditAnswerEn(c.answerEn);
    setEditChunkNote(c.chunkNote ?? "");
  }

  async function handleSaveEdit(c: Card) {
    if (!editPromptKo.trim() || !editAnswerEn.trim()) return;
    await updateCard({
      ...c,
      promptKo: editPromptKo.trim(),
      answerEn: editAnswerEn.trim(),
      chunkNote: editChunkNote.trim() || undefined,
    });
    setEditingId(null);
  }

  // 카드가 많으면 목록이 길어져 "카드 추가" 폼까지 내려간 뒤 맨 위로 돌아가기 번거로움 → 스크롤 시 노출되는 위로가기 버튼.
  const [showToTop, setShowToTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowToTop(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [search, setSearch] = useState("");
  const [boxFilter, setBoxFilter] = useState<string>("전체");
  const [sortKey, setSortKey] = useState<"추가순" | "영문장" | "박스">("추가순");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showAddForm, setShowAddForm] = useState(false);
  const [promptKo, setPromptKo] = useState("");
  const [answerEn, setAnswerEn] = useState("");
  const [chunkNote, setChunkNote] = useState("");

  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // 검색·필터·정렬이 바뀌면 다시 첫 페이지부터.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, boxFilter, sortKey, sortDir]);

  // 학습 시작한 카드 + 아직 대기 중인 저수지 문장을 한 목록에 섞어 보여준다.
  // 대기 문장은 box가 없으므로 정렬 시 "신규(0)"보다 앞(-1)으로 취급한다.
  type Row = { kind: "card"; card: Card } | { kind: "pending"; item: NewPoolItem };

  // 한글·영어·메모를 하나의 텍스트로 합쳐 통합 검색한다. 공백으로 나눈 각 단어가
  // (어느 필드에 있든) 모두 포함되면 일치 — "회의 report"처럼 한영 섞어 검색 가능.
  const searchTokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  const matchesSearch = (en: string, ko: string, note?: string) => {
    if (searchTokens.length === 0) return true;
    const hay = `${ko} ${en} ${note ?? ""}`.toLowerCase();
    return searchTokens.every((t) => hay.includes(t));
  };

  const filtered = useMemo<Row[]>(() => {
    const cardRows: Row[] = cards
      .filter((c) => {
        if (boxFilter === "졸업" && c.box !== 7) return false;
        if (
          boxFilter !== "전체" &&
          boxFilter !== "대기 제외" &&
          boxFilter !== "졸업" &&
          String(c.box) !== boxFilter
        )
          return false;
        return matchesSearch(c.answerEn, c.promptKo, c.chunkNote);
      })
      .map((card) => ({ kind: "card", card }));

    // 대기 문장은 박스 필터가 "전체" 또는 "대기"일 때만 노출.
    const pendingRows: Row[] =
      boxFilter === "전체" || boxFilter === "대기"
        ? newPool
            .filter((p) => matchesSearch(p.answerEn, p.promptKo, p.chunkNote))
            .map((item) => ({ kind: "pending", item }))
        : [];

    const list = [...cardRows, ...pendingRows];
    const boxOf = (r: Row) => (r.kind === "card" ? r.card.box : -1);
    const enOf = (r: Row) => (r.kind === "card" ? r.card.answerEn : r.item.answerEn);

    if (sortKey !== "추가순") {
      list.sort((a, b) => {
        const cmp =
          sortKey === "영문장"
            ? enOf(a).localeCompare(enOf(b), "en", { sensitivity: "base" })
            : boxOf(a) - boxOf(b);
        return sortDir === "asc" ? cmp : -cmp;
      });
    } else if (sortDir === "desc") {
      list.reverse();
    }
    return list;
  }, [cards, newPool, boxFilter, search, sortKey, sortDir]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

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

      <button
        type="button"
        className="btn"
        aria-expanded={showAddForm}
        onClick={() => setShowAddForm((v) => !v)}
      >
        {showAddForm ? "▲ 카드 추가 닫기" : "＋ 카드 추가"}
      </button>
      <p className="muted">
        학습 시작한 카드 {cards.length}개 · 저수지(대기) {newPool.length}개
      </p>
      {showAddForm && (
        <form className="card-form add-card-form" onSubmit={handleAddCard}>
          <input placeholder="한글 문장(제시)" value={promptKo} onChange={(e) => setPromptKo(e.target.value)} required />
          <input placeholder="영어 문장(정답)" value={answerEn} onChange={(e) => setAnswerEn(e.target.value)} required />
          <input placeholder="청크·문법 메모(선택)" value={chunkNote} onChange={(e) => setChunkNote(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!promptKo.trim() || !answerEn.trim()}>
            카드 추가
          </button>
        </form>
      )}

      <div className="filters">
        <span className="search-box">
          <input
            placeholder="검색 (한글·영어·메모)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setSearch("")}
              aria-label="검색어 지우기"
            >
              ×
            </button>
          )}
        </span>
        <select value={boxFilter} onChange={(e) => setBoxFilter(e.target.value)}>
          {["전체", "대기 제외", "대기", "1", "2", "3", "4", "5", "6", "졸업"].map((v) => (
            <option key={v} value={v}>
              {v === "전체" || v === "대기" || v === "대기 제외" ? v : `박스 ${v}`}
            </option>
          ))}
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)}>
          <option value="추가순">추가순</option>
          <option value="영문장">영문장</option>
          <option value="박스">박스</option>
        </select>
        <button
          type="button"
          className="btn"
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          aria-label={sortDir === "asc" ? "오름차순" : "내림차순"}
        >
          {sortDir === "asc" ? "↑ 오름차순" : "↓ 내림차순"}
        </button>
      </div>

      <ul className="card-list">
        {visible.map((row) => {
          if (row.kind === "pending") {
            const p = row.item;
            return (
              <li key={`pool-${p.id}`}>
                <span className="card-text">
                  <span className="card-en">{p.answerEn}</span>
                  <span className="card-ko muted">{p.promptKo}</span>
                  {p.chunkNote && <span className="card-note muted">{p.chunkNote}</span>}
                </span>
                <span className="box-dot box-dot-pending">대기</span>
              </li>
            );
          }
          const c = row.card;
          return editingId === c.id ? (
            <li key={c.id}>
              <form
                className="card-form card-edit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveEdit(c);
                }}
              >
                <textarea
                  placeholder="한글 문장(제시)"
                  value={editPromptKo}
                  onChange={(e) => setEditPromptKo(e.target.value)}
                  rows={2}
                  required
                />
                <textarea
                  placeholder="영어 문장(정답)"
                  value={editAnswerEn}
                  onChange={(e) => setEditAnswerEn(e.target.value)}
                  rows={2}
                  required
                />
                <textarea
                  placeholder="청크·문법 메모(선택)"
                  value={editChunkNote}
                  onChange={(e) => setEditChunkNote(e.target.value)}
                  rows={2}
                />
                <div className="card-edit-actions">
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={!editPromptKo.trim() || !editAnswerEn.trim()}
                  >
                    저장
                  </button>
                  <button className="btn" type="button" onClick={() => setEditingId(null)}>
                    취소
                  </button>
                </div>
              </form>
            </li>
          ) : (
            <li key={c.id}>
              <span className="card-text">
                <span className="card-en">{c.answerEn}</span>
                <span className="card-ko muted">{c.promptKo}</span>
                {c.chunkNote && <span className="card-note muted">{c.chunkNote}</span>}
              </span>
              <span className="box-dot">
                {c.box === 0 || c.box === 7 ? BOX_LABEL[c.box] : `박스 ${BOX_LABEL[c.box]}`}
              </span>
              <button className="btn card-delete" onClick={() => startEdit(c)}>
                수정
              </button>
              <button className="btn card-delete" onClick={() => deleteCard(c.id)}>
                삭제
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="muted">카드가 없습니다.</li>}
      </ul>

      {visible.length < filtered.length && (
        <div className="load-more">
          <button
            type="button"
            className="btn"
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          >
            더보기 ({visible.length}/{filtered.length})
          </button>
        </div>
      )}

      <p className="muted" style={{ marginTop: "1.5rem" }}>
        문장을 대량으로 채우려면 파일 업로드 대신 <Link to="/settings">설정에서 구글시트 동기화</Link>를 등록하세요.
      </p>

      {showToTop && (
        <button
          type="button"
          className="btn to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="맨 위로"
        >
          ↑ 맨 위로
        </button>
      )}
    </div>
  );
}
