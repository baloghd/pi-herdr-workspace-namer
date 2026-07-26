import { EventEmitter } from "node:events";
import path from "node:path";
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
	it("isolates list, spawn, commands, and cleanup from the default Herdr config", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { runUniqueLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const temporaryRoot = path.join("/tmp", "workspace-namer-smoke-isolated");
		const defaultConfig = path.join("/home", "tester", ".config", "herdr", "config.toml");
		const removeTempRoot = vi.fn(async () => undefined);
		const listSessions = vi.fn(async (_options?: { env?: NodeJS.ProcessEnv }) => ({
			stdout: JSON.stringify({ sessions: [] }),
		}));
		const server = serverStub();
		const spawnServer = vi.fn(() => server);
		const commandCalls: Array<{ args: string[]; options?: { env?: NodeJS.ProcessEnv } }> = [];
		const run = vi.fn(async (args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
			commandCalls.push({ args, options });
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

		await expect(
			runUniqueLiveSmoke({
				makeTempRoot: vi.fn(async () => temporaryRoot),
				removeTempRoot,
				listSessions,
				createName: () => "pi-herdr-workspace-namer-smoke-isolated",
				runForSession: vi.fn(() => run),
				spawnServer,
				wait: vi.fn(async () => undefined),
				readinessAttempts: 1,
				importAdapter: vi.fn(async () => ({
					syncWorkspaceName: vi.fn(async ({ exec }) => {
						await exec("herdr", ["pane", "current", "--current"]);
						return { ok: true, workspaceId: "w1" };
					}),
				})),
				baseEnv: {
					HOME: "/home/tester",
					HERDR_CONFIG_PATH: defaultConfig,
					HERDR_ENV: "1",
					HERDR_SOCKET_PATH: "/home/tester/.config/herdr/herdr.sock",
				},
			}),
		).resolves.toBe("pi-herdr-workspace-namer-smoke-isolated");

		const isolatedConfig = path.join(temporaryRoot, "config.toml");
		expect(listSessions).toHaveBeenCalledWith(
			expect.objectContaining({
				env: expect.objectContaining({ HERDR_CONFIG_PATH: isolatedConfig }),
			}),
		);
		expect(listSessions.mock.calls[0]?.[0]?.env).not.toHaveProperty("HERDR_SOCKET_PATH");
		expect(spawnServer).toHaveBeenCalledWith(
			"pi-herdr-workspace-namer-smoke-isolated",
			expect.objectContaining({ env: expect.objectContaining({ HERDR_CONFIG_PATH: isolatedConfig }) }),
		);
		expect(commandCalls.length).toBeGreaterThan(0);
		for (const call of commandCalls) {
			expect(call.options?.env?.HERDR_CONFIG_PATH).toBe(isolatedConfig);
			expect(call.options?.env?.HERDR_CONFIG_PATH).not.toBe(defaultConfig);
		}
		expect(removeTempRoot).toHaveBeenCalledWith(temporaryRoot);
	});

	it("fails when the isolated temporary root cannot be removed", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { runUniqueLiveSmoke } = await import("../scripts/live-smoke.mjs");
		await expect(
			runUniqueLiveSmoke({
				makeTempRoot: vi.fn(async () => "/tmp/workspace-namer-smoke-cleanup-failure"),
				removeTempRoot: vi.fn(async () => {
					throw new Error("remove denied");
				}),
				listSessions: vi.fn(async () => ({
					stdout: JSON.stringify({ sessions: [{ name: "pi-herdr-workspace-namer-smoke-collision" }] }),
				})),
				createName: () => "pi-herdr-workspace-namer-smoke-collision",
				maxNameAttempts: 1,
				runForSession: vi.fn(),
				spawnServer: vi.fn(),
			}),
		).rejects.toThrow("temporary root cleanup failed: remove denied");
	});

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
		expect(spawnServer).toHaveBeenCalledWith(
			unique,
			expect.objectContaining({ env: expect.objectContaining({ HERDR_CONFIG_PATH: expect.any(String) }) }),
		);
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
