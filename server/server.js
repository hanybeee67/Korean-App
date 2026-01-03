const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Initialize Database Schema on Startup
pool.connect(async (err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    console.log('Connected to PostgreSQL Database');

    try {
        console.log('Checking database schema...');

        // 1. Create Basic Tables
        await client.query(`
            CREATE TABLE IF NOT EXISTS branches (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                branch_id INTEGER REFERENCES branches(id),
                name VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS daily_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                accumulated_points INTEGER NOT NULL,
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, date)
            );
        `);

        // 2. Migrations: Add missing columns safely (IF NOT EXISTS)
        // This fixes the 'column password does not exist' error on existing tables
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR(255) DEFAULT '1234';`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER;`);

        // 3. Legacy Compatibility: Remove NOT NULL constraint from 'branch' (legacy column)
        await client.query(`
            DO $$ 
            BEGIN 
                BEGIN
                    ALTER TABLE users ALTER COLUMN branch DROP NOT NULL;
                EXCEPTION 
                    WHEN undefined_column THEN RAISE NOTICE 'column branch does not exist';
                END; 
            END $$;
        `);

        // 4. Mission Logs Table (New)
        await client.query(`
            CREATE TABLE IF NOT EXISTS mission_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                sentence TEXT,
                result VARCHAR(10), -- 'success' or 'fail'
                attempts_used INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. Monthly Test Results Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS test_results (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                score INTEGER NOT NULL,
                result VARCHAR(10), -- 'PASS' or 'FAIL'
                test_month VARCHAR(7), -- '2025-01'
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 6. Seed Data & Admin Logic Refined
        // Ensure '동탄점' exists and get its ID
        await client.query(`INSERT INTO branches (name) VALUES ('동탄점'), ('하남점'), ('영등포점'), ('스타필드점') ON CONFLICT (name) DO NOTHING;`);

        let branchResult = await client.query(`SELECT id FROM branches WHERE name = '동탄점'`);
        // Fallback: If for some reason select fails (unlikely), default to null or try inserting again
        if (branchResult.rows.length === 0) {
            const insertBranch = await client.query(`INSERT INTO branches (name) VALUES ('동탄점') RETURNING id`);
            branchResult = insertBranch;
        }

        if (branchResult.rows.length > 0) {
            const branchId = branchResult.rows[0].id;

            // Ensure 'admin' exists
            const adminResult = await client.query(`SELECT id FROM users WHERE name = 'admin'`);
            if (adminResult.rows.length === 0) {
                await client.query(`INSERT INTO users (name, password, branch_id, points) VALUES ('admin', '1234', $1, 1000)`, [branchId]);
                console.log('Admin user created successfully');
            } else {
                await client.query(`UPDATE users SET password = '1234' WHERE name = 'admin'`);
                console.log('Admin password reset successfully');
            }
        }

        console.log('Database Schema & Migrations Applied Successfully');
    } catch (e) {
        console.error('Failed to apply database schema:', e);
    } finally {
        release();
    }
});

// --- API Endpoints ---

// 1. Get Branches
app.get('/api/branches', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM branches ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Failed to fetch branches' });
    }
});

// 2. Login
app.post('/api/login', async (req, res) => {
    const { name, password, branch_id } = req.body;
    try {
        // Detailed Login Check
        const userResult = await pool.query('SELECT * FROM users WHERE name = $1 AND branch_id = $2', [name, branch_id]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'User not found in this branch (해당 지점에 계정이 없습니다)' });
        }

        const user = userResult.rows[0];
        if (user.password !== password) {
            return res.status(401).json({ success: false, message: 'Incorrect password (비밀번호가 틀렸습니다)' });
        }

        res.json({ success: true, user: { id: user.id, name: user.name, points: user.points, branch_id: user.branch_id } });

    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ success: false, message: 'Server Login Error: ' + err.message });
    }
});

// 2. Register (Optional, for admin usage)
app.post('/api/register', async (req, res) => {
    const { name, password, branch_id } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO users (name, password, branch_id) VALUES ($1, $2, $3) RETURNING id, name',
            [name, password, branch_id]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Registration failed: ' + err.message });
    }
});

// 4. Mission Result Handling (Log & Reward)
app.post('/api/mission_result', async (req, res) => {
    const { userId, sentence, result, attempts_used } = req.body;
    const REWARD_AMOUNT = 150;

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Log the attempt (Always log)
            await client.query(
                'INSERT INTO mission_logs (user_id, sentence, result, attempts_used) VALUES ($1, $2, $3, $4)',
                [userId, sentence, result, attempts_used]
            );

            // 2. Logic for Success
            if (result === 'success') {
                // Check if already rewarded today for ANY mission (Limit 150pts per day per user? Or per mission?)
                // Assuming 150pts max per day as per previous logic
                const checkLog = await client.query(
                    'SELECT * FROM daily_logs WHERE user_id = $1 AND date = CURRENT_DATE',
                    [userId]
                );

                if (checkLog.rows.length === 0) {
                    await client.query('INSERT INTO daily_logs (user_id, accumulated_points) VALUES ($1, $2)', [userId, REWARD_AMOUNT]);
                    await client.query('UPDATE users SET points = points + $1 WHERE id = $2', [REWARD_AMOUNT, userId]);
                }
            }

            await client.query('COMMIT');

            // Get updated user points
            const userRes = await client.query('SELECT points FROM users WHERE id = $1', [userId]);
            res.json({ success: true, points: userRes.rows[0].points });

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Mission Result Error:', err);
        res.status(500).json({ success: false, message: 'Server Log Error' });
    }
});

// 5. Reward (150 Points)
app.post('/api/reward', async (req, res) => {
    const { userId } = req.body;
    const REWARD_AMOUNT = 150;

    try {
        // Transaction for safety
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check if already rewarded today
            const checkLog = await client.query(
                'SELECT * FROM daily_logs WHERE user_id = $1 AND date = CURRENT_DATE',
                [userId]
            );

            if (checkLog.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Already rewarded today' });
            }

            // Insert Log
            await client.query(
                'INSERT INTO daily_logs (user_id, accumulated_points) VALUES ($1, $2)',
                [userId, REWARD_AMOUNT]
            );

            // Update User Points
            await client.query(
                'UPDATE users SET points = points + $1 WHERE id = $2',
                [REWARD_AMOUNT, userId]
            );

            await client.query('COMMIT');

            // Get updated points
            const userRes = await client.query('SELECT points FROM users WHERE id = $1', [userId]);
            res.json({ success: true, points: userRes.rows[0].points, message: '150 Points Rewarded!' });

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Reward processing failed' });
    }
});

// 6. Monthly Test Submission
app.post('/api/monthly_test', async (req, res) => {
    const { userId, score, result, month } = req.body;
    try {
        await pool.query(
            'INSERT INTO test_results (user_id, score, result, test_month) VALUES ($1, $2, $3, $4)',
            [userId, score, result, month]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Test Submit Error' });
    }
});

// 7. Admin Summary Endpoint
app.get('/api/admin/summary', async (req, res) => {
    try {
        // Daily Stats: Group by Branch -> User
        const date = new Date().toISOString().split('T')[0]; // Current Date

        const statsQuery = `
            SELECT 
                b.name as branch_name,
                u.name as user_name,
                COUNT(CASE WHEN ml.result = 'success' THEN 1 END) as success_count,
                COUNT(CASE WHEN ml.result = 'fail' THEN 1 END) as fail_count,
                MAX(ml.created_at) as last_attempt
            FROM users u
            JOIN branches b ON u.branch_id = b.id
            LEFT JOIN mission_logs ml ON u.id = ml.user_id AND DATE(ml.created_at) = CURRENT_DATE
            GROUP BY b.name, u.name
            ORDER BY b.name, u.name
        `;

        const statsResult = await pool.query(statsQuery);
        res.json({ success: true, data: statsResult.rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Admin API Error' });
    }
});

// 7. Rankings (Branch Average)
app.get('/api/rankings', async (req, res) => {
    try {
        // This query averages the test_results. 
        // For Phase 3 daily points ranking, we might want to sum daily_logs or users.points.
        // Let's return Total Points by Branch for now.
        const query = `
            SELECT b.name as branch_name, SUM(u.points) as total_points, COUNT(u.id) as user_count 
            FROM branches b
            JOIN users u ON b.id = u.branch_id
            GROUP BY b.id, b.name
            ORDER BY total_points DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/', (req, res) => {
    res.send('Everest Pay Server is Running');
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
