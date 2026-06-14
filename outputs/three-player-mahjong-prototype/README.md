# 3人麻雀プロトタイプ

独自ルールの3人麻雀をブラウザで確認するためのTypeScriptベースのプロトタイプです。
ゲームロジック、ルール、点数計算、UIを分離し、あとからルールを差し替えやすい構造にしています。

## 実行方法

`index.html` をブラウザで開くと動作確認できます。
現在はビルドなしで確認できるように、`runtime/app.js` にブラウザ実行用コードを同梱しています。

## 構成

```text
three-player-mahjong-prototype/
  index.html
  styles.css
  runtime/app.js
  public/tiles/          # AI生成ベースから作成した牌画像
  src/
    application/         # ゲーム進行
    domain/              # GameState / Player / Tile
    nuki-dora/           # 華牌の抜きドラ処理
    pochi/               # 白ぽっち専用処理
    rules/               # RuleEngine
    scoring/             # 独自点数計算
    ui/                  # TileView / GameView
    online/              # Repository / Supabase同期 / オンライン移行層
  supabase/schema.sql    # Supabase Postgres用スキーマ
```

## オンライン移行

オンライン対戦用の土台として、`src/online/` にRepository interface、LocalStorage実装、Supabase実装、GameAction/turnVersion管理を追加しています。

環境変数は `.env.example` をコピーして設定します。

```txt
VITE_REPOSITORY_BACKEND=local
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Supabaseで動かす場合は `supabase/schema.sql` をSupabase SQL editorで実行し、`VITE_REPOSITORY_BACKEND=supabase` に変更してください。

未決定仕様とデプロイ手順は `ONLINE_TODO.md` にまとめています。

## 現在の主な仕様

- 開始点は全員 `0点` です。
- 支払いはそのまま加減算されるため、8点放銃すれば `-8点` になります。
- 初期プレイヤーは `自分: human`、`CPU1: cpu`、`CPU2: cpu` です。
- CPUは暫定戦略として必ずツモ切りします。
- 場風は常に東場です。
- 次局の親は和了者になります。
- 通常山はツモりきりです。
- 嶺上牌は8枚、ドラ表示牌1枚、裏ドラ表示牌1枚を通常山から分離します。

## 華牌と自動抜き

華牌は通常の手牌構成には使わず、抜きドラとして扱います。

- 配牌直後に全員分を一括では抜きません。
- 自分の手番が始まった瞬間に、そのプレイヤーの手牌またはツモ牌にある華牌を自動で抜きます。
- 抜いた華牌は `Player.nukiDoraTiles` に移動します。
- 補充は通常山ではなく `GameState.rinshanWall` から行います。
- 補充牌が華牌なら、同じ手番開始処理の中で続けて抜きます。
- 華牌を抜いてもリーチや一発状態は維持する前提です。
- 和了時は抜いた華牌1枚につきドラ1として加算します。

関連関数:

```ts
canNukiDora(gameState, playerId)
performNukiDora(gameState, playerId, tileId)
autoNukiDora(gameState, playerId)
```

## 捨て牌

捨て牌は `DiscardedTile` として管理します。

```ts
type DiscardType = "tedashi" | "tsumogiri";

interface DiscardedTile {
  tile: Tile;
  discardType: DiscardType;
  turnIndex: number;
}
```

UIには `isTsumogiri` として渡し、`.tile.tsumogiri` で薄く表示できるようにしています。

## CPU対戦

CPU処理は `src/cpu/` に分離しています。

- `CpuStrategy`: CPU戦略インターフェース
- `TsumogiriCpuStrategy`: 現在の暫定戦略。`drawnTile.id` を必ず返します。
- `processCpuTurn`: CPUの1手番を進める関数

人間が打牌したあと、現在プレイヤーがCPUならCPU手番を自動で進めます。
CPUが2人続く場合は2人分を順に処理し、人間の手番で停止します。

手番開始時には人間・CPUを問わず自動で通常ツモします。
人間はツモ済みの状態で切る牌を選び、CPUはツモ済みの `drawnTile` を必ずツモ切りします。
手牌とツモ牌の合計が対局中に13枚未満または15枚以上にならないよう、進行処理内で枚数検査を行います。

CPUの手牌とツモ牌は対局中は裏向き表示です。
CPUの捨て牌、抜きドラ、点数は表向きで見えます。

## 牌譜

局単位の牌譜は `GameState.handLog` に保存します。

- 初期手牌
- 初期ドラ
- 初期点
- ツモ
- 打牌
- 抜きドラ
- ドラ表示
- 和了
- 流局

などを記録します。

牌譜表示は `HandLogViewer` に分離しています。
対局中はCPU手牌を隠しますが、牌譜には完全情報を保存し、レビューで初期手牌やツモ牌を確認できます。

## 牌画像

`public/tiles/` に牌画像を配置しています。
現在は `C:\Users\h1320\OneDrive\Desktop\麻雀牌\` の画像を、ゲーム内の牌名に対応する `public/tiles/*.png` へコピーして使用しています。

画像パスはUIに直書きせず、`getTileImagePath(tile)` で取得します。
画像が読み込めない場合は `TileView` がテキスト表示へフォールバックします。

CPU手牌などの裏向き牌は `tile_back.png` を参照し、指定フォルダ内の `背中黄色.PNG` を使用します。

## 点数計算

点数計算は一般的な麻雀の符計算を使わず、`src/scoring/ScoreTables.ts` の独自テーブルを参照します。
ロンは放銃者が全額支払い、ツモは他家2人が同額を支払います。

## 牌構成

総牌数は112枚です。

- 萬子: 1萬 x4、9萬 x4
- 筒子: 1〜9筒 各4枚
- 索子: 1〜9索 各4枚
- 字牌: 東、南、西、北、白、發、中 各4枚
- 華牌: 華 x4

5筒、5索は `黒黒金青` の構成です。
白4枚はすべて白ぽっちで、赤・黄・緑・青の4種類です。
