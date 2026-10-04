import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Evidence, Objection, ObjectionStatus, SessionPhase, SessionState, TimelineEntry } from "../types";

const seedEvidence: Evidence[] = [
  { id: "e1", exhibitNo: "原告-003", title: "项目验收会议纪要", type: "书证", duration: 8, presenter: "原告", sensitive: false, status: "待展示", note: "第4页涉及合同补充约定" },
  { id: "e2", exhibitNo: "原告-004", title: "设备故障检测报告", type: "书证", duration: 10, presenter: "原告", sensitive: true, status: "待展示", note: "含第三方客户名称，公开屏需遮罩" },
  { id: "e3", exhibitNo: "被告-002", title: "系统运行日志", type: "电子数据", duration: 12, presenter: "被告", sensitive: false, status: "待展示", note: "重点展示 14:20 至 14:45" }
];
const seedSession: SessionState = { phase: "举证", currentEvidenceId: "e1", timerSeconds: 8 * 60, operatorMode: "庭审控制", paused: false };

interface State {
  initialized: boolean;
  evidence: Evidence[];
  objections: Objection[];
  timeline: TimelineEntry[];
  snapshots: { id: string; label: string; time: string; evidence: Evidence[]; phase: SessionPhase; currentEvidenceId: string | null }[];
  session: SessionState;
  online: boolean;
  /** 庭审记录修订号，离线合并时按修订号对齐 */
  recordRevision: number;
  mergeStatus: "idle" | "merging" | "succeeded" | "failed";
  mergeError: string | null;
  /** 演示用：强制下一次合并失败以验证重试 */
  forceMergeFailure: boolean;
}

const initialState: State = {
  initialized: false,
  evidence: seedEvidence,
  objections: [{ id: "o1", evidenceId: "e2", ground: "关联性异议", explanation: "检测报告来源和保管链尚未说明。", status: "待裁定", createdAt: new Date().toISOString(), revision: 1, syncStatus: "synced", frozenRemainingSeconds: 0 }],
  timeline: [{ id: "t1", time: new Date().toISOString(), actor: "书记员", action: "庭审开始", detail: "核对到庭人员并宣布法庭纪律" }],
  snapshots: [],
  session: seedSession,
  online: true,
  recordRevision: 1,
  mergeStatus: "idle",
  mergeError: null,
  forceMergeFailure: false
};

function addEntry(state: State, actor: TimelineEntry["actor"], action: string, detail: string) {
  state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor, action, detail });
}

const slice = createSlice({
  name: "court",
  initialState,
  reducers: {
    setOnline(state, action: PayloadAction<boolean>) { state.online = action.payload; },
    setMode(state, action: PayloadAction<SessionState["operatorMode"]>) { state.session.operatorMode = action.payload; },
    reorder(state, action: PayloadAction<Evidence[]>) { state.evidence = action.payload; addEntry(state, "书记员", "调整证据顺序", "已更新举证顺序"); },
    selectEvidence(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      if (!item) return;
      state.session.currentEvidenceId = item.id;
      state.session.timerSeconds = item.duration * 60;
      state.session.paused = false;
      addEntry(state, item.presenter, "切换展示证据", `${item.exhibitNo} ${item.title}`);
    },
    showEvidence(state) {
      const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
      if (!item) return;
      item.status = "展示中";
      state.session.phase = "质证";
      state.session.paused = false;
      addEntry(state, item.presenter, "开始展示", item.title);
    },
    completeEvidence(state) {
      const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
      if (!item) return;
      item.status = "已展示";
      const next = state.evidence.find((entry) => entry.status === "待展示");
      state.session.currentEvidenceId = next?.id ?? null;
      state.session.timerSeconds = (next?.duration ?? 0) * 60;
      state.session.phase = next ? "举证" : "休庭";
      state.session.paused = false;
      addEntry(state, "审判庭", "完成质证", item.title);
    },
    toggleSensitive(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      if (!item) return;
      item.sensitive = !item.sensitive;
      addEntry(state, "审判庭", item.sensitive ? "隐藏敏感内容" : "恢复公开内容", item.title);
    },
    addObjection(state, action: PayloadAction<{ evidenceId: string; ground: string; explanation: string }>) {
      const item = state.evidence.find((entry) => entry.id === action.payload.evidenceId);
      const isCurrent = state.session.currentEvidenceId === action.payload.evidenceId;
      // 提出异议先冻结该证据的剩余时长
      const frozen = isCurrent ? state.session.timerSeconds : 0;
      state.objections.unshift({
        ...action.payload,
        id: crypto.randomUUID(),
        status: "待裁定",
        createdAt: new Date().toISOString(),
        revision: state.recordRevision,
        syncStatus: "pending",
        frozenRemainingSeconds: frozen
      });
      if (isCurrent) state.session.paused = true;
      state.session.phase = "质证";
      addEntry(state, item?.presenter ?? "审判庭", "提出异议", `${item?.exhibitNo ?? ""} ${action.payload.ground}${isCurrent ? "，剩余时长已冻结" : ""}`);
    },
    resolveObjection(state, action: PayloadAction<{ id: string; status: ObjectionStatus }>) {
      const objection = state.objections.find((entry) => entry.id === action.payload.id);
      if (!objection) return;
      objection.status = action.payload.status;
      const item = state.evidence.find((entry) => entry.id === objection.evidenceId);
      if (action.payload.status === "支持" && item) {
        item.status = "已跳过";
        // 支持后剩余时长失效重算：切到下一条并按其时长重算
        const next = state.evidence.find((entry) => entry.status === "待展示");
        state.session.currentEvidenceId = next?.id ?? null;
        state.session.timerSeconds = (next?.duration ?? 0) * 60;
        state.session.paused = false;
        // 退出公开屏
        state.session.operatorMode = "庭审控制";
        addEntry(state, "审判庭", "异议成立", `${item.exhibitNo} 暂不展示，剩余时长失效并重算`);
      } else {
        // 驳回后从冻结处继续
        state.session.paused = false;
        addEntry(state, "审判庭", "异议驳回", `${item?.exhibitNo ?? ""} 继续质证`);
      }
    },
    snapshot(state, action: PayloadAction<string>) {
      state.snapshots.unshift({ id: crypto.randomUUID(), label: action.payload, time: new Date().toISOString(), evidence: structuredClone(state.evidence), phase: state.session.phase, currentEvidenceId: state.session.currentEvidenceId });
      state.snapshots = state.snapshots.slice(0, 10);
    },
    restore(state, action: PayloadAction<string>) {
      const snapshot = state.snapshots.find((entry) => entry.id === action.payload);
      if (!snapshot) return;
      state.evidence = structuredClone(snapshot.evidence);
      state.session.phase = snapshot.phase;
      state.session.currentEvidenceId = snapshot.currentEvidenceId;
      state.session.paused = false;
      addEntry(state, "审判庭", "恢复庭审快照", snapshot.label);
    },
    tick(state) {
      if (state.session.phase === "质证" && !state.session.paused && state.session.timerSeconds > 0) {
        state.session.timerSeconds -= 1;
      }
    },
    setPhase(state, action: PayloadAction<SessionPhase>) {
      state.session.phase = action.payload;
      addEntry(state, "审判庭", "切换庭审阶段", action.payload);
    },
    // 合并生命周期
    mergeStarted(state) { state.mergeStatus = "merging"; state.mergeError = null; },
    mergeSucceeded(state, action: PayloadAction<{ revision: number }>) {
      state.mergeStatus = "succeeded";
      state.recordRevision = action.payload.revision;
      state.objections = state.objections.map((entry) => entry.syncStatus === "synced" ? entry : { ...entry, syncStatus: "synced", syncError: undefined });
      addEntry(state, "书记员", "异议合并入卷", `按修订号 ${action.payload.revision} 合并 ${state.objections.filter((o) => o.syncStatus === "synced").length} 条异议`);
    },
    mergeFailed(state, action: PayloadAction<string>) {
      state.mergeStatus = "failed";
      state.mergeError = action.payload;
      state.objections = state.objections.map((entry) => entry.syncStatus === "synced" ? entry : { ...entry, syncStatus: "failed", syncError: action.payload });
    },
    setForceMergeFailure(state, action: PayloadAction<boolean>) { state.forceMergeFailure = action.payload; },
    /** 从本地存档恢复完整状态（已对旧数据做默认值迁移） */
    hydrate(state, action: PayloadAction<Partial<State>>) {
      const loaded = action.payload;
      if (loaded.evidence) state.evidence = loaded.evidence;
      if (loaded.session) state.session = { ...state.session, ...loaded.session, paused: loaded.session.paused ?? false };
      if (loaded.objections) state.objections = loaded.objections;
      if (loaded.timeline) state.timeline = loaded.timeline;
      if (loaded.snapshots) state.snapshots = loaded.snapshots;
      if (typeof loaded.recordRevision === "number") state.recordRevision = loaded.recordRevision;
      state.mergeStatus = "idle";
      state.mergeError = null;
      state.forceMergeFailure = false;
      state.initialized = true;
    }
  }
});

export const {
  setOnline, setMode, reorder, selectEvidence, showEvidence, completeEvidence, toggleSensitive,
  addObjection, resolveObjection, snapshot, restore, tick, setPhase,
  mergeStarted, mergeSucceeded, mergeFailed, setForceMergeFailure, hydrate
} = slice.actions;
export default slice.reducer;
