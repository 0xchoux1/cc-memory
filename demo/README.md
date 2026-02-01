# cc-memory Demo GIF Recording

README用のデモGIFを作成するための準備ファイル。

## 必要なツール

### vhs (推奨)
Charmbracelet製のターミナル録画ツール。GIF出力が可能。

**インストール方法 (Ubuntu/Debian):**

```bash
# 方法1: Charm リポジトリから (推奨)
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg
echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" | sudo tee /etc/apt/sources.list.d/charm.list
sudo apt update && sudo apt install vhs ffmpeg

# ttyd は別途インストール (vhsの依存)
# https://github.com/tsl0922/ttyd/releases から最新版をダウンロード

# 方法2: Go でインストール
go install github.com/charmbracelet/vhs@latest
# 依存: ffmpeg と ttyd も必要
sudo apt install ffmpeg
# ttyd は上記リンクから
```

### asciinema (代替)

```bash
sudo apt install asciinema
# GIFへの変換には agg が必要
# https://github.com/asciinema/agg
```

## 録画シナリオ

### demo.tape (vhs用)
約30秒のデモ:
1. `cc-memory help` - ヘルプ表示
2. `cc-memory setup --dry-run` - セットアップのプレビュー
3. `cc-memory doctor` - インストール診断
4. `cc-memory status` - 現在のステータス表示

### 実行方法

```bash
# vhs で録画
vhs demo/demo.tape

# 出力: demo/cc-memory-demo.gif
```

## asciinema + agg を使う場合

### 録画スクリプト

```bash
#!/bin/bash
# demo/record-asciinema.sh

asciinema rec demo/demo.cast --command "bash demo/demo-script.sh" --overwrite

# GIFに変換 (agg が必要)
# agg demo/demo.cast demo/cc-memory-demo.gif
```

### シナリオスクリプト

```bash
#!/bin/bash
# demo/demo-script.sh

echo "$ cc-memory help"
sleep 0.5
cc-memory help
sleep 2

echo ""
echo "$ cc-memory setup --dry-run"
sleep 0.5
cc-memory setup --dry-run
sleep 2

echo ""
echo "$ cc-memory doctor"
sleep 0.5
cc-memory doctor
sleep 2

echo ""
echo "$ cc-memory status"
sleep 0.5
cc-memory status
sleep 1
```

## GIF最適化

生成されたGIFが大きすぎる場合:

```bash
# gifsicle でサイズ削減
gifsicle -O3 --colors 256 demo/cc-memory-demo.gif -o demo/cc-memory-demo-optimized.gif
```

## READMEへの埋め込み

```markdown
![cc-memory Demo](demo/cc-memory-demo.gif)
```

または GitHub のリリースにアップロードして:

```markdown
![cc-memory Demo](https://github.com/0xchoux1/cc-memory/releases/download/v1.0.0/demo.gif)
```
