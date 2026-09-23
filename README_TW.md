# 地標拍立得 Placeprint

可以透過Google Map連結，簡單將照片配上地點標示的工具。

**[English](README.md)**

---

點擊加入照片後，可以透過手指、滑鼠的拖拉、縮放來調整照片。

店家資訊提供自動從Google Map連結抽取的功能，若有想修改或是有缺少的資訊也可以手動修正。
所有欄位都會自適應動態排版，以及額外提供可以放上自己社群ID的欄位。

編輯器最下方有一鍵清除所有資料重來的按鈕。

---

詳細規格請見 [docs/spec.md](docs/spec.md)。

---

## 開發

環境需求：Node.js >= 20.19.0

```bash
npm ci
npm run dev       # 啟動開發伺服器
npm test          # 執行測試
npm run typecheck # 型別檢查
npm run build     # 生產建置
```

首次發布請至倉庫 Settings → Pages 將 Source 改為 GitHub Actions，之後推送到 main 分支或手動執行 workflow 即可部署。完成設定與部署前上述預計網址暫時無法連線。

---

## 授權與致謝

Placeprint 採用 GNU GPLv3 授權條款釋出，詳見 [`LICENSE`](LICENSE)。

地點搜尋與座標校正邏輯改寫自 [Vela](https://github.com/PimpinPumpkin/Vela)。
詳細版權聲明請見 [`NOTICE`](NOTICE)。
