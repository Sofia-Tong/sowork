// slack-bridge/worker.js — Cloudflare Worker làm cầu nối Slack -> GitHub Actions + SoWork API.
// Slash command: /sowork run | stop | stats | status | help
//
// BIẾN MÔI TRƯỜNG (đặt trong Cloudflare: Settings -> Variables and Secrets, kiểu "Secret"):
//   SLACK_SIGNING_SECRET : Signing Secret của Slack app (để xác thực request)
//   GH_TOKEN             : GitHub Personal Access Token (Actions: read+write trên repo)
//   GH_REPO              : "nhi-hoang-nsc/sowork"
//   WORKFLOW_FILE        : "sowork.yml"   (tùy chọn, mặc định sowork.yml)
//   GH_REF               : "main"          (tùy chọn)
//   SOWORK_SESSION       : phiên SoWork (JSON hoặc base64-gzip) — dùng cho lệnh stats
//   SOWORK_GROUP_ID      : id văn phòng (tùy chọn)

const TZ = 'Asia/Ho_Chi_Minh';

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      // Luôn trả 200 kèm lý do lỗi để Slack HIỂN THỊ (thay vì "did not respond")
      return json({ response_type: 'ephemeral', text: `❌ Bridge lỗi: ${(err && err.message) || err}` });
    }
  }
};

async function route(request, env, ctx) {
    if (request.method !== 'POST') return new Response('SoWork Slack bridge OK', { status: 200 });

    const raw = await request.text();

    // 1) Xác thực chữ ký Slack — nếu sai, báo rõ vào Slack để dễ sửa
    if (!env.SLACK_SIGNING_SECRET) {
      return json({ response_type: 'ephemeral', text: '⚙️ Chưa đặt biến SLACK_SIGNING_SECRET trong Worker.' });
    }
    const ok = await verifySlack(request, raw, env.SLACK_SIGNING_SECRET);
    if (!ok) {
      return json({ response_type: 'ephemeral', text: '🚫 Chữ ký Slack không khớp — kiểm tra lại SLACK_SIGNING_SECRET (phải là *Signing Secret* trong Basic Information) và nhớ Deploy lại.' });
    }

    const params = new URLSearchParams(raw);
    const text = (params.get('text') || '').trim().toLowerCase();
    const responseUrl = params.get('response_url');
    const userId = params.get('user_id');
    const channelId = params.get('channel_id');
    const sub = text.split(/\s+/)[0] || 'help';

    // Giới hạn theo CHANNEL: nếu đặt ALLOWED_CHANNEL_IDS thì chỉ chạy trong các channel này.
    // Dùng 1 channel RIÊNG TƯ -> chỉ thành viên channel mới gõ được -> hiệu quả "chỉ người trong channel".
    const chAllow = (env.ALLOWED_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (chAllow.length && !chAllow.includes(channelId)) {
      return json({ response_type: 'ephemeral', text: '🚫 Lệnh này chỉ dùng được trong channel được cấp phép.' });
    }

    // Giới hạn theo NGƯỜI (tùy chọn, có thể kết hợp): danh sách member ID.
    const allow = (env.ALLOWED_SLACK_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allow.length && !allow.includes(userId)) {
      return json({ response_type: 'ephemeral', text: '🚫 Bạn không có quyền dùng lệnh này.' });
    }

    if (sub === 'help' || !['run', 'stop', 'stats', 'status'].includes(sub)) {
      return json({
        response_type: 'ephemeral',
        text: '*SoWork bridge* — lệnh:\n• `/sowork run` — khởi động keepalive\n• `/sowork stop` — dừng phiên đang chạy\n• `/sowork stats` — xem thời gian online hôm nay + trạng thái\n• `/sowork status` — chỉ xem trạng thái hiện tại'
      });
    }

    // Xử lý bất đồng bộ rồi trả kết quả qua response_url (tránh timeout 3s của Slack)
    ctx.waitUntil(
      handle(sub, env)
        .then(msg => postSlack(responseUrl, msg))
        .catch(err => postSlack(responseUrl, `❌ Lỗi: ${(err && err.message) || err}`))
    );
    return json({ response_type: 'ephemeral', text: '⏳ Đang xử lý...' });
}

async function handle(sub, env) {
  if (sub === 'run') return await ghRun(env);
  if (sub === 'stop') return await ghStop(env);
  if (sub === 'stats') return await soworkReport(env, true);
  if (sub === 'status') return await soworkReport(env, false);
}

/* ---------------- GitHub Actions ---------------- */
function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sowork-slack-bridge'
  };
}
async function ghRun(env) {
  const wf = env.WORKFLOW_FILE || 'sowork.yml';
  const ref = env.GH_REF || 'main';
  const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${wf}/dispatches`, {
    method: 'POST', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref })
  });
  if (res.status === 204) return '▶️ Đã khởi động keepalive. Chờ ~1 phút để vào văn phòng (bạn sẽ nhận Slack "đã VÀO văn phòng").';
  return `❌ Không khởi động được (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`;
}
async function ghStop(env) {
  const wf = env.WORKFLOW_FILE || 'sowork.yml';
  let ids = [];
  for (const st of ['in_progress', 'queued']) {
    const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${wf}/runs?status=${st}&per_page=20`, { headers: ghHeaders(env) });
    if (res.ok) { const j = await res.json(); (j.workflow_runs || []).forEach(r => ids.push(r.id)); }
  }
  ids = [...new Set(ids)];
  if (ids.length === 0) return 'ℹ️ Không có phiên keepalive nào đang chạy.';
  let cancelled = 0;
  for (const id of ids) {
    const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/runs/${id}/cancel`, { method: 'POST', headers: ghHeaders(env) });
    if (res.status === 202) cancelled++;
  }
  return `⏹️ Đã gửi lệnh dừng cho ${cancelled}/${ids.length} phiên đang chạy.`;
}

/* ---------------- SoWork API ---------------- */
async function loadState(env) {
  const s = (env.SOWORK_SESSION || '').trim();
  if (!s) throw new Error('Chưa cấu hình SOWORK_SESSION trong Worker.');
  if (s.startsWith('{')) return JSON.parse(s);
  // base64(gzip(json)) -> giải nén bằng DecompressionStream
  const bin = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ds = new DecompressionStream('gzip');
  const txt = await new Response(new Blob([bin]).stream().pipeThrough(ds)).text();
  return JSON.parse(txt);
}
async function soworkAuth(env) {
  // Ưu tiên 2 biến nhỏ (khuyến nghị cho Cloudflare vì SOWORK_SESSION quá lớn > 5kB).
  let apiKey = env.SOWORK_API_KEY;
  let refreshToken = env.SOWORK_REFRESH_TOKEN;
  if (!apiKey || !refreshToken) {
    // Fallback: trích từ SOWORK_SESSION đầy đủ (nếu đặt được).
    const raw = JSON.stringify(await loadState(env));
    apiKey = apiKey || (raw.match(/firebase:authUser:([^:]+):\[DEFAULT\]/) || [])[1];
    refreshToken = refreshToken || (raw.match(/"k":"refreshToken","v":"([^"]+)"/) || [])[1];
  }
  if (!apiKey || !refreshToken) throw new Error('Thiếu SOWORK_API_KEY / SOWORK_REFRESH_TOKEN (hoặc SOWORK_SESSION).');
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
  });
  const j = await r.json();
  if (!j.id_token) throw new Error('PHIÊN HẾT HẠN — cần chạy lại capture-session.js + cập nhật SOWORK_SESSION.');
  let p = j.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  p += '==='.slice((p.length + 3) % 4); // padding base64
  const claims = JSON.parse(atob(p));
  return { idToken: j.id_token, userId: j.user_id || claims.user_id, userName: claims.name || claims.user_id };
}
function fmtDurSec(sec) { const m = Math.round(sec / 60); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`; }

async function soworkReport(env, withTime) {
  const groupId = env.SOWORK_GROUP_ID || '5yBGdkKFdacSqo4bWb2j';
  const { idToken, userId, userName } = await soworkAuth(env);
  const auth = { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };

  // Trạng thái hiện tại
  let statusLine = '❓ không rõ';
  try {
    const rooms = await (await fetch('https://api.sowork.com/api/v1/gaia/rooms', { method: 'POST', headers: auth, body: JSON.stringify({ groupId }) })).json();
    const online = new Set();
    Object.values(rooms.roomDefinitionMap || {}).forEach(rd => (rd.rooms || []).forEach(rm => (rm.userIds || []).forEach(u => online.add(u))));
    const meeting = new Set(((await (await fetch('https://api.sowork.com/api/v1/reports/getInMeetingUserIds', { method: 'POST', headers: auth, body: JSON.stringify({ groupId }) })).json()).userIds) || []);
    if (!online.has(userId)) statusLine = '⚪ Offline';
    else if (meeting.has(userId)) statusLine = '🎥 Online — đang họp';
    else statusLine = '🟢 Online — trong văn phòng';
    statusLine += ` _(${online.size} người đang online)_`;
  } catch (e) { statusLine = '❓ ' + (e.message || e); }

  if (!withTime) return `*SoWork — ${userName}*\nTrạng thái ngay bây giờ: ${statusLine}`;

  // Thời gian hôm nay (analytics/user-working-hours)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const wk = await (await fetch(`https://api.sowork.com/api/v1/analytics/user-working-hours?groupId=${groupId}&userId=${userId}&fromDate=${today}&timezone=${encodeURIComponent('Asia/Saigon')}`, { headers: { 'Authorization': `Bearer ${idToken}` } })).json();
  const d = (wk.days || []).find(x => x.date === today) || {};
  const office = d.totalSeconds || 0, away = d.awaySeconds || 0, onlineSec = Math.max(0, office - away);
  return [
    `*SoWork — ${userName}* (hôm nay ${today})`,
    `Trạng thái: ${statusLine}`,
    `🏢 Trong văn phòng: *${fmtDurSec(office)}*`,
    `🟢 Đang online: ${fmtDurSec(onlineSec)}`,
    `💤 Away: ${fmtDurSec(away)}`
  ].join('\n');
}

/* ---------------- Slack helpers ---------------- */
function json(obj) { return new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } }); }
async function postSlack(responseUrl, text) {
  if (!responseUrl) return;
  await fetch(responseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response_type: 'ephemeral', text }) });
}
async function verifySlack(request, rawBody, signingSecret) {
  if (!signingSecret) return false;
  const ts = request.headers.get('X-Slack-Request-Timestamp');
  const sig = request.headers.get('X-Slack-Signature');
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // chống replay
  const base = `v0:${ts}:${rawBody}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  const mine = `v0=${hex}`;
  // so sánh an toàn theo thời gian
  if (mine.length !== sig.length) return false;
  let diff = 0; for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
