# B站账号连接

支持 macOS Apple Silicon。B站扫码登录使用固定的 biliup 1.2.4 独立进程；本阶段只提供账号连接与身份检查，不提供投稿。

## 使用

1. 在“内容 → 账号管理”新增哔哩哔哩账号。
2. 点击“连接B站”，使用哔哩哔哩手机端扫描二维码并确认。
3. 程序从 B 站读取账号 UID 和昵称。核验通过后显示“已连接”和核验时间。
4. “检查登录”重新请求身份。网络失败显示待检查，登录失效显示已过期；超过 15 分钟的状态回读会提示重新检查。
5. “重新连接B站”使用新的扫码流程。若扫码身份不同，拒绝覆盖原绑定；请使用原账号或新增一条账号记录。
6. 二维码在三分钟内有效，可取消；退出服务会结束登录进程。重启后未完成登录显示中断，原有绑定保留。

扫码登录自身不等于验证通过。凭据写入后仍需成功回读 B 站身份；身份获取失败不会覆盖原凭据。重复登记同一个已绑定 UID 会被拒绝。

## 安装

先确认后台有效 `dataDir`，再运行：

```sh
pnpm bilibili:install --data-dir /absolute/path/to/service-data
```

本机当前部署目录为 `.lab/fixture/data`。安装脚本固定版本及下载哈希，并检查 Python 3 的 PTY（伪终端）支持。不会访问 latest 发行或自动升级运行时。仅支持 macOS ARM64；其他平台暂未安装验证。

归档 SHA-256：`f2341fbb2c95be4f0934d070d13e3891ff83a68fa35c20bcebc5518bee7cf15b`。
执行文件 SHA-256：`1a0d178ae7be6be76f060e12d7910b30798334d1f1921f226a8311ad003a588a`。

## 存储与边界

运行时位于 `<dataDir>/platform-runtime/biliup/1.2.4`。连接状态及凭据位于 `<dataDir>/platform-connections/bilibili/<账号ID散列>/binding.json`。目录权限为 0700、文件权限为 0600；前端只收到连接状态、UID、昵称、核验时间及短期登录二维码。

`content-accounts.json` 保留原数据结构，不写入 Cookie 或令牌。凭据与运行时目录加入 Git 忽略规则。扫码候选与原绑定分开，成功核验后原子替换。原始终端输出不会转发到前端或业务日志。

账号连接由用户按钮显式触发，不依赖旧 video-publisher，也不启用外部发布配置。视频号、视频上传与投稿回读仍在任务后续阶段。

## 开源来源

使用 [biliup v1.2.4](https://github.com/biliup/biliup/releases/tag/v1.2.4) 作为外部本机运行时。扫码交互顺序与身份读取接口依据该版本的 `crates/biliup-cli/src/uploader.rs` 和 `crates/biliup/src/uploader/bilibili.rs` 核对。账号检查请求 `https://api.bilibili.com/x/space/myinfo`，这是网页身份读取接口，不是官方开放平台授权。

[该版本 LICENSE](https://github.com/biliup/biliup/blob/v1.2.4/LICENSE) 为 MIT；README 另有禁止商业用途表述，仍需在对外或商业分发前澄清。仓库不分发运行时二进制，保留许可证原文如下；本地安装不代表已解决该表述不一致。

```text
MIT License

Copyright (c) 2019 ForgQi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
