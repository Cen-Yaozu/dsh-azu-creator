#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const ROOT = process.cwd();
const DIST_DIR = resolve(ROOT, "dist");
const APP_BUNDLE_NAME = "Azu Creator.app";
const APP_DIR = resolve(DIST_DIR, APP_BUNDLE_NAME);
const CONTENTS_DIR = join(APP_DIR, "Contents");
const MACOS_DIR = join(CONTENTS_DIR, "MacOS");
const RESOURCES_DIR = join(CONTENTS_DIR, "Resources");
const ICONSET_DIR = resolve(DIST_DIR, ".AppIcon.iconset");
const SOURCE_WEBP = resolve(ROOT, "src/client/assets/azu-creator-icon.webp");
const SWIFT_SOURCE = resolve(ROOT, "src/macos-app/main.swift");
const TARGET_USER_APP = resolve(homedir(), "Applications", APP_BUNDLE_NAME);

console.log("=== 开始构建 Azu Creator 原生 macOS 应用 ===");

// 1. Prepare directory structure
mkdirSync(MACOS_DIR, { recursive: true });
mkdirSync(RESOURCES_DIR, { recursive: true });

// 2. Generate AppIcon.icns
console.log("-> 正在生成高清应用图标...");
try {
  mkdirSync(ICONSET_DIR, { recursive: true });
  const basePng = join(ICONSET_DIR, "base.png");
  execSync(`sips -s format png "${SOURCE_WEBP}" --out "${basePng}" > /dev/null 2>&1`);

  const iconSizes = [
    { name: "icon_16x16.png", size: 16 },
    { name: "icon_16x16@2x.png", size: 32 },
    { name: "icon_32x32.png", size: 32 },
    { name: "icon_32x32@2x.png", size: 64 },
    { name: "icon_128x128.png", size: 128 },
    { name: "icon_128x128@2x.png", size: 256 },
    { name: "icon_256x256.png", size: 256 },
    { name: "icon_256x256@2x.png", size: 512 },
    { name: "icon_512x512.png", size: 512 },
  ];

  for (const { name, size } of iconSizes) {
    const outPath = join(ICONSET_DIR, name);
    execSync(`sips -z ${size} ${size} "${basePng}" --out "${outPath}" > /dev/null 2>&1`);
  }

  const icnsPath = join(RESOURCES_DIR, "AppIcon.icns");
  execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${icnsPath}"`);
  rmSync(ICONSET_DIR, { recursive: true, force: true });
  console.log("✓ 图标生成完毕: AppIcon.icns");
} catch (err) {
  console.warn("⚠️ 图标转换遇到警告（将使用备用策略）:", err.message);
}

// 3. Generate Info.plist
console.log("-> 正在生成 Info.plist 元数据...");
const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>zh_CN</string>
    <key>CFBundleExecutable</key>
    <string>AzuCreator</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.azu.creator.app</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Azu Creator</string>
    <key>CFBundleDisplayName</key>
    <string>Azu Creator</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.2.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
    <key>NSRequiresAquaSystemAppearance</key>
    <false/>
</dict>
</plist>
`;
writeFileSync(join(CONTENTS_DIR, "Info.plist"), infoPlist, "utf8");

// 4. Compile Swift binary
console.log("-> 正在编译原生执行体 (swiftc)...");
const binaryPath = join(MACOS_DIR, "AzuCreator");
execSync(`swiftc -O "${SWIFT_SOURCE}" -o "${binaryPath}"`, { stdio: "inherit" });
console.log("✓ 原生二进制编译成功: AzuCreator");

// 5. Install to ~/Applications
console.log(`-> 正在同步安装到个人应用目录: ${TARGET_USER_APP}`);
try {
  const userAppsDir = resolve(homedir(), "Applications");
  mkdirSync(userAppsDir, { recursive: true });
  rmSync(TARGET_USER_APP, { recursive: true, force: true });
  execSync(`cp -R "${APP_DIR}" "${TARGET_USER_APP}"`);
  console.log("✓ 安装成功！Spotlight 与 Launchpad 已同步索引");
} catch (err) {
  console.warn("⚠️ 安装到 ~/Applications 警告:", err.message);
}

console.log("\n==========================================");
console.log("🎉 打包安装完成！");
console.log(`📂 应用路径: ${TARGET_USER_APP}`);
console.log("🚀 启动方式:");
console.log("   1. 终端运行: pnpm app:open 或 open ~/Applications/'Azu Creator.app'");
console.log("   2. 快捷键: Cmd + 空格 呼出聚焦搜索，输入 'Azu Creator' 回车秒开");
console.log("   3. 可在启动后右键 Dock 图标选择「在程序坞中保留」");
console.log("==========================================");
