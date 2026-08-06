const { chromium } = require('playwright');

// Hàm tạo thời gian trễ ngẫu nhiên (tính bằng mili-giây)
const delay = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  // Lấy thời gian hiện tại theo múi giờ Việt Nam
  const vnTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const currentHour = vnTime.getHours();
  const currentMinute = vnTime.getMinutes();

  console.log(`[TIME] Gio hien tai tai Viet Nam: ${currentHour}:${currentMinute < 10 ? '0' + currentMinute : currentMinute}`);

  // --- LOGIC NGẪU NHIÊN KHI BẮT ĐẦU VÀ KẾT THÚC ---
  
  // 1. Nếu đang ở khung giờ 8:00 AM - 8:15 AM: Ngẫu nhiên bỏ qua một số lượt chạy để tạo cảm giác vào làm muộn/sớm
  if (currentHour === 8 && currentMinute <= 15) {
    const randomStartDelay = Math.floor(Math.random() * 10); // Ngẫu nhiên từ 0 đến 10 phút
    console.log(`[RANDOM] Khung gio bat dau 8AM. Tu dong delay ngau nhien ${randomStartDelay} phut...`);
    await delay(randomStartDelay * 60 * 1000);
  }

  // 2. Nếu đang ở khung giờ 11:00 PM (23:00 PM): Ngẫu nhiên thoát sớm hoặc muộn quanh mốc 11PM
  if (currentHour === 23) {
    const randomChance = Math.random();
    if (randomChance > 0.6) { // 40% cơ hội sẽ nghỉ sớm ngay từ sau 11h đêm
      console.log('[RANDOM] Khung gio ket thuc 11PM. Ngau nhien dung chay luot nay de off som.');
      process.exit(0); // Thoát script an toàn, hệ thống SoWork sẽ tự chuyển sang Away
    }
  }
  // ------------------------------------------------

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  try {
    console.log('Dang nap bo ma Cookie tu GitHub Secrets...');
    let rawCookies = JSON.parse(process.env.SOWORK_COOKIES);
    
    // Log thời gian hết hạn cookie
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

    // Làm sạch dữ liệu SameSite
    const cleanedCookies = rawCookies.map(cookie => {
      const newCookie = { ...cookie };
      if (newCookie.sameSite) {
        const formatted = newCookie.sameSite.charAt(0).toUpperCase() + newCookie.sameSite.slice(1).toLowerCase();
        newCookie.sameSite = ['Strict', 'Lax', 'None'].includes(formatted) ? formatted : undefined;
      }
      delete newCookie.hostOnly;
      delete newCookie.session;
      return newCookie;
    });
    
    await context.addCookies(cleanedCookies);
    const page = await context.newPage();

    console.log('Dang tien vao van phong ao SoWork...');
    await page.goto('https://sowork.com', { waitUntil: 'networkidle', timeout: 60000 });
    
    // Ngẫu nhiên thời gian treo máy từ 45 giây đến 90 giây mỗi lần ping để tránh hành vi rập khuôn
    const randomKeepTime = Math.floor(Math.random() * (90000 - 45000 + 1)) + 45000;
    console.log(`Trinh duyet mo thanh cong! Treo may ngau nhien trong ${(randomKeepTime/1000).toFixed(0)} giay...`);
    
    await page.waitForTimeout(randomKeepTime); 
    console.log('Duy tri trang thai Online thanh cong!');
  } catch (error) {
    console.error('Loi trong qua trinh gia lap:', error.message || error);
  } {
    await browser.close();
  }
})();
