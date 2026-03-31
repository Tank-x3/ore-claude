import type { ScanResult, CategoryScore, ScoreResult } from "./types.js";

function clamp(value: number, max: number): number {
  return Math.min(Math.max(0, value), max);
}

// ── CLAUDE.md 成熟度 (12pt) ──

function scoreClaudeMd(data: ScanResult["claudeMd"]): CategoryScore {
  let score = 0;

  // グローバル CLAUDE.md の存在と充実度
  if (data.globalExists) {
    score += 2;
    // 行数: 10行で+1, 30行で+2, 80行で+3
    if (data.globalLineCount >= 80) score += 3;
    else if (data.globalLineCount >= 30) score += 2;
    else if (data.globalLineCount >= 10) score += 1;

    // セクション構造
    if (data.globalSectionCount >= 5) score += 2;
    else if (data.globalSectionCount >= 2) score += 1;
  }

  // プロジェクト別設定
  if (data.projectConfigs >= 5) score += 5;
  else if (data.projectConfigs >= 3) score += 3;
  else if (data.projectConfigs >= 1) score += 2;

  return {
    name: "CLAUDE.md",
    score: clamp(score, 12),
    maxScore: 12,
    detail: `global: ${data.globalExists ? `${data.globalLineCount}行/${data.globalSectionCount}セクション` : "なし"}, プロジェクト別: ${data.projectConfigs}件`,
  };
}

// ── Hooks 活用 (10pt) ──

function scoreHooks(data: ScanResult["hooks"]): CategoryScore {
  let score = 0;

  // イベント種別の幅
  const eventCount = data.configuredEvents.length;
  if (eventCount >= 4) score += 4;
  else if (eventCount >= 2) score += 3;
  else if (eventCount >= 1) score += 2;

  // hook 総数
  if (data.totalHookCount >= 5) score += 3;
  else if (data.totalHookCount >= 3) score += 2;
  else if (data.totalHookCount >= 1) score += 1;

  // スクリプトファイル（再利用可能なhook）
  if (data.scriptFileCount >= 3) score += 3;
  else if (data.scriptFileCount >= 1) score += 2;

  return {
    name: "Hooks",
    score: clamp(score, 10),
    maxScore: 10,
    detail: `${eventCount}イベント, ${data.totalHookCount}フック, ${data.scriptFileCount}スクリプト`,
  };
}

// ── MCP/Plugin 連携 (8pt) ──

function scorePlugins(data: ScanResult["plugins"]): CategoryScore {
  let score = 0;

  if (data.installedCount >= 5) score += 4;
  else if (data.installedCount >= 3) score += 3;
  else if (data.installedCount >= 1) score += 2;

  // 有効化率
  if (data.enabledCount > 0) {
    const ratio = data.enabledCount / Math.max(data.installedCount, 1);
    if (ratio >= 0.8) score += 2;
    else if (ratio >= 0.5) score += 1;
  }

  // プラグインの多様性
  if (data.names.length >= 3) score += 2;
  else if (data.names.length >= 1) score += 1;

  return {
    name: "Plugins",
    score: clamp(score, 8),
    maxScore: 8,
    detail: `${data.installedCount}インストール, ${data.enabledCount}有効, [${data.names.join(", ")}]`,
  };
}

// ── Memory 運用 (8pt) ──

function scoreMemory(data: ScanResult["memory"]): CategoryScore {
  let score = 0;

  // メモリを使っているプロジェクト数
  if (data.projectsWithMemory >= 5) score += 3;
  else if (data.projectsWithMemory >= 2) score += 2;
  else if (data.projectsWithMemory >= 1) score += 1;

  // メモリファイル総数
  if (data.totalFiles >= 15) score += 2;
  else if (data.totalFiles >= 5) score += 1;

  // 型の多様性（user, feedback, project, reference）
  const types = Object.keys(data.typeDistribution).length;
  if (types >= 4) score += 2;
  else if (types >= 2) score += 1;

  // インデックスの充実度
  if (data.indexLineCount >= 30) score += 1;

  return {
    name: "Memory",
    score: clamp(score, 8),
    maxScore: 8,
    detail: `${data.projectsWithMemory}プロジェクト, ${data.totalFiles}ファイル, 型: ${JSON.stringify(data.typeDistribution)}`,
  };
}

// ── Skills (7pt) ──

function scoreSkills(data: ScanResult["skills"]): CategoryScore {
  let score = 0;

  if (data.count >= 8) score += 7;
  else if (data.count >= 5) score += 5;
  else if (data.count >= 3) score += 4;
  else if (data.count >= 1) score += 2;

  return {
    name: "Skills",
    score: clamp(score, 7),
    maxScore: 7,
    detail: `${data.count}スキル [${data.names.join(", ")}]`,
  };
}

// ── Settings 設計 (5pt) ──

function scoreSettings(data: ScanResult["settings"]): CategoryScore {
  let score = 0;

  // パーミッション粒度
  if (data.permissionRuleCount >= 10) score += 2;
  else if (data.permissionRuleCount >= 3) score += 1;

  // 言語設定
  if (data.hasLanguageSetting) score += 1;

  // カスタム環境変数
  if (data.customEnvVarCount >= 5) score += 2;
  else if (data.customEnvVarCount >= 1) score += 1;

  return {
    name: "Settings",
    score: clamp(score, 5),
    maxScore: 5,
    detail: `${data.permissionRuleCount}パーミッション, ${data.customEnvVarCount}環境変数, 言語: ${data.hasLanguageSetting ? "設定済" : "デフォルト"}`,
  };
}

// ── 活用スコア: 継続利用 (10pt) ──

function scoreActiveDays(data: ScanResult["usage"]): CategoryScore {
  let score = 0;
  const days = data.activeDaysLast30;

  if (days >= 25) score += 10;
  else if (days >= 20) score += 8;
  else if (days >= 15) score += 6;
  else if (days >= 10) score += 4;
  else if (days >= 5) score += 2;
  else if (days >= 1) score += 1;

  return {
    name: "継続利用",
    score: clamp(score, 10),
    maxScore: 10,
    detail: `直近30日中 ${days}日アクティブ, ${data.estimatedSessions}セッション`,
  };
}

// ── 活用スコア: 機能活用幅 (8pt) ──

function scoreFeatureBreadth(data: ScanResult): CategoryScore {
  let score = 0;

  // 使っている機能の幅をカウント
  const features: string[] = [];
  if (data.hooks.totalHookCount > 0) features.push("hooks");
  if (data.plugins.enabledCount > 0) features.push("plugins");
  if (data.memory.totalFiles > 0) features.push("memory");
  if (data.skills.count > 0) features.push("skills");
  if (data.usage.teamCount > 0) features.push("teams");
  if (data.usage.channelIntegrations.length > 0) features.push("channels");
  if (data.claudeMd.globalExists) features.push("claude.md");
  if (data.settings.customEnvVarCount > 0) features.push("custom-env");

  if (features.length >= 7) score += 8;
  else if (features.length >= 5) score += 6;
  else if (features.length >= 3) score += 4;
  else if (features.length >= 1) score += 2;

  return {
    name: "機能活用幅",
    score: clamp(score, 8),
    maxScore: 8,
    detail: `${features.length}機能 [${features.join(", ")}]`,
  };
}

// ── 活用スコア: Claude コミット (7pt) ──

function scoreClaudeCommits(data: ScanResult["usage"]): CategoryScore {
  let score = 0;
  const commits = data.claudeCommitCount;

  if (commits >= 100) score += 7;
  else if (commits >= 50) score += 5;
  else if (commits >= 20) score += 4;
  else if (commits >= 10) score += 3;
  else if (commits >= 5) score += 2;
  else if (commits >= 1) score += 1;

  return {
    name: "Claudeコミット",
    score: clamp(score, 7),
    maxScore: 7,
    detail: `直近30日: ${commits}コミット`,
  };
}

// ── 活用スコア: チーム/タスク活用 (5pt) ──

function scoreTeamsAndTasks(data: ScanResult["usage"]): CategoryScore {
  let score = 0;

  if (data.teamCount >= 3) score += 3;
  else if (data.teamCount >= 1) score += 2;

  if (data.totalTasks >= 10) score += 2;
  else if (data.totalTasks >= 3) score += 1;

  return {
    name: "チーム/タスク",
    score: clamp(score, 5),
    maxScore: 5,
    detail: `${data.teamCount}チーム, ${data.totalTasks}タスク`,
  };
}

// ── メインスコアリング ──

export function calculateScore(scan: ScanResult): ScoreResult {
  const categories: CategoryScore[] = [
    // 構造スコア (50pt)
    scoreClaudeMd(scan.claudeMd),
    scoreHooks(scan.hooks),
    scorePlugins(scan.plugins),
    scoreMemory(scan.memory),
    scoreSkills(scan.skills),
    scoreSettings(scan.settings),
    // 活用スコア (30pt)
    scoreActiveDays(scan.usage),
    scoreFeatureBreadth(scan),
    scoreClaudeCommits(scan.usage),
    scoreTeamsAndTasks(scan.usage),
  ];

  // Claude評論スコア (20pt) はClaude自身が判定するのでここでは0
  categories.push({
    name: "設計思想の一貫性",
    score: 0,
    maxScore: 10,
    detail: "Claudeが評価",
  });
  categories.push({
    name: "独創性",
    score: 0,
    maxScore: 10,
    detail: "Claudeが評価",
  });

  const totalScore = categories.reduce((sum, c) => sum + c.score, 0);
  const maxScore = categories.reduce((sum, c) => sum + c.maxScore, 0);

  return { totalScore, maxScore, categories, scanData: scan };
}
