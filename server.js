const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mysql = require('mysql2');

const app = express();

// 1. KONEKSI DATABASE MYSQL CLOUD (AIVEN)
const db = mysql.createConnection({
    host: '://aivencloud.com',
    port: 20587,
    user: 'avnadmin',
    password: 'MASUKKAN_PASSWORD_ASLI_AIVEN_ANDA_DI_SINI',
    database: 'defaultdb',
    ssl: {
        rejectUnauthorized: false
    }
});

db.connect((err) => {
    if (err) {
        console.error('Koneksi MySQL Cloud Gagal: ' + err.stack);
        return;
    }
    console.log('Koneksi Database MySQL Cloud Berhasil!');

    // OTOMATIS MEMBUAT TABEL PRODUCTS JIKA BELUM ADA DI CLOUD
    const sqlProducts = `
        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            price INT NOT NULL,
            image VARCHAR(255) NOT NULL
        );
    `;
    db.query(sqlProducts, (err) => {
        if (err) console.error('Gagal membuat tabel products:', err);
        else console.log('Tabel products cloud siap digunakan!');
    });

    // OTOMATIS MEMBUAT TABEL ORDERS JIKA BELUM ADA DI CLOUD
    const sqlOrders = `
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_name VARCHAR(255) NOT NULL,
            price INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    db.query(sqlOrders, (err) => {
        if (err) console.error('Gagal membuat tabel orders:', err);
        else console.log('Tabel orders cloud siap digunakan!');
    });
});


db.connect((err) => {
    if (err) {
        console.error('Koneksi MySQL Gagal: ' + err.stack);
        return;
    }
    console.log('Koneksi Database MySQL Berhasil!');
});

// 2. KONFIGURASI MULTER (UNTUK UPLOAD GAMBAR)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/'); // File disimpan di folder public/uploads
    },
    filename: (req, file, cb) => {
        // Mengubah nama file menjadi unik menggunakan waktu agar tidak bentrok
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

const configPath = path.join(__dirname, 'config.json');
function getClientConfig() {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// 4. RUTE HALAMAN UTAMA (KATALOG DARI DATABASE MYSQL)
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

// 6. DASHBOARD ADMIN (AMBIL DATA DARI MYSQL)
app.get('/admin', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/login');
    const config = getClientConfig();

    // Ambil data produk
    db.query('SELECT * FROM products', (err, products) => {
        if (err) throw err;

        // Ambil data pesanan terbaru
        db.query('SELECT * FROM orders ORDER BY created_at DESC', (err, orders) => {
            if (err) throw err;
            res.render('admin', { config, products, orders });
        });
    });
});


// 7. PROSES TAMBAH PRODUK BARU DENGAN UPLOAD GAMBAR (SIMPAN KE MYSQL)
app.post('/admin/add', upload.single('image'), (req, res) => {
    if (!req.session.isAdmin) return res.sendStatus(403);
    const { name, price } = req.body;

    // Path gambar yang disimpan ke database agar bisa dimuat browser
    const imagePath = req.file ? '/uploads/' + req.file.filename : '/d.jpg';

    const sql = 'INSERT INTO products (name, price, image) VALUES (?, ?, ?)';
    db.query(sql, [name, parseInt(price) || 0, imagePath], (err, result) => {
        if (err) throw err;
        console.log('Produk baru berhasil disimpan ke MySQL!');
        res.redirect('/admin');
    });
});

// 8. PROSES HAPUS PRODUK DAN MENGHAPUS FILE GAMBAR FISIKNYA
app.get('/admin/delete/:id', (req, res) => {
    if (!req.session.isAdmin) return res.sendStatus(403);
    const id = req.params.id;

    // Ambil info gambar untuk dihapus dari folder laptop Anda
    db.query('SELECT image FROM products WHERE id = ?', [id], (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
            const fileGambar = results[0].image;
            if (fileGambar !== '/d.jpg') {
                const fullPath = path.join(__dirname, 'public', fileGambar);
                if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            }
        }

        // Hapus baris data dari database MySQL
        db.query('DELETE FROM products WHERE id = ?', [id], (err, result) => {
            if (err) throw err;
            res.redirect('/admin');
        });
    });
});

// A. HALAMAN FORM EDIT PRODUK (GET)
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

// B. PROSES SIMPAN PERUBAHAN PRODUK (POST)
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


app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = 4000;
app.listen(PORT, () => {
    console.log(`Server Super Boilerplate berjalan di http://localhost:${PORT}`);
});

module.exports = app;



// A. PROSES REKAM KLIK BELI (POST)
app.post('/order/record', (req, res) => {
    const { name, price } = req.body;
    const sql = 'INSERT INTO orders (product_name, price) VALUES (?, ?)';
    db.query(sql, [name, parseInt(price) || 0], (err, result) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// B. TAMPILKAN RIWAYAT PESANAN DI HALAMAN ADMIN (KITA UPDATE RUTE /ADMIN YANG SUDAH ADA)
