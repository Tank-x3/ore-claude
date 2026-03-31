import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { scanAll } from "./scanner.js";
import { calculateScore } from "./scorer.js";
import type { LeaderboardPayload } from "./types.js";

const server = new Server(
  { name: "ore-claude", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ── ツール一覧 ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "score_my_claude",
      description:
        "ローカルのClaude Code設定をスキャンしてスコアリングする。設定の中身は一切外部に送信されない。構造メタデータのみを集計し、80点満点の客観スコアを算出する。残り20点はClaudeが評論として付与する。結果を受け取ったら、Claudeは評論・称号を生成してユーザーに提示すること。",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "build_leaderboard_payload",
      description:
        "score_my_claudeの結果にClaude評論スコア(設計思想0-10pt, 独創性0-10pt)と称号・評論テキストを付与し、リーダーボード送信用ペイロードを生成する。設定の中身は含まれない。",
      inputSchema: {
        type: "object" as const,
        properties: {
          scan_score_json: {
            type: "string",
            description: "score_my_claudeの戻り値JSON",
          },
          design_philosophy_score: {
            type: "number",
            description: "設計思想の一貫性スコア (0-10)",
          },
          originality_score: {
            type: "number",
            description: "独創性スコア (0-10)",
          },
          title: {
            type: "string",
            description: "Claudeが付与する称号",
          },
          review: {
            type: "string",
            description: "Claudeが書いた評論テキスト",
          },
        },
        required: [
          "scan_score_json",
          "design_philosophy_score",
          "originality_score",
          "title",
          "review",
        ],
      },
    },
    {
      name: "submit_to_leaderboard",
      description:
        "build_leaderboard_payloadで生成したペイロードをリーダーボードに送信する。X認証済みセッションが必要。",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload_json: {
            type: "string",
            description: "build_leaderboard_payloadの出力JSON",
          },
          link_token: {
            type: "string",
            description: "X認証後にブラウザで表示されるリンクトークン",
          },
          api_base: {
            type: "string",
            description: "バックエンドAPIのベースURL。デフォルト: https://ore-claude.seeda.fun",
          },
        },
        required: ["payload_json", "link_token"],
      },
    },
  ],
}));

// ── ツール実行 ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  if (name === "score_my_claude") {
    try {
      const scan = await scanAll();
      const score = calculateScore(scan);

      const summary = [
        `## スキャン完了`,
        ``,
        `**客観スコア: ${score.totalScore} / 80** (Claude評論 20pt は別途付与)`,
        ``,
        `### カテゴリ別`,
        ...score.categories.map(
          (c) => `- **${c.name}**: ${c.score}/${c.maxScore} — ${c.detail}`
        ),
        ``,
        `### 指示`,
        `上記の結果を踏まえて、以下を生成してください:`,
        `1. **称号**: この設定の特徴を表す二つ名（自由に創作）`,
        `2. **評論**: 3-5文で、良い点と改善点を含む。毒舌OK、ユーモアあり。設定の中身には触れず、構造と活用度から推察して書く。`,
        `3. **設計思想の一貫性スコア** (0-10pt): カテゴリ間のバランスや哲学の一貫性`,
        `4. **独創性スコア** (0-10pt): 構成の独自性、珍しい組み合わせ`,
        ``,
        `評論後、build_leaderboard_payload ツールでペイロードを生成してください。`,
      ].join("\n");

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: `\n\n<score_data>\n${JSON.stringify(score, null, 2)}\n</score_data>`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `スキャンエラー: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === "build_leaderboard_payload") {
    const args = request.params.arguments as {
      scan_score_json: string;
      design_philosophy_score: number;
      originality_score: number;
      title: string;
      review: string;
    };

    try {
      const scoreResult = JSON.parse(args.scan_score_json);
      const philosophyScore = Math.min(10, Math.max(0, Math.round(args.design_philosophy_score)));
      const originalityScore = Math.min(10, Math.max(0, Math.round(args.originality_score)));

      const totalWithClaude =
        scoreResult.totalScore + philosophyScore + originalityScore;

      // API送信用ペイロード（snake_case）
      const payload = {
        total_score: totalWithClaude,
        categories: scoreResult.categories.map(
          (c: { name: string; score: number; maxScore: number; detail: string }) => {
            const base = { name: c.name, score: c.score, max_score: c.maxScore };
            if (c.name === "設計思想の一貫性") return { ...base, score: philosophyScore };
            if (c.name === "独創性") return { ...base, score: originalityScore };
            return base;
          }
        ),
        project_count: scoreResult.scanData.usage.projectCount,
        plugin_count: scoreResult.scanData.plugins.installedCount,
        skill_count: scoreResult.scanData.skills.count,
        hook_event_count: scoreResult.scanData.hooks.configuredEvents.length,
        memory_file_count: scoreResult.scanData.memory.totalFiles,
        active_days: scoreResult.scanData.usage.activeDaysLast30,
        claude_commits: scoreResult.scanData.usage.claudeCommitCount,
        title: args.title,
        review: args.review,
      };

      const shareText = [
        `${args.title} — ${totalWithClaude}/100`,
        ``,
        args.review,
        ``,
        `#おれのClaude #ClaudeCode`,
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `## リーダーボード送信準備完了`,
              ``,
              `**${args.title}** — **${totalWithClaude}/100点**`,
              ``,
              `### 評論`,
              args.review,
              ``,
              `### Xシェア用テキスト`,
              "```",
              shareText,
              "```",
              ``,
              `### ペイロード（設定の中身は含まれていません）`,
              "```json",
              JSON.stringify(payload, null, 2),
              "```",
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `ペイロード生成エラー: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === "submit_to_leaderboard") {
    const args = request.params.arguments as {
      payload_json: string;
      link_token: string;
      api_base?: string;
    };

    const apiBase = args.api_base || "https://ore-claude.seeda.fun";

    try {
      const payload = JSON.parse(args.payload_json);

      const res = await fetch(`${apiBase}/api/scores`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${args.link_token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          content: [
            {
              type: "text",
              text: `送信失敗 (${res.status}): ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `リーダーボードに登録しました！ ${apiBase} でランキングを確認できます。`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `送信エラー: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `不明なツール: ${name}` }],
    isError: true,
  };
});

// ── 起動 ──

const transport = new StdioServerTransport();
await server.connect(transport);
