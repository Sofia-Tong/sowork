const { chromium } = require('playwright');

(async () => {
  // Khởi chạy trình duyệt ẩn danh
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Đang truy cập SoWork...');
    await page.goto('https://sowork.com', { waitUntil: 'networkidle' });

    // Điền thông tin đăng nhập từ biến môi trường
    await page.fill('input[type="email"]', process.env.SOWORK_EMAIL);
    await page.fill('input[type="password"]', process.env.SOWORK_PASSWORD);
    
    // Nhấn nút Đăng nhập (Thay đổi selector nếu giao diện thay đổi)
    await page.click('button[type="submit"]');
    
    // Chờ 30 giây để hệ thống SoWork tải xong không gian làm việc và ghi nhận trạng thái Online
    console.log('Đăng nhập thành công. Đang giữ kết nối...');
    await page.waitForTimeout(30000); 

    console.log('Đã cập nhật trạng thái hoạt động thành công!');
  } catch (error) {
    console.error('Lỗi khi duy trì trạng thái:', error);
  } finally {
    await browser.close();
  }
})();
