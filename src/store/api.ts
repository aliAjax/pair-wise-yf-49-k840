import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type { Evidence, Objection, PersistedState, SessionState } from "../types";

const KEY = "pair-wise-yf-49/court";
const TRIAL_KEY = "pair-wise-yf-49/trial-record";

/**
 * 旧数据迁移：升级前的存档可能缺少暂停信息、修订号、同步状态等字段，
 * 读取时统一补成默认值，保证旧存档能正常打开。
 */
function migrate(raw: any): PersistedState {
  const session: SessionState = {
    phase: raw?.session?.phase ?? "举证",
    currentEvidenceId: raw?.session?.currentEvidenceId ?? null,
    timerSeconds: raw?.session?.timerSeconds ?? 0,
    operatorMode: raw?.session?.operatorMode ?? "庭审控制",
    paused: raw?.session?.paused ?? false
  };
  return {
    evidence: (raw?.evidence ?? []) as Evidence[],
    session,
    objections: (raw?.objections ?? []).map((o: any): Objection => ({
      ...o,
      revision: o.revision ?? 1,
      syncStatus: o.syncStatus ?? "synced",
      frozenRemainingSeconds: o.frozenRemainingSeconds ?? 0
    })),
    timeline: raw?.timeline ?? [],
    snapshots: raw?.snapshots ?? [],
    recordRevision: raw?.recordRevision ?? 1
  };
}

export const courtApi = createApi({
  reducerPath: "courtApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    loadState: builder.query<PersistedState | null, void>({
      queryFn: async () => {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { data: null };
        return { data: migrate(JSON.parse(raw)) };
      }
    }),
    saveState: builder.mutation<{ ok: true }, PersistedState>({
      queryFn: async (payload) => {
        localStorage.setItem(KEY, JSON.stringify(payload));
        return { data: { ok: true } };
      }
    }),
    /** 书记员离线记下异议，回网后按修订号合并进庭审记录；失败可重试 */
    mergeTrialRecord: builder.mutation<{ revision: number; mergedIds: string[] }, { objections: Objection[]; baseRevision: number; forceFailure?: boolean }>({
      queryFn: async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (payload.forceFailure) {
          return { error: { status: 500, data: { code: "NETWORK", message: "模拟网络故障，合并失败，请重试" } } };
        }
        const raw = localStorage.getItem(TRIAL_KEY);
        const record = raw ? JSON.parse(raw) : { revision: 1, objections: [] };
        if (record.revision !== payload.baseRevision) {
          return {
            error: {
              status: 409,
              data: { code: "REVISION_CONFLICT", message: `修订号冲突（服务端 ${record.revision} / 客户端 ${payload.baseRevision}），请重试` }
            }
          };
        }
        const existing = new Set(record.objections.map((o: Objection) => o.id));
        const merged = payload.objections.filter((o) => !existing.has(o.id));
        record.objections.push(...merged);
        record.revision += 1;
        localStorage.setItem(TRIAL_KEY, JSON.stringify(record));
        return { data: { revision: record.revision, mergedIds: merged.map((o) => o.id) } };
      }
    })
  })
});

export const { useLoadStateQuery, useSaveStateMutation, useMergeTrialRecordMutation } = courtApi;
