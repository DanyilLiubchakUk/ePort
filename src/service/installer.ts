import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import type { ConfigStore } from "../config/index.ts";
import { defaultSpawnSync, trimCommandOutput, type SpawnSyncFn } from "./exec.ts";
import {
  getLaunchAgentPlistPath,
  getLauncherVbsPath,
  getRunnerCmdPath,
  getServiceLogPath,
  getWindowsServiceDir,
  resolveCliEntryPath,
  SERVICE_LABEL,
  WINDOWS_TASK_NAME,
} from "./paths.ts";
import type { ServicePlatform, ServiceStatus } from "./types.ts";

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface ServiceInstallerDeps {
  home?: string;
  spawnSync?: SpawnSyncFn;
  cliEntry?: string;
  runtimePath?: string;
}

function assertSupportedPlatform(action: string): ServicePlatform {
  if (process.platform === "darwin" || process.platform === "win32") {
    return process.platform;
  }
  throw new ServiceError(
    `Service ${action} is supported on macOS and Windows only (current: ${process.platform}).`,
  );
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch (err) {
    if (!hasErrorCode(err, "ENOENT")) throw err;
  }
}

function hasErrorCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === code;
}

export function formatSchtasksError(op: string, raw: string): string {
  const trimmed = trimCommandOutput(raw);
  const lower = trimmed.toLowerCase();
  const denied =
    lower.includes("access is denied") ||
    lower.includes("access denied") ||
    trimmed.includes("Accès refusé") ||
    trimmed.includes("acces refuse");
  if (denied) {
    return (
      `schtasks ${op} refused (Access denied). ` +
      "Re-run this command from an elevated PowerShell or Command Prompt (Run as Administrator)."
    );
  }
  return `schtasks ${op} failed: ${trimmed}`;
}

function buildUpArgv(cliEntry: string): string[] {
  return ["run", cliEntry, "up"];
}

function buildLaunchAgentPlist(options: {
  bunPath: string;
  cliEntry: string;
  home: string;
  logPath: string;
}): string {
  const programArgs = [
    options.bunPath,
    ...buildUpArgv(options.cliEntry),
  ];
  const argsXml = programArgs
    .map((arg) => `      <string>${escapeXml(arg)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(options.home)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.logPath)}</string>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class ServiceInstaller {
  private readonly home: string;
  private readonly spawnSync: SpawnSyncFn;
  private readonly cliEntry: string;
  private readonly runtimePath: string;

  constructor(_store: ConfigStore, deps: ServiceInstallerDeps = {}) {
    this.home = deps.home ?? homedir();
    this.spawnSync = deps.spawnSync ?? defaultSpawnSync;
    this.cliEntry = resolve(deps.cliEntry ?? resolveCliEntryPath());
    this.runtimePath = deps.runtimePath ?? process.execPath;
  }

  get logPath(): string {
    return getServiceLogPath(this.home);
  }

  install(): ServiceStatus {
    const platform = assertSupportedPlatform("install");
    if (platform === "darwin") {
      return this.installDarwin();
    }
    return this.installWindows();
  }

  uninstall(): void {
    const platform = assertSupportedPlatform("uninstall");
    if (platform === "darwin") {
      this.uninstallDarwin();
      return;
    }
    this.uninstallWindows();
  }

  start(): void {
    const platform = assertSupportedPlatform("start");
    if (platform === "darwin") {
      this.startDarwin();
      return;
    }
    this.startWindows();
  }

  stop(): void {
    const platform = assertSupportedPlatform("stop");
    if (platform === "darwin") {
      this.stopDarwin();
      return;
    }
    this.stopWindows();
  }

  restart(): void {
    this.stop();
    this.start();
  }

  status(): ServiceStatus {
    if (process.platform === "darwin") {
      return this.statusDarwin();
    }
    if (process.platform === "win32") {
      return this.statusWindows();
    }
    return {
      platform: "unsupported",
      installed: false,
      running: false,
      logPath: this.logPath,
    };
  }

  private installDarwin(): ServiceStatus {
    const plistPath = getLaunchAgentPlistPath(this.home);
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(
      plistPath,
      buildLaunchAgentPlist({
        bunPath: this.runtimePath,
        cliEntry: this.cliEntry,
        home: this.home,
        logPath: this.logPath,
      }),
      "utf8",
    );

    const boot = this.spawnSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, plistPath]);
    if (boot.status !== 0) {
      const out = `${boot.stderr ?? ""}${boot.stdout ?? ""}`.toLowerCase();
      if (!out.includes("no such process") && !out.includes("could not find")) {
        throw new ServiceError(
          `launchctl bootout failed: ${trimCommandOutput(boot.stderr || boot.stdout || "unknown error")}`,
        );
      }
    }

    const bootstrap = this.spawnSync("launchctl", [
      "bootstrap",
      `gui/${process.getuid?.() ?? 0}`,
      plistPath,
    ]);
    if (bootstrap.status !== 0) {
      throw new ServiceError(
        `launchctl bootstrap failed: ${trimCommandOutput(bootstrap.stderr || bootstrap.stdout || "unknown error")}`,
      );
    }

    const kick = this.spawnSync("launchctl", ["kickstart", "-k", `gui/${process.getuid?.() ?? 0}/${SERVICE_LABEL}`]);
    const started = kick.status === 0;
    const startError = started
      ? null
      : trimCommandOutput(kick.stderr || kick.stdout || "unknown error");

    return {
      platform: "darwin",
      installed: true,
      running: started || this.isDarwinRunning(),
      logPath: this.logPath,
      registrationPath: plistPath,
      startError,
    };
  }

  private uninstallDarwin(): void {
    const plistPath = getLaunchAgentPlistPath(this.home);
    this.spawnSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, plistPath]);
    safeUnlink(plistPath);
  }

  private startDarwin(): void {
    const plistPath = getLaunchAgentPlistPath(this.home);
    if (!existsPlist(plistPath)) {
      throw new ServiceError("ePort service is not installed. Run: eport service install");
    }
    const domain = `gui/${process.getuid?.() ?? 0}`;
    const kick = this.spawnSync("launchctl", ["kickstart", "-k", `${domain}/${SERVICE_LABEL}`]);
    if (kick.status === 0) {
      return;
    }
    const bootstrap = this.spawnSync("launchctl", ["bootstrap", domain, plistPath]);
    if (bootstrap.status !== 0) {
      throw new ServiceError(
        `launchctl bootstrap failed: ${trimCommandOutput(bootstrap.stderr || bootstrap.stdout || "unknown error")}`,
      );
    }
    const retry = this.spawnSync("launchctl", ["kickstart", "-k", `${domain}/${SERVICE_LABEL}`]);
    if (retry.status !== 0) {
      throw new ServiceError(
        `launchctl kickstart failed: ${trimCommandOutput(retry.stderr || retry.stdout || "unknown error")}`,
      );
    }
  }

  private stopDarwin(): void {
    const plistPath = getLaunchAgentPlistPath(this.home);
    if (!existsPlist(plistPath)) {
      return;
    }
    this.spawnSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, plistPath]);
  }

  private statusDarwin(): ServiceStatus {
    const plistPath = getLaunchAgentPlistPath(this.home);
    const installed = existsPlist(plistPath);
    return {
      platform: "darwin",
      installed,
      running: installed && this.isDarwinRunning(),
      logPath: this.logPath,
      registrationPath: installed ? plistPath : undefined,
    };
  }

  private isDarwinRunning(): boolean {
    const list = this.spawnSync("launchctl", ["list"]);
    if (list.status !== 0) return false;
    const line = (list.stdout ?? "")
      .split(/\r?\n/)
      .find((row) => row.includes(SERVICE_LABEL));
    if (!line) return false;
    const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10);
    return Number.isFinite(pid) && pid > 0;
  }

  private installWindows(): ServiceStatus {
    const serviceDir = getWindowsServiceDir(this.home);
    mkdirSync(serviceDir, { recursive: true });

    const runnerPath = getRunnerCmdPath(this.home);
    const launcherPath = getLauncherVbsPath(this.home);
    const runnerContent =
      `@echo off\r\n` +
      `set HOME=${this.home}\r\n` +
      `"${this.runtimePath}" run "${this.cliEntry}" up >> "${this.logPath}" 2>&1\r\n`;
    writeFileSync(runnerPath, runnerContent, "utf8");

    const vbsContent =
      `Set WshShell = CreateObject("WScript.Shell")\r\n` +
      `WshShell.Run """${runnerPath}""", 0, False\r\n`;
    writeFileSync(launcherPath, vbsContent, "utf8");

    const taskAction = `wscript.exe "${launcherPath}"`;
    const create = this.spawnSync("schtasks", [
      "/Create",
      "/TN",
      WINDOWS_TASK_NAME,
      "/TR",
      taskAction,
      "/SC",
      "ONLOGON",
      "/F",
    ]);
    if (create.status !== 0) {
      throw new ServiceError(formatSchtasksError("/Create", create.stderr || create.stdout || ""));
    }

    const run = this.spawnSync("schtasks", ["/Run", "/TN", WINDOWS_TASK_NAME]);
    const started = run.status === 0;
    const startError = started
      ? null
      : trimCommandOutput(run.stderr || run.stdout || "unknown error");

    return {
      platform: "win32",
      installed: true,
      running: started,
      logPath: this.logPath,
      registrationPath: runnerPath,
      startError,
    };
  }

  private uninstallWindows(): void {
    this.spawnSync("schtasks", ["/End", "/TN", WINDOWS_TASK_NAME]);
    const del = this.spawnSync("schtasks", ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"]);
    if (del.status !== 0) {
      const out = `${del.stderr ?? ""}${del.stdout ?? ""}`.toLowerCase();
      const notFound =
        out.includes("does not exist") ||
        out.includes("cannot find") ||
        out.includes("the system cannot find");
      if (!notFound) {
        throw new ServiceError(formatSchtasksError("/Delete", del.stderr || del.stdout || ""));
      }
    }
    safeUnlink(getLauncherVbsPath(this.home));
    safeUnlink(getRunnerCmdPath(this.home));
  }

  private startWindows(): void {
    if (!this.isWindowsInstalled()) {
      throw new ServiceError("ePort service is not installed. Run: eport service install");
    }
    const run = this.spawnSync("schtasks", ["/Run", "/TN", WINDOWS_TASK_NAME]);
    if (run.status !== 0) {
      throw new ServiceError(formatSchtasksError("/Run", run.stderr || run.stdout || ""));
    }
  }

  private stopWindows(): void {
    if (!this.isWindowsInstalled()) {
      return;
    }
    this.spawnSync("schtasks", ["/End", "/TN", WINDOWS_TASK_NAME]);
  }

  private statusWindows(): ServiceStatus {
    const installed = this.isWindowsInstalled();
    return {
      platform: "win32",
      installed,
      running: installed && this.isWindowsRunning(),
      logPath: this.logPath,
      registrationPath: installed ? getRunnerCmdPath(this.home) : undefined,
    };
  }

  private isWindowsInstalled(): boolean {
    const result = this.spawnSync("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME]);
    return result.status === 0;
  }

  private isWindowsRunning(): boolean {
    const result = this.spawnSync("schtasks", [
      "/Query",
      "/TN",
      WINDOWS_TASK_NAME,
      "/FO",
      "LIST",
      "/V",
    ]);
    if (result.status !== 0) return false;
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
    return text.includes("running") || text.includes("status:\t\trunning");
  }
}

function existsPlist(path: string): boolean {
  return existsSync(path);
}
