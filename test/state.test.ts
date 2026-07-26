import { describe, expect, it } from "vitest";
import { reconstructState, STATE_TYPE } from "../src/state.ts";

const custom = (data: unknown) => ({ type: "custom", customType: STATE_TYPE, data });

describe("reconstructState", () => {
	it("uses only valid records matching the current session", () => {
		const state = reconstructState(
			[
				custom({ v: 1, kind: "named", sessionId: "parent", title: "Parent Task", at: 1 }),
				custom({ v: 1, kind: "candidate", sessionId: "fork", prompt: "new task", at: 2 }),
				custom({ v: 99, kind: "named", sessionId: "fork", title: "bad", at: 3 }),
			],
			"fork",
		);
		expect(state).toMatchObject({ candidate: "new task" });
		expect(state.title).toBeUndefined();
	});

	it("replays latest records deterministically", () => {
		const state = reconstructState(
			[
				custom({ v: 1, kind: "named", sessionId: "s1", title: "First", at: 1 }),
				custom({ v: 1, kind: "named", sessionId: "s1", title: "Second", at: 2 }),
				custom({ v: 1, kind: "sync-finished", sessionId: "s1", title: "Second", workspaceId: "w2", at: 3 }),
			],
			"s1",
		);
		expect(state).toMatchObject({
			title: "Second",
			syncedTitle: "Second",
			syncStatus: "finished",
			workspaceId: "w2",
		});
	});

	it("ignores malformed records and malformed branch entries", () => {
		const state = reconstructState(
			[
				null,
				{
					type: "message",
					customType: STATE_TYPE,
					data: { v: 1, kind: "named", sessionId: "s1", title: "wrong entry", at: 1 },
				},
				{
					type: "custom",
					customType: "other",
					data: { v: 1, kind: "named", sessionId: "s1", title: "wrong type", at: 2 },
				},
				custom({ v: 1, kind: "unknown", sessionId: "s1", title: "unknown kind", at: 3 }),
				custom({ v: 1, kind: "candidate", sessionId: "s1", prompt: 42, at: 4 }),
				custom({ v: 1, kind: "named", sessionId: "s1", title: "missing at" }),
				custom({ v: 1, kind: "named", sessionId: "s1", title: "infinite", at: Number.POSITIVE_INFINITY }),
				custom({
					v: 1,
					kind: "sync-finished",
					sessionId: "s1",
					title: "bad workspace",
					workspaceId: 42,
					at: 5,
				}),
				custom({ v: 1, kind: "sync-started", sessionId: "s1", title: "extra field", extra: true, at: 6 }),
				custom({ v: 1, kind: "named", sessionId: "s1", title: "valid", at: 7 }),
			],
			"s1",
		);
		expect(state).toEqual({ sessionId: "s1", title: "valid" });
	});

	it("replays every sync event in branch order", () => {
		const state = reconstructState(
			[
				custom({ v: 1, kind: "sync-started", sessionId: "s1", title: "Starting", workspaceId: "w1", at: 1 }),
				custom({ v: 1, kind: "sync-finished", sessionId: "s1", title: "Finished", workspaceId: "w1", at: 2 }),
				custom({ v: 1, kind: "sync-failed", sessionId: "s1", title: "Failed", at: 3 }),
			],
			"s1",
		);
		expect(state).toEqual({
			sessionId: "s1",
			syncedTitle: "Failed",
			syncStatus: "failed",
		});
		expect(state.workspaceId).toBeUndefined();
	});
});
