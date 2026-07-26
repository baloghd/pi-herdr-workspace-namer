import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceNamerConfig } from "../src/config.ts";
import { registerWorkspaceNamer, type WorkspaceNamerDependencies } from "../src/lifecycle.ts";
import { STATE_TYPE, type StateRecord } from "../src/state.ts";

const config: WorkspaceNamerConfig = {
	enabled: true,
	maxLength: 48,
	fallback: "local",
	notifyOnError: true,
	herdrCommand: "herdr",
	commandTimeoutMs: 5000,
};

type Handler = (event: never, ctx: ExtensionContext) => Promise<unknown> | unknown;

function harness(options: { sessionName?: string; sessionId?: string; branch?: unknown[] } = {}) {
	const handlers = new Map<string, Handler>();
	let sessionName = options.sessionName;
	let sessionId = options.sessionId ?? "s1";
	let branch = options.branch ?? [];
	const appendEntry = vi.fn();
	const setSessionName = vi.fn((name: string) => {
		sessionName = name;
	});
	const notify = vi.fn();
	const pi = {
		on: vi.fn((name: string, handler: Handler) => handlers.set(name, handler)),
		setSessionName,
		getSessionName: vi.fn(() => sessionName),
		appendEntry,
		exec: vi.fn(),
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: "/project",
		hasUI: true,
		ui: { notify },
		sessionManager: {
			getSessionId: () => sessionId,
			getBranch: () => branch,
		},
	} as unknown as ExtensionContext;
	const emit = async (name: string, event: Record<string, unknown>, context = ctx) => {
		const handler = handlers.get(name);
		if (!handler) throw new Error(`missing ${name} handler`);
		return handler(event as never, context);
	};
	return {
		pi,
		ctx,
		emit,
		appendEntry,
		setSessionName,
		notify,
		setSession(id: string, entries: unknown[] = []) {
			sessionId = id;
			branch = entries;
		},
	};
}

function dependencies(overrides: Partial<WorkspaceNamerDependencies> = {}) {
	return {
		loadConfig: vi.fn(() => config),
		generateTitle: vi.fn(async () => ({ title: "Implement Auth Refactor", source: "model" as const })),
		syncWorkspace: vi.fn(async (title: string) => ({ ok: true as const, workspaceId: "ws1", title })),
		now: vi.fn(() => 100),
		...overrides,
	};
}

async function startAndSettle(
	h: ReturnType<typeof harness>,
	prompt = "implement the authentication refactor",
) {
	await h.emit("session_start", { type: "session_start", reason: "startup" });
	await h.emit("input", { type: "input", source: "interactive", text: prompt });
	await h.emit("before_agent_start", {
		type: "before_agent_start",
		prompt,
		images: [],
		systemPrompt: "",
		systemPromptOptions: {},
	});
	await h.emit("agent_settled", { type: "agent_settled" });
}

describe("workspace namer lifecycle", () => {
	it("generates once only after the first agent_settled", async () => {
		const h = harness();
		const deps = dependencies();
		registerWorkspaceNamer(h.pi, deps);

		await startAndSettle(h);
		expect(deps.generateTitle).toHaveBeenCalledTimes(1);
		expect(h.setSessionName).toHaveBeenCalledTimes(1);
		expect(deps.syncWorkspace).toHaveBeenCalledTimes(1);

		await h.emit("input", { type: "input", source: "interactive", text: "a second task" });
		await h.emit("agent_settled", { type: "agent_settled" });
		expect(deps.generateTitle).toHaveBeenCalledTimes(1);
		expect(h.setSessionName).toHaveBeenCalledTimes(1);
		expect(deps.syncWorkspace).toHaveBeenCalledTimes(1);
	});

	it("syncs a resumed native session name without generating", async () => {
		const h = harness({ sessionName: "Resume Auth Refactor" });
		const deps = dependencies();
		registerWorkspaceNamer(h.pi, deps);

		await h.emit("session_start", { type: "session_start", reason: "resume" });
		await h.emit("input", { type: "input", source: "interactive", text: "continue refactoring" });
		await h.emit("agent_settled", { type: "agent_settled" });

		expect(deps.syncWorkspace).toHaveBeenCalledOnce();
		expect(deps.syncWorkspace).toHaveBeenCalledWith("Resume Auth Refactor", config);
		expect(deps.generateTitle).not.toHaveBeenCalled();
	});

	it("a fork ignores inherited parent records and names from its first new prompt", async () => {
		const parentRecord: StateRecord = {
			v: 1,
			kind: "named",
			sessionId: "parent",
			title: "Parent Name",
			at: 1,
		};
		const h = harness({
			sessionId: "fork",
			branch: [{ type: "custom", customType: STATE_TYPE, data: parentRecord }],
		});
		const deps = dependencies();
		registerWorkspaceNamer(h.pi, deps);

		await startAndSettle(h, "create a separate fork feature");

		expect(deps.generateTitle).toHaveBeenCalledOnce();
		expect(deps.generateTitle).toHaveBeenCalledWith(h.ctx, "create a separate fork feature", 48);
	});

	it("mirrors manual session_info_changed and suppresses duplicate own-name event", async () => {
		const h = harness();
		const deps = dependencies();
		registerWorkspaceNamer(h.pi, deps);
		let ownEvent: Promise<unknown> | undefined;
		h.setSessionName.mockImplementation((name: string) => {
			ownEvent = h.emit("session_info_changed", { type: "session_info_changed", name });
		});

		await startAndSettle(h);
		await ownEvent;
		expect(deps.syncWorkspace).toHaveBeenCalledTimes(1);

		await h.emit("session_info_changed", {
			type: "session_info_changed",
			name: "Manual Workspace Name",
		});
		expect(deps.syncWorkspace).toHaveBeenCalledTimes(2);
		expect(deps.syncWorkspace).toHaveBeenLastCalledWith("Manual Workspace Name", config);
	});

	it("ignores extension messages, streaming steering/followups, blank text, and image-only input", async () => {
		const h = harness();
		const deps = dependencies();
		registerWorkspaceNamer(h.pi, deps);
		await h.emit("session_start", { type: "session_start", reason: "startup" });

		for (const event of [
			{ type: "input", source: "extension", text: "extension task" },
			{ type: "input", source: "interactive", text: "steer", streamingBehavior: "steer" },
			{ type: "input", source: "rpc", text: "follow", streamingBehavior: "followUp" },
			{ type: "input", source: "interactive", text: "   " },
			{ type: "input", source: "interactive", text: "", images: [{ type: "image", data: "x" }] },
		]) {
			await h.emit("input", event);
		}
		await h.emit("agent_settled", { type: "agent_settled" });

		expect(deps.generateTitle).not.toHaveBeenCalled();
		expect(h.appendEntry).not.toHaveBeenCalledWith(
			STATE_TYPE,
			expect.objectContaining({ kind: "candidate" }),
		);
	});

	it("falls back to expanded before_agent_start prompt for skill/template input", async () => {
		const h = harness();
		const deps = dependencies();
		registerWorkspaceNamer(h.pi, deps);
		await h.emit("session_start", { type: "session_start", reason: "startup" });
		await h.emit("input", { type: "input", source: "interactive", text: "/skill:search" });
		await h.emit("before_agent_start", {
			type: "before_agent_start",
			prompt: "Search the repository for authentication behavior",
			images: [],
			systemPrompt: "",
			systemPromptOptions: {},
		});
		await h.emit("agent_settled", { type: "agent_settled" });

		expect(deps.generateTitle).toHaveBeenCalledWith(
			h.ctx,
			"Search the repository for authentication behavior",
			48,
		);
	});

	it("never throws when Herdr synchronization fails", async () => {
		const h = harness();
		const deps = dependencies({
			syncWorkspace: vi.fn(async () => ({
				ok: false as const,
				code: "rename_failed",
				message: "raw secret stderr",
			})),
		});
		registerWorkspaceNamer(h.pi, deps);

		await expect(startAndSettle(h)).resolves.toBeUndefined();
		expect(h.notify).toHaveBeenCalledOnce();
		expect(h.notify).toHaveBeenCalledWith("Unable to synchronize the Herdr workspace name.", "warning");
		expect(h.notify.mock.calls.flat().join(" ")).not.toContain("raw secret stderr");
	});

	it("also contains a thrown synchronization failure", async () => {
		const h = harness();
		const deps = dependencies({
			syncWorkspace: vi.fn(async () => {
				throw new Error("raw secret stderr");
			}),
		});
		registerWorkspaceNamer(h.pi, deps);

		await expect(startAndSettle(h)).resolves.toBeUndefined();
		expect(h.notify).toHaveBeenCalledOnce();
		expect(h.notify.mock.calls.flat().join(" ")).not.toContain("raw secret stderr");
	});

	it("does not let an old generation mutate a replacement session", async () => {
		const h = harness();
		let release: ((value: { title: string }) => void) | undefined;
		const oldGeneration = new Promise<{ title: string }>((resolve) => {
			release = resolve;
		});
		const generateTitle = vi
			.fn()
			.mockImplementationOnce(() => oldGeneration)
			.mockResolvedValueOnce({ title: "Second Session Title", source: "model" as const });
		const deps = dependencies({ generateTitle });
		registerWorkspaceNamer(h.pi, deps);

		await h.emit("session_start", { type: "session_start", reason: "startup" });
		await h.emit("input", { type: "input", source: "interactive", text: "old session task" });
		const oldSettled = h.emit("agent_settled", { type: "agent_settled" });
		await vi.waitFor(() => expect(generateTitle).toHaveBeenCalledTimes(1));
		await h.emit("session_shutdown", { type: "session_shutdown", reason: "new" });
		h.setSession("s2");
		await h.emit("session_start", { type: "session_start", reason: "new" });
		await h.emit("input", { type: "input", source: "interactive", text: "new session task" });
		await h.emit("agent_settled", { type: "agent_settled" });
		release?.({ title: "Old Session Title" });
		await oldSettled;

		expect(h.setSessionName).toHaveBeenCalledOnce();
		expect(h.setSessionName).toHaveBeenCalledWith("Second Session Title");
		expect(deps.syncWorkspace).toHaveBeenCalledOnce();
	});

	it("serializes synchronization and drops queued work after session replacement", async () => {
		const h = harness({ sessionName: "First" });
		let release: (() => void) | undefined;
		const first = new Promise<void>((resolve) => {
			release = resolve;
		});
		const syncWorkspace = vi
			.fn()
			.mockImplementationOnce(async (title: string) => {
				await first;
				return { ok: true as const, workspaceId: "ws1", title };
			})
			.mockImplementation(async (title: string) => ({ ok: true as const, workspaceId: "ws2", title }));
		const deps = dependencies({ syncWorkspace });
		registerWorkspaceNamer(h.pi, deps);

		const startup = h.emit("session_start", { type: "session_start", reason: "resume" });
		await vi.waitFor(() => expect(syncWorkspace).toHaveBeenCalledTimes(1));
		const queued = h.emit("session_info_changed", { type: "session_info_changed", name: "Queued" });
		await h.emit("session_shutdown", { type: "session_shutdown", reason: "new" });
		h.setSession("s2");
		release?.();
		await Promise.all([startup, queued]);

		expect(syncWorkspace).toHaveBeenCalledTimes(1);
		const finished = h.appendEntry.mock.calls.filter(
			(call) => (call[1] as StateRecord).kind === "sync-finished",
		);
		expect(finished).toHaveLength(0);
	});
});
