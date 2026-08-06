// session-info.js — trích & log thông tin phiên đăng nhập từ storageState.
// LƯU Ý: Firebase refresh token KHÔNG có hạn cố định (chỉ chết khi logout/đổi mật khẩu/bị thu hồi),
// nên KHÔNG có "ngày hết hạn" để đếm ngược. Ta log thời điểm đăng nhập + tuổi phiên để bạn nắm bối cảnh;
// tín hiệu "cần chạy lại" thật sự là khi script phát hiện màn hình đăng nhập lúc chạy.

function vnFmt(ms) {
  return new Date(ms).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function decodeJwt(t) {
  try { return JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); }
  catch { return null; }
}

// Log thông tin phiên. Trả về object tóm tắt (hoặc null nếu không đọc được).
function logSessionInfo(state) {
  const raw = JSON.stringify(state);
  const jwts = [...new Set([...raw.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)].map(m => m[0]))];
  // Lấy ID token chính (có claim auth_time + email)
  const idToken = jwts.map(decodeJwt).find(p => p && p.auth_time && (p.email || p.user_id));

  console.log('================= THONG TIN PHIEN =================');
  if (!idToken) {
    console.log('[SESSION] Khong doc duoc thong tin token tu phien.');
    console.log('==================================================');
    return null;
  }

  const authMs = idToken.auth_time * 1000;
  const ageDays = ((Date.now() - authMs) / (1000 * 60 * 60 * 24)).toFixed(1);
  console.log(`[SESSION] Tai khoan     : ${idToken.email || idToken.user_id}`);
  if (idToken.name) console.log(`[SESSION] Ten hien thi  : ${idToken.name}`);
  console.log(`[SESSION] Dang nhap luc : ${vnFmt(authMs)} (gio VN)`);
  console.log(`[SESSION] Phien da song : ${ageDays} ngay`);
  console.log('[SESSION] Refresh token KHONG co han co dinh — chi het khi logout/doi mat khau/bi thu hoi.');
  console.log('[SESSION] Khi het han, buoc kiem tra ben duoi se bao ❌ va job chuyen do.');
  console.log('==================================================');
  return { email: idToken.email, authMs, ageDays: Number(ageDays) };
}

module.exports = { logSessionInfo };
