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
		this.timer = setTimeout(() => {
			this.timer = undefined;
			const dispatch = () => {
				const next = this.ports.context();
				if (
					this.disposed || !current() || context.pane !== next.pane ||
					context.origin !== next.origin || !this.ports.canFocus(id)
				) return;
				document.querySelector<HTMLElement>(
					`.markdown-editor-host[data-editor-item-id="${CSS.escape(id)}"]`,
				)
					?.dispatchEvent(new CustomEvent("radiora:focus-editor", { detail: { caretOffset } }));
			};
			const next = this.ports.context();
			if (
				this.disposed || !current() || context.pane !== next.pane ||
				context.origin !== next.origin || !this.ports.canFocus(id)
			) return;
			if (!this.ports.ensureMounted) {
				dispatch();
				return;
			}
			void this.ports.ensureMounted(id, current).then((mounted) => {
				if (mounted) dispatch();
			}).catch((cause) => {
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
