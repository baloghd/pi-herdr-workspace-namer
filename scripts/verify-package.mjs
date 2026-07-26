#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACK_ARGS = ["pack", "--json", "--dry-run", "--ignore-scripts"];

const REQUIRED_FILES = new Set([
	"package.json",
	"README.md",
	"LICENSE",
	"CHANGELOG.md",
	"SECURITY.md",
	"extensions/workspace-namer.ts",
]);
const ALLOWED_PATH =
	/^(?:package\.json|README\.md|LICENSE|CHANGELOG\.md|SECURITY\.md|extensions\/workspace-namer\.ts|src\/[^/]+\.ts)$/;
const UNSAFE_DIRECTORY = /(^|\/)(?:\.env|\.git|node_modules|test|docs|coverage|\.pi-subagents)(?:\/|$)/;
const SESSION_OR_LOG = /(?:^|\/)[^/]+\.(?:log|jsonl|session)$/i;
const ABSOLUTE_HOME = /(?:^|\/)(?:home\/[^/]+|Users\/[^/]+)(?:\/|$)/;
const MAX_FILE_SIZE = 250 * 1024;
const SECRET_ASSIGNMENT = /\b(?:API_KEY|TOKEN|PASSWORD)\s*(?:=\s*(?:"[^"\r\n]+"|'[^'\r\n]+')|=[^\s`"'<>]+)/g;

export function containsSecretAssignment(contents) {
	SECRET_ASSIGNMENT.lastIndex = 0;
	return SECRET_ASSIGNMENT.test(contents);
}

function fail(errors) {
	for (const error of errors) console.error(`package verification failed: ${error}`);
	process.exitCode = 1;
}

export function verifyPackage(root = process.cwd()) {
	let records;
	try {
		const output = execFileSync("npm", PACK_ARGS, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		records = JSON.parse(output);
	} catch (error) {
		const detail = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
		fail([`npm pack dry-run failed (${detail})`]);
		return;
	}

	const record = records?.[0];
	if (!record || !Array.isArray(record.files)) {
		fail(["npm pack returned no package file list"]);
		return;
	}

	const errors = [];
	const paths = new Set(record.files.map((file) => file.path));
	for (const required of REQUIRED_FILES) {
		if (!paths.has(required)) errors.push(`missing required file: ${required}`);
	}

	const runtimeFiles = readdirSync(path.join(root, "src"), { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => `src/${entry.name}`);
	for (const runtimeFile of runtimeFiles) {
		if (!paths.has(runtimeFile)) errors.push(`missing runtime module: ${runtimeFile}`);
	}
	if (runtimeFiles.length === 0) errors.push("missing src/*.ts runtime modules");

	for (const file of record.files) {
		const packagePath = file.path;
		if (!ALLOWED_PATH.test(packagePath)) errors.push(`file is not allowlisted: ${packagePath}`);
		if (UNSAFE_DIRECTORY.test(packagePath)) errors.push(`unsafe directory in path: ${packagePath}`);
		if (SESSION_OR_LOG.test(packagePath)) errors.push(`session/log artifact in path: ${packagePath}`);
		if (ABSOLUTE_HOME.test(packagePath)) errors.push(`absolute home fragment in path: ${packagePath}`);
		if (file.size > MAX_FILE_SIZE) errors.push(`file exceeds 250 KiB: ${packagePath} (${file.size} bytes)`);

		if (!ALLOWED_PATH.test(packagePath)) continue;
		try {
			const contents = readFileSync(path.join(root, packagePath), "utf8");
			if (containsSecretAssignment(contents)) errors.push(`likely secret assignment in: ${packagePath}`);
		} catch (error) {
			errors.push(`cannot inspect ${packagePath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	if (errors.length > 0) {
		fail(errors);
		return;
	}

	const totalSize = record.files.reduce((sum, file) => sum + file.size, 0);
	console.log(`package verified: ${record.files.length} files, ${totalSize} bytes unpacked`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) verifyPackage();
