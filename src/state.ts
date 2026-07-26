import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const STATE_TYPE = "pi-herdr-workspace-namer/v1";

export type StateRecord =
	| { v: 1; kind: "candidate"; sessionId: string; prompt: string; at: number }
	| { v: 1; kind: "named"; sessionId: string; title: string; at: number }
	| { v: 1; kind: "sync-started"; sessionId: string; title: string; workspaceId?: string; at: number }
	| {
			v: 1;
			kind: "sync-finished" | "sync-failed";
			sessionId: string;
			title: string;
			workspaceId?: string;
			at: number;
	  };

export interface SessionState {
	sessionId: string;
	candidate?: string;
	title?: string;
	syncedTitle?: string;
	workspaceId?: string;
}

function validRecord(value: unknown, sessionId: string): value is StateRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.v === 1 &&
		record.sessionId === sessionId &&
		typeof record.kind === "string" &&
		typeof record.at === "number"
	);
}

export function reconstructState(branch: readonly unknown[], sessionId: string): SessionState {
	const state: SessionState = { sessionId, title: undefined };
	for (const entry of branch) {
		if (!entry || typeof entry !== "object") continue;
		const item = entry as { type?: string; customType?: string; data?: unknown };
		if (item.type !== "custom" || item.customType !== STATE_TYPE || !validRecord(item.data, sessionId))
			continue;
		const record = item.data;
		if (record.kind === "candidate" && typeof record.prompt === "string") state.candidate = record.prompt;
		if (record.kind === "named" && typeof record.title === "string") state.title = record.title;
		if (record.kind === "sync-finished" && typeof record.title === "string") {
			state.syncedTitle = record.title;
			state.workspaceId = record.workspaceId;
		}
	}
	return state;
}

export function record(pi: Pick<ExtensionAPI, "appendEntry">, value: StateRecord): void {
	pi.appendEntry(STATE_TYPE, value);
}
