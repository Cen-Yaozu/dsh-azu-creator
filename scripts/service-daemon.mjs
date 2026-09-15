#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");

const SERVICE_LABEL = "com.azu.creator";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, `${SERVICE_LABEL}.plist`);
const LOG_DIR = join(root, ".lab", "logs");
const OUT_LOG = join(LOG_DIR, "service.log");
const ERR_LOG = join(LOG_DIR, "service.err.log");
const PID_FILE = join(LOG_DIR, "service.pid");
const DEFAULT_PORT = 51873;

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function generatePlist() {
  const nodeBin = process.execPath;
  const scriptPath = join(root, "scripts", "lab-start.mjs");
  const cliPath = join(root, "node_modules", ".bin", "dsh");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBin}</string>
        <string>${scriptPath}</string>
        <string>--cli</string>
        <string>${cliPath}</string>
        <string>--port</string>
        <string>${DEFAULT_PORT}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${root}</string>
    <key>StandardOutPath</key>
    <string>${OUT_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${ERR_LOG}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}</string>
        <key>HOME</key>
        <string>${homedir()}</string>
    </dict>
</dict>
</plist>
`;
}

async function checkPortHealth(port = DEFAULT_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/models`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

function isLaunchdRunning() {
  try {
    const output = execSync(`launchctl list | grep "${SERVICE_LABEL}" || true`, { encoding: "utf8" });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

function installService() {
  if (process.platform !== "darwin") {
    console.error("目前系统级开机常驻 (LaunchAgent) 仅直接支持 macOS。其他平台请使用 pnpm service:daemon 启动后台守护。");
    process.exit(1);
  }

  ensureLogDir();
  if (!existsSync(LAUNCH_AGENTS_DIR)) {
    mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  }

  const plist = generatePlist();
  writeFileSync(PLIST_PATH, plist, "utf8");
  console.log(`[✓] LaunchAgent 配置已生成：${PLIST_PATH}`);

  // Unload previous if any
  try {
    execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null || true`);
  } catch {}

  // Load and start service
  execSync(`launchctl load -w "${PLIST_PATH}"`);
  console.log(`[✓] 常驻服务已注册并开机自启：${SERVICE_LABEL}`);
  console.log(`[✓] 日志路径：\n    标准输出: ${OUT_LOG}\n    错误输出: ${ERR_LOG}`);
  console.log(`\n提示：可使用 pnpm service:status 查看运行状态，浏览器访问 http://127.0.0.1:${DEFAULT_PORT}`);
}

function uninstallService() {
  if (process.platform === "darwin" && existsSync(PLIST_PATH)) {
    try {
      execSync(`launchctl unload -w "${PLIST_PATH}" 2>/dev/null || true`);
    } catch {}
    rmSync(PLIST_PATH, { force: true });
    console.log(`[✓] 已卸载 macOS 常驻服务并移除 plist。`);
  } else {
    console.log(`未发现已安装的 LaunchAgent 服务。`);
  }
}

function startService() {
  if (process.platform === "darwin" && existsSync(PLIST_PATH)) {
    try {
      if (!isLaunchdRunning()) {
        execSync(`launchctl load -w "${PLIST_PATH}"`);
      } else {
        execSync(`launchctl start ${SERVICE_LABEL}`);
      }
      console.log(`[✓] 已通过 launchctl 启动服务：${SERVICE_LABEL}`);
    } catch (err) {
      console.error(`[!] 启动失败：`, err.message);
    }
    return;
  }

  // Fallback to detached process
  ensureLogDir();
  const nodeBin = process.execPath;
  const scriptPath = join(root, "scripts", "lab-start.mjs");
  const cliPath = join(root, "node_modules", ".bin", "dsh");

  const child = spawn(nodeBin, [scriptPath, "--cli", cliPath, "--port", String(DEFAULT_PORT)], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  if (child.pid) {
    writeFileSync(PID_FILE, String(child.pid), "utf8");
    console.log(`[✓] 已作为独立后台进程启动，PID: ${child.pid}`);
  }
}

function stopService() {
  let stopped = false;
  if (process.platform === "darwin" && existsSync(PLIST_PATH)) {
    try {
      execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null || true`);
      console.log(`[✓] 已通过 launchctl 停止服务并暂停守护：${SERVICE_LABEL}`);
      stopped = true;
    } catch {}
  }

  // Also check if any server process listening on 51873
  try {
    const pids = execSync(`lsof -t -i :${DEFAULT_PORT} -sTCP:LISTEN || true`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`[✓] 已终止端口监听进程 PID: ${pid}`);
        stopped = true;
      } catch {}
    }
  } catch {}

  if (existsSync(PID_FILE)) {
    try {
      const pid = Number(readFileSync(PID_FILE, "utf8").trim());
      if (pid) process.kill(pid, "SIGTERM");
    } catch {}
    rmSync(PID_FILE, { force: true });
  }

  if (!stopped) {
    console.log(`未发现正在运行的 ${SERVICE_LABEL} 服务。`);
  }
}

async function printStatus() {
  console.log(`=== Azu Creator (${SERVICE_LABEL}) 后台常驻状态 ===`);
  const hasPlist = existsSync(PLIST_PATH);
  console.log(`• LaunchAgent 配置: ${hasPlist ? `已安装 (${PLIST_PATH})` : "未安装"}`);

  const launchdActive = isLaunchdRunning();
  console.log(`• launchd 状态: ${launchdActive ? "运行中 (Active)" : "未激活 / 未运行"}`);

  const healthy = await checkPortHealth();
  console.log(`• HTTP 服务健康状态 (http://127.0.0.1:${DEFAULT_PORT}): ${healthy ? "🟢 正常响应 (HTTP 200)" : "🔴 未响应"}`);

  try {
    const lsofOutput = execSync(`lsof -i :${DEFAULT_PORT} || true`, { encoding: "utf8" }).trim();
    if (lsofOutput) {
      console.log(`• 端口 ${DEFAULT_PORT} 占用情况:\n${lsofOutput}`);
    }
  } catch {}

  if (existsSync(OUT_LOG)) {
    console.log(`• 日志文件：${OUT_LOG}`);
  }
}

function showLogs() {
  if (!existsSync(OUT_LOG) && !existsSync(ERR_LOG)) {
    console.log("暂无日志文件。");
    return;
  }
  console.log(`--- [stdout: ${OUT_LOG}] (最后 20 行) ---`);
  if (existsSync(OUT_LOG)) {
    try {
      const lines = execSync(`tail -n 20 "${OUT_LOG}"`, { encoding: "utf8" });
      console.log(lines);
    } catch {}
  }
  if (existsSync(ERR_LOG)) {
    console.log(`--- [stderr: ${ERR_LOG}] (最后 20 行) ---`);
    try {
      const lines = execSync(`tail -n 20 "${ERR_LOG}"`, { encoding: "utf8" });
      console.log(lines);
    } catch {}
  }
}

const command = process.argv[2] || "status";

switch (command) {
  case "install":
    installService();
    break;
  case "uninstall":
    uninstallService();
    break;
  case "start":
    startService();
    break;
  case "stop":
    stopService();
    break;
  case "restart":
    stopService();
    setTimeout(() => startService(), 1000);
    break;
  case "status":
    await printStatus();
    break;
  case "logs":
    showLogs();
    break;
  default:
    console.log(`未知指令: ${command}\n可用指令: install, uninstall, start, stop, restart, status, logs`);
    process.exit(1);
}
