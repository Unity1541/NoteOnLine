# Firebase 設定指南 (現代化版本)

本指南將引導您完成設定 Firebase 專案的所有必要步驟，確保應用程式（包括使用者和管理員介面）能夠正確且安全地運行。

---

## 🚀 應用程式入口

本專案包含兩個獨立的網頁入口：
*   `index.html`: **一般使用者** 的行事曆介面。
*   `admin.html`: **管理者** 專用的後台儀表板。

---

## 1. 建立 Firebase 專案

1.  前往 [Firebase 控制台](https://console.firebase.google.com/)。
2.  點擊 **「新增專案」**，並依照畫面指示完成專案建立。

---

## 2. 取得 Firebase 設定金鑰

您的網頁應用程式需要這個金鑰來與 Firebase 後端服務進行通訊。

1.  在您的專案主控台中，點擊左上角的齒輪圖示 ⚙️，選擇 **「專案設定」**。
2.  在「一般」分頁下方，捲動到「您的應用程式」區塊。
3.  點擊網頁圖示 `</>` 來註冊一個新的網頁應用程式。
4.  為您的應用程式取一個暱稱 (例如 `Weekly Planner`)，然後點擊 **「註冊應用程式」**。
5.  Firebase 將會提供一個 `firebaseConfig` 物件。**複製**這個完整的 JavaScript 物件。
6.  打開您專案中的 `public/js/firebase.js` 檔案，並用您剛剛複製的 `firebaseConfig` 物件**取代**檔案中既有的預留位置內容。

---

## 3. 啟用 Firebase 服務 & 建立帳號

### 3.1 啟用 Authentication

1.  在 Firebase 控制台左側導覽列，前往 **Authentication**。
2.  點擊 **「開始使用」**。
3.  在「登入方法」分頁中，選擇 **「電子郵件/密碼」** 並將其**啟用**。

### 3.2 建立使用者與管理員帳號

1.  切換到「使用者」分頁。
2.  點擊 **「新增使用者」** 來建立您要使用的帳號。
3.  **關鍵步驟**: 請務必建立一個您將要指定為**管理員**的帳號。這個帳號的 Email 必須與您在 `public/js/admin.js` 檔案中 `ADMIN_CONFIG` 物件內設定的 `email` 完全一致 (預設為 `admin@hotmail.com`)。

---

## 4. 🔒 設定 Firestore 安全規則

這是確保資料安全、解決 `permission-denied` 錯誤的**最重要步驟**。

1.  在 Firebase 控制台左側導覽列，前往 **Firestore Database**。
2.  如果尚未建立資料庫，請點擊「建立資料庫」並以**測試模式**開始。
3.  前往 **「規則」** 分頁。
4.  將編輯器中的所有內容**刪除**，然後**貼上以下全新的規則**：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 函數：檢查當前登入的使用者是否為管理員
    function isAdmin() {
      // 重要：請將 'admin@hotmail.com' 替換為您在 admin.js 中設定的管理員信箱
      return request.auth.token.email == 'admin@hotmail.com';
    }

    // 規則：針對 events 集合中的每一個文件
    match /events/{eventId} {
      
      // 函數：檢查當前登入的使用者是否為該事件的擁有者
      function isOwner() {
        return request.auth.uid == resource.data.uid;
      }

      // 讀取權限 (Read):
      // - 管理員可以讀取所有事件。
      // - 一般用戶只能讀取自己的事件。
      allow read: if isAdmin() || isOwner();
      
      // 寫入權限 (Write - Create, Update, Delete):
      // - 創建 (Create): 任何已登入的用戶都可以創建事件。
      // - 更新 (Update): 只有事件的擁有者可以更新自己的事件。管理員也可以更新 (方便後台修正)。
      // - 刪除 (Delete): 管理員或事件擁有者可以刪除事件。
      allow write: if (request.method == 'create' && request.auth != null)
                   || (request.method == 'update' && (isOwner() || isAdmin()))
                   || (request.method == 'delete' && (isOwner() || isAdmin()));
    }
  }
}
```

5.  **重要：** 再次確認規則中的 `admin@hotmail.com` 與您在 `admin.js` 中設定的管理員郵箱**完全相同**。
6.  點擊 **「發佈」** 來儲存並啟用新的安全規則。

---

## 5. 管理員儀表板功能

設定完成後，您可以用管理員帳號登入 `admin.html`，您將會看到：

*   **本週使用者進度圖表**: 一個條形圖，顯示本週所有使用者的事件完成度百分比。
*   **管理所有使用者事件**: 一個列表，顯示資料庫中所有的事件，您可以從這裡直接編輯或刪除任何使用者的事件。
*   **行事曆與編輯表單**: 管理員可以查看所有事件在行事曆上的分佈，並點擊列表中的項目來進行編輯。

---

設定完成！您的應用程式現在已經準備就緒，並且擁有安全的資料存取權限。