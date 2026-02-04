# Sử dụng Node.js LTS
FROM node:18-alpine

# Tạo thư mục làm việc
WORKDIR /app

# Sao chép package.json và package-lock.json
COPY package*.json ./

# Cài đặt dependencies
RUN npm install --production

# Sao chép toàn bộ mã nguồn
COPY . .

# Tạo thư mục cho dữ liệu (nếu cần)
RUN mkdir -p /app/data

# Expose cổng
EXPOSE 5000

# Khởi chạy ứng dụng
CMD ["npm", "start"]
