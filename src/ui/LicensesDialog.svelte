<script lang="ts">
	export type LicenseEntry = {
		name: string;
		version: string;
		license: string;
		file: string | null;
		summary: string;
	};

	export type LicenseIndex = {
		runtime: LicenseEntry[];
		npm: LicenseEntry[];
	};

	let {
		dialog = $bindable<HTMLDialogElement>(),
		licenseIndex,
		licenseDetail,
		licenseError,
		licenseLoading,
		onSelectLicense,
	}: {
		dialog: HTMLDialogElement | undefined;
		licenseIndex: LicenseIndex | null;
		licenseDetail: { name: string; text: string } | null;
		licenseError: string;
		licenseLoading: boolean;
		onSelectLicense: (entry: LicenseEntry) => void | Promise<void>;
	} = $props();
</script>

<dialog
	bind:this={dialog}
	class="licenses-dialog"
	aria-labelledby="licenses-title"
	aria-modal="true"
>
	<div class="licenses-dialog__content">
		<header class="licenses-dialog__header">
			<p class="eyebrow">THIRD-PARTY NOTICES</p>
			<h2 id="licenses-title">ライセンス情報</h2>
			<p>Radioraが利用しているサードパーティソフトウェアのライセンスを表示します。</p>
		</header>
		{#if licenseError}
			<p class="licenses-dialog__error" role="alert">{licenseError}</p>
		{:else if licenseIndex}
			<div class="licenses-dialog__layout">
				<ul class="licenses-dialog__list">
					{#each [...licenseIndex.runtime, ...licenseIndex.npm] as entry}
						<li>
							<button onclick={() => onSelectLicense(entry)}>
								<strong>{entry.name}</strong>
								<small>{entry.license}{entry.version ? ` · ${entry.version}` : ""}</small>
							</button>
						</li>
					{/each}
				</ul>
				<div class="licenses-dialog__detail">
					{#if licenseDetail}
						<h3>{licenseDetail.name}</h3>
						<pre>{licenseDetail.text}</pre>
					{:else}
						<p class="licenses-dialog__hint">左の一覧からライセンスを選択してください。</p>
					{/if}
				</div>
			</div>
		{:else if licenseLoading}
			<p>読み込んでいます…</p>
		{/if}
		<div class="licenses-dialog__actions">
			<button onclick={() => dialog?.close()}>閉じる</button>
		</div>
	</div>
</dialog>
