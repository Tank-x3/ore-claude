import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";
import type { ScanResult } from "./types.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const IS_WINDOWS = platform() === "win32";

/**
 * ディレクトリ名に使われるエンコード関数:
 * 全ての非英数字文字を "-" に置換する（Claude Code の命名規則を再現）。
 */
function encodeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * ファイルシステムを逆引きしてパスを復元する。
 * 各階層で実ディレクトリ名をエンコードし、残りの文字列とマッチングする。
 * 長い名前を優先（greedy）して "u_temp" vs "u"+"temp" のような曖昧性を解消する。
 */
async function walkAndMatch(
  basePath: string,
  encodedRemaining: string
): Promise<string | null> {
  if (!encodedRemaining) return basePath;

  const dirs = await listDirs(basePath);
  const candidates = dirs
    .map((dir) => ({ dir, encoded: encodeName(dir) }))
    .filter(
      ({ encoded }) =>
        encodedRemaining.toLowerCase() === encoded.toLowerCase() ||
        encodedRemaining.toLowerCase().startsWith(encoded.toLowerCase() + "-")
    )
    .sort((a, b) => b.encoded.length - a.encoded.length);

  for (const { dir, encoded } of candidates) {
    if (encodedRemaining.toLowerCase() === encoded.toLowerCase()) {
      return join(basePath, dir);
    }
    const rest = encodedRemaining.slice(encoded.length + 1);
    const result = await walkAndMatch(join(basePath, dir), rest);
    if (result) return result;
  }

  return null;
}

/**
 * ~/.claude/projects/ のディレクトリ名から実際のファイルシステムパスを復元する。
 * エンコードは不可逆（_, -, /, . が全て - になる）なので、
 * ファイルシステムを逆引きしてマッチングする。
 *
 * Windows: "C--u-temp-project" → "C:/u_temp/project"
 * Unix:    "-home-yuto-foo"    → "/home/yuto/foo"
 */
async function resolveProjectPath(dirName: string): Promise<string | null> {
  if (IS_WINDOWS) {
    const winMatch = dirName.match(/^([A-Za-z])--(.+)$/);
    if (winMatch) {
      const drive = winMatch[1].toUpperCase();
      return walkAndMatch(`${drive}:/`, winMatch[2]);
    }
    const driveOnly = dirName.match(/^([A-Za-z])--$/);
    if (driveOnly) {
      return `${driveOnly[1].toUpperCase()}:/`;
    }
    return null;
  }

  const unixMatch = dirName.match(/^-(.+)$/);
  if (unixMatch) {
    return walkAndMatch("/", unixMatch[1]);
  }
  return null;
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
  // ファイルシステム逆引きでパスを復元し、実ディレクトリの CLAUDE.md を探す
  const projectsDir = join(CLAUDE_DIR, "projects");
  const projects = await listDirs(projectsDir);
  let projectConfigs = 0;
  const globalDir = CLAUDE_DIR; // ~/.claude を除外判定用に保持

  for (const proj of projects) {
    const realPath = await resolveProjectPath(proj);
    if (!realPath) continue;

    // ~/.claude 自体のCLAUDE.mdはグローバルとしてカウント済みなので除外
    if (realPath === globalDir || realPath === homedir()) continue;

    if (await exists(join(realPath, "CLAUDE.md"))) {
      projectConfigs++;
    }
  }

  return { globalExists, globalLineCount, globalSectionCount, projectConfigs };
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

  // セッション数・アクティブ日数: プロジェクト内の .jsonl セッションログ + session-env を併用
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const activeDays = new Set<string>();
  let estimatedSessions = 0;

  for (const proj of projects) {
    const projDir = join(projectsDir, proj);
    try {
      const files = await listFiles(projDir);
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        estimatedSessions++;
        const s = await stat(join(projDir, f));
        if (s.mtimeMs >= thirtyDaysAgo) {
          activeDays.add(toLocalDateString(s.mtimeMs));
        }
      }
    } catch {
      // skip
    }
  }

  // session-env からも補完
  const sessionEnvDir = join(CLAUDE_DIR, "session-env");
  const sessionEnvEntries = await listDirs(sessionEnvDir);
  for (const sess of sessionEnvEntries) {
    try {
      const s = await stat(join(sessionEnvDir, sess));
      if (s.mtimeMs >= thirtyDaysAgo) {
        activeDays.add(toLocalDateString(s.mtimeMs));
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

  // Claude コミット数: ファイルシステム逆引きでリポジトリを特定して検索
  let claudeCommitCount = 0;
  const scannedRepoPaths = new Set<string>();

  for (const proj of projects) {
    try {
      const repoDir = await resolveProjectPath(proj);
      if (!repoDir) continue;
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
    estimatedSessions,
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
