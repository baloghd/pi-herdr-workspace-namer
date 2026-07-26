import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("community documentation", () => {
	it("documents install, update, uninstall, privacy, cost, trust, and Herdr custom-name behavior", () => {
		const readme = read("README.md");
		for (const phrase of [
			"pi install npm:pi-herdr-workspace-namer",
			"pi update pi-herdr-workspace-namer",
			"pi remove npm:pi-herdr-workspace-namer",
			"one additional model request",
			"full user privileges",
			"cannot reset",
		])
			expect(readme).toContain(phrase);
	});

	it("gives agents the non-negotiable implementation invariants", () => {
		const agents = read("AGENTS.md");
		for (const phrase of ["agent_settled", "Pi session name", "pi.exec", "npm pack --dry-run", "test first"])
			expect(agents).toContain(phrase);
	});

	it("keeps planned changelog content unreleased", () => {
		const changelog = read("CHANGELOG.md");
		expect(changelog).toContain("## [Unreleased]");
		expect(changelog).not.toContain("## [0.1.0]");
		expect(changelog).not.toContain("2026-07-26");
		expect(changelog).not.toContain("releases/tag/v0.1.0");
		expect(changelog).toContain("Generate a concise workspace title");
	});
});
