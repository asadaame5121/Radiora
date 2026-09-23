export interface OperationRecord {
	timestamp: string;
	sessionId: string;
	event: string;
	outcome: "ok" | "error";
	durationMs: number;
	errorType?: string;
}

export interface OperationSummary {
	retentionDays: number;
	bytes: number;
	count: number;
	failed: number;
	averageDurationMs: number;
	byDay: { day: string; count: number }[];
	byEvent: { event: string; count: number }[];
	recent: OperationRecord[];
}
