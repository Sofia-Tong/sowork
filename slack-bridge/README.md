# SoWork Slack Bridge (Cloudflare Worker)

Điều khiển SoWork keepalive **ngay trong Slack** bằng lệnh `/sowork`:

| Lệnh | Tác dụng |
|---|---|
| `/sowork run` | Khởi động keepalive (kích `workflow_dispatch` cho `sowork.yml`) |
| `/sowork stop` | Dừng các phiên keepalive đang chạy (hủy workflow run) |
| `/sowork stats` | Thời gian online hôm nay + trạng thái hiện tại (trả lời ngay trong Slack) |
| `/sowork status` | Chỉ xem trạng thái hiện tại (online/họp/offline) |

Không cần vào GitHub. Bridge chạy trên Cloudflare Workers (miễn phí).

---

## Bước 1 — Tạo GitHub Personal Access Token (PAT)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access**: Only select repositories → chọn `nhi-hoang-nsc/sowork`.
3. **Permissions → Repository permissions**:
   - **Actions**: Read and write
   - **Metadata**: Read-only (tự bật)
4. Generate → **copy token** (dạng `github_pat_...`). Lưu tạm để dán ở Bước 3.

## Bước 2 — Tạo Slack App + Signing Secret

1. Vào https://api.slack.com/apps → **Create New App → From scratch** → đặt tên (VD "SoWork Bot") → chọn workspace.
2. Vào **Basic Information → App Credentials** → copy **Signing Secret** (lưu tạm).
3. (Slash command sẽ tạo ở Bước 5, sau khi có URL Worker.)

## Bước 3 — Tạo Cloudflare Worker

1. Đăng ký/đăng nhập https://dash.cloudflare.com → **Workers & Pages → Create → Create Worker**.
2. Đặt tên (VD `sowork-bridge`) → **Deploy** (tạm thời code mặc định).
3. Bấm **Edit code** → xóa hết, dán toàn bộ nội dung [worker.js](worker.js) vào → **Deploy**.
4. Ghi lại URL Worker, dạng: `https://sowork-bridge.<tài-khoản>.workers.dev`

## Bước 4 — Thêm biến môi trường (Secrets) cho Worker

Trong Worker → **Settings → Variables and Secrets** → thêm từng biến, chọn kiểu **Secret** (Encrypt):

| Tên | Giá trị |
|---|---|
| `SLACK_SIGNING_SECRET` | Signing Secret ở Bước 2 |
| `GH_TOKEN` | PAT ở Bước 1 |
| `GH_REPO` | `nhi-hoang-nsc/sowork` |
| `SOWORK_API_KEY` | apiKey Firebase (nhỏ) — xem cách lấy bên dưới |
| `SOWORK_REFRESH_TOKEN` | refresh token (nhỏ) — xem cách lấy bên dưới |
| `SOWORK_GROUP_ID` | *(tùy chọn)* `5yBGdkKFdacSqo4bWb2j` |
| `ALLOWED_SLACK_USER_IDS` | *(tùy chọn)* member ID được phép dùng, VD `U012AB3CD` (nhiều người: `U1,U2`). Bỏ trống = không giới hạn theo người |
| `ALLOWED_CHANNEL_IDS` | *(tùy chọn)* chỉ cho chạy trong các channel này, VD `C0123ABCD`. Dùng 1 channel riêng tư = chỉ thành viên channel dùng được. Bỏ trống = mọi channel |

Bấm **Deploy** lại sau khi thêm.

> ⚠️ **Không dùng `SOWORK_SESSION` cho Worker** — chuỗi đó ~17 kB, vượt giới hạn 5 kB/biến của Cloudflare.
> Worker chỉ cần 2 giá trị nhỏ là `SOWORK_API_KEY` + `SOWORK_REFRESH_TOKEN`. Lấy chúng bằng lệnh chạy tại thư mục dự án:
>
> ```bash
> node -e "const s=require('./session.json');const r=JSON.stringify(s);console.log('SOWORK_API_KEY =',(r.match(/firebase:authUser:([^:]+):/)||[])[1]);console.log('SOWORK_REFRESH_TOKEN =',(r.match(/\"k\":\"refreshToken\",\"v\":\"([^\"]+)\"/)||[])[1]);"
> ```
> Copy 2 giá trị in ra, dán vào 2 biến Secret tương ứng trong Worker.

## Bước 5 — Tạo Slash Command trong Slack App

1. Slack app → **Slash Commands → Create New Command**:
   - **Command**: `/sowork`
   - **Request URL**: URL Worker ở Bước 3
   - **Short Description**: `Điều khiển SoWork keepalive`
   - **Usage Hint**: `run | stop | stats | status`
2. **Save**.
3. Vào **Install App → Install to Workspace** → Allow. (Nếu đổi gì sau này nhớ **Reinstall**.)

## Bước 6 — Dùng thử

Trong Slack, gõ:
```
/sowork stats
/sowork status
/sowork run
/sowork stop
```

---

## Ghi chú bảo mật
- Worker xác thực **chữ ký Slack** (`SLACK_SIGNING_SECRET`) trên mọi request → người ngoài không gọi được.
- `GH_TOKEN` chỉ có quyền Actions trên đúng repo này.
- `SOWORK_SESSION` nằm trong Worker để lệnh `stats` chạy tức thì mà không cần bật workflow.
- Khi bạn đổi phiên SoWork (chạy lại `capture-session.js`), nhớ cập nhật `SOWORK_SESSION` ở **cả** GitHub secret **và** Cloudflare Worker.
- Ai trong workspace Slack cũng gõ được `/sowork` (Slack không giới hạn theo người mặc định). Nếu cần giới hạn, có thể thêm kiểm tra `user_id` trong `worker.js`.
