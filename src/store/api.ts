import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type { Evidence, SessionState } from "../types";
import { migratePersisted, STORAGE_VERSION } from "./migrate";
import { readCourtRecord } from "./server";

const KEY = "pair-wise-yf-49/court";

export interface Bootstrap {
  evidence: Evidence[];
  session: SessionState | null;
  recordRevision: number;
}

function readPersisted(): Record<string, unknown> {
  const raw = localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : {};
}

export const courtApi = createApi({
  reducerPath: "courtApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getBootstrap: builder.query<Bootstrap, void>({
      queryFn: async () => {
        const migrated = migratePersisted(localStorage.getItem(KEY));
        return {
          data: {
            evidence: migrated?.evidence ?? [],
            session: migrated?.session ?? null,
            recordRevision: readCourtRecord().revision
          }
        };
      }
    }),
    saveEvidence: builder.mutation<{ ok: true }, Evidence[]>({
      queryFn: async (payload) => {
        const current = readPersisted();
        localStorage.setItem(KEY, JSON.stringify({ ...current, version: STORAGE_VERSION, evidence: payload }));
        return { data: { ok: true } };
      }
    }),
    saveSession: builder.mutation<{ ok: true }, SessionState>({
      queryFn: async (payload) => {
        const current = readPersisted();
        localStorage.setItem(KEY, JSON.stringify({ ...current, version: STORAGE_VERSION, session: payload }));
        return { data: { ok: true } };
      }
    })
  })
});

export const { useGetBootstrapQuery, useSaveEvidenceMutation, useSaveSessionMutation } = courtApi;
