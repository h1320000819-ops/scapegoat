# 別端末からのアクセス

## 同じWi-Fi内で確認する場合

`localhost` と `127.0.0.1` は、その端末自身を指します。
スマホや別PCから、このPC上の開発サーバーを見る場合はLAN内IPを使います。

例:

```txt
http://192.168.x.x:5173/online-debug
```

PCとスマホを同じWi-Fiに接続してください。

## 同じWi-Fi以外から確認する場合

LAN内IPでは外部ネットワークからアクセスできません。
Render / Railway などに公開デプロイして、次のようなURLを使ってください。

```txt
https://anmika-rocket-online.onrender.com/online-debug
```

このプロジェクトは `static-server.mjs` がフロント画面とSocket.IOゲームサーバーを同じHTTPサーバーで動かします。
公開デプロイでは、フロントとゲームサーバーを同じURLで動かす構成が一番簡単です。
