# 系統規格書

## 1. 架構與外部依賴

純前端靜態架構，無後端伺服器與資料庫。不使用 Google Maps 官方 API，資料流程依賴以下公開端點：

| 服務 | 用途 | 端點 / 機制 |
|---|---|---|
| Domainee API | 短網址展開 | `https://api.domainee.dev/v1/tools/redirect-checker?url={URL}` |
| AllOrigins Proxy | Google 搜尋請求代理 | `https://allorigins.hexlet.app/raw?url={ENCODED_ENDPOINT}` |
| Vela Calibration | 搜尋端點與 protobuf 索引 | 本地 fallback + 遠端 `https://raw.githubusercontent.com/PimpinPumpkin/Vela/main/calibration.json`（快取 TTL 24h） |
| Google Maps Embed | 營業時間缺漏時補抓 | `https://www.google.com/maps?q={QUERY}&output=embed` 經由 AllOrigins |

## 2. 資料模型

```ts
export type Weekday =
  | "星期一"
  | "星期二"
  | "星期三"
  | "星期四"
  | "星期五"
  | "星期六"
  | "星期日";

export interface PlaceInfo {
  sourceUrl: string;
  resolvedUrl?: string;
  originalName: string;      // 優先取自 URL 路徑或 query，避免被 Google 本地化強制翻譯
  googleName?: string;
  rating?: number;           // 0.0 - 5.0
  reviewCount?: number;
  address?: string;          // 已過濾開頭重複店名的乾淨地址
  category?: string;
  priceText?: string;
  qrCode?: string;
  weeklyHours?: Partial<Record<Weekday, string>>;
  lat?: number;
  lng?: number;
  placeId?: string;
  featureId?: string;
}

export interface ShareCardContent {
  placeInfo?: PlaceInfo | null;
  socialId?: string | null;
  qrCode?: string | null;
  hoursText?: string | null;
}

export type ThemeId = "nando" | "koubai" | "konjou" | "kincha";

export interface ShareCardPalette {
  photoPlaceholder: string;
  paper: string;
  primary: string;
  rating: string;
  category: string;
  hours: string;
  secondary: string;
  qr: string;
}
```

卡片渲染時，缺失欄位直接省略，不得產生空白佔位或孤立標點。

## 3. 地點資料取得

1. **網址解析**：
   - 支援完整 Google Maps 網址與短網址（`maps.app.goo.gl` 等）。
   - 店名提取：優先自 `/maps/place/<NAME>/` 解碼，次選 `?q=`。
   - 座標提取：依序匹配 `/@<lat>,<lng>` → `!3d<lat>!4d<lng>` → `?ll=`；缺失時預設 Viewport `(37.7749, -122.4194)`。
2. **搜尋與校準**：
   - 讀取校準檔替換 `{QUERY}`、`{LAT}`、`{LNG}` 組裝 `pb` 參數，範圍限制於目標周邊（1000m）。
   - 驗證校準檔安全性，禁止執行遠端 `transformsJs`。
3. **回應解析**：
   - 去除 XSSI 前綴（`)]}'\n`），依 `cal.paths` 安全取值。
   - 多筆結果排序權重：`placeId` 完全相符 > `featureId` 相符 > 座標距離 > 店名相似度。
   - 營業時間若未滿整週，以店名加座標查詢 `output=embed` 頁面補齊。若非全天營業或特殊狀態，正規化為星期時段字串或「公休」。

## 4. 照片處理

- 支援 JPG、PNG、HEIC、HEIF。
- 透過 `URL.createObjectURL` 預覽，純瀏覽器端處理。
- 讀取 EXIF 修正方向；非 Safari 環境透過 `heic-to` Worker 動態解碼 HEIC/HEIF。
- 操作手勢：單指/滑鼠拖曳平移、雙指/滾輪縮放、鍵盤方向鍵平移與 `+` / `-` 縮放。

## 5. 卡片輸出與排版

### 5.1 尺寸分區
- 輸出格式：原生 Canvas 繪製 **1536 × 1919 PNG**。
- 照片區：`0, 0, 1536, 1229`（固定高度 1229 px）。
- 資訊區：`0, 1229, 1536, 690`（固定高度 690 px）。

### 5.2 資訊座標與規則
- 主正文起始點：`x=128, y=1341`，各欄位垂直固定間距 24 px。
- **店名**：單行，寬度上限 1280 px，上限 24 字。
  - 1–12 字：固定 100 px 字級。
  - 13–24 字：Canvas 測量自適應縮小至可容納之整數字級。
  - >24 字：直接截斷。
- **評分**：字級 50 px，格式 `★ 4.9 · (1,250)`。
- **類別與價格**：字級 42 px，如 `日式燒肉 · ¥3,000–5,000`。
- **營業時間**：字級 40 px。優先顯示平日合併、假日合併或當日選項；「自填」內容留空則隱藏。
- **地址**：字級 38 px，行高 52 px，寬度上限 1032 px，最多 2 行。超過兩行在第二行尾以 `…` 截斷。
- **社群 ID**：字級 42 px，`x=128`，可見文字底部對齊 `y=1862`。
- **QR Code**：
  - 佔位 `288 × 288`（`x=1184`），內部可見模組 `203 × 203`（`x=1226`），無白底板。
  - 垂直位置錨點：
    - 有社群 ID：對齊社群底部（module 底部 `y=1862`，box `y=1617`）。
    - 無社群 ID、有地址：對齊地址滿版槽位（module 底部 `y=1829`，box `y=1584`）。
    - 皆無：上移至基準槽位（module 底部 `y=1777`，box `y=1532`）。
  - 同步規則：自動帶入的 QR 會隨每次抓取的新地圖網址更新；只有非空白的手動輸入才停止同步。手動清空後，下一次抓取恢復自動帶入。
- **色彩套用**：依據當前選用的主題 Palette 繪製紙張底色、文字、標點與 QR Code，實際照片維持原色。

## 6. 本機儲存

- **主題偏好**：Key 為 `placeprint:theme:v1`（`localStorage`）。獨立於店家草稿，首次繪製前讀取套用；點擊「✗清空資料」不重設主題。
- **店家草稿與表單狀態**：儲存於 `localStorage`（含原始網址、各欄位內容、營業時間選項、QR override 狀態、裁切參數）。
- **照片**：原始圖片儲存於 `IndexedDB`。
- 生命週期：重新整理與切換 App 自動還原；下載卡片不清除。點擊「✗清空資料」確認後重置店家草稿與照片。真正重新載入頁面時，以 localStorage 草稿為準，避免瀏覽器把已清除的舊表單內容自動帶回。
