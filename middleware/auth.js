const jwt = require('jsonwebtoken');

// Sabit bir yedek değer BULUNDURMUYORUZ: kaynak koda yazılan herhangi bir
// "gizli" değer, repoya erişimi olan herkes için artık gizli değildir ve
// keyfi (ör. admin rolüne sahip) JWT sahteciliğine izin verir.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET ortam değişkeni tanımlı değil. Kimlik doğrulama güvenli değil.');
}

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
