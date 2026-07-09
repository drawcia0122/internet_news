# DEVELOPMENT RULES

## 1. 基本方針

このリポジトリでは、実装前に必ず docs 配下の仕様書を確認する。

Codexは勝手に仕様を変更してはいけない。

不明点がある場合は、実装前に確認事項として報告する。

## 2. 作業範囲

各タスクでは、指定された範囲以外のファイルを変更しない。

特に以下は明示指示がない限り変更しない。

- package.json
- package-lock.json
- vite.config.*
- next.config.*
- src 配下の実装コード
- public 配下の既存アセット
- scripts 配下の既存処理
- データ取得処理
- AI要約処理
- デプロイ設定
- GitHub Actions

## 3. PR単位

1つのPRは1つの目的に限定する。

複数の目的を混ぜない。

例：

- docs追加
- PROJECT.md作成
- AI要約改善
- 急上昇ワード改善
- UI改善

## 4. 変更前確認

実装前に以下を確認する。

- 目的
- 対象ファイル
- 変更内容
- 影響範囲
- テスト方法

## 5. 既存機能保護

既存のINTERNET NEWSは現在も利用価値があるため、破壊的変更を避ける。

新機能や大幅な変更は、既存機能を壊さない形で追加する。

## 6. Classic / Next 方針

現行のINTERNET NEWSは Classic として扱う。

完全版のINTERNET NEWSは Next として `/next/` に独立ページとして追加する。

Classic の `index.html` / `styles.css` / `app.js` は原則変更しない。

Next は `next/index.html` / `next/styles.css` / `next/app.js` として分離する。

初期段階では、Next は既存の data JSON を読むだけにする。

明示指示がない限り、Next 追加のために scripts / GitHub Actions / data生成処理は変更しない。

将来的に Next が十分良くなった場合、CEO判断により `/` への昇格を検討する。

## 7. 報告

作業後は以下を報告する。

- 作成・変更したファイル
- 変更内容
- 既存コードに変更がないこと
- 次に実施すべきタスク
