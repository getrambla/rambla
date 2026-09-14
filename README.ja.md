<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Rambla logo">
</p>

<h1 align="center">Rambla</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/getrambla/rambla/stargazers">
    <img src="https://img.shields.io/github/stars/getrambla/rambla?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/getrambla/rambla/releases">
    <img src="https://img.shields.io/github/v/release/getrambla/rambla?style=flat&logo=github" alt="GitHub release">
  </a>
  <a href="https://x.com/moboudra">
    <img src="https://img.shields.io/badge/%40moboudra-555?logo=x" alt="X">
  </a>
  <a href="https://discord.gg/jz8T2uahpH">
    <img src="https://img.shields.io/badge/Discord-555?logo=discord" alt="Discord">
  </a>
  <a href="https://www.reddit.com/r/RamblaAI/">
    <img src="https://img.shields.io/badge/Reddit-555?logo=reddit" alt="Reddit">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode、Pi のエージェントを、ひとつのインターフェースで。</p>

<p align="center">
  <img src="https://rambla.sh/hero-mockup.png" alt="Rambla アプリのスクリーンショット" width="100%">
</p>

<p align="center">
  <img src="https://rambla.sh/mobile-mockup.png" alt="Rambla モバイルアプリ" width="100%">
</p>

> [!NOTE]
> 私はひとりでメンテナンスしているため、GitHub Issues を毎日確認できるとは限りません。
> 急ぎの問題や作業がブロックされている場合は、[Discord](https://discord.gg/jz8T2uahpH) から連絡するのが一番早いです。

---

自分のマシンでエージェントを並列実行。スマートフォンからでもデスクからでも、開発を進めてリリースできます。

- **セルフホスト:** エージェントはあなたのマシン上で動作し、完全な開発環境を使用します。自分のツール・設定・スキルをそのまま活用できます。
- **マルチプロバイダー:** Claude Code、Codex、Copilot、OpenCode、Pi を同一のインターフェースで利用。タスクに合ったモデルを選べます。
- **音声コントロール:** 音声モードでタスクを口述したり問題を話し合ったりできます。ハンズフリーが必要なときに便利です。
- **クロスデバイス:** iOS、Android、デスクトップ、Web、CLI に対応。机で作業を始め、スマートフォンで確認し、ターミナルから自動化できます。
- **プライバシー優先:** Rambla にはテレメトリー・トラッキング・強制ログインは一切ありません。

## はじめかた

Rambla はコーディングエージェントを管理するローカルサーバー（デーモン）を起動します。デスクトップアプリ・モバイルアプリ・Web アプリ・CLI などのクライアントがこのデーモンに接続します。

### 前提条件

エージェント CLI をひとつ以上インストールし、認証情報を設定しておく必要があります。

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### デスクトップアプリ（推奨）

[rambla.sh/download](https://rambla.sh/download) または [GitHub のリリースページ](https://github.com/getrambla/rambla/releases)からダウンロードしてください。アプリを開くとデーモンが自動的に起動します。追加のインストールは不要です。

スマートフォンから接続するには、Settings 画面に表示される QR コードをスキャンしてください。

### CLI / ヘッドレス

CLI をインストールして Rambla を起動します。

```bash
npm install -g @getrambla/cli
rambla
```

ターミナルに QR コードが表示されます。どのクライアントからでも接続できます。サーバーやリモートマシンでの利用に適しています。

詳しいセットアップと設定については以下を参照してください。

- [ドキュメント](https://rambla.sh/docs)
- [設定リファレンス](https://rambla.sh/docs/configuration)

## CLI

アプリでできることはすべてターミナルからも実行できます。

```bash
rambla run --provider claude/opus-4.6 "implement user authentication"
rambla run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

rambla ls                           # 実行中のエージェントを一覧表示
rambla attach abc123                # ライブ出力をストリーミング
rambla send abc123 "also add tests" # 追加タスクを送信

# リモートデーモンで実行
rambla --host workstation.local:6767 run "run the full test suite"
```

詳細は[完全な CLI リファレンス](https://rambla.sh/docs/cli)を参照してください。

## スキル

スキルはエージェントに Rambla を使って他のエージェントをオーケストレーションする方法を教えます。

```bash
npx skills add getrambla/rambla
```

どのエージェントとの会話でも使用できます。

- `/rambla-handoff` — エージェント間で作業を引き継ぎます。私はこれを使って Claude で計画し、Codex に実装を引き継いでいます。
- `/rambla-advisor` — 単一のエージェントをアドバイザーとして起動し、作業を委任せずにセカンドオピニオンを得ます。
- `/rambla-committee` — 対照的な2つのエージェントで委員会を構成し、一歩引いた視点で根本原因を分析して計画を作成します。

## 開発

モノレポのパッケージ構成：

- `packages/server`: Rambla デーモン（エージェントプロセスのオーケストレーション、WebSocket API、MCP サーバー）
- `packages/app`: Expo クライアント（iOS、Android、Web）
- `packages/cli`: デーモンおよびエージェントワークフロー向け `rambla` CLI
- `packages/desktop`: Electron デスクトップアプリ
- `packages/relay`: リモート接続用リレーパッケージ
- `packages/website`: マーケティングサイトとドキュメント（`rambla.sh`）

よく使うコマンド：

```bash
# すべてのローカル開発サービスを起動
npm run dev

# 個別のサービスを起動
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# サーバースタックをビルド
npm run build:server

# リポジトリ全体のチェック
npm run typecheck
```

## 関連プロジェクト

- [getrambla/rambla-relay](https://github.com/getrambla/rambla-relay) — Elixir 製の公式分散リレー
- [rambla-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.rambla-vscode) — VS Code 拡張機能

## ライセンス

Apache-2.0
