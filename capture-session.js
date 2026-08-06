// capture-session.js
// Chạy CỤC BỘ trên máy bạn để đăng nhập SoWork 1 lần và lưu phiên (kèm IndexedDB/Firebase auth).
// Cách chạy:  node capture-session.js
// Sau khi cửa sổ trình duyệt hiện ra: đăng nhập SoWork như bình thường,
// chờ vào được văn phòng ảo, rồi quay lại terminal bấm ENTER.

const { chromium } = require('playwright');
const fs = require('fs');
const readline = require('readline');

const OUT = 'session.json';

const waitEnter = () => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\n>>> Sau khi ĐÃ đăng nhập và vào được văn phòng SoWork, bấm ENTER ở đây... ', () => { rl.close(); res(); });
});

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  console.log('Đang mở app.sowork.com ... hãy đăng nhập trong cửa sổ trình duyệt vừa hiện.');
  await page.goto('https://app.sowork.com', { waitUntil: 'domcontentloaded' });

  await waitEnter();

  // Lưu toàn bộ storage state KÈM IndexedDB (chứa refresh token của Firebase)
  const state = await context.storageState({ indexedDB: true });
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2));

  const hasIdb = (state.origins || []).some(o => (o.indexedDB || []).some(db => db.name === 'firebaseLocalStorageDb'));
  console.log(`\n[OK] Đã lưu phiên vào ${OUT}`);
  console.log(`[KIỂM TRA] Có firebaseLocalStorageDb trong state? -> ${hasIdb ? 'CÓ ✅' : 'KHÔNG ❌ (có thể chưa login xong)'}`);
  console.log('Tiếp theo: chạy `node verify-session.js` để xác nhận đăng nhập được ở chế độ headless.');

  await browser.close();
})();
