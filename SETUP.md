# Cài SoWork Keepalive cho người mới (nhanh)

Mỗi người cần **phiên đăng nhập SoWork riêng** (SoWork chỉ cho 1 kết nối/tài khoản — không dùng chung).
Người mới chạy trên **repo GitHub của chính họ**; phần Slack thì **dùng chung Worker** đã dựng.

---

## Phần A — Người mới tự dựng keepalive (repo riêng)

**1. Tạo repo của mình**
- Vào repo gốc trên GitHub → **Fork** về tài khoản của bạn ấy (giữ nguyên public để Actions miễn phí).
- Trong fork: tab **Actions** → bấm **I understand... enable** (fork cần bật Actions thủ công).

**2. Lấy phiên đăng nhập (chạy trên máy bạn ấy)**
```bash
git clone <fork-cua-ban-ay> && cd sowork
npm install playwright@1.62.1 && npx playwright install chromium
node capture-session.js     # đăng nhập SoWork trong cửa sổ hiện ra, xong bấm ENTER
node verify-session.js      # kiểm tra: thấy "✅ ĐÃ ONLINE" là ổn
node pack-session.js        # tạo chuỗi để dán vào secret (in ra + lưu session.b64.txt)
```

**3. Đặt secret trên repo của bạn ấy**
GitHub repo → **Settings → Secrets and variables → Actions** → New repository secret:
- `SOWORK_SESSION` = nội dung `session.b64.txt` (bắt buộc)
- `SLACK_WEBHOOK_URL`, `SLACK_USER_ID` = *(tùy chọn)* để nhận cảnh báo Slack
- `SOWORK_GROUP_ID` = *(chỉ khi khác văn phòng)* lấy trong URL `app.sowork.com/s/<groupId>`

**Xong!** Cron trong `.github/workflows/sowork.yml` sẽ tự chạy 07:00–22:40 (T2–T6).
Bấm **Actions → SoWork Keep Alive → Run workflow** để test ngay.

---

## Phần B — Thêm người mới vào Slack Worker dùng chung (do CHỦ Worker làm)

Worker hỗ trợ nhiều người qua biến `USERS_JSON` (mỗi Slack user → phiên + repo riêng).

**1. Xin từ người mới 4 thứ:**
- `apiKey` + `refreshToken`: chạy tại repo của họ:
  ```bash
  node -e "const s=require('./session.json');const r=JSON.stringify(s);console.log('apiKey =',(r.match(/firebase:authUser:([^:]+):/)||[])[1]);console.log('refreshToken =',(r.match(/\"k\":\"refreshToken\",\"v\":\"([^\"]+)\"/)||[])[1]);"
  ```
- `repo`: `tài-khoản-github-của-họ/sowork`
- `ghToken`: họ tạo **fine-grained PAT** trên repo đó (quyền *Actions: read+write*) và đưa cho bạn
- **Slack member ID** của họ (Slack → Profile → ⋯ → Copy member ID, dạng `U...`)

**2. Cập nhật biến `USERS_JSON` trong Cloudflare Worker** (Settings → Variables), gồm CẢ bạn và người mới:
```json
{
  "U_CUA_BAN":     { "apiKey":"...", "refreshToken":"...", "repo":"nhi-hoang-nsc/sowork", "ghToken":"github_pat_..." },
  "U_CUA_BAN_MOI": { "apiKey":"...", "refreshToken":"...", "repo":"ban-moi/sowork",       "ghToken":"github_pat_..." }
}
```
→ **Deploy** lại.

> ⚠️ Khi đã đặt `USERS_JSON`, Worker BỎ QUA các biến rời (`SOWORK_API_KEY`, `GH_REPO`…). Vì vậy **phải thêm cả chính bạn** vào `USERS_JSON`, nếu không bạn sẽ mất quyền.

**3. Người mới dùng thử:** trong Slack gõ `/sowork status` — Worker tự nhận diện theo Slack ID và chạy trên phiên/repo của họ.

---

## Ghi chú
- Người mới cùng văn phòng thì `groupId` mặc định là đúng; khác văn phòng thì set `SOWORK_GROUP_ID` (repo) và `groupId` (trong USERS_JSON).
- Bảo mật: `USERS_JSON` chứa refreshToken + PAT của người khác → chỉ nằm trong Secret của Cloudflare; ai giữ Worker sẽ nắm khóa của mọi người. Nếu không muốn tập trung, mỗi người tự dựng Worker riêng.
- Khi ai đó làm mới phiên (chạy lại `capture-session.js`): cập nhật `SOWORK_SESSION` (repo của họ) **và** `refreshToken` trong `USERS_JSON` (Worker).
