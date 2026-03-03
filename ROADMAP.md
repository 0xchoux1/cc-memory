# ROADMAP

## Now (next up)
- [ ] session_recall のパフォーマンス最適化 — 大量セッション時のインデックス速度改善
- [ ] session_recall の project_path フィルタ — 特定プロジェクトのセッションのみ検索

## Next
- [ ] メモリの重要度スコアリング — recall 結果のランキング改善
- [ ] CLI に `session-stats` コマンド追加 — インデックス済みセッション数・チャンク数の表示
- [ ] `memory_curate` の自動スケジュール提案 — stale メモリの定期クリーンアップ

## Later
- [ ] メモリのエクスポート/インポート — JSON 形式でのバックアップ・復元
- [ ] session_recall + memory_recall の統合検索 — 短期・長期記憶を横断検索
- [ ] メモリの関連性グラフ — タグベースのメモリ間リンク

## Done
- [x] v3.2.0 — session_recall（短期記憶）
- [x] v3.1.0 — embedding support, options object refactor
- [x] v3.0.0 — memory_curate, hybrid semantic search
- [x] v2.1.1 — 初期リリース（v2 アーキテクチャ）
