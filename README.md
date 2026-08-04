# sync-gitee

Obsidian 插件 — 端到端加密同步笔记到 Gitee 仓库。

## 特性

- **单向推送**：本地修改后增量推送到 Gitee，不拉取
- **端到端加密**：AES-256-GCM 加密，本地明文，远程密文
- **全平台**：支持桌面端和移动端（iOS/Android）
- **二进制文件**：支持图片、PDF 等文件类型
- **密码保护**：密码变更检测，防止数据无法解密

## 安装

1. 在 Obsidian 设置中启用 Community 插件
2. 从 Releases 下载 `main.js`、`manifest.json`、`styles.css`
3. 复制到 `<vault>/.obsidian/plugins/sync-gitee/`
4. 启用插件并填写配置

## 配置

| 设置项 | 说明 |
|--------|------|
| Gitee 用户名 | 仓库所有者的用户名 |
| 仓库名称 | Gitee 仓库名称 |
| 访问令牌 | Gitee 个人访问令牌（需 repo 权限） |
| 加密密码 | 用于端到端加密的密码 |
| 分支 | 推送的目标分支（默认 master） |
| 忽略模式 | 逗号分隔的路径前缀，匹配的文件不会推送 |
| 最大文件大小 | 超过此大小的文件将被跳过 |

## 使用

- **推送全部文件**：点击 Ribbon 图标或运行命令
- **选择文件推送**：Ribbon 菜单 → 选择文件推送
- **右键推送**：在文件上右键 → 推送至 Gitee

## 加密格式

```
格式: GSE1:<base64>
Base64 解码后 = salt(16) + iv(12) + encryptedData + authTag
```

## 开发

```bash
npm install
npm run build
```

## 许可证

MIT