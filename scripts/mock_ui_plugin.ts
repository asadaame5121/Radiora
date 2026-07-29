import type { Plugin } from "vite";
import type { OutlineItem, OutlineLink, OutlineSnapshot, Revision } from "../src/domain/models.ts";

const TITLES = [
	"観察と問いのはじまり",
	"記憶のかたち",
	"時間の層位学",
	"他者との共鳴",
	"対話のアーキテクチャ",
	"記憶の再編成",
	"創造性と記憶",
	"忘却のデザイン",
	"創造の触媒",
	"偶発性と発見",
	"記録の責任",
	"効率性への逆説",
	"身体化された知識",
	"語り直す技術",
	"断片から全体へ",
	"問いを育てる",
	"概念の漂流",
	"経験の輪郭",
	"意味の発芽",
	"批判と修復",
	"静かな仮説",
	"知識の余白",
	"連想の地図",
	"未来の考古学",
	"編集という思考",
	"不確実性を抱える",
	"発見の速度",
	"記憶の庭",
];

function mockSnapshot(): OutlineSnapshot {
	const start = Date.UTC(2023, 0, 15);
	const titles = [...TITLES, ...TITLES.map((title) => `${title}・余章`)];
	const items: OutlineItem[] = titles.map((title, index) => {
		const createdAt = new Date(start + index * 39 * 86_400_000).toISOString();
		const parentIndex = index < 4 ? null : Math.max(0, index - (2 + index % 4));
		return {
			id: `mock-${index + 1}`,
			workId: `mock-${index + 1}`,
			text: index === 6
				? `${title}\n創造性は、記憶の単なる再生ではなく、過去の要素を新しい文脈で再構成する働きである。`
				: title,
			parentId: parentIndex === null ? null : `mock-${parentIndex + 1}`,
			orderKey: (index + 1) * 1024,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: `mock-${index + 1}` },
			createdAt,
			updatedAt: createdAt,
		};
	});
	const links: OutlineLink[] = [
		["mock-7", "mock-10", "LIKE"],
		["mock-7", "mock-11", "FIX"],
		["mock-11", "mock-12", "VS"],
		["mock-4", "mock-18", "SUPPORT"],
		["mock-15", "mock-22", "LIKE"],
	].map(([fromId, toId, type], index) => ({
		id: `mock-link-${index + 1}`,
		fromId,
		toId,
		from: { scope: "work" as const, workId: fromId },
		to: { scope: "work" as const, workId: toId },
		type: type as OutlineLink["type"],
		status: "asserted" as const,
		origin: "human" as const,
		createdAt: new Date(start + (index + 1) * 86_400_000).toISOString(),
	}));
	return {
		items,
		links,
		knots: [{ id: "mock-knot", cycleIds: ["mock-12"], createdAt: items[11].createdAt }],
		stashItemIds: ["mock-12"],
	};
}

function mockRevisions(workId: string): Revision[] {
	return [
		{
			id: `${workId}-version-1`,
			workId,
			text: "観察から問いが生まれる。\n\nまだ名前のない輪郭を記録する。",
			parentRevisionIds: [],
			kind: "edition",
			createdAt: "2025-03-10T09:00:00.000Z",
			message: "最初の版",
		},
		{
			id: `${workId}-version-2`,
			workId,
			text:
				"観察から問いが生まれる。\n言葉になる前の違和感を残す。\n\nまだ名前のない輪郭を記録する。",
			parentRevisionIds: [`${workId}-version-1`],
			kind: "edition",
			createdAt: "2025-03-14T15:30:00.000Z",
			message: "加筆した版",
		},
	];
}

export function mockUiPlugin(): Plugin {
	const snapshot = mockSnapshot();
	const rewriteBranches = new Map<
		string,
		Array<{
			id: string;
			workId: string;
			name: string;
			headRevisionId: string;
			createdAt: string;
		}>
	>();
	return {
		name: "radiora-mock-ui-api",
		configureServer(server) {
			server.middlewares.use(async (request, response, next) => {
				if (request.url === "/api/renderer-log") {
					response.statusCode = 204;
					response.end();
					return;
				}
				if (!request.url?.startsWith("/api/rpc/")) {
					next();
					return;
				}

				const method = request.url.slice("/api/rpc/".length);
				const chunks: Uint8Array[] = [];
				for await (const chunk of request) chunks.push(chunk);
				const body = chunks.length
					? JSON.parse(Buffer.concat(chunks).toString("utf8")) as { args?: unknown[] }
					: {};
				const args = body.args ?? [];

				let result: unknown;
				switch (method) {
					case "getStartupStatus":
					case "retryStartup":
						result = { phase: "ready", message: "Radiora is ready." };
						break;
					case "listOutline":
						result = snapshot;
						break;
					case "listRevisions":
						result = mockRevisions(String(args[0]));
						break;
					case "listRecoverySnapshots":
						result = [];
						break;
					case "listGlobalLineage":
						result = {
							snapshot,
							promotedBranches: [{
								branch: {
									id: "mock-promoted",
									workId: "mock-7",
									name: "公開向け",
									headRevisionId: "mock-7-version-2",
									createdAt: "2025-03-10T09:00:00.000Z",
									promotedAt: "2025-03-15T09:00:00.000Z",
								},
								headRevision: mockRevisions("mock-7")[1],
							}],
						};
						break;
					case "listWorkLineage": {
						const workId = String(args[0]);
						result = {
							work: {
								id: workId,
								createdAt: "2025-03-10T09:00:00.000Z",
								updatedAt: "2025-03-14T15:30:00.000Z",
							},
							branches: [{
								id: `${workId}-main`,
								workId,
								name: "main",
								headRevisionId: `${workId}-version-2`,
								createdAt: "2025-03-10T09:00:00.000Z",
							}, ...(rewriteBranches.get(workId) ?? [])],
							revisions: mockRevisions(workId),
						};
						break;
					}
					case "rewriteAsNewBranch": {
						if (args[2] !== "confirmed") {
							throw new Error("Explicit confirmation is required");
						}
						const sourceBranchId = String(args[0]);
						const name = String(args[1] ?? "").trim();
						if (!name) throw new Error("Branch name must not be empty");
						const source = snapshot.items.find((item) =>
							item.revisionSelector.mode === "branch" &&
							item.revisionSelector.branchId === sourceBranchId
						);
						if (!source) throw new Error(`Branch not found: ${sourceBranchId}`);
						const baseRevision = mockRevisions(source.workId).at(-1)!;
						const branch = {
							id: `mock-branch-${crypto.randomUUID()}`,
							workId: source.workId,
							name,
							headRevisionId: baseRevision.id,
							createdAt: new Date().toISOString(),
						};
						rewriteBranches.set(source.workId, [
							...(rewriteBranches.get(source.workId) ?? []),
							branch,
						]);
						result = {
							status: "created",
							branch,
							workingCopy: {
								branchId: branch.id,
								workId: branch.workId,
								text: source.text,
								updatedAt: branch.createdAt,
							},
							baseRevision,
							checkpointCreated: false,
						};
						break;
					}
					case "setCollapsed": {
						const item = snapshot.items.find((candidate) => candidate.id === String(args[0]));
						if (item) item.collapsed = Boolean(args[1]);
						result = null;
						break;
					}
					case "createOccurrence": {
						const input = args[0] as {
							workId: string;
							parentId: string | null;
							contextualHeading?: string;
						};
						const source = snapshot.items.find((item) => item.workId === input.workId)!;
						const created = {
							...source,
							id: `mock-${crypto.randomUUID()}`,
							parentId: input.parentId,
							contextualHeading: input.contextualHeading,
						};
						snapshot.items.push(created);
						result = created;
						break;
					}
					case "setContextualHeading": {
						const item = snapshot.items.find((candidate) => candidate.id === String(args[0]));
						if (item) item.contextualHeading = String(args[1] ?? "") || undefined;
						result = null;
						break;
					}
					case "deleteItem": {
						const id = String(args[0]);
						snapshot.items = snapshot.items.filter((item) => item.id !== id);
						result = null;
						break;
					}
					case "listTrash":
						result = [];
						break;
					case "suggestItems": {
						const prefix = String(args[0] ?? "").normalize("NFKC").toLocaleLowerCase();
						result = snapshot.items
							.filter((item) =>
								item.text.split(/\r?\n/)[0].normalize("NFKC").toLocaleLowerCase().startsWith(prefix)
							)
							.slice(0, Number(args[1] ?? 8))
							.map((item) => ({ item, title: item.text.split(/\r?\n/)[0], ancestorIds: [] }));
						break;
					}
					case "searchItems": {
						const input = args[0] as { query?: string } | string;
						const query = (typeof input === "string" ? input : input?.query ?? "")
							.toLocaleLowerCase();
						result = snapshot.items
							.filter((item) => item.text.toLocaleLowerCase().includes(query))
							.map((item) => ({
								item,
								ancestorIds: [],
								score: 0.75,
								reasons: [{ kind: "body", label: "本文一致", score: 1 }],
							}));
						break;
					}
					case "listSearchAliases":
					case "listSavedRuleQueries":
						result = [];
						break;
					case "listEmergenceSuggestions": {
						const contextId = String(args[0] ?? snapshot.items[0]?.id ?? "mock-1");
						const context = snapshot.items.find((item) => item.id === contextId) ??
							snapshot.items[0];
						const target = snapshot.items.find((item) => item.id !== contextId) ??
							snapshot.items[1] ?? context;
						const contextTitle = context.text.split(/\r?\n/)[0];
						const targetTitle = target.text.split(/\r?\n/)[0];
						result = [{
							id: `bridge:${context.id}:${target.id}`,
							kind: "cross-branch-resonance",
							title: "離れた話題をつなぐ接点",
							explanation:
								`「${contextTitle}」と「${targetTitle}」は、共通する語と近接リンクから一緒に眺める価値があります。`,
							score: 0.82,
							contextItemId: context.id,
							targetItemId: target.id,
							proposedLinkType: "LIKE",
							evidence: [
								{
									fromId: context.id,
									toId: target.id,
									relation: "LEXICAL",
								},
							],
						}];
						break;
					}
					case "runRuleQuery":
						result = { columns: ["From", "To"], rows: [["mock-7", "mock-10"]], elapsedMs: 0.4 };
						break;
					default:
						result = null;
				}

				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify({ result }));
			});
		},
	};
}
