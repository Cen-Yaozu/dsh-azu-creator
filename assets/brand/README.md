# Azu Creator 头像

- `azu-avatar-cartoon-v1.png`：用户于 2026-09-15 选定的原始设计稿，完整保留。灰白棋盘格属于图片像素，并非透明背景。
- `azu-avatar-cartoon-v1-cream.png`：正式图标的奶油白背景版本。
- `../../src/client/assets/azu-creator-icon.webp`：512 × 512 的应用素材，由正式版本以 WebP quality 92 转换；侧栏、会话欢迎页和 macOS 打包共用。
- `../../src/client/assets/muzi-creator-icon.webp`：兼容旧路径的同一份新头像。

设计与背景处理使用内置 imagegen。原始设计以用户单人照为人物参考、旧 Muzi 图标为风格参考，保留短发、黑框眼镜和圆润脸型，采用粗轮廓、简化五官与暖色大色块。

正式版本的编辑提示：仅将头像外部的灰白棋盘格替换为纯奶油白背景（目标色 #FFF5E4），保留人物、构图、发型、眼镜和配色；不添加文字、边框或装饰。图片工具未成功输出透明通道，因此正式版本采用不透明浅色底。
