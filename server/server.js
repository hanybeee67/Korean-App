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

        // --- MIGRATION FIX: Ensure columns exist if table was created earlier ---
        await client.query(`ALTER TABLE test_results ADD COLUMN IF NOT EXISTS result VARCHAR(10);`);
        await client.query(`ALTER TABLE mission_logs ADD COLUMN IF NOT EXISTS result VARCHAR(10);`);
        await client.query(`ALTER TABLE mission_logs ADD COLUMN IF NOT EXISTS sentence TEXT;`);
        // -----------------------------------------------------------------------

        // 6. Seed Data & Admin Logic Refined
        // 6.1. Migrate Legacy Names
        await client.query(`UPDATE branches SET name = '동탄 롯데백화점점' WHERE name = '동탄점'`);
        await client.query(`UPDATE branches SET name = '하남스타필드점' WHERE name = '하남점'`);
        // '스타필드점' is problematic. If '하남스타필드점' already exists, merging is hard without logic.
        // Instead, we will handle it in the "Cleanup" phase below by moving users.

        // 6.2. Define Target Branches (The Only 9 Allowed)
        const targetBranches = [
            '동대문 본점',
            '영등포점',
            '굿모닝시티점',
            '양재점',
            '수원 영통점',
            '하남스타필드점',
            '동탄 롯데백화점점',
            '마곡 원그로브점',
            '룸비니'
        ];

        // 6.3. Insert Missing Branches
        for (const branchName of targetBranches) {
            await client.query(`INSERT INTO branches (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [branchName]);
        }

        // 6.4. AGGRESSIVE CLEANUP: Remove any branch NOT in the list
        // First, Ensure '동대문 본점' id is available for fallback
        const defaultBranchRes = await client.query(`SELECT id FROM branches WHERE name = '동대문 본점'`);
        const defaultBranchId = defaultBranchRes.rows[0]?.id;

        if (defaultBranchId) {
            // Find invalid branches
            const invalidBranchesRes = await client.query(`SELECT id, name FROM branches WHERE name != ALL($1::text[])`, [targetBranches]);

            for (const row of invalidBranchesRes.rows) {
                console.log(`Cleaning up invalid branch: ${row.name} (Moving users to 동대문 본점)`);
                // Move users
                await client.query(`UPDATE users SET branch_id = $1 WHERE branch_id = $2`, [defaultBranchId, row.id]);
                // Delete branch
                await client.query(`DELETE FROM branches WHERE id = $1`, [row.id]);
            }
        }

        // 6.5. Admin User Check
        // Get '동대문 본점' ID again or use defaultBranchId
        if (defaultBranchId) {
            // Ensure 'admin' exists
            const adminResult = await client.query(`SELECT id FROM users WHERE name = 'admin'`);
            if (adminResult.rows.length === 0) {
                await client.query(`INSERT INTO users (name, password, branch_id, points) VALUES ('admin', '1234', $1, 1000)`, [defaultBranchId]);
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

// 1. Get Branches (Strict Order 1-9)
app.get('/api/branches', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM branches');

        // Define exact order
        const order = [
            '동대문 본점',
            '영등포점',
            '굿모닝시티점',
            '양재점',
            '수원 영통점',
            '하남스타필드점',
            '동탄 롯데백화점점',
            '마곡 원그로브점',
            '룸비니'
        ];

        // Sort in Javascript to guarantee exact sequence
        const sortedBranches = result.rows.sort((a, b) => {
            return order.indexOf(a.name) - order.indexOf(b.name);
        });

        res.json(sortedBranches);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Failed to fetch branches' });
    }
});

// 2. Login
app.post('/api/login', async (req, res) => {
    const { name, password, branch_name, branch_id } = req.body; // Support both for backward compatibility or transition
    try {
        let userResult;

        // Strategy: Try by branch_name first (Robust), then branch_id (Legacy)
        if (branch_name) {
            userResult = await pool.query(`
                SELECT u.* 
                FROM users u
                JOIN branches b ON u.branch_id = b.id
                WHERE u.name = $1 AND b.name = $2
            `, [name, branch_name]);
        } else if (branch_id) {
            userResult = await pool.query('SELECT * FROM users WHERE name = $1 AND branch_id = $2', [name, branch_id]);
        } else {
            return res.status(400).json({ success: false, message: 'Branch information missing' });
        }

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
    const { name, password, branch_name, branch_id } = req.body;
    try {
        let targetBranchId = branch_id;

        // Resolve Branch ID from Name if needed
        if (!targetBranchId && branch_name) {
            const branchRes = await pool.query('SELECT id FROM branches WHERE name = $1', [branch_name]);
            if (branchRes.rows.length > 0) {
                targetBranchId = branchRes.rows[0].id;
            } else {
                return res.status(400).json({ success: false, message: 'Invalid Branch Name' });
            }
        }

        if (!targetBranchId) {
            return res.status(400).json({ success: false, message: 'Branch ID required' });
        }

        const result = await pool.query(
            'INSERT INTO users (name, password, branch_id) VALUES ($1, $2, $3) RETURNING id, name',
            [name, password, targetBranchId]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Registration failed: ' + err.message });
    }
});

// 4. Mission Result Handling (Log & Reward)
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

            let message = 'Mission Completed';
            let newPoints = 0;

            // 2. Logic for Success: Check Daily Progress
            if (result === 'success') {
                // Get count of UNIQUE successful sentences for today (including this one)
                const todayStats = await client.query(
                    `SELECT COUNT(DISTINCT sentence) as cnt 
                     FROM mission_logs 
                     WHERE user_id = $1 
                     AND result = 'success' 
                     AND DATE(created_at) = CURRENT_DATE`,
                    [userId]
                );

                const successCount = parseInt(todayStats.rows[0].cnt);

                if (successCount === 1) {
                    // First mission done
                    message = '다음 문장도 성공하면 150원을 받아요!';
                } else if (successCount === 2) {
                    // Second mission done -> Check if reward already given today
                    const checkLog = await client.query(
                        'SELECT * FROM daily_logs WHERE user_id = $1 AND date = CURRENT_DATE',
                        [userId]
                    );

                    if (checkLog.rows.length === 0) {
                        // Grant Reward
                        await client.query('INSERT INTO daily_logs (user_id, accumulated_points) VALUES ($1, $2)', [userId, REWARD_AMOUNT]);
                        await client.query('UPDATE users SET points = points + $1 WHERE id = $2', [REWARD_AMOUNT, userId]);
                        message = '축하합니다! 150원 획득!';
                    } else {
                        // Already rewarded (maybe re-doing 2nd mission?)
                        message = '오늘의 미션을 모두 완료했습니다!';
                    }
                } else {
                    // More than 2?
                    message = '오늘의 미션을 모두 완료했습니다!';
                }
            } else {
                message = 'Try Again!';
            }

            await client.query('COMMIT');

            // Get updated user points
            const userRes = await client.query('SELECT points FROM users WHERE id = $1', [userId]);
            res.json({ success: true, points: userRes.rows[0].points, message: message });

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
// 7. Admin: Delete User
app.delete('/api/users/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Delete related data first (Manual Cascade)
            await client.query('DELETE FROM daily_logs WHERE user_id = $1', [userId]);
            await client.query('DELETE FROM mission_logs WHERE user_id = $1', [userId]);
            await client.query('DELETE FROM test_results WHERE user_id = $1', [userId]);
            await client.query('DELETE FROM users WHERE id = $1', [userId]);
            await client.query('COMMIT');
            res.json({ success: true, message: 'User deleted' });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Delete User Error:', err);
        // Expose error message for debugging
        res.status(500).json({ success: false, message: 'Failed to delete user: ' + err.message });
    }
});

// 8. Admin: Update User
app.put('/api/users/:id', async (req, res) => {
    const userId = req.params.id;
    const { name, points } = req.body;
    try {
        await pool.query(
            'UPDATE users SET name = COALESCE($1, name), points = COALESCE($2, points) WHERE id = $3',
            [name, points, userId]
        );
        res.json({ success: true, message: 'User updated' });
    } catch (err) {
        console.error('Update User Error:', err);
        res.status(500).json({ success: false, message: 'Failed to update user' });
    }
});

// 9. Admin Summary Endpoint
app.get('/api/admin/summary', async (req, res) => {
    try {
        const date = new Date();
        const year = date.getFullYear();
        const monthStr = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        const todayStr = date.toISOString().split('T')[0];

        // 1. User Stats (Financials + Today + Test)
        // Fixed: Use subqueries in SELECT to avoid grouping complexity or JOIN fan-out issues
        const userStatsQuery = `
            SELECT 
                u.id, -- Add ID for delete action
                b.name as branch_name,
                u.name as user_name,
                
                -- Today's Mission Status
                (SELECT COUNT(*) FROM mission_logs ml WHERE ml.user_id = u.id AND ml.result = 'success' AND DATE(ml.created_at) = CURRENT_DATE) as success_count,
                (SELECT COUNT(*) FROM mission_logs ml WHERE ml.user_id = u.id AND ml.result = 'fail' AND DATE(ml.created_at) = CURRENT_DATE) as fail_count,
                (SELECT MAX(created_at) FROM mission_logs ml WHERE ml.user_id = u.id AND DATE(ml.created_at) = CURRENT_DATE) as last_attempt,

                -- Financials (Daily Logs)
                COALESCE((SELECT accumulated_points FROM daily_logs dl WHERE dl.user_id = u.id AND dl.date = CURRENT_DATE), 0) as today_points,
                COALESCE((SELECT SUM(accumulated_points) FROM daily_logs dl WHERE dl.user_id = u.id AND TO_CHAR(dl.date, 'YYYY-MM') = '${monthStr}'), 0) as monthly_points,

                -- Monthly Test
                (SELECT score FROM test_results tr WHERE tr.user_id = u.id AND tr.test_month = '${monthStr}' LIMIT 1) as test_score,
                (SELECT result FROM test_results tr WHERE tr.user_id = u.id AND tr.test_month = '${monthStr}' LIMIT 1) as test_result

            FROM users u
            JOIN branches b ON u.branch_id = b.id
            ORDER BY b.name, u.name
        `;

        const userStats = await pool.query(userStatsQuery);

        // 2. Branch Rankings (Avg Test Score)
        // 2. Branch Rankings (Avg Test Score) -> Fix: Log all branches even if no data
        const rankingQuery = `
            SELECT 
                b.name as branch_name, 
                COALESCE(ROUND(AVG(tr.score), 1), 0) as avg_score, 
                COUNT(tr.id) as participant_count
            FROM branches b
            LEFT JOIN users u ON b.id = u.branch_id
            LEFT JOIN test_results tr ON u.id = tr.user_id AND tr.test_month = '${monthStr}'
            GROUP BY b.name
            ORDER BY avg_score DESC, b.name ASC
        `;

        const rankings = await pool.query(rankingQuery);

        res.json({
            success: true,
            data: userStats.rows,
            rankings: rankings.rows
        });

    } catch (err) {
        console.error('Admin API Error:', err);
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
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
