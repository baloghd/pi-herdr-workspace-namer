const TITLE_SYSTEM_PROMPT = [
	"Create a concise task title for a coding-agent workspace.",
	"Return only 3 to 6 words in the user's language.",
	"Use title case when natural for that language.",
	"Describe the task, not the conversation.",
	"No quotes, markdown, path names, issue commentary, or trailing punctuation.",
].join("\n");

const COMMENTARY_PREFIX =
	/^(?:(?:sure|okay|ok|certainly|of course)[,!\s]+)?here(?:'s| is)(?: your)? title\b|^(?:sure|okay|ok|certainly)[,!\s]+title\b|^title\s*:/i;
const MARKDOWN_DELIMITER = /(^|\s)(\*\*|__|~~|`|\*)(?=\S)([\s\S]*?\S)\2(?=$|\s)/g;

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"can",
	"could",
	"for",
	"how",
	"i",
	"in",
	"is",
	"it",
	"me",
	"my",
	"of",
	"on",
	"please",
	"should",
	"the",
	"this",
	"to",
	"we",
	"with",
	"you",
]);

export function normalizeTitle(value: string, maxLength: number): string | undefined {
	const hasLineBreak = /[\r\n\u2028\u2029]/.test(value);
	let text = Array.from(value, (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
	})
		.join("")
		.replace(/\s+/g, " ")
		.trim();
	if (hasLineBreak || !text || COMMENTARY_PREFIX.test(text)) return undefined;

	text = text.replace(MARKDOWN_DELIMITER, "$1$3");
	if (/[`*_~]/.test(text)) return undefined;

	// Strip unambiguous edge decoration repeatedly so punctuation outside a quote is handled.
	for (let pass = 0; pass < 3; pass++) {
		const before = text;
		text = text
			.replace(/^\s*(?:[-*#>`]+\s*)+/, "")
			.replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
			.replace(/[.!?:;,]+$/g, "")
			.replace(/\s*(?:[-*_~`]+\s*)+$/, "")
			.trim();
		if (text === before) break;
	}
	if (!text || /[`*_~]/.test(text)) return undefined;
	const words = text.split(" ");
	if (words.length < 2 || words.length > 8 || maxLength < 1) return undefined;
	return (
		[...text]
			.slice(0, maxLength)
			.join("")
			.trim()
			.replace(/[.!?:;,]+$/g, "") || undefined
	);
}

export function fallbackTitle(prompt: string, maxLength: number): string {
	const safe = prompt
		.replace(/`[^`]*`/g, " ")
		.split(/\s+/)
		.filter((token) => token && !token.includes("/") && !token.includes("\\") && !token.startsWith("-"))
		.join(" ")
		.replace(/[^\p{L}\p{N}\s-]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	const words = safe
		.split(" ")
		.filter((word) => word && !STOP_WORDS.has(word.toLowerCase()))
		.slice(0, 6)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
	const candidate = words.join(" ") || "Pi Task";
	return [...candidate].slice(0, Math.max(0, maxLength)).join("").trim();
}

export interface GenerateTitleInput {
	prompt: string;
	maxLength: number;
	complete(systemPrompt: string, prompt: string): Promise<string>;
}

export async function generateTitle(
	input: GenerateTitleInput,
): Promise<{ title: string; source: "model" | "fallback" }> {
	try {
		const result = normalizeTitle(await input.complete(TITLE_SYSTEM_PROMPT, input.prompt), input.maxLength);
		if (result) return { title: result, source: "model" };
	} catch {
		// The caller receives a deterministic fallback; provider details are intentionally not propagated.
	}
	return { title: fallbackTitle(input.prompt, input.maxLength), source: "fallback" };
}
