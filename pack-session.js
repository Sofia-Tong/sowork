// pack-session.js — nén session.json thành chuỗi base64(gzip) để dán vào GitHub Secret SOWORK_SESSION.
// (GitHub Actions secret giới hạn 48KB; session.json thô thường vượt mức này.)
// Cách chạy:  node pack-session.js
// Kết quả: in ra chuỗi + lưu vào session.b64.txt. Copy toàn bộ nội dung dán vào secret.

const fs = require('fs');
const zlib = require('zlib');

const json = fs.readFileSync('session.json');
const packed = zlib.gzipSync(json).toString('base64');
fs.writeFileSync('session.b64.txt', packed);

console.log('Kich thuoc goc :', json.length, 'bytes');
console.log('Sau khi nen    :', packed.length, 'bytes', packed.length < 48000 ? '(OK, < 48KB)' : '(⚠️ VAN > 48KB!)');
console.log('Da luu vao     : session.b64.txt');
console.log('----------------------------------------');
console.log('Copy toan bo noi dung duoi day (hoac trong session.b64.txt) dan vao GitHub Secret "SOWORK_SESSION":\n');
console.log(packed);
