# オンライン対局同期 SQL 実行手順

Supabase SQL Editorで、まず通常の `schema.sql` とロビー系パッチを実行したうえで、以下を順番に実行してください。

```txt
online_game_sync_01_ensure_game.sql
online_game_sync_02_action_types.sql
online_game_sync_03_state_reducer.sql
```

## 追加されること

`online_game_sync_01_ensure_game.sql`

- 卓からアクティブな `game_states` を作成または取得します。
- 3席が埋まっていない場合は開始しません。

`online_game_sync_02_action_types.sql`

- `draw`
- `discard`
- `ron`
- `tsumo`
- `pon`
- `kan`
- `riichi`
- `skip`
- `flower`
- `nukiDora`

を `game_events` に保存できるようにします。

`online_game_sync_03_state_reducer.sql`

- `submit_game_action` を差し替えます。
- イベント保存後に `game_states.version` を進めます。
- `game_states.state.actionLog` にイベントを追記します。
- `discard` の場合は席ごとの河を更新し、次手番へ進めます。
- `ron` / `tsumo` の場合は結果フェーズを保存します。

## ブラウザ側

`online-debug/index.html` で卓の3席を埋めてから `デバッグ対局開始` を押すと、同じ画面内の `オンライン同期対局` パネルが開きます。

このパネルで `打牌` や `ツモ` などを押すと、Supabaseの `game_events` にイベントが保存され、`game_states` が更新されます。

別ブラウザ・別端末で同じ卓URLを開くと、短周期ポーリングで同じ `version`・河・イベントログを確認できます。

## 今後のTODO

- 短周期ポーリングを Supabase Realtime channel へ置き換える
- 牌山・手牌・合法手判定をDBまたはゲーム進行サーバー側へ移す
- pendingActionの期限・優先順位・同時ロン処理をサーバー管理にする
- プレイヤー別ViewStateを生成し、他家手牌を必ず隠す
- game_eventsから正式な牌譜を生成する
