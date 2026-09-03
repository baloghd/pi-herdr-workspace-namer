import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";

export interface WorkspaceNamerConfig {
	enabled: boolean;
	maxLength: number;
	fallback: "local";
	notifyOnError: boolean;
	herdrCommand: string;
	commandTimeoutMs: number;
}

export const DEFAULT_CONFIG: WorkspaceNamerConfig = {
	enabled: true,
	maxLength: 32,
	fallback: "local",
	notifyOnError: true,
	herdrCommand: "herdr",
	commandTimeoutMs: 5000,
};

interface LoadConfigInput {
	cwd: string;
	agentDir?: string;
	readFile(path: string): string | undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function parseSettings(text: string | undefined): Record<string, unknown> {
	if (!text) return {};
	try {
		return objectValue(parse(text));
	} catch {
		return {};
	}
}

export function loadConfig(input: LoadConfigInput): WorkspaceNamerConfig {
	const agentDir = input.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	const user = objectValue(
		parseSettings(input.readFile(join(agentDir, "settings.json"))).herdrWorkspaceNamer,
	);
	const project = objectValue(
		parseSettings(input.readFile(join(input.cwd, ".pi", "settings.json"))).herdrWorkspaceNamer,
	);
	const merged = { ...user, ...project };
	const maxLength =
		Number.isInteger(merged.maxLength) && Number(merged.maxLength) >= 16 && Number(merged.maxLength) <= 80
			? Number(merged.maxLength)
			: DEFAULT_CONFIG.maxLength;
	const commandTimeoutMs =
		Number.isInteger(merged.commandTimeoutMs) &&
		Number(merged.commandTimeoutMs) >= 500 &&
		Number(merged.commandTimeoutMs) <= 30000
			? Number(merged.commandTimeoutMs)
			: DEFAULT_CONFIG.commandTimeoutMs;
	return {
		enabled: typeof merged.enabled === "boolean" ? merged.enabled : DEFAULT_CONFIG.enabled,
		maxLength,
		fallback: "local",
		notifyOnError:
			typeof merged.notifyOnError === "boolean" ? merged.notifyOnError : DEFAULT_CONFIG.notifyOnError,
		herdrCommand:
			typeof merged.herdrCommand === "string" && merged.herdrCommand.trim()
				? merged.herdrCommand.trim()
				: DEFAULT_CONFIG.herdrCommand,
		commandTimeoutMs,
	};
}
