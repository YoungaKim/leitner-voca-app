import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@leitner/core";
const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, fail: false, writes: 0, rpc: vi.fn() }));
vi.mock("../src/lib/supabase", () => ({ supabase: {
  rpc: (...args: any[]) => state.rpc(...args),
  from: (table: string) => {
    let start = 0, end = Infinity;
    const query: any = {
      select: () => query, eq: () => query, order: () => query,
      range: (a: number, b: number) => { start = a; end = b; return query; },
      maybeSingle: () => Promise.resolve({ data: state.tables[table]?.[0] ?? null, error: state.fail ? new Error("network") : null }),
      upsert: () => { state.writes++; return query; },
      then: (resolve: any, reject: any) => Promise.resolve({ data: (state.tables[table] ?? []).slice(start, end + 1), error: state.fail ? new Error("network") : null }).then(resolve, reject),
    };
    return query;
  },
} }));
import { fullSync, pushSettings, saveReviewRemote } from "../src/lib/sync";

describe("shared cloud state", () => {
  beforeEach(() => { state.tables = {}; state.fail = false; state.writes = 0; state.rpc.mockReset(); });
  it("does not upload cached settings or resurrect records removed on another device", async () => {
    const snapshot = await fullSync("user", { settings: { ...DEFAULT_SETTINGS, dailyGoal: 777 } });
    expect(snapshot.cards).toEqual([]);
    expect(snapshot.newPool).toEqual([]);
    expect(snapshot.settings.dailyGoal).toBe(DEFAULT_SETTINGS.dailyGoal);
    expect(state.writes).toBe(0);
  });
  it("reads all pages, including more than 1000 review logs", async () => {
    state.tables.review_log = Array.from({ length: 1203 }, (_, i) => ({ id: String(i), card_id: "card", date: "2026-10-08", box_before: 1, box_after: 2 }));
    expect((await fullSync("user")).reviewLog).toHaveLength(1203);
  });
  it("does not return an empty snapshot after a failed server read", async () => {
    state.fail = true;
    await expect(fullSync("user")).rejects.toThrow("network");
  });
  it("propagates Supabase write errors rather than claiming success", async () => {
    state.fail = true;
    await expect(pushSettings("user", DEFAULT_SETTINGS)).rejects.toThrow("network");
  });
  it("sends review and expected revision in a single atomic request", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    const card: any = { id: "c", deckId: "d", box: 2, tags: [] };
    const log: any = { id: "l", cardId: "c", boxBefore: 1, boxAfter: 2 };
    await saveReviewRemote("user", card, log, "revision");
    expect(state.rpc).toHaveBeenCalledWith("save_shared_review", expect.objectContaining({ expected_updated_at: "revision", log_data: expect.objectContaining({ card_id: "c" }) }));
  });
});
