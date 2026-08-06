const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  try {
    console.log('Dang nap bo ma Cookie tu GitHub Secrets...');
    
    // Đọc mã Cookie thô từ biến môi trường
    let rawCookies = JSON.parse(process.env.SOWORK_COOKIES);
    
    // Chuẩn hóa và làm sạch dữ liệu SameSite để tránh lỗi Playwright
    const cleanedCookies = rawCookies.map(cookie => {
      // Bản sao của cookie để chỉnh sửa
      const newCookie = { ...cookie };
      
      if (newCookie.sameSite) {
        // Chuyển chữ thường thành viết hoa chữ cái đầu theo chuẩn (lax -> Lax, strict -> Strict)
        const formatted = newCookie.sameSite.charAt(0).toUpperCase() + newCookie.sameSite.slice(1).toLowerCase();
        
        if (['Strict', 'Lax', 'None'].includes(formatted)) {
          newCookie.sameSite = formatted;
        } else {
          // Nếu giá trị lạ không hợp lệ, xóa thuộc tính sameSite để trình duyệt tự nhận diện mặc định
          delete newCookie.sameSite;
        }
      } else {
        // Xóa nếu trường này trống hoặc null
        delete newCookie.sameSite;
      }
      
      // Đảm bảo loại bỏ các trường không tương thích khác nếu có
      delete newCookie.hostOnly;
      delete newCookie.session;
      
      return newCookie;
    });
    
    // Nạp danh sách Cookie đã được làm sạch
    await context.addCookies(cleanedCookies);
    console.log('Nap Cookie va xử ly SameSite thanh cong!');

    const page = await context.newPage();

    console.log('Dang tien vao van phong ao SoWork...');
    await page.goto('https://sowork.com', { waitUntil: 'networkidle', timeout: 60000 });
    
    console.log('Trinh duyet da mo van phong thanh cong!');
    console.log('Dang giu ket noi 45 giay de ghi nhan trang thai Online...');
    
    await page.waitForTimeout(45000); 
    console.log('Duy tri trang thai Online thanh cong!');
  } catch (error) {
    console.error('Loi trong qua trinh gia lap:', error.message || error);
  } finally {
    await browser.close();
  }
})();
