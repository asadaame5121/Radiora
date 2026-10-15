import { asError } from "./cdp_client.ts";
import { parseOptions } from "./options.ts";
import { runAudit, writeNewJsonFile } from "../desktop_cdp_audit.ts";

export type PerformanceCaseName = "outline-input" | "outline-collapse" | "tree-pan" | "tree-zoom";

export interface PerformanceCaseArguments {
	caseName: PerformanceCaseName;
	itemId?: string;
	auditArgs: string[];
}

const CASE_NAMES = new Set<PerformanceCaseName>([
	"outline-input",
	"outline-collapse",
	"tree-pan",
	"tree-zoom",
]);
const PERFORMANCE_SAMPLE_COUNT = 35;

if (import.meta.main) {
	if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
		printHelp();
	} else {
		try {
			const args = parsePerformanceCaseArguments(Deno.args);
			const options = parseOptions(args.auditArgs);
			if (options.target !== "renderer") {
				throw new Error("Performance cases require --target renderer.");
			}
			if (!options.trace || !options.output) {
				throw new Error("Performance cases require both --trace and --output paths.");
			}
			if (options.expression) {
				throw new Error("Performance cases own --expression; remove that option.");
			}
			options.expression = buildPerformanceCaseExpression(args.caseName, args.itemId);
			const report = await runAudit(options);
			await writeNewJsonFile(options.output, report);
			console.log(JSON.stringify(
				{
					outputPath: options.output,
					trace: report.trace,
					issueCount: report.issueCount,
					case: args.caseName,
					samples: PERFORMANCE_SAMPLE_COUNT,
				},
				null,
				2,
			));
			if (options.strict && report.issueCount > 0) Deno.exit(2);
		} catch (cause) {
			console.error(`Desktop performance case failed: ${asError(cause).message}`);
			Deno.exit(1);
		}
	}
}

export function parsePerformanceCaseArguments(args: string[]): PerformanceCaseArguments {
	let caseName: PerformanceCaseName | undefined;
	let itemId: string | undefined;
	const auditArgs: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const [flag, inlineValue] = arg.split("=", 2);
		if (flag !== "--case" && flag !== "--item-id") {
			auditArgs.push(arg);
			continue;
		}
		const value = inlineValue ?? args[++index];
		if (!value) throw new Error(`${flag} requires a non-empty value.`);
		if (flag === "--case") caseName = parseCaseName(value);
		else itemId = value;
	}
	if (!caseName) throw new Error("A --case must be selected.");
	return { caseName, itemId, auditArgs };
}

function parseCaseName(value: string): PerformanceCaseName {
	if (!CASE_NAMES.has(value as PerformanceCaseName)) {
		throw new Error(`Invalid performance case: ${value}`);
	}
	return value as PerformanceCaseName;
}

export function buildPerformanceCaseExpression(
	caseName: PerformanceCaseName,
	itemId?: string,
): string {
	const caseValue = JSON.stringify(caseName);
	const itemValue = JSON.stringify(itemId ?? null);
	return `(async () => {
	const caseName = ${caseValue};
	const itemId = ${itemValue};
	const sampleCount = ${PERFORMANCE_SAMPLE_COUNT};
	const samples = [];
	const frame = () => new Promise(requestAnimationFrame);
	const until = async (predicate, label) => {
		const deadline = performance.now() + 10000;
		while (performance.now() < deadline) {
			if (predicate()) return performance.now();
			await frame();
		}
		throw new Error('Timed out waiting for ' + label);
	};
	const outlineRow = () => {
		if (itemId) return [...document.querySelectorAll('[data-outline-row-id]')]
			.find((row) => row.getAttribute('data-outline-row-id') === itemId) ?? null;
		return document.querySelector('[data-outline-row-id]');
	};
	const collapsibleRow = () => itemId
		? outlineRow()
		: [...document.querySelectorAll('[data-outline-row-id]')]
			.find((row) => row.querySelector('button.disclosure:not(.hidden)')) ?? null;
	const tree = () => document.querySelector('svg[aria-label="思索の系統樹"]');
	for (let index = 0; index < sampleCount; index += 1) {
		const start = performance.now();
		const inputMark = 'radiora:' + caseName + ':' + index + ':input';
		const domMark = 'radiora:' + caseName + ':' + index + ':dom';
		const rafMark = 'radiora:' + caseName + ':' + index + ':raf-proxy';
		performance.mark(inputMark);
		if (caseName === 'outline-input') {
			const editor = outlineRow()?.querySelector('textarea[data-item-id]');
			if (!(editor instanceof HTMLTextAreaElement)) throw new Error('Outline editor not found.');
			const nextValue = editor.value + (index % 2 === 0 ? 'x' : 'y');
			editor.value = nextValue;
			editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
		} else if (caseName === 'outline-collapse') {
			const row = collapsibleRow();
			const button = row?.querySelector('button.disclosure:not(.hidden)');
			if (!(button instanceof HTMLButtonElement)) throw new Error('Outline row with children not found.');
			const initialLabel = button.getAttribute('aria-label');
			button.click();
			await until(() => row.querySelector('button.disclosure')?.getAttribute('aria-label') !== initialLabel, 'collapse');
		} else {
			const svg = tree();
			if (!(svg instanceof SVGSVGElement)) throw new Error('Tree renderer not found.');
			const box = svg.getBoundingClientRect();
			if (caseName === 'tree-pan') {
				const x = box.left + 12;
				const y = box.top + 12;
				const before = Reflect.get(svg, '__zoom');
				svg.dispatchEvent(new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: x,
					clientY: y,
					view: window,
				}));
				window.dispatchEvent(new MouseEvent("mousemove", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: x + 8,
					clientY: y + 6,
					view: window,
				}));
				window.dispatchEvent(new MouseEvent("mouseup", {
					bubbles: true,
					button: 0,
					buttons: 0,
					clientX: x + 8,
					clientY: y + 6,
					view: window,
				}));
				await until(() => {
					const next = Reflect.get(svg, '__zoom');
					return next && before && (next.x !== before.x || next.y !== before.y);
				}, 'Tree pan');
			} else {
				const before = Reflect.get(svg, '__zoom')?.k;
				svg.dispatchEvent(new WheelEvent("wheel", {
					bubbles: true,
					cancelable: true,
					deltaY: index % 2 === 0 ? -80 : 80,
					clientX: box.left + box.width / 2,
					clientY: box.top + box.height / 2,
				}));
				await until(() => Reflect.get(svg, '__zoom')?.k !== before, 'Tree zoom');
			}
		}
		const domTime = performance.now();
		performance.mark(domMark);
		await frame();
		const rafProxyTime = performance.now();
		performance.mark(rafMark);
		samples.push({
			index,
			inputMark,
			domMark,
			rafMark,
			operationToDomMs: domTime - start,
			rafProxyMs: rafProxyTime - start,
		});
		if (caseName === 'outline-collapse') {
			const row = collapsibleRow();
			const button = row?.querySelector('button.disclosure');
			const label = button?.getAttribute('aria-label');
			button?.click();
			await until(() => row.querySelector('button.disclosure')?.getAttribute('aria-label') !== label, 'restore Outline expansion');
		}
	}
	return {
		caseName,
		inputKind: 'synthetic renderer DOM event',
		sampleCount: samples.length,
		samples,
		runtime: {
			userAgent: navigator.userAgent,
			title: document.title,
			appVersion: document.querySelector('meta[name="app-version"]')?.getAttribute('content') ?? null,
		},
		paintMetric: 'Resolve inputMark to the next Paint event in the accompanying trace; rafProxyMs is not paint completion.',
		appQueueDepth: null,
		appQueueDepthNote: 'The renderer does not expose its pending operation queue.',
	};
})()`;
}

function printHelp(): void {
	console.log(
		`Usage: deno task desktop:performance -- --case <name> --trace <path> --output <path> [audit options]

Cases: outline-input, outline-collapse, tree-pan, tree-zoom
Options:
  --item-id <id>       Select an Outline item; collapse requires a row with children
  --trace <path>       Save the renderer Performance trace JSON
  --output <path>      Save the report with 35 input/DOM/rAF proxy samples
  --host/--port        Override the inspector endpoint (default 127.0.0.1:9230)

The events are synthetic renderer events. The trace retains the actual Paint events;
the rAF proxy is reported separately and must not be called paint completion.
	`,
	);
}
