---
name: score
description: おれのClaude — Claude Code設定をスコアリングして評論・称号を生成する。「スコアリングして」「おれのClaude」と言われた場合に使用。
allowed-tools: [mcp__ore-claude__score_my_claude, mcp__ore-claude__build_leaderboard_payload, mcp__ore-claude__submit_to_leaderboard]
---

# おれのClaude スコアリング

以下の手順でスコアリングを実行してください:

1. `score_my_claude` ツールを呼び出して設定をスキャンする
2. 結果を見て、以下を生成する:
   - **称号**: この設定の特徴を表す二つ名（自由に創作、面白く）
   - **評論**: 3-5文。良い点と改善点を含む。毒舌OK、ユーモアあり。設定の中身には触れず、構造と活用度から推察して書く。
   - **設計思想の一貫性スコア** (0-10pt)
   - **独創性スコア** (0-10pt)
3. `build_leaderboard_payload` でペイロードを生成する
4. ユーザーにスコアと評論を見せる
5. ユーザーがリーダーボードへの登録を希望したら:
   - https://ore-claude.seeda.fun でXログインしてリンクトークンを取得するよう案内
   - トークンを受け取ったら `submit_to_leaderboard` で送信
