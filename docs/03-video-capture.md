# 03 映像取り込みモジュール（OBS仮想カメラ）

## 概要

OBSバーチャルカメラを偽カメラとして `getUserMedia` で受け取り、`<video>` にプレビューする。**差し替え可能な1モジュール**として抽象化し、将来 `getDisplayMedia`（画面共有）方式も足せるようにする。クライアント専用。

関連: `REQUIREMENTS.md §6.1, §10` / 依存: 01

## Todo

- [×] 映像ソース抽象 `VideoSource` インターフェース（`start()`・`stop()`・`getStream()`）を定義（`src/lib/video/types.ts`）
- [×] `getUserMedia` 実装 `src/lib/video/userMediaSource.ts`（将来 `getDisplayMedia` 実装を並列で足せる形）
- [×] デバイス一覧を列挙し "OBS Virtual Camera" を選択する UI（`enumerateDevices`／`listVideoInputDevices`）
- [×] `<video>` プレビューコンポーネント `src/components/VideoPreview.tsx`（`'use client'`）
- [×] 権限拒否・デバイス未検出・ストリーム切断のエラー表示（`VideoSourceError.kind` で出し分け＋トラック `ended` 監視）
- [×] 選択デバイスの記憶（localStorage `tomoni.videoDeviceId`）

## 完了条件

- OBS仮想カメラを選んでプレビューが表示される。
- ソース実装が抽象越しに差し替え可能になっている。

## 注意

- `getUserMedia`/`enumerateDevices` はクライアント専用。
- 物理カメラは不要（OBSの画面を横流しする偽カメラ）。
- 動作確認は暫定ページ `src/app/capture-test/page.tsx`（`/capture-test`）で行う。これは ticket 10（セッション画面統合）で本UIに置き換える前提の確認用ハーネス。
