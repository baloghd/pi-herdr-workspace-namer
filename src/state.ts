import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const STATE_TYPE = "pi-herdr-workspace-namer/v1";

export type StateRecord =
	| { v: 1; kind: "candidate"; sessionId: string; prompt: string; at: number }
	| { v: 1; kind: "named"; sessionId: string; title: string; at: number }
	| { v: 1; kind: "sync-started"; sessionId: string; title: string; workspaceId?: string; at: number }
	| { v: 1; kind: "sync-finished"; sessionId: string; title: string; workspaceId?: string; at: number }
	| { v: 1; kind: "sync-failed"; sessionId: string; title: string; workspaceId?: string; at: number };

export interface SessionState {
	sessionId: string;
	candidate?: string;
	title?: string;
	syncedTitle?: string;
	syncStatus?: "started" | "finished" | "failed";
	workspaceId?: string;
}

type UnknownRecord = Record<string, unknown>;

function hasOnlyKeys(record: UnknownRecord, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(record).length === keys.length && Object.keys(record).every((key) => allowed.has(key));
}

function validRecord(value: unknown, sessionId: string): value is StateRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as UnknownRecord;
	if (
		record.v !== 1 ||
		typeof record.sessionId !== "string" ||
		record.sessionId !== sessionId ||
		typeof record.at !== "number" ||
		!Number.isFinite(record.at)
	)
		return false;

	switch (record.kind) {
		case "candidate":
			return (
				hasOnlyKeys(record, ["v", "kind", "sessionId", "prompt", "at"]) && typeof record.prompt === "string"
			);
		case "named":
			return (
				hasOnlyKeys(record, ["v", "kind", "sessionId", "title", "at"]) && typeof record.title === "string"
			);
		case "sync-started":
		case "sync-finished":
		case "sync-failed":
			return (
				typeof record.title === "string" &&
				(hasOnlyKeys(record, ["v", "kind", "sessionId", "title", "at"]) ||
					(hasOnlyKeys(record, ["v", "kind", "sessionId", "title", "workspaceId", "at"]) &&
						typeof record.workspaceId === "string"))
			);
		default:
			return false;
	}
}

export function reconstructState(branch: readonly unknown[], sessionId: string): SessionState {
	const state: SessionState = { sessionId };
	for (const entry of branch) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const item = entry as { type?: unknown; customType?: unknown; data?: unknown };
		if (item.type !== "custom" || item.customType !== STATE_TYPE || !validRecord(item.data, sessionId))
			continue;
		const record = item.data;
		switch (record.kind) {
			case "candidate":
				state.candidate = record.prompt;
				break;
			case "named":
				state.title = record.title;
				break;
			case "sync-started":
			case "sync-finished":
			case "sync-failed":
				state.syncedTitle = record.title;
				state.syncStatus = record.kind.slice("sync-".length) as "started" | "finished" | "failed";
				if (record.workspaceId === undefined) delete state.workspaceId;
				else state.workspaceId = record.workspaceId;
				break;
		}
	}
	return state;
}

export function record(pi: Pick<ExtensionAPI, "appendEntry">, value: StateRecord): void {
	pi.appendEntry(STATE_TYPE, value);
}
