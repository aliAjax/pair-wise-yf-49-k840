export type Party = "原告" | "被告" | "审判庭";
export type EvidenceStatus = "待展示" | "展示中" | "已展示" | "已跳过";
export type SessionPhase = "开庭" | "举证" | "质证" | "休庭" | "结束";

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
  status: "待裁定" | "支持" | "驳回";
  createdAt: string;
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
  /** 异议提出后冻结计时，公开屏展示暂停 */
  timerFrozen: boolean;
  /** 冻结时的剩余秒数，驳回后从这里继续 */
  frozenRemaining: number | null;
  /** 被冻结的证据，裁定时据此恢复或退出公开屏 */
  frozenEvidenceId: string | null;
}

/** 离线记录的异议，回网后按修订号合并进庭审记录 */
export interface PendingSyncItem {
  objectionId: string;
  /** 记录异议时本地所知的庭审记录修订号 */
  baseRevision: number;
  attempts: number;
  lastError: string | null;
  status: "待同步" | "同步失败";
}
