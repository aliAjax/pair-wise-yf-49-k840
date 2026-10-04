import type { Objection } from "../types";

/**
 * 模拟共享的庭审记录服务端（各操作端通过 localStorage 共用一份记录）。
 * 正式部署时把这里替换成真实接口即可，合并语义不变：
 * 客户端带上自己基于的修订号，服务端修订号不一致时拒绝合并。
 */
const RECORD_KEY = "pair-wise-yf-49/courtRecord";

export interface CourtRecord {
  revision: number;
  objections: Objection[];
  updatedAt: string;
}

export class RevisionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`修订号冲突：本地基于第 ${expected} 版，庭审记录已更新到第 ${actual} 版`);
    this.name = "RevisionConflictError";
  }
}

export function readCourtRecord(): CourtRecord {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        revision: typeof parsed.revision === "number" ? parsed.revision : 0,
        objections: Array.isArray(parsed.objections) ? parsed.objections : [],
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
      };
    }
  } catch {
    // 记录损坏时回退到空记录，不阻塞庭审操作
  }
  return { revision: 0, objections: [], updatedAt: new Date().toISOString() };
}

/** 按修订号合并异议；修订号不匹配时抛出 RevisionConflictError，由调用方重试 */
export function mergeObjectionsIntoRecord(baseRevision: number, objections: Objection[]): CourtRecord {
  const record = readCourtRecord();
  if (record.revision !== baseRevision) throw new RevisionConflictError(baseRevision, record.revision);
  const next: CourtRecord = {
    revision: record.revision + 1,
    objections: [...record.objections, ...objections],
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(RECORD_KEY, JSON.stringify(next));
  return next;
}
