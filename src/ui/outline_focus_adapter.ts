interface FocusPorts {
	context(): { pane: string; origin: unknown };
	canFocus(id: string): boolean;
	ensureMounted?: (id: string, current: () => boolean) => Promise<boolean>;
}

/** One scheduled DOM request, invalidated by selection receipt, pane, navigation or disposal. */
export class OutlineFocusAdapter {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	constructor(private readonly ports: FocusPorts) {}
	request(id: string, caretOffset: number | undefined, current: () => boolean): void {
		if (this.disposed) return;
		if (this.timer !== undefined) clearTimeout(this.timer);
		const context = this.ports.context();
		const stillCurrent = () => {
			const next = this.ports.context();
			return (
				!this.disposed &&
				current() &&
				context.pane === next.pane &&
				context.origin === next.origin &&
				this.ports.canFocus(id)
			);
		};
		this.timer = setTimeout(() => {
			this.timer = undefined;
			const dispatch = () => {
				if (!stillCurrent()) return;
				document
					.querySelector<HTMLElement>(
						`.markdown-editor-host[data-editor-item-id="${CSS.escape(id)}"]`,
					)
					?.dispatchEvent(new CustomEvent("radiora:focus-editor", { detail: { caretOffset } }));
			};
			if (!stillCurrent()) return;
			if (!this.ports.ensureMounted) {
				dispatch();
				return;
			}
			void this.ports
				.ensureMounted(id, stillCurrent)
				.then((mounted) => {
					if (mounted) dispatch();
				})
				.catch((cause) => {
					console.error("Outlineの対象行をmountできませんでした", cause);
				});
		}, 0);
	}
	dispose(): void {
		this.disposed = true;
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
	}
}
