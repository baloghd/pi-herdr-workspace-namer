#!/usr/bin/env node

import { execFile, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SESSION = "pi-herdr-workspace-namer-smoke";
const HERDR = process.env.HERDR_COMMAND || "herdr";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.PI_HERDR_WORKSPACE_NAMER_LIVE !== "1") {
	console.error("Set PI_HERDR_WORKSPACE_NAMER_LIVE=1 to run the disposable Herdr smoke test.");
	process.exit(2);
}

function skip(reason) {
	console.error(`SKIP: ${reason}; no active/default Herdr session was touched.`);
	process.exit(0);
}

function runHerdr(args, options = {}) {
	return execFileAsync(HERDR, ["--session", SESSION, ...args], {
		cwd: ROOT,
		timeout: 5_000,
		maxBuffer: 64 * 1024,
		...options,
	});
}

function parseResult(stdout) {
	return JSON.parse(stdout).result;
}

let help;
try {
	help = execFileSync(HERDR, ["--help"], { encoding: "utf8", timeout: 5_000 });
} catch {
	skip("Herdr is not installed or its CLI syntax cannot be inspected");
}
if (!help.includes("--session <name>") || !help.includes("herdr session <subcommand>")) {
	skip("installed Herdr lacks isolated named-session syntax");
}

let sessions;
try {
	sessions = JSON.parse(execFileSync(HERDR, ["session", "list", "--json"], { encoding: "utf8" })).sessions;
} catch {
	skip("installed Herdr cannot list named sessions noninteractively");
}
if (!Array.isArray(sessions)) skip("installed Herdr returned an unrecognized session list");
if (sessions.some((session) => session?.name === SESSION)) {
	console.error(
		`Refusing to use existing named session ${SESSION}; clean it up manually if it is disposable.`,
	);
	process.exit(1);
}

const server = spawn(HERDR, ["--session", SESSION, "server"], {
	cwd: ROOT,
	stdio: ["ignore", "ignore", "pipe"],
});
let serverError = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => {
	serverError = `${serverError}${chunk}`.slice(-4_096);
});

let ownsSession = false;
async function cleanup() {
	if (!ownsSession) {
		server.kill("SIGTERM");
		if (server.exitCode === null) {
			await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))]);
		}
		return;
	}
	try {
		await execFileAsync(HERDR, ["session", "stop", SESSION, "--json"], { timeout: 5_000 });
	} catch {
		server.kill("SIGTERM");
	}
	if (server.exitCode === null) {
		await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))]);
	}
	try {
		await execFileAsync(HERDR, ["session", "delete", SESSION, "--json"], { timeout: 5_000 });
	} catch (error) {
		console.error(`warning: could not delete stopped disposable session ${SESSION}: ${error.message}`);
	}
}

try {
	let ready = false;
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (server.exitCode !== null)
			throw new Error(`isolated Herdr server exited early: ${serverError.trim()}`);
		try {
			await runHerdr(["workspace", "list"]);
			ready = true;
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	if (!ready) throw new Error("isolated Herdr server did not become ready");
	ownsSession = true;
	const create = parseResult(
		(await runHerdr(["workspace", "create", "--cwd", ROOT, "--label", "before-smoke", "--no-focus"])).stdout,
	);
	const paneId = create?.root_pane?.pane_id;
	const workspaceId = create?.workspace?.workspace_id;
	if (!paneId || !workspaceId) throw new Error("Herdr did not return disposable pane/workspace IDs");

	const { syncWorkspaceName } = await import("../src/herdr.ts");
	const exec = async (_command, args, options = {}) => {
		try {
			const result = await runHerdr(args, {
				timeout: options.timeout,
				env: { ...process.env, HERDR_PANE_ID: paneId, HERDR_SESSION: SESSION },
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
		command: HERDR,
		timeoutMs: 5_000,
		exec,
	});
	if (!synchronized.ok || synchronized.workspaceId !== workspaceId) {
		throw new Error(`adapter synchronization failed: ${JSON.stringify(synchronized)}`);
	}

	const get = parseResult((await runHerdr(["workspace", "get", workspaceId])).stdout);
	if (get?.workspace?.label !== "after-smoke") throw new Error("workspace label was not after-smoke");
	console.log(`live smoke passed in disposable Herdr session ${SESSION}`);
} catch (error) {
	console.error(`live smoke failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	await cleanup();
}
