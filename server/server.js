const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve Static Files (Frontend) from parent directory
app.use(express.static(path.join(__dirname, '../')));

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// API Routes

// 1. Health Check (Renamed to prevent conflict with static index.html)
app.get('/health', (req, res) => {
    res.send('Everest-Pay Server is Running!');
});

// 2. Login or Register (Upsert User)
app.post('/api/login', async (req, res) => {
    const { name, branch } = req.body;
    try {
        // Check if user exists, if not create
        const userCheck = await pool.query('SELECT * FROM users WHERE name = $1 AND branch = $2', [name, branch]);

        let user;
        if (userCheck.rows.length > 0) {
            user = userCheck.rows[0];
        } else {
            const newUser = await pool.query(
                'INSERT INTO users (name, branch, total_points, level) VALUES ($1, $2, 0, 1) RETURNING *',
                [name, branch]
            );
            user = newUser.rows[0];
        }
        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Database Error' });
    }
});

// 3. Earn Points (Mission Complete)
app.post('/api/score/earn', async (req, res) => {
    const { userId, points, description } = req.body;
    try {
        // Update User Points
        const updateResult = await pool.query(
            'UPDATE users SET total_points = total_points + $1 WHERE id = $2 RETURNING total_points',
            [points, userId]
        );

        // Log Transaction
        await pool.query(
            'INSERT INTO logs (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
            [userId, 'EARN', points, description || 'Daily Mission']
        );

        res.json({ success: true, newBalance: updateResult.rows[0].total_points });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Database Error' });
    }
});

// 4. Get Leaderboard (Admin)
app.get('/api/admin/leaderboard', async (req, res) => {
    try {
        const result = await pool.query('SELECT name, branch, total_points FROM users ORDER BY total_points DESC LIMIT 50');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database Error' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
