const { chromium } = require('playwright');

(async () => {
  // Khởi chạy trình duyệt ẩn danh với cấu hình giả lập người dùng thật
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('Đang truy cập SoWork...');
    // Tăng thời gian chờ tải trang lên 60 giây đề phòng mạng chậm
    await page.goto('https://sowork.com', { waitUntil: 'load', timeout: 60000 });

    console.log('Đang tìm ô nhập thông tin đăng nhập...');
    
    // Đợi tối đa 15 giây cho đến khi các ô nhập liệu xuất hiện trên màn hình
    // Sử dụng bộ định vị linh hoạt hơn (tìm theo id, placeholder hoặc thuộc tính)
    const emailSelector = 'input[id="email"], input[type="email"], input[placeholder*="email" i]';
    const passwordSelector = 'input[id="password"], input[type="password"], input[placeholder*="password" i]';
    
    await page.waitForSelector(emailSelector, { state: 'visible', timeout: 15000 });

    // Điền thông tin đăng nhập từ biến môi trường
    await page.fill(emailSelector, process.env.SOWORK_EMAIL);
    await page.fill(passwordSelector, process.env.SOWORK_PASSWORD);
    console.log('Đã điền Email và Mật khẩu.');

    // Tìm và nhấn nút đăng nhập (bằng nút submit hoặc text bên trong nút)
    const submitSelector = 'button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")';
    await page.click(submitSelector);
    console.log('Đã nhấn nút Đăng nhập.');
    
    // Đợi hệ thống tải không gian làm việc
    console.log('Đang giữ kết nối để hệ thống ghi nhận trạng thái Online...');
    await page.waitForTimeout(45000); 

    console.log('Đã cập nhật trạng thái hoạt động thành công!');
  } catch (error) {
    console.error('Lỗi khi duy trì trạng thái:', error);
    
    // Chụp ảnh màn hình lỗi để bạn dễ dàng kiểm tra xem trang web đang hiển thị gì
    try {
      await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
      console.log('Đã chụp ảnh màn hình lỗi: error-screenshot.png');
    } catch (e) {
      console.error('Không thể chụp ảnh màn hình:', e);
    }
  } finally {
    await browser.close();
  }
})();
