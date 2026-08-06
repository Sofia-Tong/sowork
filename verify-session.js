// verify-session.js
// Kiểm tra session.json có đăng nhập được ở chế độ HEADLESS hay không (giống môi trường CI).
// Cách chạy:  node verify-session.js
// Đọc session từ file session.json (mặc định) hoặc từ biến môi trường SOWORK_SESSION nếu có.

const { chromium } = require('playwright');
const fs = require('fs');
const zlib = require('zlib');
const { logSessionInfo } = require('./session-info');

function loadState() {
  const raw = process.env.SOWORK_SESSION;
  if (raw) {
    const s = raw.trim();
    if (s.startsWith('{')) return JSON.parse(s);
    return JSON.parse(zlib.gunzipSync(Buffer.from(s, 'base64')).toString('utf8'));
  }
  return JSON.parse(fs.readFileSync('session.json', 'utf8'));
}

(async () => {
  const state = loadState();
  logSessionInfo(state);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: state,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  let gaiaConnected = false;
  page.on('websocket', ws => { if (/api\.sowork\.com\/gaia/.test(ws.url())) gaiaConnected = true; });

  const clickIfVisible = async (re, label, timeout) => {
    try {
      const el = page.getByText(re).first();
      await el.waitFor({ state: 'visible', timeout });
      await el.click();
      console.log('-> Bam:', label);
      return true;
    } catch { console.log('-> Khong thay (bo qua):', label); return false; }
  };

  // KHÔNG dùng 'networkidle': khi đã login, WebSocket real-time chạy liên tục nên không bao giờ idle.
  await page.goto('https://app.sowork.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const bodyText = (await page.evaluate(() => document.body ? document.body.innerText : '')).slice(0, 300);
  const onLoginScreen = /Welcome to SoWork!|Continue with Google|Continue with Microsoft|Sign in with email/i.test(bodyText);
  if (onLoginScreen) {
    console.log('URL:', page.url());
    console.log('--- Body snippet ---\n' + bodyText.replace(/\n{2,}/g, '\n'));
    console.log('❌ VẪN Ở MÀN HÌNH ĐĂNG NHẬP — session chưa hợp lệ.');
    await page.screenshot({ path: 'verify.png' });
    await browser.close();
    return;
  }

  // Cổng 1: "Launching SoWork" -> continue in your browser
  await clickIfVisible(/continue in your browser/i, 'continue in your browser', 45000);
  await page.waitForTimeout(3000);
  // Cổng 2: màn chào phòng -> vào không cần camera/mic
  await clickIfVisible(/continue without camera or microphone/i, 'continue without camera or microphone', 30000);

  // Chờ kết nối real-time gaia (= Online)
  for (let i = 0; i < 20 && !gaiaConnected; i++) await page.waitForTimeout(1500);

  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());
  console.log('====================================');
  console.log(gaiaConnected
    ? '✅ ĐÃ ONLINE — kết nối real-time (api.sowork.com/gaia) thành công.'
    : '⚠️  ĐÃ ĐĂNG NHẬP nhưng chưa thấy kết nối gaia — xem verify.png để kiểm tra.');

  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'verify.png' });
  console.log('Đã lưu ảnh: verify.png (mở ra xem có thấy văn phòng ảo không).');

  await browser.close();
})();
