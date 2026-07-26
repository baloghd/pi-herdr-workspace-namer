import { describe, expect, it, vi } from "vitest";
import { fallbackTitle, generateTitle, normalizeTitle } from "../src/naming.ts";

describe("normalizeTitle", () => {
	it("removes markdown, quotes, punctuation, and truncates by code point", () => {
		expect(normalizeTitle('**"Research Herdr Workspace Naming."**', 30)).toBe(
			"Research Herdr Workspace Namin",
		);
	});
	it("rejects commentary and empty responses", () => {
		expect(normalizeTitle("Here is your title:\nFix Status", 48)).toBeUndefined();
		expect(normalizeTitle("", 48)).toBeUndefined();
	});
	it("rejects Unicode line separators before normalization", () => {
		expect(normalizeTitle("Fix\u2028Status", 48)).toBeUndefined();
		expect(normalizeTitle("Fix\u2029Status", 48)).toBeUndefined();
	});
	it("bounds astral code points without splitting them", () => {
		expect(normalizeTitle("Fix 🚀 Status", 5)).toBe("Fix 🚀");
	});
});

describe("fallbackTitle", () => {
	it("builds a readable task title without leaking paths or command syntax", () => {
		expect(fallbackTitle("please research how to fix /home/me/project Herdr status", 48)).toBe(
			"Research Fix Herdr Status",
		);
	});
	it("removes relative and Windows path tokens entirely", () => {
		expect(fallbackTitle("please fix src/naming.ts and lib\\old.ts Herdr status", 48)).toBe(
			"Fix Herdr Status",
		);
	});
	it("removes shell flags and code spans", () => {
		expect(fallbackTitle("please fix `npm test --run` --verbose Herdr status", 48)).toBe("Fix Herdr Status");
	});
});

describe("generateTitle", () => {
	it("uses one validated current-model result", async () => {
		const complete = vi.fn().mockResolvedValue("Fix Herdr Agent Status");
		await expect(generateTitle({ prompt: "fix it", maxLength: 48, complete })).resolves.toEqual({
			title: "Fix Herdr Agent Status",
			source: "model",
		});
		expect(complete).toHaveBeenCalledTimes(1);
	});
	it("falls back locally after model failure or invalid output", async () => {
		const complete = vi.fn().mockRejectedValue(new Error("provider unavailable"));
		const result = await generateTitle({ prompt: "research workspace naming", maxLength: 48, complete });
		expect(result).toEqual({ title: "Research Workspace Naming", source: "fallback" });
	});
	it("falls back when the provider resolves an invalid value", async () => {
		const complete = vi.fn().mockResolvedValue(null);
		await expect(
			generateTitle({ prompt: "research workspace naming", maxLength: 48, complete }),
		).resolves.toEqual({
			title: "Research Workspace Naming",
			source: "fallback",
		});
	});
});
