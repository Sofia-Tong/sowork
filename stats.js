// stats.js — xem thời gian hoạt động trên SoWork mà KHÔNG cần mở app (không tạo presence, không đá phiên trên GitHub).
// Cách hoạt động: tự làm mới ID token từ refresh token trong phiên, rồi gọi thẳng API Reports của SoWork.
//
// Cách chạy:
//   node stats.js                 -> hôm nay (giờ VN)
//   node stats.js 2026-08-05      -> một ngày cụ thể
//   node stats.js 2026-08-01 2026-08-06  -> một khoảng ngày
//
// Nguồn phiên: file session.json (mặc định) hoặc biến môi trường SOWORK_SESSION (JSON hoặc base64-gzip).
// groupId: mặc định là văn phòng của bạn; đổi qua biến môi trường SOWORK_GROUP_ID nếu cần
//          (groupId nằm trong URL văn phòng: app.sowork.com/s/<groupId>).

const fs = require('fs');
const zlib = require('zlib');

const TZ = 'Asia/Ho_Chi_Minh';
const DEFAULT_GROUP_ID = process.env.SOWORK_GROUP_ID || '5yBGdkKFdacSqo4bWb2j';

function loadState() {
  const raw = process.env.SOWORK_SESSION;
  if (raw) {
    const s = raw.trim();
    if (s.startsWith('{')) return JSON.parse(s);
    return JSON.parse(zlib.gunzipSync(Buffer.from(s, 'base64')).toString('utf8'));
  }
  if (fs.existsSync('session.json')) return JSON.parse(fs.readFileSync('session.json', 'utf8'));
  throw new Error('Không tìm thấy phiên: đặt SOWORK_SESSION hoặc tạo session.json (chạy capture-session.js).');
}

// YYYY-MM-DD theo giờ VN cho "hôm nay"
function todayVN() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // en-CA -> YYYY-MM-DD
}

function fmtDur(minutes) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}m (${m} phút)`;
}
function fmtClock(sec) {
  return new Date(sec * 1000).toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

async function main() {
  const startDate = process.argv[2] || todayVN();
  const endDate = process.argv[3] || startDate;

  const state = loadState();
  const raw = JSON.stringify(state);
  const apiKey = (raw.match(/firebase:authUser:([^:]+):\[DEFAULT\]/) || [])[1];
  const refreshToken = (raw.match(/"k":"refreshToken","v":"([^"]+)"/) || [])[1];
  if (!apiKey || !refreshToken) throw new Error('Phiên thiếu apiKey/refreshToken — chạy lại capture-session.js.');

  // Làm mới ID token
  const tr = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
  });
  const tj = await tr.json();
  if (!tj.id_token) throw new Error('❌ Không làm mới được token — phiên có thể đã hết hạn (logout/đổi mật khẩu). Chạy lại capture-session.js.');
  const idToken = tj.id_token;
  const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
  const userId = tj.user_id || claims.user_id;
  const userName = claims.name || userId;
  const groupId = DEFAULT_GROUP_ID;

  const api = async (path, body) => {
    const res = await fetch(`https://api.sowork.com/api/v1/reports/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  // 1) Thời gian trong văn phòng (online) theo ngày
  const dwh = await api('getGroupDailyWorkHoursLocal', { groupId, startDate, endDate, timezone: TZ });
  const myDays = (dwh.data || []).filter(d => d.userId === userId);
  const worldMin = myDays.reduce((s, d) => s + (d.worldDurationMinutes || 0), 0);
  const enters = myDays.map(d => d.enterAt && d.enterAt.seconds).filter(Boolean);
  const exits = myDays.map(d => d.exitAt && d.exitAt.seconds).filter(Boolean);

  // 2) Thời gian họp
  const ms = await api('getUserTotalMeetingStats', { groupId, userId, startDate, endDate, timezone: TZ });
  const meetingMin = (ms.data && ms.data.user_duration_s ? ms.data.user_duration_s : 0) / 60;
  const meetingCount = (ms.data && ms.data.user_meetings) || 0;

  const nonMeetingMin = Math.max(0, worldMin - meetingMin);

  console.log('==================================================');
  console.log(`  BAO CAO HOAT DONG SOWORK — ${userName}`);
  console.log(`  Khoang: ${startDate}${endDate !== startDate ? ' → ' + endDate : ''} (gio ${TZ})`);
  console.log('==================================================');
  if (myDays.length === 0) {
    console.log('  (Chua co du lieu trong van phong cho khoang nay.)');
  } else {
    if (enters.length) console.log(`  Vao lan dau : ${fmtClock(Math.min(...enters))}`);
    if (exits.length)  console.log(`  Ra lan cuoi : ${fmtClock(Math.max(...exits))}`);
  }
  console.log('  ----------------------------------------');
  console.log(`  🟢 Trong van phong (online) : ${fmtDur(worldMin)}`);
  console.log(`  🎥 Trong do dang hop        : ${fmtDur(meetingMin)}  (${meetingCount} luot)`);
  console.log(`  💤 Ngoai hop (online != hop): ${fmtDur(nonMeetingMin)}`);
  console.log('==================================================');
  console.log('  Luu y: API Reports cua SoWork khong tach rieng chi so "Away/idle";');
  console.log('  "Ngoai hop" = tong thoi gian trong van phong tru thoi gian hop.');

  // Nếu chạy trên GitHub Actions -> ghi báo cáo Markdown vào Job Summary (xem trên app GitHub / điện thoại).
  if (process.env.GITHUB_STEP_SUMMARY) {
    const range = endDate !== startDate ? `${startDate} → ${endDate}` : startDate;
    const md = [
      `## 📊 Hoạt động SoWork — ${userName}`,
      ``,
      `**Khoảng:** ${range} _(giờ VN)_`,
      ``,
      myDays.length && enters.length ? `- 🕗 **Vào lần đầu:** ${fmtClock(Math.min(...enters))}` : `- _(Chưa có dữ liệu trong văn phòng)_`,
      myDays.length && exits.length ? `- 🕔 **Ra lần cuối:** ${fmtClock(Math.max(...exits))}` : ``,
      ``,
      `| Chỉ số | Thời lượng |`,
      `| --- | --- |`,
      `| 🟢 Trong văn phòng (online) | **${fmtDur(worldMin)}** |`,
      `| 🎥 Đang họp | ${fmtDur(meetingMin)} (${meetingCount} lượt) |`,
      `| 💤 Ngoài họp | ${fmtDur(nonMeetingMin)} |`,
      ``,
      `<sub>Đọc qua API — không mở app, không ảnh hưởng phiên keepalive. "Ngoài họp" = online − họp (API không có chỉ số Away riêng).</sub>`,
      ``
    ].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
