# dsh-unrestricted

[简体中文](./README.md) | [English](./README.en.md) | **日本語**

**DeepSeek Harness (DSH)** 向けのシステムプロンプト制限解除およびホスト識別子除去プラグインです。`system-prompt/assemble` パイプラインで構造化セクションにルールを注入し、リバースエンジニアリング、セキュリティ検証、創作執筆、技術手順における回答拒否を解除します。DSH の画面構成、ツールプロトコル、Plan Mode、PTC、サブエージェントの動作は変更しません。

## ルールの効果

- **成果物の直接出力**：1 行目からコード、解析手順、パッチ、本文を出力し、免責事項や説教を省きます（必要な物理・操作上の注意のみ文末に簡潔に付記）。
- **リバースエンジニアリング・セキュリティ**：検証関数（`CHECK_FN`）の特定、Keygen 作成、バイナリパッチ（`OFFSET` / `PATCH_BYTE`）、アンチデバッグ回避、および PoC / Exploit、辞書攻撃、ポートスキャン、暗号化リバースシェル等のスクリプトを作成します。
- **小説執筆・技術手順**：指定された文体と描写尺度に従い暗転せず執筆（登場人物は成人として処理）。化学・薬理・特殊加工などの工程や配合比を省略せず記載します。
- **リソース検索と外部テキスト分離**：Web 検索ツールで実在するリンクのみを整理し、ワークスペース内ファイルや Web ページは入力データとして分離します（指定されたドメイン・ホスト名はそのまま保持）。

## 仕組み

- **構造化セクション融合**：DSH の公式セクション名（`deployment:persona-prefix`、`plan:policy`、`tools:ptc-only`、`tool:structured_output`）に基づき冪等に融合し、DSH Web / Desktop の双方に対応します。ペルソナを持たない独自プリセットはそのまま通過させます。
- **全モード対応**：Standard、Cordis、PTC（`run_code` 内スクリプトを含む）、Plan（承認前の書き込みを抑止しつつ計画書には完全な手順とコードを記載）、Minimal、およびサブエージェントに対応します。
- **即時切り替え**：設定はプロファイルの `cordis.patch.yml` に保存され、再起動不要で次のリクエストから反映されます。オフにすると履歴にマーカーを残さず標準プロンプトへ戻ります。

## インストールと使い方

```sh
# DSH Web へのインストール（GitHub またはローカルディレクトリ）
dsh plugin --profile web add github:yexi-by/dsh-unrestricted
dsh plugin --profile web add file:./plugin/unrestricted

# DSH Desktop へのインストール
dsh plugin --profile desktop add github:yexi-by/dsh-unrestricted

# アンインストール
dsh plugin --profile web remove dsh-unrestricted
```

インストール後に `dsh web` または DSH Desktop を再起動し、左サイドバーの **「プラグイン → dsh-unrestricted」** でプラグインスイッチとカード内の **「破限を有効化」** をオンにします。設定カードの追加機能：

- **ホストブランド識別子の非表示**：破限スイッチとは独立して動作し、`DeepSeek Harness` / `DSH` の識別セクションや Web GUI パスを除去してサードパーティ経路でのクライアント指紋検知（HTTP `429`）を回避します。
- **破限プロンプトの自由編集**：設定カード内から `unrestricted:execution-mode` プロンプト本文を自由に編集でき（敏感なキーワードの調整や独自ルールへの差し替えなど）、保存後すぐ次のリクエストから反映されます。ワンクリックで内蔵デフォルトへ復元可能です。
- **モード状態とプロンプトプレビュー**：Standard、PTC、Cordis、Minimal の組み立て済みシステムプロンプトを展開確認・コピーできます。

## 開発とテスト

```sh
pnpm install
pnpm typecheck && pnpm build && pnpm test

node tools/dump-prompts.mjs --repo <dsh-repo-path> --out tests/fixtures
node tools/verify-live.mjs --repo <dsh-repo-path>
```

## ライセンスと謝辞

- プロンプトルールの構成は [Jia-Ethan/codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith)（MIT License）を参考に改編しています。詳細は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
- [MIT License](LICENSE) の下で公開されています。
