import type { Plugin } from "vite";
import type {
	OutlineItem,
	OutlineLink,
	OutlineSnapshot,
	Revision,
	ScopedTagSet,
} from "../src/domain/models.ts";

type MockNode = {
	id: string;
	title: string;
	body: string;
	parentId: string | null;
};

/**
 * One small, coherent story is shared by Outline and Tree. The pre-order
 * arrangement makes the Outline readable while the FROM links below give the
 * Tree a calm three-generation shape with a few deliberate cross-connections.
 */
const MOCK_NODES: readonly MockNode[] = [
	{
		id: "mock-1",
		title: "街角の小さな灯りを育てる",
		body: "観察から始めて、誰かがまた訪れたくなる小さな場をつくる。",
		parentId: null,
	},
	{
		id: "mock-2",
		title: "01 観察｜街の余白を見つける",
		body: "急がずに歩き、足を止める理由の手がかりを集める。",
		parentId: "mock-1",
	},
	{
		id: "mock-7",
		title: "朝の光と人の流れ",
		body: "午前の光が差す角度と、立ち止まる人の動線を記録する。",
		parentId: "mock-2",
	},
	{
		id: "mock-8",
		title: "立ち止まる場所の地図",
		body: "ベンチ、窓辺、木陰。小さな居場所を一枚の地図に重ねる。",
		parentId: "mock-2",
	},
	{
		id: "mock-9",
		title: "観察メモから問いを選ぶ",
		body: "見えたことを並べ直し、次に確かめたい問いをひとつ残す。",
		parentId: "mock-2",
	},
	{
		id: "mock-3",
		title: "02 仮説｜問いを場に置き換える",
		body: "問いを読むだけの言葉から、触れられる小さな仕掛けへ変える。",
		parentId: "mock-1",
	},
	{
		id: "mock-10",
		title: "問いを一枚のカードにする",
		body: "答えを急がず、来訪者が自分の経験を重ねられる余白を残す。",
		parentId: "mock-3",
	},
	{
		id: "mock-11",
		title: "三つの来訪者像を描く",
		body: "通りすがり、近所の人、何度も戻る人。それぞれの目線を想像する。",
		parentId: "mock-3",
	},
	{
		id: "mock-12",
		title: "仮説を一文にしぼる",
		body: "『余白があれば、会話は自然に始まる』を最初の仮説にする。",
		parentId: "mock-3",
	},
	{
		id: "mock-4",
		title: "03 試作｜小さく灯して確かめる",
		body: "完成を目指さず、週末の短い実験として場をひらく。",
		parentId: "mock-1",
	},
	{
		id: "mock-13",
		title: "週末だけの小さな展示",
		body: "拾った言葉と写真を、夕方の二時間だけ見える形にする。",
		parentId: "mock-4",
	},
	{
		id: "mock-14",
		title: "手触りを残す案内板",
		body: "説明しすぎず、触れた人の記憶が次の一歩になる案内を置く。",
		parentId: "mock-4",
	},
	{
		id: "mock-15",
		title: "会話が生まれる導線",
		body: "ひとりで見て、誰かと話し、またひとりで考えられる順路をつくる。",
		parentId: "mock-4",
	},
	{
		id: "mock-5",
		title: "04 反応｜声を集めて編み直す",
		body: "正しさを測るのではなく、場に残った声の違いを手がかりにする。",
		parentId: "mock-1",
	},
	{
		id: "mock-16",
		title: "最初の来訪者の声",
		body: "『ここに来ると考えがほどける』という短い感想を記録する。",
		parentId: "mock-5",
	},
	{
		id: "mock-17",
		title: "賛成と違和感を分ける",
		body: "うれしい反応と、まだ届いていない部分を同じ箱に入れない。",
		parentId: "mock-5",
	},
	{
		id: "mock-18",
		title: "仮説をひとつ手放す",
		body: "場を説明しすぎる案をやめ、偶然の会話が起きる余地を守る。",
		parentId: "mock-5",
	},
	{
		id: "mock-6",
		title: "05 公開｜続く仕組みにする",
		body: "一度きりの展示を、季節ごとに育つ静かな習慣へつなげる。",
		parentId: "mock-1",
	},
	{
		id: "mock-19",
		title: "季節ごとのテーマを置く",
		body: "春は芽吹き、夏は影。季節の変化を次の問いの入口にする。",
		parentId: "mock-6",
	},
	{
		id: "mock-20",
		title: "公開ページの構成を整える",
		body: "活動の背景、今週の展示、次に参加する方法を一画面にまとめる。",
		parentId: "mock-6",
	},
	{
		id: "mock-21",
		title: "運営を続ける小さなルール",
		body: "記録を残す人と場を開ける人を分け、無理なく続けられる形にする。",
		parentId: "mock-6",
	},
	{
		id: "mock-22",
		title: "次の観察へ戻る",
		body: "公開した場をもう一度歩き、まだ見えていない余白を探しに行く。",
		parentId: "mock-6",
	},
];

const MOCK_LINKS: readonly [string, string, OutlineLink["type"]][] = [
	["mock-2", "mock-1", "FROM"],
	["mock-3", "mock-1", "FROM"],
	["mock-4", "mock-1", "FROM"],
	["mock-5", "mock-1", "FROM"],
	["mock-6", "mock-1", "FROM"],
	["mock-7", "mock-2", "FROM"],
	["mock-8", "mock-2", "FROM"],
	["mock-9", "mock-2", "FROM"],
	["mock-10", "mock-3", "FROM"],
	["mock-11", "mock-3", "FROM"],
	["mock-12", "mock-3", "FROM"],
	["mock-13", "mock-4", "FROM"],
	["mock-14", "mock-4", "FROM"],
	["mock-15", "mock-4", "FROM"],
	["mock-16", "mock-5", "FROM"],
	["mock-17", "mock-5", "FROM"],
	["mock-18", "mock-5", "FROM"],
	["mock-19", "mock-6", "FROM"],
	["mock-20", "mock-6", "FROM"],
	["mock-21", "mock-6", "FROM"],
	["mock-22", "mock-6", "FROM"],
	["mock-7", "mock-10", "SUPPORT"],
	["mock-8", "mock-13", "RELATED"],
	["mock-9", "mock-16", "CITE"],
	["mock-11", "mock-12", "SUPPORT"],
	["mock-15", "mock-18", "FIX"],
	["mock-16", "mock-19", "LIKE"],
	["mock-21", "mock-20", "SUPPORT"],
	["mock-22", "mock-7", "RELATED"],
];

const MOCK_START = Date.UTC(2025, 8, 1);

function mockSnapshot(): OutlineSnapshot {
	const items: OutlineItem[] = MOCK_NODES.map((node, index) => {
		const createdAt = new Date(MOCK_START + index * 9 * 86_400_000).toISOString();
		return {
			id: node.id,
			workId: node.id,
			text: `${node.title}\n${node.body}`,
			parentId: node.parentId,
			orderKey: (index + 1) * 1024,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: node.id },
			createdAt,
			updatedAt: createdAt,
		};
	});
	const links: OutlineLink[] = MOCK_LINKS.map(([fromId, toId, type], index) => ({
		id: `mock-link-${index + 1}`,
		fromId,
		toId,
		from: { scope: "work" as const, workId: fromId },
		to: { scope: "work" as const, workId: toId },
		type: type as OutlineLink["type"],
		status: "asserted" as const,
		origin: "human" as const,
		createdAt: new Date(MOCK_START + (index + 1) * 2 * 86_400_000).toISOString(),
	}));
	return {
		items,
		links,
		knots: [],
		stashItemIds: [],
	};
}

function mockRevisions(workId: string): Revision[] {
	const title = MOCK_NODES.find((node) => node.id === workId)?.title ?? "観察から問いが生まれる";
	const body = MOCK_NODES.find((node) => node.id === workId)?.body ??
		"まだ名前のない輪郭を記録する。";
	return [
		{
			id: `${workId}-version-1`,
			workId,
			text: `${title}\n${body}`,
			parentRevisionIds: [],
			kind: "edition",
			createdAt: "2025-09-01T09:00:00.000Z",
			message: "最初の版",
		},
		{
			id: `${workId}-version-2`,
			workId,
			text: `${title}\n${body}\n\n次の観察につながる余白を残す。`,
			parentRevisionIds: [`${workId}-version-1`],
			kind: "edition",
			createdAt: "2025-09-18T15:30:00.000Z",
			message: "加筆した版",
		},
	];
}

function mockTagScopes(snapshot: OutlineSnapshot): ScopedTagSet[] {
	const tagSets = [
		["観察", "余白"],
		["仮説", "問い"],
		["試作", "手触り"],
		["反応", "対話"],
		["公開", "習慣"],
		["記録", "次の問い"],
	];
	return snapshot.items.map((item, index) => ({
		scope: {
			kind: "working-copy",
			workId: item.workId,
			branchId: item.revisionSelector.mode === "branch"
				? item.revisionSelector.branchId
				: undefined,
		},
		tags: tagSets[index % tagSets.length],
	}));
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
	const tagScopes = mockTagScopes(snapshot);
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
									workId: "mock-1",
									name: "展示の公開版",
									headRevisionId: "mock-1-version-2",
									createdAt: "2025-09-01T09:00:00.000Z",
									promotedAt: "2025-10-18T09:00:00.000Z",
								},
								headRevision: mockRevisions("mock-1")[1],
							}],
						};
						break;
					case "listWorkLineage": {
						const workId = String(args[0]);
						result = {
							work: {
								id: workId,
								createdAt: "2025-09-01T09:00:00.000Z",
								updatedAt: "2025-09-18T15:30:00.000Z",
							},
							branches: [{
								id: `${workId}-main`,
								workId,
								name: "main",
								headRevisionId: `${workId}-version-2`,
								createdAt: "2025-09-01T09:00:00.000Z",
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
					case "listScopedTags":
						result = tagScopes;
						break;
					case "listTagAliases":
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
