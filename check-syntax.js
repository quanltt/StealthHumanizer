#!/usr/bin/env node
/**
 * check-syntax.js — Kiểm tra cú pháp toàn bộ file JS/JSX sau khi merge,
 * bắt lỗi kiểu "duplicate declaration" hay leftover conflict marker mà
 * mắt thường dễ bỏ sót.
 *
 * Cài đặt (một lần):
 *   npm install --no-save @babel/parser
 *
 * Cách dùng:
 *   node check-syntax.js <thư_mục_cần_kiểm_tra>
 *
 * Ví dụ:
 *   node check-syntax.js ./merged
 */

const fs = require("fs");
const path = require("path");

let parser;
try {
  parser = require("@babel/parser");
} catch (e) {
  console.error(
    "Thiếu @babel/parser. Chạy: npm install --no-save @babel/parser"
  );
  process.exit(1);
}

const targetDir = process.argv[2];
if (!targetDir) {
  console.error("Usage: node check-syntax.js <thư_mục_cần_kiểm_tra>");
  process.exit(1);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, files);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(targetDir);
let errorCount = 0;
let markerCount = 0;

for (const file of files) {
  const code = fs.readFileSync(file, "utf8");

  // 1. Kiểm tra còn sót conflict marker không
  // Marker Git thật luôn là: "<<<<<<< " / ">>>>>>> " (7 ký tự + khoảng trắng
  // hoặc hết dòng, theo sau là tên ref) hoặc "=======" (đúng 7 ký tự, không
  // hơn, chiếm trọn 1 dòng). Regex cũ (^(<{7}|={7}|>{7})) chỉ cần khớp 7 ký
  // tự ĐẦU DÒNG nên báo nhầm với các chuỗi trang trí dài hơn 7 ký tự, ví dụ
  // dòng "============" (12 dấu "=") trong 1 template string bất kỳ. Regex
  // dưới đây bắt buộc dừng đúng ở khoảng trắng/cuối dòng ngay sau 7 ký tự,
  // nên phân biệt được marker thật với chuỗi dài hơn tình cờ trùng.
  if (/^(<{7}(\s|$)|={7}$|>{7}(\s|$))/m.test(code)) {
    console.log(`CONFLICT MARKER CÒN SÓT: ${file}`);
    markerCount++;
    continue;
  }

  // 2. Kiểm tra cú pháp
  try {
    parser.parse(code, {
      sourceType: "module",
      plugins: [
        "jsx",
        "classProperties",
        "optionalChaining",
        "nullishCoalescingOperator",
        "objectRestSpread",
      ],
    });
  } catch (e) {
    console.log(`SYNTAX ERROR: ${file}`);
    console.log(`   ${e.message}`);
    errorCount++;
  }
}

console.log("");
console.log("======================================");
console.log(`Tổng số file kiểm tra : ${files.length}`);
console.log(`Lỗi cú pháp           : ${errorCount}`);
console.log(`Còn sót conflict marker: ${markerCount}`);
console.log("======================================");

process.exit(errorCount > 0 || markerCount > 0 ? 1 : 0);