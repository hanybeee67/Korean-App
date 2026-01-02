-- 지점 정보
CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE, -- e.g., '동탄점', '하남점'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 직원(사용자) 정보
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER REFERENCES branches(id),
    name VARCHAR(50) NOT NULL,
    password VARCHAR(255) NOT NULL, -- Simple text for prototype, Hash for production
    points INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 일일 적립 로그 (중복 방지용)
CREATE TABLE IF NOT EXISTS daily_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    accumulated_points INTEGER NOT NULL, -- e.g., 150
    date DATE DEFAULT CURRENT_DATE, -- 'YYYY-MM-DD'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date) -- 하루에 한 번만 적립 가능
);

-- 월말 테스트 결과
CREATE TABLE IF NOT EXISTS test_results (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    score INTEGER NOT NULL,
    test_month VARCHAR(7), -- '2025-01'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 초기 데이터 (지점)
INSERT INTO branches (name) VALUES ('동탄점'), ('하남점'), ('영등포점'), ('스타필드점') ON CONFLICT (name) DO NOTHING;
