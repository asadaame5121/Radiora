import {
	fetchLicenseIndex,
	type LicenseEntry,
	type LicenseIndex,
} from "../services/license_index.ts";

export interface LicensesPorts {
	fetchIndex?: () => Promise<LicenseIndex>;
	fetchDetail?: (file: string) => Promise<Response>;
	errorMessage?: (cause: unknown) => string;
}

function defaultErrorMessage(cause: unknown): string {
	if (typeof cause === "object" && cause && "message" in cause) {
		return String(cause.message);
	}
	return String(cause);
}

/** Owns the short-lived license dialog state and request invalidation. */
export class LicensesController {
	private liveOpen = $state(false);
	private liveIndex = $state<LicenseIndex | null>(null);
	private liveDetail = $state<{ name: string; text: string } | null>(null);
	private liveError = $state("");
	private liveLoading = $state(false);

	private indexGeneration = 0;
	private detailGeneration = 0;
	private disposed = false;

	private readonly fetchIndex: () => Promise<LicenseIndex>;
	private readonly fetchDetail: (file: string) => Promise<Response>;
	private readonly errorMessage: (cause: unknown) => string;

	constructor(ports: LicensesPorts = {}) {
		this.fetchIndex = ports.fetchIndex ?? (() => fetchLicenseIndex());
		this.fetchDetail = ports.fetchDetail ?? ((file: string) => fetch(`/licenses/${file}`));
		this.errorMessage = ports.errorMessage ?? defaultErrorMessage;
	}

	get isOpen(): boolean {
		return this.liveOpen;
	}

	get index(): LicenseIndex | null {
		return this.liveIndex;
	}

	get detail(): { name: string; text: string } | null {
		return this.liveDetail;
	}

	get error(): string {
		return this.liveError;
	}

	get loading(): boolean {
		return this.liveLoading;
	}

	async open(): Promise<void> {
		if (this.disposed) return;
		this.liveOpen = true;
		this.liveDetail = null;
		this.liveError = "";
		this.liveIndex = null;
		this.liveLoading = true;
		const gen = ++this.indexGeneration;

		try {
			const result = await this.fetchIndex();
			if (!this.disposed && this.liveOpen && this.indexGeneration === gen) {
				this.liveIndex = result;
			}
		} catch (cause) {
			if (!this.disposed && this.liveOpen && this.indexGeneration === gen) {
				this.liveError = this.errorMessage(cause);
			}
		} finally {
			if (!this.disposed && this.liveOpen && this.indexGeneration === gen) {
				this.liveLoading = false;
			}
		}
	}

	close(): void {
		this.liveOpen = false;
		this.indexGeneration++;
		this.detailGeneration++;
		this.liveLoading = false;
		this.liveDetail = null;
		this.liveError = "";
	}

	async select(entry: LicenseEntry): Promise<void> {
		if (this.disposed || !this.liveOpen || !entry.file) return;
		const gen = ++this.detailGeneration;
		this.liveDetail = {
			name: `${entry.name} ${entry.version}`,
			text: "ライセンス全文を読み込んでいます…",
		};

		try {
			const response = await this.fetchDetail(entry.file);
			if (this.disposed || !this.liveOpen || this.detailGeneration !== gen) return;

			if (response.ok) {
				const text = await response.text();
				if (this.disposed || !this.liveOpen || this.detailGeneration !== gen) return;
				this.liveDetail = {
					name: `${entry.name} ${entry.version}`,
					text,
				};
			} else {
				this.liveDetail = {
					name: `${entry.name} ${entry.version}`,
					text: `ライセンス全文を読み込めませんでした (${response.status})。`,
				};
			}
		} catch (cause) {
			if (this.disposed || !this.liveOpen || this.detailGeneration !== gen) return;
			this.liveDetail = {
				name: `${entry.name} ${entry.version}`,
				text: this.errorMessage(cause),
			};
		}
	}

	dispose(): void {
		this.disposed = true;
		this.liveOpen = false;
		this.indexGeneration++;
		this.detailGeneration++;
	}
}
