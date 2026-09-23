import type { BindingContext } from "../src/desktop/register_bindings.ts";

export const operationLogBindingStub: Pick<
	BindingContext,
	| "getOperationSummary"
	| "exportOperationLog"
	| "clearDiagnosticLogs"
	| "recordViewChange"
	| "recordClientOperation"
> = {
	getOperationSummary: () =>
		Promise.resolve({
			retentionDays: 30,
			bytes: 0,
			count: 0,
			failed: 0,
			averageDurationMs: 0,
			byDay: [],
			byEvent: [],
			recent: [],
		}),
	exportOperationLog: () => Promise.resolve(""),
	clearDiagnosticLogs: () => Promise.resolve(),
	recordViewChange: () => Promise.resolve(),
	recordClientOperation: () => Promise.resolve(),
};
