/** スキャン結果: 設定の構造メタデータのみ（中身は含まない） */
export interface ScanResult {
  claudeMd: {
    globalExists: boolean;
    globalLineCount: number;
    globalSectionCount: number;
    projectConfigs: number; // CLAUDE.md があるプロジェクト数
  };

  hooks: {
    configuredEvents: string[];
    totalHookCount: number;
    scriptFileCount: number;
  };

  plugins: {
    installedCount: number;
    enabledCount: number;
    names: string[];
  };

  memory: {
    projectsWithMemory: number;
    totalFiles: number;
    typeDistribution: Record<string, number>;
    indexLineCount: number;
  };

  skills: {
    count: number;
    names: string[];
  };

  settings: {
    permissionRuleCount: number;
    hasLanguageSetting: boolean;
    customEnvVarCount: number;
  };

  usage: {
    projectCount: number;
    estimatedSessions: number;
    activeDaysLast30: number;
    teamCount: number;
    totalTasks: number;
    claudeCommitCount: number;
    channelIntegrations: string[];
  };
}

/** カテゴリ別スコア */
export interface CategoryScore {
  name: string;
  score: number;
  maxScore: number;
  detail: string;
}

/** スコアリング結果 */
export interface ScoreResult {
  totalScore: number;
  maxScore: number;
  categories: CategoryScore[];
  scanData: ScanResult;
}

/** リーダーボード送信用ペイロード（設定の中身は一切含まない） */
export interface LeaderboardPayload {
  totalScore: number;
  maxScore: number;
  categories: CategoryScore[];
  // usage stats (anonymized)
  projectCount: number;
  pluginCount: number;
  skillCount: number;
  hookEventCount: number;
  memoryFileCount: number;
  activeDays: number;
  claudeCommits: number;
}
