// keepalive.js — giữ Online trên SoWork bằng 1 phiên browser sống liên tục.
// Nguồn phiên: biến môi trường SOWORK_SESSION (JSON storageState kèm IndexedDB) trên CI,
//              hoặc file session.json khi chạy cục bộ.
//
// Cấu hình qua ENV (đều tùy chọn):
//   RUN_MINUTES   : số phút giữ browser sống trước khi thoát (mặc định 350 ~ sát trần 6h của 1 job).
//   STOP_HOUR_VN  : dừng khi giờ VN >= mốc này (mặc định 24 = nửa đêm).

const { chromium } = require('playwright');
const fs = require('fs');
const zlib = require('zlib');

const delay = ms => new Promise(res => setTimeout(res, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const vnNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

const RUN_MINUTES = parseInt(process.env.RUN_MINUTES || '350', 10);
const STOP_HOUR_VN = parseInt(process.env.STOP_HOUR_VN || '24', 10);

function loadState() {
  const raw = process.env.SOWORK_SESSION;
  if (raw) {
    const s = raw.trim();
    // Ho tro ca 2 dinh dang: JSON tho, hoac base64(gzip(json)) — dung khi vuot gioi han 48KB cua secret.
    if (s.startsWith('{')) return JSON.parse(s);
    return JSON.parse(zlib.gunzipSync(Buffer.from(s, 'base64')).toString('utf8'));
  }
  if (fs.existsSync('session.json')) return JSON.parse(fs.readFileSync('session.json', 'utf8'));
  throw new Error('Không tìm thấy phiên: đặt biến SOWORK_SESSION hoặc tạo file session.json (chạy capture-session.js).');
}

(async () => {
  const start = vnNow();
  console.log(`[TIME] Bat dau luc (VN): ${start.getHours()}:${String(start.getMinutes()).padStart(2, '0')}`);

  // Vào làm "muộn" ngẫu nhiên nếu đang đầu giờ sáng (7:00–7:15)
  if (start.getHours() === 7 && start.getMinutes() <= 15) {
    const d = rand(0, 10);
    console.log(`[RANDOM] Dau gio 7AM -> delay ${d} phut cho tu nhien...`);
    await delay(d * 60 * 1000);
  }

  const state = loadState();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: state,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  // Theo dõi WebSocket real-time cua SoWork -> tin hieu chac chan da Online
  let gaiaConnected = false;
  page.on('websocket', ws => { if (/api\.sowork\.com\/gaia/.test(ws.url())) gaiaConnected = true; });

  // Bam 1 link/nut theo text neu no xuat hien (cho toi timeout)
  const clickIfVisible = async (re, label, timeout) => {
    try {
      const el = page.getByText(re).first();
      await el.waitFor({ state: 'visible', timeout });
      await el.click();
      console.log('-> Bam:', label);
      return true;
    } catch { return false; }
  };

  try {
    console.log('Dang vao van phong ao app.sowork.com...');
    // KHONG dung 'networkidle': khi da login, WebSocket real-time chay lien tuc nen khong bao gio idle.
    await page.goto('https://app.sowork.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    // Kiem tra phien con hop le
    const body = (await page.evaluate(() => document.body ? document.body.innerText : '')).slice(0, 300);
    if (/Welcome to SoWork!|Continue with Google|Continue with Microsoft|Sign in with email/i.test(body)) {
      console.error('❌ VAN O MAN HINH DANG NHAP — phien het han hoac khong hop le. Can chay lai capture-session.js.');
      await page.screenshot({ path: 'keepalive-error.png' }).catch(() => {});
      await browser.close();
      process.exit(1);
    }

    // Cong 1: man hinh "Launching SoWork" (~10-15s moi hien) -> "continue in your browser"
    await clickIfVisible(/continue in your browser/i, 'continue in your browser', 45000);
    await page.waitForTimeout(3000);
    // Cong 2: man hinh chao phong -> vao ma khong can camera/mic
    await clickIfVisible(/continue without camera or microphone/i, 'continue without camera or microphone', 30000);

    // Cho ket noi real-time gaia (= Online)
    for (let i = 0; i < 20 && !gaiaConnected; i++) await page.waitForTimeout(1500);
    if (gaiaConnected) {
      console.log('✅ Da ket noi real-time (gaia) — DANG ONLINE. Bat dau giu phien...');
    } else {
      console.log('⚠️  Chua thay ket noi gaia nhung da qua cac man cho — van tiep tuc giu phien.');
    }
    await page.screenshot({ path: 'keepalive-online.png' }).catch(() => {});

    const deadline = Date.now() + RUN_MINUTES * 60 * 1000;
    let tick = 0;
    while (Date.now() < deadline) {
      const now = vnNow();
      // Dừng khi tới mốc nửa đêm (hoặc STOP_HOUR_VN)
      if (now.getHours() >= STOP_HOUR_VN || (STOP_HOUR_VN === 24 && now.getHours() === 0)) {
        console.log('[STOP] Toi mat gio nghi -> off.');
        break;
      }
      // 23h đêm: 40% cơ hội off sớm cho tự nhiên
      if (now.getHours() === 23 && Math.random() > 0.6) {
        console.log('[RANDOM] 23PM -> off som ngau nhien.');
        break;
      }

      const wait = rand(45000, 90000);
      await page.waitForTimeout(wait);

      // Hoạt động nhẹ để tránh bị coi là idle: rê chuột ngẫu nhiên
      await page.mouse.move(rand(200, 1000), rand(150, 650)).catch(() => {});
      tick++;
      if (tick % 10 === 0) {
        console.log(`[ALIVE] tick ${tick} — VN ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} — van Online.`);
      }
    }
    console.log('Ket thuc phien giu Online.');
  } catch (error) {
    console.error('Loi:', error.message || error);
    await page.screenshot({ path: 'keepalive-error.png' }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
