---
title: "macOS の pbcopy/open を Linux で使う（Wayland 対応）"
emoji: "📋"
type: "tech"
topics: ["linux", "macos", "wayland", "ubuntu", "cli"]
published: false
---

## TL;DR

```bash
# ~/.bashrc に追加
alias pbcopy='wl-copy'
alias pbpaste='wl-paste'
alias open='xdg-open'
```

ただし Wayland 環境では `xclip` ではなく `wl-clipboard` を使う必要がある。

---

## 背景

macOS から Linux に移行すると、手癖で `pbcopy` や `open` を打ってしまう。

```bash
# macOS では当たり前に使える
cat file.txt | pbcopy
open .
```

Linux でも同じ感覚で使いたい。

---

## 環境の確認：X11 か Wayland か

**これが重要。** 最近の Ubuntu（21.04以降）はデフォルトで Wayland を使っている。

```bash
echo $XDG_SESSION_TYPE
# wayland → Wayland 環境
# x11 → X11 環境
```

| 環境 | クリップボードツール |
|------|---------------------|
| X11 | `xclip` または `xsel` |
| Wayland | `wl-clipboard` |

**X11 用の `xclip` を Wayland で使うと、コピーしたはずなのにペーストできない問題が起きる。**

---

## セットアップ

### Wayland 環境の場合

```bash
# wl-clipboard をインストール
sudo apt install wl-clipboard

# ~/.bashrc に追加
cat >> ~/.bashrc << 'EOF'

# macOS-like commands (Wayland)
alias pbcopy='wl-copy'
alias pbpaste='wl-paste'
alias open='xdg-open'
EOF

source ~/.bashrc
```

### X11 環境の場合

```bash
# xclip をインストール
sudo apt install xclip

# ~/.bashrc に追加
cat >> ~/.bashrc << 'EOF'

# macOS-like commands (X11)
alias pbcopy='xclip -selection clipboard'
alias pbpaste='xclip -selection clipboard -o'
alias open='xdg-open'
EOF

source ~/.bashrc
```

---

## 使い方

```bash
# ファイルの内容をコピー
cat file.txt | pbcopy

# コマンド出力をコピー
pwd | pbcopy

# クリップボードの内容を表示
pbpaste

# ファイルマネージャでディレクトリを開く
open .

# デフォルトアプリでファイルを開く
open document.pdf

# ブラウザで URL を開く
open https://example.com
```

---

## トラブルシューティング

### 「pbcopy したのに Ctrl+V でペーストできない」

**ターミナル内では Ctrl+V ではなく Ctrl+Shift+V を使う。**

| 操作 | GUI アプリ | ターミナル |
|------|-----------|-----------|
| ペースト | Ctrl+V | **Ctrl+Shift+V** |
| コピー | Ctrl+C | Ctrl+Shift+C |

Ctrl+V はターミナルでは「リテラル入力」として解釈されることが多い。

### 「Wayland なのに xclip を設定してしまった」

XWayland（X11 互換レイヤー）が動いていれば、xclip も一応動く。

```bash
echo $DISPLAY
# :0 などが表示されれば XWayland は動いている
```

ただし、Wayland ネイティブアプリ（GNOME アプリ、Firefox など）とのクリップボード共有が不安定になることがある。素直に `wl-clipboard` に切り替えるのがおすすめ。

### 「どのアプリが Wayland ネイティブか分からない」

```bash
# XWayland で動いているアプリ一覧
xlsclients
```

このコマンドに表示されないアプリは Wayland ネイティブ。

代表例：
- **Wayland ネイティブ**: GNOME アプリ全般、Firefox、LibreOffice
- **XWayland**: Chrome（デフォルト）、古い GTK2 アプリ、Wine アプリ

---

## まとめ

1. まず `echo $XDG_SESSION_TYPE` で環境を確認
2. Wayland なら `wl-clipboard`、X11 なら `xclip`
3. ターミナルでのペーストは Ctrl+Shift+V

これで Mac と同じ手癖のまま Linux を使える。
