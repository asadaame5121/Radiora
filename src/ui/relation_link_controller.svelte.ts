import type { CreateLinkInput, LinkType, OutlineLink } from "../domain/models.ts";
import type { InlineSemanticLinkCandidate } from "../services/inline_semantic_link.ts";
import type { AdvancedLinkResolution } from "../services/advanced_link_resolver.ts";

export interface RelationLinkPorts {
	createLink(input: CreateLinkInput): Promise<unknown>;
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<unknown>;
	resolveAdvancedLink(advancedInput: string): Promise<AdvancedLinkResolution>;
	isSymmetric(type: LinkType): boolean;
	reload(): Promise<unknown>;
	errorMessage(cause: unknown): string;
}

/** Owns link mutations and candidate resolution workflows. */
export class RelationLinkController {
	constructor(private readonly ports: RelationLinkPorts) {}

	async addLink(input: CreateLinkInput): Promise<void> {
		await this.ports.createLink(input);
		await this.ports.reload();
	}

	async removeLink(link: OutlineLink): Promise<void> {
		await this.ports.deleteLink(link.fromId, link.toId, link.type);
		await this.ports.reload();
	}

	async reverseLink(link: OutlineLink): Promise<void> {
		if (link.origin === "derived" || this.ports.isSymmetric(link.type)) return;
		await this.ports.deleteLink(link.fromId, link.toId, link.type);
		await this.ports.createLink({
			fromId: link.toId,
			toId: link.fromId,
			fromEndpoint: link.to,
			toEndpoint: link.from,
			type: link.type,
			status: link.status,
			origin: link.origin,
			reason: link.reason,
		});
		await this.ports.reload();
	}

	async inspectCandidate(candidate: InlineSemanticLinkCandidate): Promise<string> {
		const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
		const reason = candidate.reason === undefined
			? ""
			: `("${candidate.reason.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
		const advancedInput = `${quote(candidate.source)} :: ${candidate.type}${reason} :: ${
			quote(candidate.target)
		}`;
		try {
			const resolution = await this.ports.resolveAdvancedLink(advancedInput);
			return resolution.source.status === "resolved" && resolution.target.status === "resolved"
				? `候補を解決しました: ${candidate.type} · ${candidate.source} → ${candidate.target}`
				: `未確定の候補です: ${
					resolution.source.reason ?? resolution.target.reason ?? "対象を選択してください。"
				}`;
		} catch (cause) {
			return `構文を確認できませんでした: ${this.ports.errorMessage(cause)}`;
		}
	}
}
