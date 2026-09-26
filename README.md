# Hitorigoto（ひとりごと）

Chrome 内蔵のオンデバイス AI（Prompt API / Gemini Nano）だけで動く、**サーバーを持たない**チャット Web アプリです。
入力も履歴も添付画像も端末の外に出ません。それを方針ではなく、ブラウザが強制する仕組み（CSP）で保証します。

設計の詳細は [`docs/Hitorigoto 仕様書.md`](docs/Hitorigoto%20仕様書.md)、開発者向けの構成メモは [`CLAUDE.md`](CLAUDE.md) にあります。

## 特徴

- **送信ゼロ**: `connect-src 'self'` の CSP で外部通信をブラウザが拒否します。クラウド LLM へのフォールバックも、分析タグも、CDN も使いません。アプリ内の「送信 0」から、ヘッダーの確認と接続テスト、DevTools での確かめ方を見られます。
- **アカウント不要・従量課金なし・オフライン動作**（モデルのダウンロード後）。PWA として静的ファイルだけをキャッシュします。
- **チャット**: ストリーミング、停止・再生成、画像の添付、一時チャット（保存しない）、複数案の比較（温度違いで並べて比較）、日本語 / 英語。
- **履歴**: IndexedDB に保存（旧 localStorage からは初回に自動移行）。検索、ピン留め、名前変更、複数選択削除と「元に戻す」、JSON / Markdown の書き出し、読み込み（マージ / 別名保存）、使用量メーター。
- **長い会話**: コンテキスト使用量のゲージ。上限に近づくと古い発言を自動で要約し、「要約 + 直近の発言」で会話を続けます。
- **初回ガイド**: アプリの説明、初回のモデル設定・ダウンロード、使い方、履歴の仕組みを、ヘッダーの「使い方」から読めます。

## 動作要件

デスクトップ版 Chrome 148 以上（Windows 10/11、macOS 13 以降、Linux、Chromebook Plus）。Android・iOS は非対応です。

| 項目 | 要件 |
| --- | --- |
| 空き容量 | Chrome プロファイルのあるドライブに 22GB 以上（ダウンロード後に 10GB を下回るとモデルは削除されます） |
| GPU | VRAM が 4GB 超（GPU がない場合は RAM 16GB 以上かつ 4 コア以上） |
| 回線 | 従量制でない接続（通信が必要なのは初回のモデルダウンロード時のみ） |
| 言語 | 英語・スペイン語・日本語・ドイツ語・フランス語 |

初回はアプリの画面で「モデルをダウンロード」を押します（ダウンロードの開始にはユーザー操作が必要です）。詳しくはアプリ内の「使い方」を参照してください。

## 開発

Node.js 20.19 以上が必要です（Cloudflare Pages 用に `.node-version` で 22 を指定しています）。

```sh
npm ci
npm run dev        # 開発サーバー
npm run build      # 型チェック + dist/ への静的ビルド
npm test           # ユニットテスト（vitest）
npm run verify:network   # ビルド後に実行: 送信ゼロと主要な UI の一括検証（要 Chrome）
```

`npm run verify:network` は `dist/` を CSP 付きで配信し、`LanguageModel` を差し替えた状態でヘッドレス Chrome を操作します。外部への通信・CSP 違反・ページエラー・UI の不具合があると失敗します。Chrome が標準の場所にない場合は環境変数 `CHROME_PATH` で指定してください。開発サーバー（`npm run dev`）では `_headers` の CSP は適用されません。

### 技術スタック

Vite + React + TypeScript、Tailwind CSS v4、[assistant-ui](https://github.com/assistant-ui/assistant-ui)（チャット UI）、[Streamdown](https://streamdown.ai/)（Markdown 描画）。バックエンドはありません。

依存を追加するときは、実行時に外部へ通信しないことを確認し（`npm audit` と `npm run verify:network`）、`CLAUDE.md` の「Dependency findings」を更新してください。

## デプロイ（Cloudflare Pages）

静的ファイルだけを配信します（Functions、KV、D1 は使いません）。

| 設定 | 値 |
| --- | --- |
| フレームワーク プリセット | なし（None） |
| ビルド コマンド | `npm run build` |
| ビルド出力ディレクトリ | `dist` |
| Node.js のバージョン | `.node-version` で 22 を指定済み |

- `public/_headers` が CSP などのセキュリティヘッダーと、`sw.js` / マニフェストのキャッシュ設定を定義します。**ビルド出力に含まれることを確認してください。**
- Cloudflare の Web Analytics は有効にしないでください（外部スクリプトを注入し、CSP の保証が崩れます）。
- 履歴はオリジン（URL）ごとに保存されます。公開 URL を変えると、以前の履歴は見えなくなります。移行するときはアプリの書き出し / 読み込みを使ってください。
- 公開後は、公開 URL で「使い方」→「送信ゼロの検証」を開き、CSP が表示され、接続テストがブロックされることを確認してください。

## ライセンス

未設定です。
