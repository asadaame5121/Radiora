type Diagnostic = {
	category?: string;
	message: string;
	location?: { path?: string };
};

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

Deno.test("Biome and GritQL enforce the production safety policy", async () => {
	const repositoryRoot = new URL("../../", import.meta.url).pathname.replace(
		/^\/(?:([A-Za-z]:))/,
		"$1",
	);
	const directory = await Deno.makeTempDir({ prefix: "radiora-biome-policy-" });
	try {
		await Deno.mkdir(`${directory}/src`, { recursive: true });
		await Deno.mkdir(`${directory}/tests`, { recursive: true });
		await Deno.mkdir(`${directory}/lint-plugins`, { recursive: true });
		for (const plugin of ["noDangerousTypeAssertion.grit", "noSwallowedRejection.grit"]) {
			await Deno.copyFile(
				`${repositoryRoot}/lint-plugins/${plugin}`,
				`${directory}/lint-plugins/${plugin}`,
			);
		}

		await write(
			`${directory}/src/dangerous.ts`,
			[
				"declare const input: unknown;",
				"export const explicitAny = input as any;",
				"export const doubleAssertion = input as unknown as string;",
			].join("\n"),
		);
		await write(
			`${directory}/src/safe.ts`,
			[
				"declare const input: unknown;",
				"export const singleAssertion = input as string;",
				"export const literal = { mode: 'safe' } as const;",
				"export const checked = { mode: 'safe' } satisfies { mode: string };",
				"export function fallback(): string { try { throw new Error('x'); } catch { return 'fallback'; } }",
				"export function logged(): void { try { throw new Error('x'); } catch (error) { console.error(error); } }",
				"export function wrapped(): never { try { throw new Error('x'); } catch (cause) { throw new Error('wrapped', { cause }); } }",
			].join("\n"),
		);
		await write(
			`${directory}/tests/dangerous_test.ts`,
			[
				"declare const input: unknown;",
				"export const invalidFixture = input as unknown as string;",
			].join("\n"),
		);
		await write(
			`${directory}/src/swallowed.ts`,
			[
				"declare const promise: Promise<void>;",
				"declare const success: () => void;",
				"export function emptyCatch(): void { try { throw new Error('x'); } catch {} }",
				"promise.catch(() => {});",
				"promise.catch(() => undefined);",
				"promise.then(success, () => {});",
				"promise.then(success, () => undefined);",
			].join("\n"),
		);
		await write(
			`${directory}/src/floating.ts`,
			[
				"declare function operation(): Promise<void>;",
				"export function floating(): void { operation(); }",
				"export function losesCause(): never { try { throw new Error('x'); } catch { throw new Error('wrapped'); } }",
			].join("\n"),
		);

		await write(
			`${directory}/biome.json`,
			JSON.stringify(
				{
					files: { includes: ["**/*.ts"] },
					plugins: [
						{
							path: "./lint-plugins/noDangerousTypeAssertion.grit",
							includes: ["**/*.ts", "!**/*_test.ts", "!tests/**"],
						},
						"./lint-plugins/noSwallowedRejection.grit",
					],
					linter: {
						rules: {
							preset: "none",
							nursery: { noFloatingPromises: "error" },
							style: { useErrorCause: "error" },
							suspicious: { noEmptyBlockStatements: "error", noExplicitAny: "error" },
						},
					},
				},
				null,
				"\t",
			),
		);

		const result = await new Deno.Command("node", {
			args: [
				`${repositoryRoot}/node_modules/@biomejs/biome/bin/biome`,
				"lint",
				"--reporter=json",
				"--max-diagnostics=100",
			],
			cwd: directory,
			stdout: "piped",
			stderr: "piped",
		}).output();
		assert(!result.success, "The intentionally invalid production fixtures must fail lint.");
		const report = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			diagnostics: Diagnostic[];
		};
		const diagnostics = report.diagnostics;

		const dangerous = diagnostics.filter((diagnostic) =>
			diagnostic.message.startsWith("Do not bypass type safety")
		);
		assert(
			dangerous.length === 2,
			`Expected two dangerous assertion diagnostics, got ${dangerous.length}.`,
		);
		assert(
			dangerous.every((diagnostic) => diagnostic.location?.path?.includes("dangerous.ts")),
			"Test fixtures must be excluded from the dangerous assertion plugin.",
		);
		const swallowed = diagnostics.filter((diagnostic) =>
			diagnostic.message.startsWith("Do not silently swallow")
		);
		assert(
			swallowed.length === 5,
			`Expected five swallowed rejection diagnostics, got ${swallowed.length}.`,
		);
		assert(
			diagnostics.some((diagnostic) => diagnostic.category === "lint/nursery/noFloatingPromises"),
			"Floating promises must fail.",
		);
		assert(
			diagnostics.some((diagnostic) => diagnostic.category === "lint/style/useErrorCause"),
			"Cause-losing rethrows must fail.",
		);
		assert(
			!diagnostics.some((diagnostic) => diagnostic.location?.path?.includes("safe.ts")),
			"Explicit fallback, logging, and cause-preserving paths must pass.",
		);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

async function write(path: string, source: string): Promise<void> {
	await Deno.writeTextFile(path, `${source}\n`);
}
