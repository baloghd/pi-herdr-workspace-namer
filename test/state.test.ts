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
		expect(state).toMatchObject({ candidate: "new task", title: undefined });
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
		expect(state).toMatchObject({ title: "Second", syncedTitle: "Second", workspaceId: "w2" });
	});
});
