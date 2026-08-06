const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  try {
    console.log('Dang nap bo ma Cookie tu GitHub Secrets...');
    let rawCookies = JSON.parse(process.env.SOWORK_COOKIES);
    
    // --- ĐOẠN MÃ LOG THỜI GIAN HẾT HẠN COOKIE ---
    let earliestExpiry = Infinity;
    let latestExpiry = 0;

    rawCookies.forEach(cookie => {
      if (cookie.expirationDate) {
        // expirationDate của cookie tính bằng giây, cần đổi sang mili-giây
        const expiryMs = cookie.expirationDate * 1000;
        if (expiryMs < earliestExpiry) earliestExpiry = expiryMs;
        if (expiryMs > latestExpiry) latestExpiry = expiryMs;
      }
    });

    console.log('==================================================');
    if (earliestExpiry !== Infinity && latestExpiry !== 0) {
      // Định dạng hiển thị theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)
      const options = { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
      
      const earliestDate = new Date(earliestExpiry).toLocaleString('vi-VN', options);
      const latestDate = new Date(latestExpiry).toLocaleString('vi-VN', options);
      const now = Date.now();

      console.log(`[THONG BAO] Phien dang nhap gan nhat se het han vao: ${earliestDate}`);
      console.log(`[THONG BAO] Toan bo Cookie se het han hoan toan vao: ${latestDate}`);
      
      // Tính số ngày còn lại của phiên ngắn nhất
      const daysLeft = ((earliestExpiry - now) / (1000 * 60 * 60 * 24)).toFixed(1);
      if (daysLeft <= 0) {
        console.log('============= BAN CAN UPDATE COOKIES MOI NGAY =============');
      } else {
        console.log(`[GOI Y] Ban con khoang ${daysLeft} ngay truoc khi phien dau tien bi het han.`);
      }
    } else {
      console.log('[CANH BAO] Khong tim thay thong tin ngay het han trong Cookie. Co the day la Session Cookie tam thoi.');
    }
    console.log('==================================================');
    // -------------------------------------------------

    // Chuẩn hóa và làm sạch dữ liệu SameSite để tránh lỗi Playwright
    const cleanedCookies = rawCookies.map(cookie => {
      const newCookie = { ...cookie };
      
      if (newCookie.sameSite) {
        const formatted = newCookie.sameSite.charAt(0).toUpperCase() + newCookie.sameSite.slice(1).toLowerCase();
        if (['Strict', 'Lax', 'None'].includes(formatted)) {
          newCookie.sameSite = formatted;
        } else {
          delete newCookie.sameSite;
        }
      } else {
        delete newCookie.sameSite;
      }
      
      delete newCookie.hostOnly;
      delete newCookie.session;
      
      return newCookie;
    });
    
    await context.addCookies(cleanedCookies);
    console.log('Nap Cookie va xu ly SameSite thanh cong!');

    const page = await context.newPage();

    console.log('Dang tien vao van phong ao SoWork...');
    await page.goto('https://sowork.com', { waitUntil: 'networkidle', timeout: 60000 });
    
    console.log('Trinh duyet da mo van phong thanh cong!');
    console.log('Dang giu ket noi 45 giay de ghi nhan trang thai Online...');
    
    await page.waitForTimeout(45000); 
    console.log('Duy trì trạng thái Online thanh cong!');
  } catch (error) {
    console.error('Loi trong qua trinh gia lap:', error.message || error);
  } finally {
    await browser.close();
  }
})();
