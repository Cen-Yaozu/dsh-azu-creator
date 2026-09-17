# 本轮验证记录

时间：2026-09-18（Asia/Shanghai）。范围：B站账号连接；任务保持 in_progress。

## 代码与自动验证

- 已实现：固定版本扫码进程、二维码展示、取消与超时、真实身份读取、原绑定保护、检查登录、重连、账号隔离、私有凭据存储及重启中断恢复。
- 定向测试：`pnpm exec vitest run tests/bilibiliConnections.test.ts tests/bilibiliConnection.dom.test.tsx tests/contentAccounts.test.ts tests/contentManagement.dom.test.tsx tests/typert.test.ts`，5 个文件、23 项通过。
- `pnpm typecheck` 通过；`pnpm build` 通过。小窗口账号布局调整后重新构建通过。
- Python 桥接脚本语法检查通过。
- npm 打包清单包含安装脚本和 PTY 桥接脚本，不含运行时二进制及平台凭据。
- 身份接口、登录过期、网络异常、身份不一致、重复绑定的自动测试使用受控响应；不能作为真实账号验收证据。

## 本地运行时与部署

- biliup 1.2.4，macOS ARM64；归档与执行文件 SHA-256 均校验通过，`--version` 返回 `biliup-cli 1.2.4`。
- 运行时安装到本地后台有效 dataDir 的 `platform-runtime` 目录；版本、许可证与安装方法见 `docs/bilibili-connection.md`。
- 精确重载 LaunchAgent `com.azu.creator`，后台监听 `127.0.0.1:51873`。未替换 Swift 外壳，已刷新 `/Users/mac/Applications/Azu Creator.app` 加载新的前后端。
- 在桌面“内容 → 账号管理”登记“我的B站账号”，平台为哔哩哔哩。此名称只是本地标签，不代表已核验的平台身份。
- 桌面点击连接后成功获取真实 B站二维码；取消后界面显示取消，临时登录目录与锁数量为 0，没有残留 biliup 子进程。
- 再次连接成功取得新二维码；窄窗口布局已修正并查看实际截图，二维码保持 200px。

## 仍待验收

- 用户尚未完成扫码确认，真实 UID、昵称、凭据持久化后的检查登录与重启回读未验证。
- B站视频上传、投稿、审核/作品链接回读未实现，未调用任何上传或发布。
- 视频号接入未开始，SAU 版本及补丁仍待后续阶段固定。
- biliup LICENSE 与 README 的商业用途表述差异仍待澄清；本轮不分发第三方二进制。

整个真实发布闭环尚未完成。不得据本轮二维码与自动测试结果，将阶段 2 的真实账号验收或整个任务标为完成。
