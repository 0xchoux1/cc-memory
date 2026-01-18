# Claude Codeに環境構築を丸投げしてみた

## TL;DR

Ubuntu 25.10をクリーンインストール後、Claude Codeに「開発環境の立ち上げ」を委任した。人間がやったのはcurl/Claude Code導入、sudo権限、OAuth認証など最小限。約1時間でNode/Python/Docker/CLI/SSH/rcloneまで揃い、途中の設計判断（なぜその選択か）も対話で詰められた。

> **注意**: NOPASSWDや`curl | bash`等のリスクがあるため、検証用環境での実施を推奨。

## 検証環境

| 項目 | 内容 |
|------|------|
| 検証日 | 2026-01-17 |
| OS | Ubuntu 25.10（クリーンインストール / 最小構成） |
| ネットワーク | 有線（プロキシなし） |
| 目的 | ローカル開発環境（MCPサーバー/Node/Python/Docker）を1時間で立ち上げ |

> **補足**: Ubuntu 25.10はinterim release（サポート期間9ヶ月）です。安定運用にはLTS版を推奨します。

## 結論：1時間でここまでできた

- Node.js v24.13.0 (LTS) + Python 3.13 + Docker 29.1.5
- モダンCLIツール一式（fzf, ripgrep, bat, fd等）
- SSH複数アカウント運用（GitHub 2アカウント対応）
- OneDriveマウント（rclone）
- MCPサーバー（cc-memory）のビルド・登録

## 人間がやったこと

1. **curlのインストール**（Claude Codeのインストールに必要）
2. **Claude Codeのインストール**
3. **sudoのNOPASSWD設定**（Claude Codeがsudoを実行できるように）
4. **OneDriveのブラウザ認証**（rclone設定時）
5. **rcloneの再設定**（OpenDriveとOneDriveを間違えたため）

それ以外の作業は**すべてClaude Codeが実行**しました。

## Claude Codeに投げた要件

最初の依頼はシンプルでした：

```
Ubuntuを先程インストールしました。環境整備を手伝ってほしいです。
```

Claude Codeが用途を質問してきたので、以下を伝えました：

```
AI/LLMを活用して、開発や運用自動化をしたい
```

その後は対話的に進行。具体的には以下のような要件を会話の中で伝えていきました：

- Node (nvmでLTS), Python, Docker を入れる
- 便利CLI（fzf/rg/bat/fd等）とbash設定
- rcloneでOneDriveをマウント（認証は私がやる）
- ~/.sshをセットアップし、複数Gitアカウント運用
- ghqでリポジトリ管理
- ターミナルとエディタは最高のものを提案してほしい

### コピペ用テンプレート

再現する際は以下をClaude Codeに投げてみてください：

```
Ubuntuを先程インストールしました。以下の環境を整備してください：
- Node (nvmでLTS), Python, Docker
- 便利CLI（fzf/rg/bat/fd等）とbash設定
- ghqでリポジトリ管理
- ターミナルとエディタを提案してほしい

※ 変更点は実行前に要約して提示してから進めてください
※ セキュリティに関わる操作（sudoers/鍵配置）は必ず確認を挟んでください
```

## Claude Codeの実行内容

### 基本開発ツール
```bash
sudo apt install -y git build-essential
```

### クラウドストレージ連携
- rcloneのインストール
- OneDriveの設定（認証以外）
- SSHキーのダウンロードと配置
- SSH configの修正（GNOME Keyringとの競合解決）

### 言語環境
- nvm + Node.js v24.13.0 LTS
- Python 3.13 + pip

### コンテナ環境
- Docker Engine 29.1.5
- Docker Compose（プラグイン版）

### 開発ツール
| カテゴリ | ツール |
|---------|--------|
| リポジトリ管理 | ghq |
| ターミナル | Ghostty, WezTerm |
| エディタ | Zed, Neovim |

### 便利ツール
```
jq, htop, whois, dig, nmap, tcpdump, tree,
ripgrep, fd-find, bat, fzf, ncdu, httpie
```

### シェル設定
- モダンCLIツールのエイリアス（`bat`, `fd`, `rg`）
- fzfのキーバインド（Ctrl+R, Ctrl+T, Alt+C）
- ghq + fzf連携（`repo`コマンド）

### プロジェクト環境
- cc-memoryリポジトリのクローン
- 依存関係インストール + ビルド
- テスト実行（139 tests passed）
- MCPサーバーとして登録

## つまずきと解決

### SSH認証が違うアカウントになる

**問題**: GitHubにSSH接続すると、意図しないアカウント（alph4-1）で認証される

**原因**: GNOME KeyringがSSHキーをキャッシュしており、SSH configの設定より優先されていた

**解決**: SSH configに`IdentityAgent none`を追加してエージェントを無視

```
Host github.com
    IdentityFile ~/.ssh/0xchoux1/id_ed25519
    IdentitiesOnly yes
    IdentityAgent none
    User git
```

> **注**: `IdentityAgent none` は、このHostに対してSSHエージェント（GNOME Keyring が提供する ssh-agent を含む）を使わない設定です。明示した `IdentityFile` を確実に優先できる一方、エージェント利用の利便性は下がります。

### rcloneでOpenDriveを設定してしまった

**問題**: OneDrive（Microsoft）を設定したつもりが、OpenDrive（別サービス）を設定していた

**原因**: 設定時にストレージタイプの選択を間違えた（名前が似ている）

**解決**: 設定を削除して再設定。Claude Codeが正しいストレージタイプ（`onedrive`）で再設定

### MCPサーバーが接続できない

**問題**: `claude mcp list`で「Failed to connect」

**原因**: nvmでインストールしたNode.jsは`.bashrc`でPATHが設定されるが、MCPプロセス起動時は対話シェルではないため`.bashrc`が読み込まれない

**解決**: ラッパースクリプトを作成してnvmを読み込んでから実行

```bash
#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
exec node "$(dirname "$0")/dist/index.js" "$@"
```

> **配置**: `run.sh`はプロジェクトルートに配置し、`chmod +x run.sh`で実行権限を付与。MCPの設定では絶対パスで指定する。

## 会話のハイライト

### ツール選定：一方的でなく対話的

**コンテナ環境の選定** — 「最高は何か」ではなく「用途に合うか」で提案

> 私: microk8sの使い道ってどんなことがある？イメージできていない
>
> Claude: 正直に言うと、本番でK8sを使わないなら、microk8sは不要かもしれません。Dockerだけで十分だと思います。

**エディタの選定** — Claude Codeとの相性を考慮した提案

> 私: 最高のエディタはどれですか？
>
> Claude: あなたの場合（Claude Code + AI/LLM開発）、エディタの重要度は実は低いです。Claude Codeがコード編集を行うので、エディタは「見る」「軽微な修正」が主な用途。Zedが最高です。

### 設計判断：理由を説明してくれる

> 私: なぜラッパースクリプトが必要なのか？他に方法はないのか？
>
> Claude: 選択肢は「フルパス指定」と「ラッパースクリプト」。フルパスはシンプルだがバージョンアップ時に設定変更が必要。長い目で見るならラッパースクリプトが良いです。

## 学び：AIに任せる境界

### 任せて良かったこと

- **インストール作業**: apt, curl, 設定ファイル編集など定型作業
- **トラブルシューティング**: エラーメッセージから原因特定、修正提案
- **ツール選定の相談**: 選択肢の整理、用途に応じた推奨
- **設定ファイルの生成**: .bashrc, SSH config など

### 人間が判断すべきこと

- **セキュリティに関わる決定**: NOPASSWD設定、鍵の配置場所
- **認証が必要な作業**: OAuth、ブラウザ認証
- **最終的なツール選定**: 提案を受けて自分で決める
- **本番環境への適用可否**: 検証環境と本番は別

## セキュリティ上の注意

### NOPASSWD設定

Claude Codeがsudoを実行できるようにNOPASSWD設定が必要ですが、これはセキュリティリスクです。

- **検証用VM/使い捨て環境に限定**（恒久運用しない）
- 作業完了後は設定を削除：
  ```bash
  sudo rm -f /etc/sudoers.d/$USER
  sudo visudo -c
  ```
- 代替案：特定コマンドのみNOPASSWDにする（例：`apt`, `docker`のみ許可）

### curl | bash 型インストール

Claude CodeやZedなど、`curl | bash`でインストールするツールがあります。

- **実行前にスクリプトを確認**（最低でもURLを開いて目視）
- 信頼できるソースか確認

参考: [Set up Claude Code](https://code.claude.com/docs/en/setup)

### SSH鍵・トークンの管理

AIの作業フローでSSH鍵やクラウド認証を扱う場合：

- **作業後に棚卸し**（何をどこに置いたか、権限は適切か）
- 不要な鍵は削除

## 最終的な環境

詳細なバージョンは「結論」セクションを参照。主な構成：

- **開発**: Node.js (nvm), Python, Docker, Zed, Neovim
- **ターミナル**: Ghostty, WezTerm, Bash + fzf
- **運用**: ghq + SSH複数アカウント, rclone (OneDrive)

## まとめ

Claude Codeは単なるコード生成ツールではなく、**対話的なシステム管理者**としても機能します。

環境構築という面倒な作業を、自然言語での会話だけで完了できる時代になりました。ただし、セキュリティの境界は人間が判断する必要があります。

**再現する場合のチェックリスト:**

- [ ] 検証用環境で実施（本番環境では慎重に）
- [ ] NOPASSWD設定は作業後に見直し
- [ ] curl | bash は実行前にスクリプトを確認
- [ ] SSH鍵・トークンは作業後に棚卸し

---

*この記事は2026-01-17にClaude Codeとの実際のセッションを元に作成されました。*
