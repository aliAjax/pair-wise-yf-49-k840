import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Evidence, Objection, PendingSyncItem, SessionPhase, SessionState, TimelineEntry } from "../types";
import { mergeObjectionsIntoRecord, readCourtRecord } from "./server";

const seedEvidence: Evidence[] = [
  { id: "e1", exhibitNo: "原告-003", title: "项目验收会议纪要", type: "书证", duration: 8, presenter: "原告", sensitive: false, status: "待展示", note: "第4页涉及合同补充约定" },
  { id: "e2", exhibitNo: "原告-004", title: "设备故障检测报告", type: "书证", duration: 10, presenter: "原告", sensitive: true, status: "待展示", note: "含第三方客户名称，公开屏需遮罩" },
  { id: "e3", exhibitNo: "被告-002", title: "系统运行日志", type: "电子数据", duration: 12, presenter: "被告", sensitive: false, status: "待展示", note: "重点展示 14:20 至 14:45" }
];
const seedSession: SessionState = {
  phase: "举证",
  currentEvidenceId: "e1",
  timerSeconds: 8 * 60,
  operatorMode: "庭审控制",
  timerFrozen: false,
  frozenRemaining: null,
  frozenEvidenceId: null
};

interface Snapshot {
  id: string;
  label: string;
  time: string;
  evidence: Evidence[];
  session: SessionState;
}

export interface CourtState {
  initialized: boolean;
  evidence: Evidence[];
  objections: Objection[];
  timeline: TimelineEntry[];
  snapshots: Snapshot[];
  session: SessionState;
  online: boolean;
  /** 本地所知的庭审记录修订号，合并离线异议时作为基准 */
  recordRevision: number;
  /** 离线记录、等待合并进庭审记录的异议 */
  pendingSync: PendingSyncItem[];
  syncing: boolean;
}

const initialState: CourtState = {
  initialized: false,
  evidence: seedEvidence,
  objections: [{ id: "o1", evidenceId: "e2", ground: "关联性异议", explanation: "检测报告来源和保管链尚未说明。", status: "待裁定", createdAt: new Date().toISOString() }],
  timeline: [{ id: "t1", time: new Date().toISOString(), actor: "书记员", action: "庭审开始", detail: "核对到庭人员并宣布法庭纪律" }],
  snapshots: [],
  session: seedSession,
  online: true,
  recordRevision: 0,
  pendingSync: [],
  syncing: false
};

function addEntry(state: CourtState, actor: TimelineEntry["actor"], action: string, detail: string) {
  state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor, action, detail });
}

function clearFreeze(state: CourtState) {
  state.session.timerFrozen = false;
  state.session.frozenRemaining = null;
  state.session.frozenEvidenceId = null;
}

/** 回网后把离线异议按修订号合并进庭审记录；rebase 时先重新对齐服务端修订号（用于失败重试） */
export const syncPendingObjections = createAsyncThunk<
  { revision: number; mergedIds: string[] },
  { rebase?: boolean },
  { state: { court: CourtState }; rejectValue: string }
>(
  "court/syncPendingObjections",
  async (arg, { getState, rejectWithValue }) => {
    const { court } = getState();
    const objections = court.pendingSync
      .map((item) => court.objections.find((entry) => entry.id === item.objectionId))
      .filter((entry): entry is Objection => Boolean(entry));
    if (!objections.length) {
      // 队列里的异议已不在本地记录中，视为处理完毕，清出队列
      return { revision: court.recordRevision, mergedIds: court.pendingSync.map((item) => item.objectionId) };
    }
    try {
      const baseRevision = arg.rebase ? readCourtRecord().revision : court.recordRevision;
      const record = mergeObjectionsIntoRecord(baseRevision, objections);
      return { revision: record.revision, mergedIds: objections.map((entry) => entry.id) };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "合并失败，请重试");
    }
  },
  {
    // 防止重复合并（如自动同步与手动重试同时触发）
    condition: (_arg, { getState }) => {
      const { court } = getState();
      return court.pendingSync.length > 0 && !court.syncing;
    }
  }
);

const slice = createSlice({
  name: "court",
  initialState,
  reducers: {
    initialize(state, action: PayloadAction<{ evidence: Evidence[]; session: SessionState | null; recordRevision: number }>) {
      if (state.initialized) return;
      const evidence = action.payload.evidence.length ? action.payload.evidence : seedEvidence;
      state.evidence = evidence;
      const session: SessionState = action.payload.session ? { ...action.payload.session } : { ...seedSession };
      // 旧数据可能缺少会话或指向已不存在的证据，这里统一校正
      if (!session.currentEvidenceId || !evidence.some((entry) => entry.id === session.currentEvidenceId)) {
        session.currentEvidenceId = (evidence.find((entry) => entry.status === "展示中") ?? evidence.find((entry) => entry.status === "待展示"))?.id ?? null;
      }
      const current = evidence.find((entry) => entry.id === session.currentEvidenceId);
      if (current && session.timerSeconds <= 0) session.timerSeconds = current.duration * 60;
      state.session = session;
      state.recordRevision = action.payload.recordRevision;
      state.initialized = true;
    },
    setOnline(state, action: PayloadAction<boolean>) { state.online = action.payload; },
    setMode(state, action: PayloadAction<SessionState["operatorMode"]>) { state.session.operatorMode = action.payload; },
    reorder(state, action: PayloadAction<Evidence[]>) { state.evidence = action.payload; addEntry(state, "书记员", "调整证据顺序", "已更新举证顺序"); },
    selectEvidence(state, action: PayloadAction<string>) { const item = state.evidence.find((entry) => entry.id === action.payload); if (!item) return; state.session.currentEvidenceId = item.id; state.session.timerSeconds = item.duration * 60; addEntry(state, item.presenter, "切换展示证据", `${item.exhibitNo} ${item.title}`); },
    showEvidence(state) { const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId); if (!item) return; item.status = "展示中"; state.session.phase = "质证"; addEntry(state, item.presenter, "开始展示", item.title); },
    completeEvidence(state) {
      const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
      if (!item) return;
      item.status = "已展示";
      if (state.session.frozenEvidenceId === item.id) clearFreeze(state);
      const next = state.evidence.find((entry) => entry.status === "待展示");
      state.session.currentEvidenceId = next?.id ?? null;
      state.session.timerSeconds = (next?.duration ?? 0) * 60;
      state.session.phase = next ? "举证" : "休庭";
      addEntry(state, "审判庭", "完成质证", item.title);
    },
    toggleSensitive(state, action: PayloadAction<string>) { const item = state.evidence.find((entry) => entry.id === action.payload); if (!item) return; item.sensitive = !item.sensitive; addEntry(state, "审判庭", item.sensitive ? "隐藏敏感内容" : "恢复公开内容", item.title); },
    addObjection(state, action: PayloadAction<{ evidenceId: string; ground: string; explanation: string }>) {
      const item = state.evidence.find((entry) => entry.id === action.payload.evidenceId);
      const objection: Objection = { ...action.payload, id: crypto.randomUUID(), status: "待裁定", createdAt: new Date().toISOString() };
      state.objections.unshift(objection);
      // 提出异议先冻结该证据的剩余时长，等待裁定
      if (state.session.currentEvidenceId === action.payload.evidenceId) {
        state.session.timerFrozen = true;
        state.session.frozenRemaining = state.session.timerSeconds;
        state.session.frozenEvidenceId = action.payload.evidenceId;
      }
      state.session.phase = "质证";
      if (state.online) {
        addEntry(state, item?.presenter ?? "审判庭", "提出异议", `${item?.exhibitNo ?? ""} ${action.payload.ground}`);
      } else {
        // 书记员离线记下异议，回网后按修订号合并进庭审记录
        state.pendingSync.unshift({ objectionId: objection.id, baseRevision: state.recordRevision, attempts: 0, lastError: null, status: "待同步" });
        addEntry(state, item?.presenter ?? "审判庭", "离线记录异议", `${item?.exhibitNo ?? ""} ${action.payload.ground}（回网后合并入庭审记录）`);
      }
    },
    resolveObjection(state, action: PayloadAction<{ id: string; status: "支持" | "驳回" }>) {
      const objection = state.objections.find((entry) => entry.id === action.payload.id);
      if (!objection || objection.status !== "待裁定") return;
      objection.status = action.payload.status;
      const item = state.evidence.find((entry) => entry.id === objection.evidenceId);
      const frozenHere = state.session.timerFrozen && state.session.frozenEvidenceId === objection.evidenceId;
      if (action.payload.status === "支持") {
        if (item) item.status = "已跳过";
        // 异议成立：该证据退出公开屏，剩余时长失效，切到下一条并重算计时
        if (state.session.currentEvidenceId === objection.evidenceId) {
          const next = state.evidence.find((entry) => entry.status === "待展示");
          state.session.currentEvidenceId = next?.id ?? null;
          state.session.timerSeconds = (next?.duration ?? 0) * 60;
          state.session.phase = next ? "举证" : "休庭";
        }
        if (frozenHere) clearFreeze(state);
        addEntry(state, "审判庭", "异议成立", `${item?.exhibitNo ?? ""} 退出公开屏，剩余时长已重算`);
      } else {
        // 异议驳回：从冻结处继续展示；同一证据还有其他异议在审议时保持冻结
        const stillPending = state.objections.some((entry) => entry.id !== objection.id && entry.status === "待裁定" && entry.evidenceId === objection.evidenceId);
        if (frozenHere && !stillPending) {
          state.session.currentEvidenceId = state.session.frozenEvidenceId;
          state.session.timerSeconds = state.session.frozenRemaining ?? state.session.timerSeconds;
          clearFreeze(state);
        }
        addEntry(state, "审判庭", "异议驳回", item ? `${item.exhibitNo} 从冻结处继续展示` : "继续质证");
      }
    },
    snapshot(state, action: PayloadAction<string>) { state.snapshots.unshift({ id: crypto.randomUUID(), label: action.payload, time: new Date().toISOString(), evidence: structuredClone(state.evidence), session: structuredClone(state.session) }); state.snapshots = state.snapshots.slice(0, 10); },
    restore(state, action: PayloadAction<string>) { const snapshot = state.snapshots.find((entry) => entry.id === action.payload); if (!snapshot) return; state.evidence = structuredClone(snapshot.evidence); state.session = structuredClone(snapshot.session); addEntry(state, "审判庭", "恢复庭审快照", snapshot.label); },
    tick(state) { if (state.session.phase === "质证" && !state.session.timerFrozen && state.session.timerSeconds > 0) state.session.timerSeconds -= 1; },
    setPhase(state, action: PayloadAction<SessionPhase>) { state.session.phase = action.payload; addEntry(state, "审判庭", "切换庭审阶段", action.payload); }
  },
  extraReducers: (builder) => {
    builder
      .addCase(syncPendingObjections.pending, (state) => { state.syncing = true; })
      .addCase(syncPendingObjections.fulfilled, (state, action) => {
        state.syncing = false;
        state.recordRevision = action.payload.revision;
        const merged = new Set(action.payload.mergedIds);
        state.pendingSync = state.pendingSync.filter((item) => !merged.has(item.objectionId));
        if (merged.size) addEntry(state, "书记员", "合并离线异议", `${merged.size} 条异议已按修订号 ${action.payload.revision} 合并入庭审记录`);
      })
      .addCase(syncPendingObjections.rejected, (state, action) => {
        state.syncing = false;
        if (action.meta.condition) return; // 已有合并进行中，直接忽略
        const message = action.payload ?? "合并失败，请重试";
        state.pendingSync.forEach((item) => { item.status = "同步失败"; item.attempts += 1; item.lastError = message; });
        addEntry(state, "书记员", "异议合并失败", `${message}，可在在线后重试`);
      });
  }
});

export const { initialize, setOnline, setMode, reorder, selectEvidence, showEvidence, completeEvidence, toggleSensitive, addObjection, resolveObjection, snapshot, restore, tick, setPhase } = slice.actions;
export default slice.reducer;
