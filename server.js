const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mysql = require('mysql2');

const app = express();

// 1. KONEKSI DATABASE MYSQL CLOUD MENGGUNAKAN POOL (STANDAR SERVERLESS)
const db = mysql.createPool({
    host: 'aivencloud.com',
, // <--- PASTIKAN BERSIH SEPERTI INI TANPA :// DI DEPANNYA
    port: 20587,
    user: 'avnadmin',
    password: 'MASUKKAN_PASSWORD_ASLI_AIVEN_ANDA', 
    database: 'defaultdb',
    ssl: {
        rejectUnauthorized: false
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Pemicu otomatis membuat tabel saat serverless aktif
db.getConnection((err, connection) => {
    if (err) {
        console.error('Koneksi MySQL Cloud Gagal: ' + err.stack);
        return;
    }
    console.log('Koneksi Database MySQL Cloud Berhasil!');

    const sqlProducts = `
        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            price INT NOT NULL,
            image VARCHAR(255) NOT NULL
        );
    `;
    connection.query(sqlProducts, (err) => {
        if (err) console.error('Gagal membuat tabel products:', err);
    });

    const sqlOrders = `
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_name VARCHAR(255) NOT NULL,
            price INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    connection.query(sqlOrders, (err) => {
        if (err) console.error('Gagal membuat tabel orders:', err);
        connection.release(); // Melepas kembali koneksi ke pool
    });
});

// 2. KONFIGURASI MULTER (UNTUK UPLOAD GAMBAR)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// 3. MIDDLEWARE & SETTING
app.use(session({
    secret: 'kunci-rahasia-boilerplate',
    resave: false,
    saveUninitialized: true
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function getClientConfig() {
    delete require.cache[require.resolve('./config.json')];
    return require('./config.json');
}

// 4. RUTE HALAMAN UTAMA (KATALOG)
app.get('/', (req, res) => {
    const config = getClientConfig();
    db.query('SELECT * FROM products', (err, results) => {
        if (err) throw err;
        res.render('index', { config, products: results });
    });
});

// 5. RUTE LOGIN ADMIN
app.get('/login', (req, res) => {
    const config = getClientConfig();
    res.render('login', { config, error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin123') {
        req.session.isAdmin = true;
        return res.redirect('/admin');
    } else {
        const config = getClientConfig();
        return res.render('login', { config, error: 'Username atau Password Salah!' });
    }
});

// 6. DASHBOARD ADMIN
app.get('/admin', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/login');
    const config = getClientConfig();
    
    db.query('SELECT * FROM products', (err, products) => {
        if (err) throw err;
        db.query('SELECT * FROM orders ORDER BY created_at DESC', (err, orders) => {
            if (err) throw err;
            res.render('admin', { config, products, orders });
        });
    });
});

// 7. TAMBAH PRODUK BARU
app.post('/admin/add', upload.single('image'), (req, res) => {
    if (!req.session.isAdmin) return res.sendStatus(403);
    const { name, price } = req.body;
    const imagePath = req.file ? '/uploads/' + req.file.filename : '/d.jpg';

    const sql = 'INSERT INTO products (name, price, image) VALUES (?, ?, ?)';
    db.query(sql, [name, parseInt(price) || 0, imagePath], (err, result) => {
        if (err) throw err;
        res.redirect('/admin');
    });
});

// 8. HALAMAN EDIT PRODUK
app.get('/admin/edit/:id', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/login');
    const config = getClientConfig();
    const id = req.params.id;

    db.query('SELECT * FROM products WHERE id = ?', [id], (err, results) => {
        if (err) throw err;
        if (results.length === 0) return res.redirect('/admin');
        res.render('edit', { config, product: results[0] });
    });
});

app.post('/admin/edit/:id', (req, res) => {
    if (!req.session.isAdmin) return res.sendStatus(403);
    const id = req.params.id;
    const { name, price } = req.body;

    const sql = 'UPDATE products SET name = ?, price = ? WHERE id = ?';
    db.query(sql, [name, parseInt(price) || 0, id], (err, result) => {
        if (err) throw err;
        res.redirect('/admin');
    });
});

// 9. REKAM PESANAN WHATSAPP
app.post('/order/record', (req, res) => {
    const { name, price } = req.body;
    const sql = 'INSERT INTO orders (product_name, price) VALUES (?, ?)';
    db.query(sql, [name, parseInt(price) || 0], (err, result) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// 10. HAPUS PRODUK
app.get('/admin/delete/:id', (req, res) => {
    if (!req.session.isAdmin) return res.sendStatus(403);
    const id = req.params.id;

    db.query('SELECT image FROM products WHERE id = ?', [id], (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
            const fileGambar = results[0].image;
            if(fileGambar !== '/d.jpg') {
                const fullPath = path.join(__dirname, 'public', fileGambar);
                if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            }
        }

        db.query('DELETE FROM products WHERE id = ?', [id], (err, result) => {
            if (err) throw err;
            res.redirect('/admin');
        });
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = 4000;
app.listen(PORT, () => {
    console.log(`Server Super Boilerplate berjalan di http://localhost:${PORT}`);
});

module.exports = app;
