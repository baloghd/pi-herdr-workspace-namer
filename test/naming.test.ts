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
	});
});

describe("fallbackTitle", () => {
	it("builds a readable task title without leaking paths or command syntax", () => {
		expect(fallbackTitle("please research how to fix /home/me/project Herdr status", 48)).toBe(
			"Research Fix Herdr Status",
		);
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
});
