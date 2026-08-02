const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'adimkasasi_pro_v2_secret_key_2026_super_secure';

module.exports = function (req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Erişim reddedildi. Oturum açmanız gerekiyor." });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: "Geçersiz veya süresi dolmuş oturum token'ı." });
    }
};

module.exports.JWT_SECRET = JWT_SECRET;
