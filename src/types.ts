export type Party = "原告" | "被告" | "审判庭";
export type EvidenceStatus = "待展示" | "展示中" | "已展示" | "已跳过";
export type SessionPhase = "开庭" | "举证" | "质证" | "休庭" | "结束";
export type ObjectionStatus = "待裁定" | "支持" | "驳回";
/** 异议同步状态：待同步 / 已入卷 / 合并失败 */
export type SyncStatus = "pending" | "synced" | "failed";

export interface Evidence {
  id: string;
  exhibitNo: string;
  title: string;
  type: "书证" | "物证" | "电子数据" | "证人";
  duration: number;
  presenter: Party;
  sensitive: boolean;
  status: EvidenceStatus;
  note: string;
}

export interface Objection {
  id: string;
  evidenceId: string;
  ground: string;
  explanation: string;
  status: ObjectionStatus;
  createdAt: string;
  /** 提出异议时依据的庭审记录修订号 */
  revision: number;
  /** 离线合并状态 */
  syncStatus: SyncStatus;
  /** 冻结时该证据的剩余时长（秒） */
  frozenRemainingSeconds: number;
  /** 合并失败原因 */
  syncError?: string;
}

export interface TimelineEntry {
  id: string;
  time: string;
  actor: Party | "书记员";
  action: string;
  detail: string;
}

export interface SessionState {
  phase: SessionPhase;
  currentEvidenceId: string | null;
  timerSeconds: number;
  operatorMode: "庭审控制" | "公开屏预览";
  /** 异议冻结：剩余时长暂停走表 */
  paused: boolean;
}

/** 持久化到本地的完整庭审记录 */
export interface PersistedState {
  evidence: Evidence[];
  session: SessionState;
  objections: Objection[];
  timeline: TimelineEntry[];
  snapshots: { id: string; label: string; time: string; evidence: Evidence[]; phase: SessionPhase; currentEvidenceId: string | null }[];
  recordRevision: number;
}
