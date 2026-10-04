import type { Evidence, SessionState } from "../types";

/**
 * 本地持久化版本。
 * v1：只保存证据目录（{ evidence }），没有庭审会话，更没有暂停信息；
 * v2：起持久化完整会话（含 timerFrozen / frozenRemaining / frozenEvidenceId）。
 */
export const STORAGE_VERSION = 2;

export function defaultSession(): SessionState {
  return {
    phase: "开庭",
    currentEvidenceId: null,
    timerSeconds: 0,
    operatorMode: "庭审控制",
    timerFrozen: false,
    frozenRemaining: null,
    frozenEvidenceId: null
  };
}

/** 旧数据缺少暂停信息等字段时，逐项补默认值，保证升级后能正常打开 */
export function normalizeSession(session?: Partial<SessionState> | null): SessionState {
  const base = defaultSession();
  if (!session) return base;
  return {
    phase: session.phase ?? base.phase,
    currentEvidenceId: session.currentEvidenceId ?? null,
    timerSeconds: typeof session.timerSeconds === "number" ? session.timerSeconds : base.timerSeconds,
    operatorMode: session.operatorMode ?? base.operatorMode,
    timerFrozen: session.timerFrozen ?? false,
    frozenRemaining: typeof session.frozenRemaining === "number" ? session.frozenRemaining : null,
    frozenEvidenceId: session.frozenEvidenceId ?? null
  };
}

/** 读取并迁移本地持久化数据；没有数据或数据损坏时返回 null，由调用方回退到种子数据 */
export function migratePersisted(raw: string | null): { evidence: Evidence[]; session: SessionState } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const evidence: Evidence[] = Array.isArray(parsed?.evidence) ? parsed.evidence : [];
    return { evidence, session: normalizeSession(parsed?.session) };
  } catch {
    return null;
  }
}
