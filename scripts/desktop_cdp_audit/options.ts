export type TargetKind = "renderer" | "deno";

export interface AuditOptions {
	host: string;
	port: number;
	target: TargetKind;
	waitMs: number;
	expression?: string;
	screenshot?: string;
	trace?: string;
	output?: string;
	strict: boolean;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9230;

export function parseOptions(args: string[]): AuditOptions {
	const options: AuditOptions = {
		host: DEFAULT_HOST,
		port: DEFAULT_PORT,
		target: "renderer",
		waitMs: 500,
		strict: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") continue;
		if (arg === "--strict") {
			options.strict = true;
			continue;
		}
		const [flag, inlineValue] = arg.split("=", 2);
		const value = inlineValue ?? args[++index];
		if (!value) throw new Error(`Missing value for ${flag}`);
		applyAuditOption(options, flag, value);
	}
	if (options.trace && options.target !== "renderer") {
		throw new Error("--trace requires --target renderer.");
	}
	const outputPaths = [options.trace, options.output, options.screenshot]
		.filter((path): path is string => path !== undefined);
	if (new Set(outputPaths).size !== outputPaths.length) {
		throw new Error("--trace, --output, and --screenshot must use different paths.");
	}
	return options;
}

function applyAuditOption(options: AuditOptions, flag: string, value: string): void {
	switch (flag) {
		case "--host":
			options.host = value;
			break;
		case "--port":
			options.port = parsePositiveInteger(value, flag);
			break;
		case "--target":
			if (value !== "renderer" && value !== "deno") throw new Error(`Invalid target: ${value}`);
			options.target = value;
			break;
		case "--wait-ms":
			options.waitMs = parseNonNegativeInteger(value, flag);
			break;
		case "--expression":
			options.expression = value;
			break;
		case "--screenshot":
			options.screenshot = value;
			break;
		case "--trace":
			options.trace = value;
			break;
		case "--output":
			options.output = value;
			break;
		default:
			throw new Error(`Unknown option: ${flag}`);
	}
}

function parsePositiveInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive integer.`);
	}
	return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative integer.`);
	}
	return parsed;
}
