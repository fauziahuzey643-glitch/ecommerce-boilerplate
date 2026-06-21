const serverless = require('serverless-http');
const app = require('../server'); // Mengambil aplikasi Express utama Anda di luar

module.exports.handler = serverless(app);
