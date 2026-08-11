// check-online.js — kiểm tra NHANH (không cần trình duyệt) xem tài khoản có ĐANG online không.
// In ra 1 trong: ONLINE / OFFLINE / EXPIRED / UNKNOWN. Dùng để workflow quyết định có cần chạy keepalive không.
// Mục đích: nếu đang online (một ca khác đang giữ) thì bỏ qua -> tránh đá phiên & tránh tốn thời gian cài Playwright.

const fs = require('fs');
const zlib = require('zlib');

const GROUP_ID = process.env.SOWORK_GROUP_ID || '5yBGdkKFdacSqo4bWb2j';

function loadState() {
  const raw = process.env.SOWORK_SESSION;
  if (raw) {
    const s = raw.trim();
    if (s.startsWith('{')) return JSON.parse(s);
    return JSON.parse(zlib.gunzipSync(Buffer.from(s, 'base64')).toString('utf8'));
  }
  if (fs.existsSync('session.json')) return JSON.parse(fs.readFileSync('session.json', 'utf8'));
  throw new Error('no session');
}

(async () => {
  try {
    const state = loadState();
    const raw = JSON.stringify(state);
    const apiKey = (raw.match(/firebase:authUser:([^:]+):\[DEFAULT\]/) || [])[1];
    const refreshToken = (raw.match(/"k":"refreshToken","v":"([^"]+)"/) || [])[1];
    if (!apiKey || !refreshToken) { console.log('UNKNOWN'); return; }

    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
    });
    const j = await r.json();
    if (!j.id_token) { console.log('EXPIRED'); return; }
    const userId = j.user_id || JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64').toString()).user_id;

    const res = await fetch('https://api.sowork.com/api/v1/gaia/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${j.id_token}` },
      body: JSON.stringify({ groupId: GROUP_ID })
    });
    if (!res.ok) { console.log('UNKNOWN'); return; }
    const rooms = await res.json();
    const set = new Set();
    Object.values(rooms.roomDefinitionMap || {}).forEach(rd =>
      (rd.rooms || []).forEach(rm => (rm.userIds || []).forEach(u => set.add(u))));
    console.log(set.has(userId) ? 'ONLINE' : 'OFFLINE');
  } catch (e) {
    console.log('UNKNOWN'); // lỗi -> cứ để keepalive chạy cho chắc
  }
})();
