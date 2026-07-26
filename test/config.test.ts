import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
	it("returns safe defaults when files are absent", () => {
		expect(loadConfig({ cwd: "/repo", agentDir: "/agent", readFile: () => undefined })).toEqual(
			DEFAULT_CONFIG,
		);
	});

	it("merges project values over user values and clamps invalid data", () => {
		const files = new Map([
			[
				"/agent/settings.json",
				JSON.stringify({ herdrWorkspaceNamer: { maxLength: 64, notifyOnError: false } }),
			],
			[
				"/repo/.pi/settings.json",
				`{ // project override\n "herdrWorkspaceNamer": { "maxLength": 32, "commandTimeoutMs": -1 } }`,
			],
		]);
		const result = loadConfig({ cwd: "/repo", agentDir: "/agent", readFile: (path) => files.get(path) });
		expect(result).toMatchObject({ maxLength: 32, notifyOnError: false, commandTimeoutMs: 5000 });
	});
});
