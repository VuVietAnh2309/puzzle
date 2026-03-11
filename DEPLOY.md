# Hướng dẫn Deploy Quiz Game bằng Docker

## 1. Yêu cầu

- Cài đặt [Docker](https://docs.docker.com/get-docker/)

## 2. Build image

```bash
cd demo
docker build -t quiz-game .
```

## 3. Chạy container

```bash
docker run -d -p 3000:3000 --name quiz-game quiz-game
```

- `-d`: chạy nền
- `-p 3000:3000`: map port 3000 của máy host vào container
- `--name quiz-game`: đặt tên container

## 4. Truy cập

- Local: http://localhost:3000
- Từ thiết bị khác trong cùng mạng: http://<ip-máy-host>:3000

## 5. Các lệnh hữu ích

```bash
# Xem log
docker logs quiz-game

# Xem log realtime
docker logs -f quiz-game

# Dừng container
docker stop quiz-game

# Khởi động lại
docker start quiz-game

# Xoá container (phải dừng trước)
docker stop quiz-game && docker rm quiz-game

# Build lại sau khi sửa code
docker stop quiz-game && docker rm quiz-game
docker build -t quiz-game .
docker run -d -p 3000:3000 --name quiz-game quiz-game
```

## 6. Đổi port

Nếu muốn chạy trên port khác (VD: 8080):

```bash
docker run -d -p 8080:3000 --name quiz-game quiz-game
```

Truy cập tại http://localhost:8080

## 7. Lưu dữ liệu (volume)

Để giữ dữ liệu quiz và ảnh upload khi xoá/tạo lại container:

```bash
docker run -d -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/public/uploads:/app/public/uploads \
  --name quiz-game quiz-game
```