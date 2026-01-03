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

-- Migration: Ensure columns exist (Fix for "column does not exist" error)
DO $$
BEGIN
    BEGIN
        ALTER TABLE users ADD COLUMN password VARCHAR(255) DEFAULT '1234';
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'column password already exists';
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'column points already exists';
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN branch_id INTEGER;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'column branch_id already exists';
    END;
END $$;

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

-- 초기 데이터 (관리자 계정)
INSERT INTO users (branch_id, name, password, points)
SELECT id, 'admin', '1234', 1000
FROM branches
WHERE name = '동탄점'
AND NOT EXISTS (SELECT 1 FROM users WHERE name = 'admin');
