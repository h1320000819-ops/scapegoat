# オンライン対戦 TODO

## 実装済みの土台

- Repository interfaceを追加。
- LocalStorage実装とSupabase実装を切り替え可能にするFactoryを追加。
- Supabase client作成処理を追加。
- Supabase SQL schemaを追加。
- GameStateに`version`を追加。
- 操作を`GameAction`として送信する型を追加。
- `turnVersion`不一致の操作を拒否する検証関数を追加。

## 未決定仕様

### 切断時の扱い

現在案:

- プレイヤーが落ちたらオートツモ切り。
- 一定時間戻らなければラス半扱いにするかは未決定。

### 再接続

現在案:

- 対局途中の新規途中参加は不可。
- 元の着席プレイヤーは再接続可。
- 局や半荘が終わり、ラス半プレイヤーがいた時のみ新規参加可。

### 観戦

現在案:

- 観戦者を許可する。
- 観戦ViewStateでは全手牌非公開。
- 牌譜公開タイミングは未決定。

### 同時ロン

現在案:

- 3人麻雀でダブロンを許可する。
- 複数ロン時の親移動、供託なしルールでの結果表示は追加仕様が必要。

### ポイント精算タイミング

現在案:

- アンミカロケット: 局終了ごと。
- 四人麻雀など: 半荘終了後。
- ゲーム種別ごとの`settlementTiming`設定を追加予定。

### 不正操作対策

必要:

- GameActionはサーバー側またはEdge Functionで合法手検証。
- `turnVersion`不一致は拒否。
- 同一プレイヤー・同一turnVersion・同一actionTypeの二重送信を拒否。
- 牌の所有権、フリテン、リーチ制約、鳴き優先順位を検証。

### レート上限

現在案:

- UIは0.1〜10.0ポイント。
- クラブ管理者が上限を設定できるかは未決定。

### クラブ管理画面

必要:

- 申請一覧
- 承認/拒否
- メンバー権限変更
- ポイント付与/回収
- レーキログ確認

### 卓の最大保持数

現在案:

- 1クラブ100卓まで。
- ended卓の自動アーカイブ条件は未決定。

## デプロイ手順

1. Supabase projectを作成。
2. `supabase/schema.sql`をSQL editorで実行。
3. `.env`を作成。

```txt
VITE_REPOSITORY_BACKEND=supabase
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

4. `npm install`で`@supabase/supabase-js`を入れる。
5. VercelまたはNetlifyにデプロイし、同じ環境変数を設定。
6. 別ブラウザ/別端末で`/table/:tableId`を開き、着席同期とRealtime購読を確認。

## 今後必要な権威サーバー

Supabase Realtimeだけでも状態同期は可能ですが、麻雀の合法手検証をクライアント任せにすると不正操作に弱くなります。

推奨:

- 初期段階: Supabase RPC / Edge FunctionでAction検証。
- 本格運用: Node.js + WebSocketでGameActionを受け、権威GameStateを更新。
