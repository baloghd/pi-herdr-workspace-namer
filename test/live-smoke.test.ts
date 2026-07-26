import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

function serverStub(emitSpawn = true) {
	const server = new EventEmitter() as EventEmitter & {
		exitCode: number | null;
		pid?: number;
		stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
		kill: ReturnType<typeof vi.fn>;
	};
	const stderr = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
	stderr.setEncoding = vi.fn();
	server.exitCode = null;
	server.pid = emitSpawn ? 123 : undefined;
	server.stderr = stderr;
	server.kill = vi.fn(() => {
		server.exitCode = 0;
		server.emit("exit", 0);
	});
	return server;
}

describe("live smoke", () => {
	it("uses a 128-bit random suffix and cleans up when readiness fails", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { createSessionName, runLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const generated = createSessionName();
		expect(generated).toMatch(/^pi-herdr-workspace-namer-smoke-[A-Za-z0-9_-]{22}$/);
		const first = createSessionName(() => "first");
		const second = createSessionName(() => "second");
		expect(first).toBe("pi-herdr-workspace-namer-smoke-first");
		expect(second).toBe("pi-herdr-workspace-namer-smoke-second");

		const server = serverStub();
		const run = vi.fn(async (args: string[]) => {
			if (args[0] === "workspace" && args[1] === "list") throw new Error("not ready");
			if (args[0] === "session" && args[1] === "stop") server.kill();
			return { stdout: "{}", stderr: "" };
		});
		const spawnServer = vi.fn(() => server);

		await expect(
			runLiveSmoke({
				session: first,
				run,
				spawnServer,
				wait: vi.fn(async () => undefined),
				readinessAttempts: 1,
				importAdapter: vi.fn(),
			}),
		).rejects.toThrow("isolated Herdr server did not become ready");
		expect(spawnServer).toHaveBeenCalledOnce();
		expect(run.mock.calls.map(([args]) => args)).toContainEqual(["session", "stop", first, "--json"]);
		expect(run.mock.calls.map(([args]) => args)).toContainEqual(["session", "delete", first, "--json"]);
	});

	it("retries listed collisions without stopping or deleting the existing session", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { runUniqueLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const existing = "pi-herdr-workspace-namer-smoke-existing";
		const unique = "pi-herdr-workspace-namer-smoke-unique";
		const suffixes = ["existing", "unique"];
		const server = serverStub();
		const run = vi.fn(async (args: string[]) => {
			if (args[0] === "workspace" && args[1] === "create") {
				return {
					stdout: JSON.stringify({
						result: { root_pane: { pane_id: "p1" }, workspace: { workspace_id: "w1" } },
					}),
					stderr: "",
				};
			}
			if (args[0] === "workspace" && args[1] === "get") {
				return {
					stdout: JSON.stringify({ result: { workspace: { workspace_id: "w1", label: "after-smoke" } } }),
					stderr: "",
				};
			}
			if (args[0] === "session" && args[1] === "stop") server.kill();
			return { stdout: "{}", stderr: "" };
		});
		const spawnServer = vi.fn(() => server);

		const session = await runUniqueLiveSmoke({
			listSessions: vi.fn(async () => ({
				stdout: JSON.stringify({ sessions: [{ name: existing, running: false }] }),
			})),
			randomSuffix: () => suffixes.shift(),
			runForSession: vi.fn(() => run),
			spawnServer,
			wait: vi.fn(async () => undefined),
			readinessAttempts: 1,
			importAdapter: vi.fn(async () => ({
				syncWorkspaceName: vi.fn(async () => ({ ok: true, workspaceId: "w1" })),
			})),
		});

		expect(session).toBe(unique);
		expect(spawnServer).toHaveBeenCalledWith(unique);
		const cleanupCalls = run.mock.calls.map(([args]) => args).filter(([group]) => group === "session");
		expect(cleanupCalls).toEqual([
			["session", "stop", unique, "--json"],
			["session", "delete", unique, "--json"],
		]);
		expect(cleanupCalls.flat()).not.toContain(existing);
	});

	it("fails before spawning when bounded candidates all collide", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { runUniqueLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const spawnServer = vi.fn();
		await expect(
			runUniqueLiveSmoke({
				listSessions: vi.fn(async () => ({ stdout: "name status\nsmoke stopped\n" })),
				createName: () => "smoke",
				maxNameAttempts: 2,
				runForSession: vi.fn(),
				spawnServer,
			}),
		).rejects.toThrow("could not find an unused Herdr session name after 2 attempts");
		expect(spawnServer).not.toHaveBeenCalled();
	});

	it("does not claim or clean up a session when child spawn fails", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { runLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const server = serverStub(false);
		const spawnError = new Error("spawn denied");
		const spawnServer = vi.fn(() => {
			queueMicrotask(() => server.emit("error", spawnError));
			return server;
		});
		const run = vi.fn();

		await expect(
			runLiveSmoke({
				session: "pi-herdr-workspace-namer-smoke-test",
				run,
				spawnServer,
			}),
		).rejects.toThrow("spawn denied");
		expect(run).not.toHaveBeenCalled();
	});

	it("preserves the primary error and adds cleanup failure", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { runLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const session = "pi-herdr-workspace-namer-smoke-test";
		const server = serverStub();
		const run = vi.fn(async (args: string[]) => {
			if (args[0] === "workspace") throw new Error("not ready");
			if (args[0] === "session" && args[1] === "stop") server.kill();
			if (args[0] === "session" && args[1] === "delete") throw new Error("delete denied");
			return { stdout: "{}", stderr: "" };
		});

		await expect(
			runLiveSmoke({
				session,
				run,
				spawnServer: vi.fn(() => server),
				wait: vi.fn(async () => undefined),
				readinessAttempts: 1,
				importAdapter: vi.fn(),
			}),
		).rejects.toThrow(
			"isolated Herdr server did not become ready; cleanup failed: session delete failed: delete denied",
		);
	});

	it("fails an otherwise successful smoke when deletion fails", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { runLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const session = "pi-herdr-workspace-namer-smoke-test";
		const server = serverStub();
		const run = vi.fn(async (args: string[]) => {
			if (args[0] === "workspace" && args[1] === "create") {
				return {
					stdout: JSON.stringify({
						result: { root_pane: { pane_id: "p1" }, workspace: { workspace_id: "w1" } },
					}),
					stderr: "",
				};
			}
			if (args[0] === "workspace" && args[1] === "get") {
				return {
					stdout: JSON.stringify({ result: { workspace: { workspace_id: "w1", label: "after-smoke" } } }),
					stderr: "",
				};
			}
			if (args[0] === "session" && args[1] === "stop") server.kill();
			if (args[0] === "session" && args[1] === "delete") throw new Error("delete denied");
			return { stdout: "{}", stderr: "" };
		});
		const syncWorkspaceName = vi.fn(async () => ({ ok: true, workspaceId: "w1" }));

		await expect(
			runLiveSmoke({
				session,
				run,
				spawnServer: vi.fn(() => server),
				wait: vi.fn(async () => undefined),
				readinessAttempts: 1,
				importAdapter: vi.fn(async () => ({ syncWorkspaceName })),
			}),
		).rejects.toThrow("cleanup failed: session delete failed: delete denied");
		expect(syncWorkspaceName).toHaveBeenCalledOnce();
	});
});
