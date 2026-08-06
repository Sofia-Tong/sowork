// stats.js — xem thời gian hoạt động trên SoWork mà KHÔNG cần mở app (không tạo presence, không đá phiên trên GitHub).
// Cách hoạt động: tự làm mới ID token từ refresh token trong phiên, rồi gọi API SoWork:
//   - Trạng thái real-time: gaia/rooms + reports/getInMeetingUserIds
//   - Thời gian làm việc/ngày: analytics/user-working-hours (CÙNG nguồn với trang Insights → khớp số)
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

function fmtDurSec(seconds) {
  const m = Math.round(seconds / 60);
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}m`;
}
function fmtClockISO(iso) {
  return new Date(iso).toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}
// Cộng n ngày vào chuỗi "YYYY-MM-DD" (dùng UTC để tránh lệch)
function addDays(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.toISOString().slice(0, 10);
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

  const post = async (path, body) => {
    const res = await fetch(`https://api.sowork.com/api/v1/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  // 0) TRẠNG THÁI HIỆN TẠI (real-time, snapshot — không join phòng nên không tạo presence)
  let statusLabel, statusEmoji, totalOnline = 0;
  try {
    const rooms = await post('gaia/rooms', { groupId });
    const onlineSet = new Set();
    Object.values(rooms.roomDefinitionMap || {}).forEach(rd =>
      (rd.rooms || []).forEach(rm => (rm.userIds || []).forEach(u => onlineSet.add(u))));
    totalOnline = onlineSet.size;
    const meetingSet = new Set((await post('reports/getInMeetingUserIds', { groupId })).userIds || []);
    if (!onlineSet.has(userId)) { statusEmoji = '⚪'; statusLabel = 'Offline (không có trong văn phòng)'; }
    else if (meetingSet.has(userId)) { statusEmoji = '🎥'; statusLabel = 'Online — đang họp'; }
    else { statusEmoji = '🟢'; statusLabel = 'Online — trong văn phòng'; }
  } catch (e) {
    statusEmoji = '❓'; statusLabel = 'Không lấy được trạng thái (' + (e.message || e) + ')';
  }

  const get = async (path) => {
    const res = await fetch(`https://api.sowork.com/api/v1/${path}`, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  // 1) THỜI GIAN LÀM VIỆC theo ngày — nguồn CHÍNH XÁC như trang Insights (analytics/user-working-hours).
  //    Endpoint trả về nguyên tuần (Mon–Sun) chứa fromDate; ta gom các tuần phủ [startDate, endDate].
  const tzParam = encodeURIComponent('Asia/Saigon');
  const dayMap = {};
  for (let from = startDate; from <= endDate; from = addDays(from, 7)) {
    const wk = await get(`analytics/user-working-hours?groupId=${groupId}&userId=${userId}&fromDate=${from}&timezone=${tzParam}`);
    (wk.days || []).forEach(d => { dayMap[d.date] = d; });
  }
  const days = Object.values(dayMap)
    .filter(d => d.date >= startDate && d.date <= endDate && (d.totalSeconds || d.clockIn));

  const officeSec = days.reduce((s, d) => s + (d.totalSeconds || 0), 0);
  const awaySec = days.reduce((s, d) => s + (d.awaySeconds || 0), 0);
  const onlineSec = Math.max(0, officeSec - awaySec);
  const clockIns = days.map(d => d.clockIn).filter(Boolean).sort();
  const clockOuts = days.map(d => d.clockOut).filter(Boolean).sort();

  const nowVN = new Date().toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

  console.log('==================================================');
  console.log(`  BAO CAO HOAT DONG SOWORK — ${userName}`);
  console.log(`  Khoang: ${startDate}${endDate !== startDate ? ' → ' + endDate : ''} (gio ${TZ})`);
  console.log('==================================================');
  console.log(`  ${statusEmoji} TRANG THAI NGAY BAY GIO (${nowVN}): ${statusLabel}`);
  console.log(`     (${totalOnline} nguoi dang online trong van phong)`);
  console.log('  --------------------------------------------------');
  if (days.length === 0) {
    console.log('  (Chua co du lieu cho khoang nay.)');
  } else {
    if (clockIns.length) console.log(`  Vao lan dau : ${fmtClockISO(clockIns[0])}`);
    if (clockOuts.length) console.log(`  Ra lan cuoi : ${fmtClockISO(clockOuts[clockOuts.length - 1])}`);
  }
  console.log('  --------------------------------------------------');
  console.log(`  🏢 Trong van phong (tong)  : ${fmtDurSec(officeSec)}`);
  console.log(`  🟢 Dang online (hoat dong) : ${fmtDurSec(onlineSec)}`);
  console.log(`  💤 Away (roi ban phim)     : ${fmtDurSec(awaySec)}`);
  console.log('==================================================');

  // Nếu chạy trên GitHub Actions -> ghi báo cáo Markdown vào Job Summary (xem trên app GitHub / điện thoại).
  if (process.env.GITHUB_STEP_SUMMARY) {
    const range = endDate !== startDate ? `${startDate} → ${endDate}` : startDate;
    const md = [
      `## 📊 Hoạt động SoWork — ${userName}`,
      ``,
      `### ${statusEmoji} Ngay bây giờ (${nowVN}): **${statusLabel}**`,
      `<sub>${totalOnline} người đang online trong văn phòng</sub>`,
      ``,
      `**Khoảng:** ${range} _(giờ VN)_`,
      ``,
      days.length && clockIns.length ? `- 🕗 **Vào lần đầu:** ${fmtClockISO(clockIns[0])}` : `- _(Chưa có dữ liệu)_`,
      days.length && clockOuts.length ? `- 🕔 **Ra lần cuối:** ${fmtClockISO(clockOuts[clockOuts.length - 1])}` : ``,
      ``,
      `| Chỉ số | Thời lượng |`,
      `| --- | --- |`,
      `| 🏢 Trong văn phòng (tổng) | **${fmtDurSec(officeSec)}** |`,
      `| 🟢 Đang online (hoạt động) | ${fmtDurSec(onlineSec)} |`,
      `| 💤 Away (rời bàn phím) | ${fmtDurSec(awaySec)} |`,
      ``,
      `<sub>Đọc qua API analytics/user-working-hours — cùng nguồn với trang Insights. Không mở app, không ảnh hưởng phiên keepalive.</sub>`,
      ``
    ].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
