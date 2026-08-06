const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  // Khởi tạo ngữ cảnh với thông số máy tính thông thường
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  try {
    console.log('Đang nạp bộ mã Cookie bảo mật từ GitHub Secrets...');
    
    // Đọc mã Cookie từ biến môi trường và giải mã chuỗi JSON
    const cookies = JSON.parse(process.env.SOWORK_COOKIES);
    
    // Nạp Cookie trực tiếp vào trình duyệt ảo
    await context.addCookies(cookies);
    console.log('Nạp Cookie thành công!');

    const page = await context.newPage();

    console.log('Đang tiến vào văn phòng ảo SoWork trực tiếp...');
    // Điều hướng thẳng vào trang quản lý chính mà không cần qua trang Login
    await page.goto('https://app.sowork.com/', { waitUntil: 'networkidle', timeout: 60000 });
    
    console.log('Trình duyệt đã mở văn phòng thành công mà không đòi mật khẩu!');
    console.log('Đang giữ kết nối 45 giây để hệ thống ghi nhận trạng thái Online...');
    
    await page.waitForTimeout(45000); 
    console.log('Duy trì trạng thái Online thành công!');
  } catch (error) {
    console.error('Lỗi trong quá trình giả lập:', error);
  } finally {
    await browser.close();
  }
})();
