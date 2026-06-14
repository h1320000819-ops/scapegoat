# Renderで外部公開する手順

デバッグ段階で別Wi-Fiやスマホ回線から確認したい場合は、まずRenderにこのフォルダをWeb Serviceとして置くのが簡単です。

## 1. GitHubへ置く

RenderはGitHubリポジトリからデプロイするのが基本です。
このプロジェクトの `outputs/three-player-mahjong-prototype` フォルダを含むリポジトリをGitHubへpushしてください。

## 2. RenderでWeb Service作成

Renderで「New Web Service」を選び、GitHubリポジトリを接続します。

設定:

```txt
Root Directory: outputs/three-player-mahjong-prototype
Build Command: npm install
Start Command: npm start
```

このフォルダには `render.yaml` も置いてあります。Blueprintとして読み込む場合も同じ内容です。

## 3. 環境変数

RenderのEnvironmentに以下を設定してください。

```txt
VITE_REPOSITORY_BACKEND=supabase
VITE_SUPABASE_URL=https://zotqxmnvtaxbduwphjjo.supabase.co
VITE_SUPABASE_ANON_KEY=Supabaseのanon public key
NODE_VERSION=20
```

`service_role` や `secret key` は絶対に入れないでください。

## 4. Supabase側の許可URL

Supabase Dashboardで、公開されたRender URLを許可します。

場所:

```txt
Authentication
→ URL Configuration
```

設定例:

```txt
Site URL:
https://あなたのサービス名.onrender.com

Redirect URLs:
https://あなたのサービス名.onrender.com/**
```

## 5. 動作確認

公開URLで以下を開きます。

```txt
https://あなたのサービス名.onrender.com/online-debug
```

確認すること:

```txt
アカウント作成
ログイン
クラブ選択
卓作成
3人着席
麻雀画面へ遷移
別ブラウザ・別端末で同じ局面を見る
```

## 注意

Render無料枠は一定時間アクセスがないとスリープします。
最初のアクセスが遅いことがあります。
