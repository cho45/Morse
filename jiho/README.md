# jiho/generate.js について

VOICEVOX ENGINE OSS の API を使って、時報用の音声ファイルを自動生成するスクリプトです。

## 機能
- 時・分・固定文言の音声合成用クエリ生成
- クエリをもとに音声ファイル（WAV）を一括生成（並列実行対応）
- 利用可能な話者（speaker）の一覧表示

## 使い方

### 1. クエリ生成
```
node generate.js query
```
- 24時分＋60分＋固定文言分のクエリを `jiho_queries.json` に保存します。
- 固定文言はスクリプト内 `FIXED_PHRASES` で編集できます。

### 2. 音声ファイル生成（合成）
```
node generate.js synth [並列数]
```
- `jiho_queries.json` をもとに、`jiho_audio/` ディレクトリへWAVファイルを保存します。
- 並列数は省略時4、例: `node generate.js synth 8` で8並列。
- 既存ファイルはスキップされます。

### 3. speaker 一覧の表示
```
node generate.js list-speakers
```
- 利用可能な話者IDと名前を一覧表示します。

## 注意
- Node.js v18以降（fetch API対応）が必要です。
- VOICEVOX ENGINE OSS サーバーが起動している必要があります。
- `VOICEVOX_API_BASE` や `VOICEVOX_SPEAKER` 環境変数でAPIエンドポイントや話者IDを指定できます。

---

スクリプトの詳細やカスタマイズは `generate.js` を参照してください。
