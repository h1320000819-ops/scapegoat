# Node.js + Socket.IO 対局サーバー

アンミカロケットのオンライン対局中の `GameState` は、SupabaseではなくNode.js + Socket.IOサーバーのメモリ上を正とします。

## 役割分担

- Supabase: アカウント、クラブ、クラブポイント、レーキ、牌譜
- Node.js + Socket.IO: 対局中のGameState、打牌、ツモ、ロン、ポン、カン、リーチ、スキップ、華牌抜き
- クライアント: 操作イベントを送信し、サーバーから配信されたGameStateを描画

クライアントはSocket.IO対局中にGameStateを直接確定更新しません。操作は `game:action` としてサーバーへ送り、サーバーだけがGameStateを書き換えて全員へ `game:state` を配信します。

初期局面もクライアントでは作りません。クライアントは席順、プレイヤー、ルール設定だけを送り、サーバーが1つの牌山、3人分の手牌、ドラ表示牌、裏ドラ表示牌、嶺上牌を生成します。3人のプレイヤーはこの同じサーバー局面を共有して打牌します。

## 起動

プロジェクトのルートで、フロントエンドとゲームサーバーをまとめて起動できます。

```bash
npm run dev:online
```

別々に起動したい場合は、2つのターミナルで以下を実行してください。

```bash
npm run dev
npm run game-server
```

フロント:

```txt
http://127.0.0.1:5173
```

ゲームサーバー:

```txt
http://127.0.0.1:8787
```

別端末で確認する場合は、PCと端末を同じWi-Fiに接続し、localhostではなくLAN内IPを使ってください。

```txt
http://192.168.x.x:5173
http://192.168.x.x:8787
```

## Socket.IOイベント

クライアントから送るイベント:

- `game:join`
- `game:initState`
- `game:action`
- `game:requestState`

サーバーから届くイベント:

- `game:state`
- `game:event`
- `game:needInitialState`

## 実装済みのサーバー処理

サーバー側で以下の操作をGameStateへ反映します。

- 打牌
- ツモ
- リーチ
- スキップ
- 華牌抜き
- カン
- ポン
- ロン
- ツモ和了

CPU席はデバッグ用として、サーバー側で強制ツモ切りします。

## 今後の強化予定

- サーバー側で全役判定と点数計算を完全に検証する
- pendingActionの期限と優先順位をサーバーで厳密管理する
- 切断、再接続、観戦をSocket.IO側で管理する
- 終局時にSupabaseへ牌譜と精算結果を保存する
