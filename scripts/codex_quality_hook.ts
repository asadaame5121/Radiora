type HookPayload = {
	cwd?: string;
	tool_input?: {
		command?: unknown;
		path?: unknown;
		file_path?: unknown;
	};
};

type CommandResult = {
	code: number;
	output: string;
};

const decoder = new TextDecoder();

async function main(): Promise<void> {
	const payload = await readPayload();
	const repositoryRoot = await findRepositoryRoot(payload.cwd ?? Deno.cwd());
	const changedFiles = await changedFilesFromPayload(payload, repositoryRoot);

	if (changedFiles.length === 0) {
		return;
	}

	const formatFiles = changedFiles.filter(isFormatFile);
	const lintFiles = changedFiles.filter(isLintFile);

	if (formatFiles.length > 0) {
		const formatResult = await runDeno(
			["fmt", "--unstable-component", ...formatFiles],
			repositoryRoot,
		);
		if (formatResult.code !== 0) {
			console.error(
				`deno fmt failed for changed files:\n${summarize(formatResult.output)}`,
			);
			Deno.exit(2);
		}
	}

	if (lintFiles.length === 0) {
		return;
	}

	const lintResult = await runCommand(
		Deno.build.os === "windows" ? "npm.cmd" : "npm",
		biomeLintArgs(lintFiles),
		repositoryRoot,
	);
	if (lintResult.code === 0) {
		return;
	}

	// Keep the edit hook useful by applying only safe fixes while reporting
	// diagnostics without blocking the editing tool itself.
	console.log(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: "Biome safe fixes ran for changed files. Remaining diagnostics are " +
					"reported here and will be enforced by deno task verify:\n" +
					summarize(lintResult.output),
			},
		}),
	);
}

async function readPayload(): Promise<HookPayload> {
	const raw = await new Response(Deno.stdin.readable).text();
	if (raw.trim() === "") {
		return {};
	}

	try {
		return JSON.parse(raw) as HookPayload;
	} catch {
		return {};
	}
}

async function findRepositoryRoot(cwd: string): Promise<string> {
	const result = await new Deno.Command("git", {
		args: ["rev-parse", "--show-toplevel"],
		cwd,
		stdout: "piped",
		stderr: "piped",
	}).output();

	if (!result.success) {
		return cwd;
	}

	return decoder.decode(result.stdout).trim() || cwd;
}

async function changedFilesFromPayload(
	payload: HookPayload,
	repositoryRoot: string,
): Promise<string[]> {
	const command = typeof payload.tool_input?.command === "string" ? payload.tool_input.command : "";
	const candidates = [
		...extractPatchPaths(command),
		...stringValues(payload.tool_input?.path),
		...stringValues(payload.tool_input?.file_path),
	];

	const files: string[] = [];
	for (const candidate of candidates) {
		const file = await safeExistingRelativePath(repositoryRoot, candidate);
		if (file !== null && !files.includes(file)) {
			files.push(file);
		}
	}

	return files;
}

export function extractPatchPaths(command: string): string[] {
	const paths: string[] = [];
	const patterns = [
		/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm,
		/^\*\*\* (?:Move|Copy) to: (.+)$/gm,
	];

	for (const pattern of patterns) {
		for (const match of command.matchAll(pattern)) {
			if (match[1] !== undefined) {
				paths.push(match[1].trim());
			}
		}
	}

	return paths;
}

function stringValues(value: unknown): string[] {
	return typeof value === "string" && value.trim() !== "" ? [value] : [];
}

async function safeExistingRelativePath(
	repositoryRoot: string,
	candidate: string,
): Promise<string | null> {
	const relativePath = normalizeRelativePath(candidate);
	if (relativePath === null) {
		return null;
	}

	const absolutePath = joinRepositoryPath(repositoryRoot, relativePath);
	try {
		const info = await Deno.stat(absolutePath);
		return info.isFile ? relativePath : null;
	} catch {
		return null;
	}
}

export function normalizeRelativePath(candidate: string): string | null {
	const normalized = candidate.trim().replaceAll("\\", "/");
	if (normalized === "" || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
		return null;
	}

	const segments = normalized.split("/").filter((segment) => segment !== "" && segment !== ".");
	if (segments.length === 0 || segments.some((segment) => segment === "..")) {
		return null;
	}

	return segments.join("/");
}

function joinRepositoryPath(repositoryRoot: string, relativePath: string): string {
	const separator = repositoryRoot.endsWith("\\") || repositoryRoot.endsWith("/") ? "" : "/";
	return `${repositoryRoot}${separator}${relativePath}`;
}

export function isFormatFile(file: string): boolean {
	return /\.(?:cjs|css|html|js|json|jsonc|jsx|md|mjs|svelte|ts|tsx|vue)$/i.test(file);
}

export function isLintFile(file: string): boolean {
	return /\.(?:cjs|css|js|jsx|mjs|svelte|ts|tsx)$/i.test(file);
}

export function biomeLintArgs(files: string[]): string[] {
	return ["exec", "--", "biome", "lint", "--write", "--no-errors-on-unmatched", ...files];
}

async function runDeno(args: string[], cwd: string): Promise<CommandResult> {
	return await runCommand(Deno.execPath(), args, cwd);
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
	const result = await new Deno.Command(command, {
		args,
		cwd,
		stdout: "piped",
		stderr: "piped",
	}).output();

	return {
		code: result.code,
		output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`.trim(),
	};
}

function summarize(output: string): string {
	const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "");
	const visibleLines = lines.slice(0, 8);
	const omitted = lines.length - visibleLines.length;
	return omitted > 0
		? `${visibleLines.join("\n")}\n... ${omitted} more line(s)`
		: visibleLines.join("\n");
}

if (import.meta.main) await main();
