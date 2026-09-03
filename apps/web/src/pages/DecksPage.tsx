// UXUI §3.4 단어장 목록.
// 덱마다 "총 개수"만 보여주면 박스에 얼마나 올라갔는지/저수지에 얼마나 쌓여있는지가 안 보여서
// (홈의 계단형 상자 차트와 같은 맥락으로) 총/박스 진행/대기(pool)를 구분 표시하고,
// 박스별 분포를 색상 segment bar로 눈에 보이게 한다.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GRADUATED_BOX } from "@leitner/core";
import { useAppStore } from "../store";

const BOX_COLORS = ["#ef4444", "#f97316", "#eab308", "#a3e635", "#22c55e", "#14b8a6", "#dca512"];

export default function DecksPage() {
  const decks = useAppStore((s) => s.decks);
  const cards = useAppStore((s) => s.cards);
  const newPool = useAppStore((s) => s.newPool);
  const addDeck = useAppStore((s) => s.addDeck);
  const renameDeck = useAppStore((s) => s.renameDeck);
  const deleteDeck = useAppStore((s) => s.deleteDeck);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function handleDelete(id: string, deckName: string, hasContent: boolean) {
    if (hasContent && !confirm(`"${deckName}" 단어장을 삭제하면 학습 내용이 사라집니다. 삭제하시겠습니까?`)) return;
    await deleteDeck(id);
  }

  function startEdit(id: string, currentName: string) {
    setEditingId(id);
    setEditName(currentName);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  async function handleRename(e: React.FormEvent, id: string) {
    e.preventDefault();
    await renameDeck(id, editName);
    cancelEdit();
  }

  const deckStats = useMemo(() => {
    const map = new Map<
      string,
      { total: number; onBox: number; pool: number; boxCounts: number[] }
    >();
    for (const deck of decks) {
      map.set(deck.id, { total: 0, onBox: 0, pool: 0, boxCounts: Array(7).fill(0) });
    }
    for (const c of cards) {
      const s = map.get(c.deckId);
      if (!s) continue;
      s.onBox += 1;
      s.total += 1;
      s.boxCounts[c.box - 1] += 1;
    }
    for (const p of newPool) {
      if (p.status !== "pending") continue;
      const s = map.get(p.deckId);
      if (!s) continue;
      s.pool += 1;
      s.total += 1;
    }
    return map;
  }, [decks, cards, newPool]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await addDeck(name.trim());
    setName("");
  }

  return (
    <div className="page">
      <h2>단어장</h2>
      <form className="inline-form" onSubmit={handleAdd}>
        <input
          placeholder="새 단어장 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn primary" type="submit" disabled={!name.trim()}>
          + 단어장
        </button>
      </form>

      <ul className="deck-list">
        {decks.map((deck) => {
          const stat = deckStats.get(deck.id) ?? { total: 0, onBox: 0, pool: 0, boxCounts: Array(7).fill(0) };
          if (editingId === deck.id) {
            return (
              <li key={deck.id} className="deck-item">
                <form className="inline-form deck-edit-form" onSubmit={(e) => handleRename(e, deck.id)}>
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && cancelEdit()}
                    required
                  />
                  <button className="btn primary" type="submit" disabled={!editName.trim()}>
                    저장
                  </button>
                  <button className="btn ghost" type="button" onClick={cancelEdit}>
                    취소
                  </button>
                </form>
              </li>
            );
          }
          return (
            <li key={deck.id} className="deck-item">
              <Link to={`/decks/${deck.id}`} className="deck-link">
                <div className="deck-row-top">
                  <span className="deck-name">{deck.name}</span>
                  <button
                    type="button"
                    className="deck-name-edit"
                    aria-label="단어장 이름 수정"
                    title="이름 수정"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startEdit(deck.id, deck.name);
                    }}
                  >
                    ✏️
                  </button>
                  <span className="deck-count">
                    총 {stat.total} · 박스 진행 {stat.onBox} · 대기(pool) {stat.pool}
                  </span>
                </div>
                {stat.total > 0 && (
                  <div className="distbar">
                    {stat.boxCounts.map((n, i) =>
                      n > 0 ? (
                        <i
                          key={i}
                          style={{ background: BOX_COLORS[i], width: `${(n / stat.total) * 100}%` }}
                          title={`${i + 1 === GRADUATED_BOX ? "졸업" : `박스 ${i + 1}`} ${n}개`}
                        />
                      ) : null
                    )}
                    {stat.pool > 0 && (
                      <i
                        className="distbar-pool"
                        style={{ width: `${(stat.pool / stat.total) * 100}%` }}
                        title={`대기(pool) ${stat.pool}개`}
                      />
                    )}
                  </div>
                )}
              </Link>
              <button
                className="btn ghost deck-delete"
                onClick={() => handleDelete(deck.id, deck.name, stat.total > 0)}
              >
                삭제
              </button>
            </li>
          );
        })}
        {decks.length === 0 && <li className="muted">아직 단어장이 없습니다.</li>}
      </ul>
    </div>
  );
}
