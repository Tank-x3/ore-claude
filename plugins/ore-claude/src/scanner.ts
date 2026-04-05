import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";
import type { ScanResult } from "./types.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const IS_WINDOWS = platform() === "win32";

/**
 * ~/.claude/projects/ のディレクトリ名から実際のファイルシステムパスを復元する。
 * Windows: "-C-u_temp-project" → "C:/u_temp/project"
 * Unix:    "-home-yuto-foo"    → "/home/yuto/foo"
 */
function restoreProjectPath(dirName: string): string {
  if (IS_WINDOWS) {
    // Windows: 先頭の "-" を除去し、最初の区切りをドライブレターとして扱う
    // "-C-u_temp-project" → "C-u_temp-project" → "C:/u_temp/project"
    const stripped = dirName.replace(/^-/, "");
    const drive = stripped.charAt(0);
    const rest = stripped.slice(1).replace(/-/g, "/");
    return `${drive}:${rest}`;
  }
  // Unix: "-home-yuto-foo" → "/home/yuto/foo"
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

/**
 * ローカルタイムゾーンの日付文字列を返す (YYYY-MM-DD)
 */
function toLocalDateString(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function countLines(path: string): Promise<number> {
  try {
    const content = await readFile(path, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

async function countSections(path: string): Promise<number> {
  try {
    const content = await readFile(path, "utf-8");
    return content.split("\n").filter((l) => /^#{1,3}\s/.test(l)).length;
  } catch {
    return 0;
  }
}

async function safeReadJson<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFiles(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

// ── CLAUDE.md スキャン ──

async function scanClaudeMd(): Promise<ScanResult["claudeMd"]> {
  // グローバル CLAUDE.md: ~/CLAUDE.md と ~/.claude/CLAUDE.md の両方をチェック
  const globalPathHome = join(homedir(), "CLAUDE.md");
  const globalPathDotClaude = join(CLAUDE_DIR, "CLAUDE.md");
  const homeExists = await exists(globalPathHome);
  const dotClaudeExists = await exists(globalPathDotClaude);
  const globalExists = homeExists || dotClaudeExists;
  const globalPath = homeExists ? globalPathHome : globalPathDotClaude;
  const globalLineCount = globalExists ? await countLines(globalPath) : 0;
  const globalSectionCount = globalExists ? await countSections(globalPath) : 0;

  // プロジェクト別 CLAUDE.md をカウント
  // ~/.claude/projects/ のディレクトリ名からパスを復元して実ディレクトリのCLAUDE.mdを探す
  const projectsDir = join(CLAUDE_DIR, "projects");
  const projects = await listDirs(projectsDir);
  let projectConfigs = 0;

  for (const proj of projects) {
    // クロスプラットフォーム対応のパス復元
    const realPath = restoreProjectPath(proj);
    if (await exists(join(realPath, "CLAUDE.md"))) {
      projectConfigs++;
    }
    // .claude/projects/内にもCLAUDE.mdがある場合
    if (await exists(join(projectsDir, proj, "CLAUDE.md"))) {
      projectConfigs++;
    }
  }

  // 追加: ~/以下のCLAUDE.mdも拾う（上記で漏れるサブディレクトリ対応）
  // Node.js で再帰的に検索し、find コマンドに依存しない
  try {
    const found = await findClaudeMdFiles(homedir(), 3);
    if (found > projectConfigs) {
      projectConfigs = found;
    }
  } catch {
    // skip
  }

  return { globalExists, globalLineCount, globalSectionCount, projectConfigs };
}

/**
 * 指定ディレクトリから maxDepth 階層まで CLAUDE.md を再帰検索する（Node.js実装）。
 * .claude/, node_modules/ は除外。
 */
async function findClaudeMdFiles(
  dir: string,
  maxDepth: number,
  currentDepth = 0
): Promise<number> {
  if (currentDepth > maxDepth) return 0;
  let count = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name === "CLAUDE.md") {
        count++;
      } else if (entry.isDirectory()) {
        if (entry.name === ".claude" || entry.name === "node_modules") continue;
        count += await findClaudeMdFiles(
          join(dir, entry.name),
          maxDepth,
          currentDepth + 1
        );
      }
    }
  } catch {
    // 権限エラー等はスキップ
  }
  return count;
}

// ── Hooks スキャン ──

async function scanHooks(): Promise<ScanResult["hooks"]> {
  const settings = await safeReadJson<Record<string, unknown>>(
    join(CLAUDE_DIR, "settings.json")
  );

  const configuredEvents: string[] = [];
  let totalHookCount = 0;

  if (settings?.hooks && typeof settings.hooks === "object") {
    for (const [event, configs] of Object.entries(
      settings.hooks as Record<string, unknown[]>
    )) {
      configuredEvents.push(event);
      if (Array.isArray(configs)) {
        for (const cfg of configs) {
          if (
            cfg &&
            typeof cfg === "object" &&
            "hooks" in cfg &&
            Array.isArray((cfg as { hooks: unknown[] }).hooks)
          ) {
            totalHookCount += (cfg as { hooks: unknown[] }).hooks.length;
          }
        }
      }
    }
  }

  const hooksDir = join(CLAUDE_DIR, "hooks");
  const scriptFiles = await listFiles(hooksDir);

  return {
    configuredEvents,
    totalHookCount,
    scriptFileCount: scriptFiles.length,
  };
}

// ── Plugins スキャン ──

async function scanPlugins(): Promise<ScanResult["plugins"]> {
  const manifest = await safeReadJson<{
    plugins?: Record<string, unknown[]>;
  }>(join(CLAUDE_DIR, "plugins", "installed_plugins.json"));

  const settings = await safeReadJson<{
    enabledPlugins?: Record<string, boolean>;
  }>(join(CLAUDE_DIR, "settings.json"));

  const names: string[] = [];
  let installedCount = 0;

  if (manifest?.plugins) {
    for (const key of Object.keys(manifest.plugins)) {
      const name = key.split("@")[0];
      names.push(name);
      installedCount++;
    }
  }

  let enabledCount = 0;
  if (settings?.enabledPlugins) {
    enabledCount = Object.values(settings.enabledPlugins).filter(Boolean).length;
  }

  return { installedCount, enabledCount, names };
}

// ── Memory スキャン ──

async function scanMemory(): Promise<ScanResult["memory"]> {
  const projectsDir = join(CLAUDE_DIR, "projects");
  const projects = await listDirs(projectsDir);

  let projectsWithMemory = 0;
  let totalFiles = 0;
  let indexLineCount = 0;
  const typeDistribution: Record<string, number> = {};

  for (const proj of projects) {
    const memDir = join(projectsDir, proj, "memory");
    if (!(await exists(memDir))) continue;
    projectsWithMemory++;

    const files = await listFiles(memDir);
    for (const file of files) {
      if (file === "MEMORY.md") {
        indexLineCount += await countLines(join(memDir, file));
        continue;
      }
      if (!file.endsWith(".md")) continue;
      totalFiles++;

      // frontmatter から type だけ読む
      try {
        const content = await readFile(join(memDir, file), "utf-8");
        const typeMatch = content.match(/^type:\s*(\w+)/m);
        if (typeMatch) {
          const t = typeMatch[1];
          typeDistribution[t] = (typeDistribution[t] || 0) + 1;
        }
      } catch {
        // skip
      }
    }
  }

  return { projectsWithMemory, totalFiles, typeDistribution, indexLineCount };
}

// ── Skills スキャン ──

async function scanSkills(): Promise<ScanResult["skills"]> {
  const skillsDir = join(CLAUDE_DIR, "skills");
  const dirs = await listDirs(skillsDir);
  return { count: dirs.length, names: dirs };
}

// ── Settings スキャン ──

async function scanSettings(): Promise<ScanResult["settings"]> {
  const local = await safeReadJson<{
    permissions?: { allow?: string[] };
  }>(join(CLAUDE_DIR, "settings.local.json"));

  const settings = await safeReadJson<{
    language?: string;
    env?: Record<string, string>;
  }>(join(CLAUDE_DIR, "settings.json"));

  return {
    permissionRuleCount: local?.permissions?.allow?.length ?? 0,
    hasLanguageSetting: !!settings?.language,
    customEnvVarCount: settings?.env ? Object.keys(settings.env).length : 0,
  };
}

// ── Usage スキャン ──

async function scanUsage(): Promise<ScanResult["usage"]> {
  const projectsDir = join(CLAUDE_DIR, "projects");
  const projects = await listDirs(projectsDir);

  // セッション数推定
  const sessionEnvDir = join(CLAUDE_DIR, "session-env");
  const sessions = await listDirs(sessionEnvDir);

  // 直近30日のアクティブ日数（session-envのディレクトリmtimeで推定）
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const activeDays = new Set<string>();

  for (const sess of sessions) {
    try {
      const s = await stat(join(sessionEnvDir, sess));
      if (s.mtimeMs >= thirtyDaysAgo) {
        const day = toLocalDateString(s.mtimeMs);
        activeDays.add(day);
      }
    } catch {
      // skip
    }
  }

  // チーム数
  const teamsDir = join(CLAUDE_DIR, "teams");
  const teams = await listDirs(teamsDir);

  // タスク数
  const tasksDir = join(CLAUDE_DIR, "tasks");
  let totalTasks = 0;
  const taskTeams = await listDirs(tasksDir);
  for (const team of taskTeams) {
    const files = await listFiles(join(tasksDir, team));
    totalTasks += files.filter((f) => f.endsWith(".json")).length;
  }

  // Claude コミット数（直近のリポジトリで）
  // ~/.claude/projects/ のディレクトリ名からリポジトリパスを復元して検索（クロスプラットフォーム対応）
  let claudeCommitCount = 0;
  const scannedRepoPaths = new Set<string>();

  for (const proj of projects) {
    try {
      const repoDir = restoreProjectPath(proj);
      // 同じリポジトリを重複スキャンしない
      if (scannedRepoPaths.has(repoDir)) continue;
      scannedRepoPaths.add(repoDir);

      if (!(await exists(join(repoDir, ".git")))) continue;

      const result = execSync(
        `git -C "${repoDir}" log --all --oneline --grep="Co-Authored-By:" --since="30 days ago"`,
        { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      if (result) {
        claudeCommitCount += result.split("\n").filter(Boolean).length;
      }
    } catch {
      // skip
    }
  }

  // チャネル統合
  const channelsDir = join(CLAUDE_DIR, "channels");
  const channelIntegrations = await listDirs(channelsDir);

  return {
    projectCount: projects.length,
    estimatedSessions: sessions.length,
    activeDaysLast30: activeDays.size,
    teamCount: teams.length,
    totalTasks,
    claudeCommitCount,
    channelIntegrations,
  };
}

// ── メインスキャン ──

export async function scanAll(): Promise<ScanResult> {
  const [claudeMd, hooks, plugins, memory, skills, settings, usage] =
    await Promise.all([
      scanClaudeMd(),
      scanHooks(),
      scanPlugins(),
      scanMemory(),
      scanSkills(),
      scanSettings(),
      scanUsage(),
    ]);

  return { claudeMd, hooks, plugins, memory, skills, settings, usage };
}
