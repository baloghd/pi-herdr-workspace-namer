#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERDR = process.env.HERDR_COMMAND || "herdr";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createSessionName(randomSuffix = () => randomBytes(16).toString("base64url")) {
	return `pi-herdr-workspace-namer-smoke-${randomSuffix()}`;
}

export function parseSessionNames(output) {
	const stdout = typeof output === "string" ? output : output?.stdout;
	if (typeof stdout !== "string") throw new Error("Herdr returned no session list output");
	try {
		const parsed = JSON.parse(stdout);
		if (!Array.isArray(parsed?.sessions)) throw new Error("missing sessions array");
		const names = parsed.sessions.map((session) => session?.name);
		if (names.some((name) => typeof name !== "string")) throw new Error("invalid session name");
		return new Set(names);
	} catch (error) {
		if (stdout.trimStart().startsWith("{")) {
			throw new Error(
				`Herdr returned an unrecognized JSON session list: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	const lines = stdout
		.trim()
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0 || !/^name\s+status(?:\s|$)/i.test(lines[0])) {
		throw new Error("Herdr returned an unrecognized session list");
	}
	return new Set(lines.slice(1).map((line) => line.split(/\s+/, 1)[0]));
}

function parseResult(stdout) {
	return JSON.parse(stdout).result;
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}

async function settleServer(server, wait) {
	if (server.exitCode !== null) return;
	await Promise.race([once(server, "exit"), wait(1_000)]);
}

async function awaitSuccessfulSpawn(server) {
	if (server.pid !== undefined) return;
	await Promise.race([once(server, "spawn"), once(server, "error").then(([error]) => Promise.reject(error))]);
}

async function cleanupOwnedSession({ run, server, session, wait }) {
	const failures = [];
	try {
		await run(["session", "stop", session, "--json"]);
	} catch (error) {
		failures.push(`session stop failed: ${message(error)}`);
		server.kill("SIGTERM");
	}
	await settleServer(server, wait);
	try {
		await run(["session", "delete", session, "--json"]);
	} catch (error) {
		failures.push(`session delete failed: ${message(error)}`);
	}
	if (failures.length > 0) throw new Error(failures.join("; "));
}

export async function runUniqueLiveSmoke({
	listSessions,
	randomSuffix,
	createName = createSessionName,
	maxNameAttempts = 10,
	runForSession,
	spawnServer,
	makeTempRoot = () => mkdtemp(path.join(tmpdir(), "phwn-")),
	removeTempRoot = (root) => rm(root, { recursive: true, force: true }),
	baseEnv = process.env,
	...smokeOptions
}) {
	const tempRoot = await makeTempRoot();
	const env = { ...baseEnv, HERDR_CONFIG_PATH: path.join(tempRoot, "config.toml") };
	for (const inherited of [
		"HERDR_ENV",
		"HERDR_PANE_ID",
		"HERDR_SESSION",
		"HERDR_SOCKET_PATH",
		"HERDR_TAB_ID",
		"HERDR_WORKSPACE_ID",
	]) {
		delete env[inherited];
	}
	let primaryError;
	let session;
	try {
		const existingSessions = parseSessionNames(await listSessions({ env }));
		for (let attempt = 0; attempt < maxNameAttempts; attempt += 1) {
			const candidate = createName(randomSuffix);
			if (!existingSessions.has(candidate)) {
				session = candidate;
				break;
			}
		}
		if (!session) {
			throw new Error(`could not find an unused Herdr session name after ${maxNameAttempts} attempts`);
		}

		const run = runForSession(session);
		await runLiveSmoke({ ...smokeOptions, session, run, spawnServer, env });
	} catch (error) {
		primaryError = error;
	}

	let removalError;
	try {
		await removeTempRoot(tempRoot);
	} catch (error) {
		removalError = error;
	}
	if (primaryError && removalError) {
		throw new Error(`${message(primaryError)}; temporary root cleanup failed: ${message(removalError)}`, {
			cause: primaryError,
		});
	}
	if (primaryError) throw primaryError;
	if (removalError) {
		throw new Error(`temporary root cleanup failed: ${message(removalError)}`, { cause: removalError });
	}
	return session;
}

export async function runLiveSmoke({
	session,
	run,
	spawnServer,
	wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
	readinessAttempts = 50,
	importAdapter = () => import("../src/herdr.ts"),
	root = ROOT,
	command = HERDR,
	env = process.env,
}) {
	const runIsolated = (args, options = {}) =>
		run(args, { ...options, env: { ...env, ...options.env, HERDR_CONFIG_PATH: env.HERDR_CONFIG_PATH } });
	const server = spawnServer(session, { env });
	// Only a successfully spawned child can establish disposable named-session state.
	await awaitSuccessfulSpawn(server);
	const ownsSession = true;
	let serverError = "";
	server.stderr.setEncoding("utf8");
	server.stderr.on("data", (chunk) => {
		serverError = `${serverError}${chunk}`.slice(-4_096);
	});

	let primaryError;
	try {
		let ready = false;
		for (let attempt = 0; attempt < readinessAttempts; attempt += 1) {
			if (server.exitCode !== null)
				throw new Error(`isolated Herdr server exited early: ${serverError.trim()}`);
			try {
				await runIsolated(["workspace", "list"]);
				ready = true;
				break;
			} catch {
				await wait(100);
			}
		}
		if (!ready) throw new Error("isolated Herdr server did not become ready");

		const create = parseResult(
			(await runIsolated(["workspace", "create", "--cwd", root, "--label", "before-smoke", "--no-focus"]))
				.stdout,
		);
		const paneId = create?.root_pane?.pane_id;
		const workspaceId = create?.workspace?.workspace_id;
		if (!paneId || !workspaceId) throw new Error("Herdr did not return disposable pane/workspace IDs");

		const { syncWorkspaceName } = await importAdapter();
		const exec = async (_command, args, options = {}) => {
			try {
				const result = await runIsolated(args, {
					timeout: options.timeout,
					env: { HERDR_PANE_ID: paneId, HERDR_SESSION: session },
				});
				return { code: 0, stdout: result.stdout, stderr: result.stderr, killed: false };
			} catch (error) {
				return {
					code: typeof error.code === "number" ? error.code : 1,
					stdout: error.stdout || "",
					stderr: error.stderr || "",
					killed: error.killed === true,
				};
			}
		};
		const synchronized = await syncWorkspaceName({
			title: "after-smoke",
			command,
			timeoutMs: 5_000,
			exec,
		});
		if (!synchronized.ok || synchronized.workspaceId !== workspaceId) {
			throw new Error(`adapter synchronization failed: ${JSON.stringify(synchronized)}`);
		}

		const get = parseResult((await runIsolated(["workspace", "get", workspaceId])).stdout);
		if (get?.workspace?.label !== "after-smoke") throw new Error("workspace label was not after-smoke");
	} catch (error) {
		primaryError = error;
	}

	let cleanupError;
	if (ownsSession) {
		try {
			await cleanupOwnedSession({ run: runIsolated, server, session, wait });
		} catch (error) {
			cleanupError = error;
		}
	}
	if (primaryError && cleanupError) {
		throw new Error(`${message(primaryError)}; cleanup failed: ${message(cleanupError)}`, {
			cause: primaryError,
		});
	}
	if (primaryError) throw primaryError;
	if (cleanupError) throw new Error(`cleanup failed: ${message(cleanupError)}`, { cause: cleanupError });
}

async function main() {
	if (process.env.PI_HERDR_WORKSPACE_NAMER_LIVE !== "1") {
		console.error("Set PI_HERDR_WORKSPACE_NAMER_LIVE=1 to run the disposable Herdr smoke test.");
		process.exit(2);
	}

	const listSessions = async (options = {}) => {
		const executionOptions = {
			encoding: "utf8",
			timeout: 5_000,
			maxBuffer: 64 * 1024,
			...options,
		};
		try {
			return await execFileAsync(HERDR, ["session", "list", "--json"], executionOptions);
		} catch {
			return execFileAsync(HERDR, ["session", "list"], executionOptions);
		}
	};
	const runForSession =
		(session) =>
		(args, options = {}) =>
			execFileAsync(HERDR, args[0] === "session" ? args : ["--session", session, ...args], {
				cwd: ROOT,
				timeout: 5_000,
				maxBuffer: 64 * 1024,
				...options,
			});
	const spawnServer = (session, options = {}) =>
		spawn(HERDR, ["--session", session, "server"], {
			cwd: ROOT,
			stdio: ["ignore", "ignore", "pipe"],
			...options,
		});
	try {
		const session = await runUniqueLiveSmoke({ listSessions, runForSession, spawnServer });
		console.log(`live smoke passed in disposable Herdr session ${session}`);
	} catch (error) {
		console.error(`live smoke failed: ${message(error)}`);
		process.exitCode = 1;
	}
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) await main();
