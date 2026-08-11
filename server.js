const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const User = require('./models/User');
const Reward = require('./models/Reward');
const Claim = require('./models/Claim');
const Donation = require('./models/Donation');
const Charity = require('./models/Charity');
const authMiddleware = require('./middleware/auth');
const { JWT_SECRET } = authMiddleware;

// Gerçek Google Sign-In (Authorization Code akışı): kimlik doğrulaması
// google-auth-library ile Google'ın kendi sunucularına karşı doğrulanır.
// Google Cloud Console'da tanımlı "Authorized redirect URI" ile
// GOOGLE_CALLBACK_URL BİREBİR eşleşmelidir.
const googleClient = (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CALLBACK_URL)
    : null;
if (!googleClient) {
    console.warn('⚠️ Google OAuth ortam değişkenleri eksik, Google ile giriş devre dışı.');
}

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Bağlantı dizesi yalnızca ortam değişkeninden okunur; kaynak kodda düz metin
// kimlik bilgisi bulundurmayız (daha önce burada sabit kodlanmış bir şifre vardı
// ve bu değer zaten GitHub'a push edilmişti - Atlas şifresinin rotasyona
// sokulması gerekiyor).
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('❌ MONGO_URI ortam değişkeni tanımlı değil. Sunucu veritabanına bağlanamayacak.');
}

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('MongoDB Atlas (v2.6 DB) bağlandı!');
        await seedDemoData();
    })
    .catch((err) => console.log('MongoDB bağlantı hatası:', err));

// Admin Yetki Kontrol Middleware
async function adminMiddleware(req, res, next) {
    if (!req.user || (req.user.role !== 'admin' && req.user.email !== 'admin@adimkasasi.com')) {
        return res.status(403).json({ error: "Bu alana sadece yönetici erişebilir!" });
    }
    next();
}

// Demo Verilerini Tohumlama (Seed)
async function seedDemoData() {
    try {
        const rewardCount = await Reward.countDocuments();
        if (rewardCount === 0) {
            await Reward.insertMany([
                { title: '🥗 Kişiye Özel 7 Günlük Diyetisyen Planı', description: 'Boy ve kilonuza göre hazırlanmış bilimsel 7 günlük diyet ve beslenme programı.', pointsCost: 10, category: 'Kişisel Diyet', code: 'DIET-PLAN-CUSTOM', icon: '🥗', stock: 999 },
                { title: 'Starbucks Dijital Kahve Kodu', description: 'Tüm küçük boy kahvelerde geçerli e-kod.', pointsCost: 5, category: 'Dijital İçecek', code: 'STB-DIGITAL-8842', icon: '☕', stock: 100 },
                { title: 'Spotify Premium 1 Ay Dijital Kod', description: '1 Aylık Bireysel Spotify üyelik dijital kodu.', pointsCost: 8, category: 'Dijital Üyelik', code: 'SPOTIFY-1MO-DIGI', icon: '🎵', stock: 80 },
                { title: 'Valorant 1000 VP Dijital Kodu', description: 'Riot Games mağazasında geçerli dijital VP kodu.', pointsCost: 20, category: 'Dijital Oyun Kodu', code: 'VALO-1000VP-DIGI', icon: '🎯', stock: 45 },
                { title: 'Steam 100 TL Dijital E-Pin Kodu', description: 'Steam cüzdanınıza bakiye ekleyen E-Pin kodu.', pointsCost: 25, category: 'Dijital Oyun Kodu', code: 'STEAM-100-DIGI', icon: '🎮', stock: 60 },
                { title: 'Google Play 100 TL Dijital Kodu', description: 'Play Store hesabınıza bakiye ekleyen dijital kod.', pointsCost: 25, category: 'Dijital Market Kodu', code: 'GPLAY-100-DIGI', icon: '📱', stock: 50 },
                { title: 'Trendyol 200 TL Dijital Hediye Kodu', description: 'Trendyol cüzdanım alanında anında aktif olan kod.', pointsCost: 45, category: 'Dijital Alışveriş', code: 'TRND-200-DIGI', icon: '🛍️', stock: 30 }
            ]);
        }

        const charityCount = await Charity.countDocuments();
        if (charityCount === 0) {
            await Charity.insertMany([
                { title: 'HAAP Barınak Mama Bağışı', description: '1.00 YP = 1 Kg Mama', pointsCost: 1.00, icon: '🐶' },
                { title: 'TEMA Geleceğe Nefes Fidanı', description: '2.00 YP = 1 Adet Fidan', pointsCost: 2.00, icon: '🌲' },
                { title: 'LÖSEV Çocuk Sağlık Paketi', description: '3.00 YP = Sağlık Desteği', pointsCost: 3.00, icon: '❤️' },
                { title: 'Köy Okulları Kitap Seti', description: '2.50 YP = Eğitime Destek', pointsCost: 2.50, icon: '📚' }
            ]);
        }

        // Demo Admin Hesabı: SADECE hiç yoksa oluşturulur. Var olan hesaba veya
        // diğer kullanıcılara ASLA dokunulmaz - bu fonksiyon her sunucu
        // başlangıcında (her deploy/restart'ta) çalışır; önceden burada tüm
        // kullanıcıların adım/puan/kalorisini sıfırlayan bir updateMany vardı ve
        // bu, üretimde her yeniden başlatmada gerçek kullanıcıların TÜM
        // ilerlemesini siliyordu.
        let adminUser = await User.findOne({ email: 'admin@adimkasasi.com' });
        if (!adminUser) {
            const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD || require('crypto').randomBytes(9).toString('base64').replace(/[+/=]/g, '');
            const adminPassword = await bcrypt.hash(initialAdminPassword, 10);
            adminUser = await User.create({
                name: 'Sistem Yöneticisi 👑',
                email: 'admin@adimkasasi.com',
                password: adminPassword,
                role: 'admin',
                steps: 0,
                unconvertedSteps: 0,
                points: 0,
                calories: 0
            });
            console.log(`v2.6 Admin hesabı oluşturuldu: admin@adimkasasi.com / ${initialAdminPassword} (bu şifreyi kaydedin, bir daha gösterilmeyecek)`);
        }
    } catch (err) {
        console.error('Seed hatası:', err);
    }
}

function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

// Günlük sıfırlama kontrolü tek bir yerde ve ATOMİK: önceden bu, User
// dokümanını okuyup JS'de mutasyona uğratıp save() ile tam doküman olarak geri
// yazan bir yardımcıydı (bkz. git geçmişi) - eşzamanlı iki istek aynı anda bu
// sıfırlamayı yaparsa "lost update" ile birinin yazdığı diğer alanlar
// (points, adWatchesToday vb.) kaybolabiliyordu. Artık koşullu bir
// updateOne: yalnızca lastStepDate bugünden farklıysa uygulanır: eşzamanlı
// çağrılardan ilki alanları sıfırlayıp lastStepDate'i bugüne çeker, aynı anda
// gelen diğerleri artık koşula uymadığı için no-op olur - yarış durumu yok.
async function atomicEnsureDailyReset(userId, today) {
    await User.updateOne(
        { _id: userId, lastStepDate: { $ne: today } },
        { $set: { todayConvertedSteps: 0, waterGlasses: 0, completedQuests: [], adWatchesToday: 0, lastStepDate: today } }
    );
}

// Bakiye harcayan atomik güncellemelerde IEEE754 float birikim gürültüsüne
// (ör. depolanan puanın matematiksel olarak 5.00 olması gerekirken
// 4.999999999999999 olarak saklanması) karşı küçük bir tolerans - "bakiyem
// yetiyor görünüyor ama reddediliyor" şikayetini engeller, anlamlı bir açık
// bakiye (overdraft) oluşturmaz.
const POINTS_EPSILON = 1e-6;

// v2.7: Basit Oyunlar - geçerli oyun kimlikleri (client'ın gönderdiği
// gameId, /games/start içinde bu listeye karşı doğrulanır).
const GAME_IDS = ['slice', 'balance', 'runner'];

// Haftanın Pazartesi'sini (UTC) YYYY-MM-DD olarak döndürür - davet ödülü
// haftalık limitinin (10 kişi/hafta) sıfırlanma noktasını belirler.
function getWeekStartStr() {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Pazar..6=Cumartesi
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + diffToMonday);
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString().split('T')[0];
}

function calculateLevel(steps) {
    if (steps >= 150000) return { level: 4, title: 'Efsane', multiplier: 2.0 };
    if (steps >= 75000) return { level: 3, title: 'Maratoncu', multiplier: 1.5 };
    if (steps >= 25000) return { level: 2, title: 'Tempolu', multiplier: 1.25 };
    return { level: 1, title: 'Yürüyüşçü', multiplier: 1.0 };
}

// --- PUBLIC AUTH ROTALARI ---

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/v2/register', async (req, res) => {
    try {
        const { name, email, password, height, weight, refCode } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: "Tüm alanları doldurun." });

        const cleanName = String(name).trim();
        const cleanEmail = String(email).trim().toLowerCase();
        if (!cleanName) return res.status(400).json({ error: "Lütfen adınızı girin." });
        if (!EMAIL_REGEX.test(cleanEmail)) return res.status(400).json({ error: "Geçersiz e-posta formatı." });
        if (String(password).length < 6) return res.status(400).json({ error: "Şifre en az 6 karakter olmalıdır." });

        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) return res.status(400).json({ error: "E-posta kullanımda." });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            name: cleanName,
            email: cleanEmail,
            password: hashedPassword,
            height: height || 175,
            weight: weight || 70,
            steps: 0,
            unconvertedSteps: 0,
            points: 0,
            calories: 0,
            streak: 1,
            level: 1,
            multiplier: 1.0,
            lastStepDate: getTodayStr(),
            badges: [{ name: 'Aramıza Hoş Geldin!', icon: '👟' }]
        });

        // MongoDB _id benzersiz olduğu için davet kodu için ayrıca çakışma
        // kontrolü yapmaya gerek yok - _id'nin son 6 karakteri her zaman tektir.
        newUser.referralCode = newUser._id.toString().slice(-6).toUpperCase();

        if (refCode && typeof refCode === 'string') {
            const referrer = await User.findOne({ referralCode: refCode.trim().toUpperCase() });
            if (referrer) newUser.referredBy = referrer._id;
        }

        await newUser.save();
        const token = jwt.sign({ id: newUser._id, email: newUser.email, name: newUser.name, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });

        const userSafe = newUser.toObject();
        delete userSafe.password;
        res.status(201).json({ message: "Hesap oluşturuldu!", token, user: userSafe });
    } catch (err) {
        res.status(500).json({ error: "Kayıt hatası." });
    }
});

app.post('/api/v2/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "E-posta ve şifre zorunludur." });
        const user = await User.findOne({ email: String(email).trim().toLowerCase() });
        if (!user) return res.status(400).json({ error: "E-posta veya şifre hatalı!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "E-posta veya şifre hatalı!" });

        const today = getTodayStr();
        let responseUser = user;
        if (user.lastStreakDate !== today) {
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            const newStreak = (user.lastStreakDate === yesterday) ? user.streak + 1 : 1;

            // Bug-fix (yarış durumu): "bugün streak zaten güncellendi mi"
            // kontrolü ve streak/tarih güncellemesi tek atomik işlemde;
            // lastStreakDate != today koşulu sağlanmazsa (ör. eşzamanlı bir
            // adım senkronu veya ikinci giriş isteği zaten güncellemiş) null
            // döner - günde birden fazla artış olmaz. newStreak, bu bloğun
            // başında okunan tek bir snapshot'tan (user.streak/lastStreakDate)
            // hesaplanır.
            const updated = await User.findOneAndUpdate(
                { _id: user._id, lastStreakDate: { $ne: today } },
                { $set: { streak: newStreak, lastStreakDate: today } },
                { new: true }
            ).select('-password');

            // Koşul sağlanmadıysa (yarış kaybedildi) güncel veriyi tekrar
            // oku ki cevapta bayat streak/lastStreakDate dönmeyelim.
            responseUser = updated || await User.findById(user._id).select('-password');
        }

        const token = jwt.sign({ id: user._id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        const userSafe = responseUser.toObject();
        delete userSafe.password;
        res.json({ message: "Giriş başarılı!", token, user: userSafe });
    } catch (err) {
        res.status(500).json({ error: "Giriş hatası." });
    }
});

// Gerçek Google Sign-In: tarayıcıyı Google'ın onay ekranına yönlendirir.
// (Önceki sahte sürüm jwt.decode() kullanıyordu - imza DOĞRULAMASI yapmıyordu
// ve hatta bir token olmadan bile client'ın gönderdiği çıplak {email} alanına
// körü körüne güveniyordu, yani herhangi biri "admin@adimkasasi.com" gönderip
// gerçek yönetici hesabına şifresiz girebiliyordu.)
app.get('/api/v2/auth/google', (req, res) => {
    if (!googleClient) return res.status(503).send('Google ile giriş şu anda yapılandırılmamış.');
    // Native Android: index.html bu uç noktayı ?platform=native ile Custom Tab
    // (Browser plugin) içinde açar. Google'ın onay ekranı embedded WebView'i
    // reddettiği için bu zorunlu - ama bu yüzden callback'in kullanıcıyı normal
    // https sayfasına değil, uygulamaya geri dönen bir deep link'e yönlendirmesi
    // gerekiyor. Sunucu tarafında oturum/state tutmadan bu bilgiyi callback'e
    // taşımanın yolu Google'ın aynen geri yansıttığı "state" parametresi.
    const options = {
        access_type: 'online',
        scope: ['profile', 'email'],
        prompt: 'select_account'
    };
    if (req.query.platform === 'native') {
        options.state = 'native';
    }
    const url = googleClient.generateAuthUrl(options);
    res.redirect(url);
});

// Native akışta (?platform=native ile başlayan, state='native' taşıyan) hata/iptal
// durumunda kullanıcıyı yine /index.html?googleError=1'e (düz https) yönlendirmek,
// onu Custom Tab içinde mahsur bırakır - orijinal bug'ın ta kendisi. State='native'
// ise deep link'e (adimkasasi://auth-callback?error=1) yönlendirmemiz gerekiyor ki
// uygulama geri planı yakalayıp kullanıcıyı uygulama içine döndürebilsin.
function googleAuthFailRedirect(req, res) {
    if (req.query.state === 'native') return res.redirect('adimkasasi://auth-callback?error=1');
    return res.redirect('/index.html?googleError=1');
}

// Native akışın tek kullanımlık, kısa ömürlü değişim kodları: gerçek JWT'yi
// adimkasasi:// gibi bir custom scheme deep link'ine koymak istemiyoruz çünkü bu
// şema başka bir (kötü niyetli/klon) uygulama tarafından da intent-filter ile
// talep edilebilir - Android bir seçim ekranı gösterir ama kullanıcı yanlış
// uygulamayı seçerse token o uygulamaya gider. Bunun yerine deep link'e rastgele,
// tahmin edilemez, tek kullanımlık bir kod koyup gerçek JWT'yi sadece sunucu
// belleğinde bu koda eşleyerek 60 saniye saklıyoruz; native taraf kodu HTTPS
// üzerinden /api/v2/auth/exchange'e POST edip gerçek token'ı öyle alır.
const googleNativeExchangeCodes = new Map(); // code -> { token, expiresAt }
const GOOGLE_NATIVE_EXCHANGE_TTL_MS = 60 * 1000;

function createGoogleNativeExchangeCode(token) {
    const code = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + GOOGLE_NATIVE_EXCHANGE_TTL_MS;
    googleNativeExchangeCodes.set(code, { token, expiresAt });
    setTimeout(() => googleNativeExchangeCodes.delete(code), GOOGLE_NATIVE_EXCHANGE_TTL_MS).unref();
    return code;
}

// Google Cloud Console'da tanımlı "Authorized redirect URI" ile bu yolun
// (GOOGLE_CALLBACK_URL) BİREBİR aynı olması gerekir.
app.get('/auth/google/callback', async (req, res) => {
    try {
        if (!googleClient) return googleAuthFailRedirect(req, res);
        const { code } = req.query;
        if (!code) return googleAuthFailRedirect(req, res);

        const { tokens } = await googleClient.getToken(code);
        const ticket = await googleClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email) return googleAuthFailRedirect(req, res);

        const email = payload.email.toLowerCase();
        const name = payload.name || email.split('@')[0];

        let user = await User.findOne({ email });
        if (!user) {
            // Google ile gelen kullanıcı hiçbir zaman bir şifre belirlemez;
            // şema password alanını zorunlu kıldığı için rastgele, asla
            // kullanıcıya gösterilmeyen bir değer üretip hashliyoruz.
            const dummyPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
            user = await User.create({
                name,
                email,
                password: dummyPassword,
                lastStepDate: getTodayStr(),
                badges: [{ name: 'Google İle Bağlandı', icon: '🌐' }]
            });
            user.referralCode = user._id.toString().slice(-6).toUpperCase();
            await user.save();
        }

        const token = jwt.sign({ id: user._id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

        // Native Android akışı /api/v2/auth/google?platform=native ile başladıysa
        // state='native' burada aynen geri gelir. Bu durumda kullanıcıyı düz bir
        // https sayfasına değil (o zaman Chrome/Custom Tab içinde mahsur kalır,
        // bkz. bug raporu), uygulamanın AndroidManifest'te tanımlı custom scheme
        // intent-filter'ının yakalayacağı bir deep link'e yönlendiriyoruz. Gerçek
        // JWT'yi deep link'e koymuyoruz (custom scheme başka bir uygulama
        // tarafından da talep edilebilir, bkz. createGoogleNativeExchangeCode
        // üzerindeki not) - tek kullanımlık bir değişim kodu koyup native taraf
        // bunu HTTPS üzerinden /api/v2/auth/exchange'e POST ederek gerçek token'ı
        // alıyor.
        if (req.query.state === 'native') {
            const exchangeCode = createGoogleNativeExchangeCode(token);
            return res.redirect(`adimkasasi://auth-callback?code=${encodeURIComponent(exchangeCode)}`);
        }

        res.redirect(`/dashboard.html?token=${encodeURIComponent(token)}`);
    } catch (err) {
        console.error('Google OAuth callback hatası:', err.message);
        googleAuthFailRedirect(req, res);
    }
});

// Native Android akışının tek kullanımlık değişim kodunu gerçek JWT ile
// değiştirdiği uç nokta. Kod bulunduğunda hemen silinir (tek kullanımlık) ve
// süresi geçmişse (60sn) 400 döner.
app.post('/api/v2/auth/exchange', (req, res) => {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Kod eksik.' });

    const entry = googleNativeExchangeCodes.get(code);
    googleNativeExchangeCodes.delete(code); // tek kullanımlık: bulunsa da bulunmasa da sil

    if (!entry || entry.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Kod geçersiz veya süresi dolmuş.' });
    }

    res.json({ token: entry.token });
});

app.get('/api/v2/user/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

        const claims = await Claim.find({ userId: user._id }).sort({ claimedAt: -1 });
        const donations = await Donation.find({ userId: user._id }).sort({ donatedAt: -1 });

        // Bug-fix: bu salt-okunur uç nokta artık KOŞULSUZ save() ÇAĞIRMIYOR.
        // steps/add ve steps/convert her adım/dönüştürme sonrası level/multiplier'ı
        // zaten kendi atomik güncellemeleri içinde persist ediyor. Önceden bu
        // route her çağrıda tüm dokümanı save() ile geri yazıyordu; dashboard.html
        // bunu neredeyse her kullanıcı eylemi sonrası çağırdığı ve pedometer da
        // 5sn'de bir arka planda senkronize ettiği için, buradaki bayat
        // in-memory kopya başka bir uç noktanın az önce yazdığı taze
        // points/adWatchesToday/vb. değerlerini sessizce eski haline
        // döndürebiliyordu (gerçek ilerleme kaybı, normal kullanımda bile).
        // Sadece DB'deki level/multiplier GERÇEKTEN bayatsa, yalnızca bu iki
        // türetilmiş alanı atomik olarak düzeltiriz.
        const lvlData = calculateLevel(user.steps);
        if (user.level !== lvlData.level || user.multiplier !== lvlData.multiplier) {
            await User.updateOne({ _id: user._id }, { $set: { level: lvlData.level, multiplier: lvlData.multiplier } });
            user.level = lvlData.level;
            user.multiplier = lvlData.multiplier;
        }

        // v2.7: her oyun için "bugün ilk temiz oyun ödülü alındı mı" bayrağı -
        // depolanmıyor, levelInfo gibi okuma anında gameStats'tan türetiliyor.
        const today = getTodayStr();
        const gamesClaimedToday = { slice: false, balance: false, runner: false };
        (user.gameStats || []).forEach(g => { if (g.lastClaimDate === today) gamesClaimedToday[g.gameId] = true; });

        res.json({ user, claims, donations, levelInfo: lvlData, gamesClaimedToday });
    } catch (err) {
        res.status(500).json({ error: "Veri alınamadı." });
    }
});

app.post('/api/v2/steps/add', authMiddleware, async (req, res) => {
    try {
        const amount = parseInt(req.body.amount);
        // Sensör periyodik olarak (5sn'de bir) küçük miktarlar gönderir; makul
        // olmayan büyük bir tek seferlik miktarı reddet (manipülasyona karşı
        // temel önlem - istemci tarafından hesaplanan herhangi bir değeri
        // sınırsız kabul etmiyoruz).
        if (!Number.isFinite(amount) || amount <= 0 || amount > 2000) {
            return res.status(400).json({ error: "Geçersiz adım miktarı." });
        }
        // v2 Android native wrapper: istemci isteğe bağlı olarak bu senkronun
        // kaynağını bildirebilir (native foreground service TYPE_STEP_COUNTER'dan
        // mı, yoksa web devicemotion sezgiselinden mi geldi). Bilinmeyen/eksik
        // değer sessizce mevcut varsayılana ('web_motion') düşer - eski istemciler
        // (source göndermeyen) davranışta hiçbir değişiklik görmez.
        const allowedSources = ['web_motion', 'native_sensor'];
        const source = allowedSources.includes(req.body.source) ? req.body.source : 'web_motion';
        const userId = req.user.id;
        const today = getTodayStr();
        await atomicEnsureDailyReset(userId, today);

        // weight nadiren değişir ve kalori hesaplaması için sadece hafif bir
        // katsayı olarak kullanılır (bakiye/puan gibi yarış-kritik bir alan
        // değildir) - ayrı, tek alanlık bir okuma burada güvenlidir.
        const weightDoc = await User.findById(userId).select('weight');
        if (!weightDoc) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
        const calFactorPerStep = (weightDoc.weight || 70) * 0.00057;
        const burnedCaloriesDelta = Math.round(amount * calFactorPerStep * 10) / 10;

        // Asıl yarış durumu düzeltmesi: steps/unconvertedSteps/calories artık
        // atomik $inc ile uygulanıyor (önceden findById -> JS'de mutasyon ->
        // save() ile tam doküman üzerine yazılıyordu; eşzamanlı N istek aynı
        // bayat anlık görüntüden okuyup üzerine yazdığı için adımların çoğu
        // kayboluyordu - "lost update").
        const updated = await User.findOneAndUpdate(
            { _id: userId },
            {
                $inc: { steps: amount, unconvertedSteps: amount, calories: burnedCaloriesDelta },
                $set: { lastStepSource: source }
            },
            { new: true }
        ).select('-password');
        if (!updated) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

        // level/multiplier tamamen $inc'in döndürdüğü GERÇEK (atomik olarak
        // güncellenmiş) steps değerinden türetilir, bu yüzden burada da bir
        // yarış durumu oluşmaz.
        const lvlData = calculateLevel(updated.steps);
        if (updated.level !== lvlData.level || updated.multiplier !== lvlData.multiplier) {
            await User.updateOne({ _id: userId }, { $set: { level: lvlData.level, multiplier: lvlData.multiplier } });
            updated.level = lvlData.level;
            updated.multiplier = lvlData.multiplier;
        }

        res.json({ message: `${amount} adım senkronize edildi!`, user: updated });
    } catch (err) {
        res.status(500).json({ error: "Adım ekleme hatası." });
    }
});

app.post('/api/v2/user/update-body', authMiddleware, async (req, res) => {
    try {
        const { height, weight } = req.body;
        const updates = {};

        // Bug-fix: aralık doğrulaması yoktu - height=1, weight=999999 gibi
        // gerçekçi olmayan değerler sessizce kaydedilip kalori yakımı, BMI ve
        // diyet planı hesaplamalarını (bkz. /api/v2/diet/get-plan) alt tarafta
        // bozuyordu. Makul insan aralıklarıyla sınırlandırılır.
        if (height !== undefined && height !== null && height !== '') {
            const h = parseInt(height);
            if (!Number.isFinite(h) || h < 100 || h > 250) {
                return res.status(400).json({ error: "Geçersiz boy değeri (100-250 cm arasında olmalıdır)." });
            }
            updates.height = h;
        }
        if (weight !== undefined && weight !== null && weight !== '') {
            const w = parseInt(weight);
            if (!Number.isFinite(w) || w < 20 || w > 300) {
                return res.status(400).json({ error: "Geçersiz kilo değeri (20-300 kg arasında olmalıdır)." });
            }
            updates.weight = w;
        }

        const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true }).select('-password');
        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
        res.json({ message: `Vücut ölçüleriniz güncellendi! (${user.height} cm, ${user.weight} kg)`, user });
    } catch (err) {
        res.status(500).json({ error: "Ölçü güncelleme hatası." });
    }
});

// KİŞİYE ÖZEL DİYET HESAPLAMA
app.get('/api/v2/diet/get-plan', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        const height = user.height || 175;
        const weight = user.weight || 70;

        const bmr = Math.round(10 * weight + 6.25 * height - 5 * 25 + 5);
        const targetDailyCalorie = Math.round(bmr + 300 - 350);

        const dietPlan = {
            userStats: { height, weight, bmr, targetDailyCalorie },
            meals: [
                { title: '🌅 Sabah (Kahvaltı)', items: [`2 Adet Haşlanmış Yumurta (${Math.round(weight*0.4)}g protein)`, '30g Lor / Beyaz Peynir', '5 Adet Az Tuzlu Yeşil Zeytin', 'Bol Salatalık, Maydanoz ve Yeşillik', '1 Dilim Tam Buğday Ekmeği'] },
                { title: '☀️ Öğle Yemeği', items: [`${Math.round(weight * 2.2)}g Izgara Tavuk / Hindi veya Balık`, '1 Kase Yağsız Sebze Çorbası', '4 Yemek Kaşığı Haşlanmış Karabuğday / Bulgur', 'Bol Limonlu Roka & Marul Salatası'] },
                { title: '☕ İkindi (Ara Öğün)', items: ['1 Adet Yeşil Elma', '5 Adet Çiğ Badem veya 2 Ceviz İçi', '1 Kupa Şekersiz Yeşil Çay'] },
                { title: '🌙 Akşam Yemeği', items: ['1 Porsiyon Olive Oil Zeytinyağlı Sebze Yemeği', '1 Kase Ev Yapımı Yarım Yağlı Yoğurt', '1 Dilim Siyez / Çavdar Ekmeği'] }
            ],
            waterTarget: '2.5 Litre / Gün',
            notes: 'Mifflin-St Jeor metabolizma denklemlerine uygundur.'
        };

        res.json({ dietPlan });
    } catch (err) {
        res.status(500).json({ error: "Diyet planı oluşturulamadı." });
    }
});

// Adımları YürüPara'ya Çevir
app.post('/api/v2/steps/convert', authMiddleware, async (req, res) => {
    try {
        const requestedDouble = req.body.isDouble === true;
        const userId = req.user.id;
        const today = getTodayStr();
        await atomicEnsureDailyReset(userId, today);

        const DAILY_MAX_CAP = 15000;

        // Bug-fix (yarış durumu): dönüştürülecek miktar mevcut bakiyeye bağlı
        // olduğu için (sabit bir $inc değil) tek bir kör atomik komutla ifade
        // edilemez. Bunun yerine iyimser eşzamanlılık kontrolü (compare-and-swap)
        // kullanılır: bir anlık görüntü okunur, o anki değerlere göre değişiklik
        // hesaplanır, ardından güncelleme yalnızca okunan değerler HÂLÂ aynıysa
        // uygulanır (findOneAndUpdate'in sorgu koşulu). Aradan başka bir istek
        // aynı alanları değiştirmişse koşul eşleşmez (null döner) ve taze bir
        // anlık görüntüyle yeniden denenir - "lost update" oluşamaz.
        let updated = null;
        let convertAmount = 0;
        let earnedPoints = 0;
        let usedDouble = false;

        for (let attempt = 0; attempt < 5 && !updated; attempt++) {
            const snapshot = await User.findById(userId).select('-password');
            if (!snapshot) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

            if (snapshot.todayConvertedSteps >= DAILY_MAX_CAP) {
                // capReached: istemci bu bayrağı görünce Premium paywall ekranını açar.
                return res.status(400).json({ error: "Günlük maksimum 15.000 adım dönüştürme limitine ulaştınız!", capReached: true });
            }

            const availableToConvert = Math.min(snapshot.unconvertedSteps, DAILY_MAX_CAP - snapshot.todayConvertedSteps);
            if (availableToConvert < 1000) {
                return res.status(400).json({ error: "Dönüştürmek için en az 1.000 birikmiş adımınız olmalıdır." });
            }

            convertAmount = Math.floor(availableToConvert / 1000) * 1000;
            const lvlData = calculateLevel(snapshot.steps);

            // Bug-fix: isDouble istemciden gelen bir bayraktan doğrudan
            // güvenilmiyor. Yalnızca /api/v2/ads/confirm-double tarafından
            // atomik olarak set edilmiş, 60sn içinde ve HENÜZ tüketilmemiş
            // pendingDoubleBoost varsa 2x uygulanır; koşul aşağıdaki
            // findOneAndUpdate'in match kısmına dahil edilerek AYNI atomik
            // işlemde tüketilir (ayrı bir "oku sonra temizle" adımı YOK, aksi
            // halde CAS başarısız olup yeniden denendiğinde bonus zaten
            // tüketilmiş ama harcanmamış olabilirdi).
            const boostCandidate = requestedDouble
                && snapshot.pendingDoubleBoost
                && snapshot.pendingDoubleBoostAt
                && (Date.now() - new Date(snapshot.pendingDoubleBoostAt).getTime() < 60000);

            let pointsDelta = (convertAmount / 1000) * 0.10 * lvlData.multiplier;
            if (boostCandidate) pointsDelta *= 2;
            pointsDelta = Math.round(pointsDelta * 100) / 100;

            const matchCond = {
                _id: userId,
                unconvertedSteps: snapshot.unconvertedSteps,
                todayConvertedSteps: snapshot.todayConvertedSteps,
                points: snapshot.points
            };
            const setOps = {
                unconvertedSteps: snapshot.unconvertedSteps - convertAmount,
                todayConvertedSteps: snapshot.todayConvertedSteps + convertAmount,
                points: Math.round((snapshot.points + pointsDelta) * 100) / 100,
                level: lvlData.level,
                multiplier: lvlData.multiplier
            };
            if (boostCandidate) {
                matchCond.pendingDoubleBoost = true;
                setOps.pendingDoubleBoost = false;
                setOps.pendingDoubleBoostAt = null;
            }

            const result = await User.findOneAndUpdate(matchCond, { $set: setOps }, { new: true }).select('-password');
            if (result) {
                updated = result;
                earnedPoints = pointsDelta;
                usedDouble = boostCandidate;
            }
        }

        if (!updated) {
            return res.status(409).json({ error: "Çok yoğun eşzamanlı istek, lütfen tekrar deneyin." });
        }

        // Davet Et Kazan: davet edilen kişi İLK kez adım dönüştürdüğünde (sadece
        // kayıt olmak yetmez - sahte hesaplarla anlık ödül toplamayı engeller)
        // daveti getiren kişiye tek seferlik 10 YP verilir, haftada en fazla 10 kişi.
        //
        // Bug-fix (yarış durumu): referralRewardGiven'ın "okunup sonra
        // yazılması" ve referrer'ın haftalık sayaç kontrolü/artırımı da
        // atomik değildi - davet edilenin dönüştürme işlemiyle eşzamanlı
        // ikinci bir istek referreri iki kez ödüllendirebiliyor veya
        // 10/hafta limitini zamanlama ile aşabiliyordu.
        if (!updated.referralRewardGiven && updated.referredBy) {
            // "Tam olarak bir kez" garantisi: bu koşullu güncelleme yalnızca
            // referralRewardGiven HÂLÂ false ise uygulanır - eşzamanlı ikinci
            // bir dönüştürme isteği burada eşleşmez, referrer'a asla iki kez
            // ödül verilmez.
            const marked = await User.findOneAndUpdate(
                { _id: updated._id, referralRewardGiven: false },
                { $set: { referralRewardGiven: true } }
            );
            updated.referralRewardGiven = true;

            if (marked) {
                const weekStart = getWeekStartStr();
                // Aynı hafta içinde ve limit altındaysa atomik artır.
                let referrerUpdated = await User.findOneAndUpdate(
                    { _id: updated.referredBy, referralWeekStart: weekStart, referralWeekCount: { $lt: 10 } },
                    { $inc: { points: 10, referralWeekCount: 1 } }
                );
                if (!referrerUpdated) {
                    // Hafta henüz bu referrer için başlamamış (rollover) olabilir -
                    // bu durumu ayrı, yine atomik bir koşulla ele al.
                    referrerUpdated = await User.findOneAndUpdate(
                        { _id: updated.referredBy, referralWeekStart: { $ne: weekStart } },
                        { $set: { referralWeekStart: weekStart, referralWeekCount: 1 }, $inc: { points: 10 } }
                    );
                }
                // referrerUpdated hâlâ null ise: bu hafta için referrer'ın
                // 10/hafta limiti zaten dolu - referralRewardGiven yine de
                // true kalır (davet edilen kişi için "tam olarak bir kez"
                // garantisi korunur), sadece referrer ödül almaz.
            }
        }

        res.json({
            message: `🎉 ${convertAmount.toLocaleString('tr-TR')} adım dönüştürüldü! (+${earnedPoints} YürüPara)`,
            earnedPoints,
            usedDouble,
            user: updated
        });
    } catch (err) {
        res.status(500).json({ error: "Dönüştürme hatası." });
    }
});

// SU TAKİBİ
app.post('/api/v2/health/water', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayStr();
        await atomicEnsureDailyReset(userId, today);

        // Bug-fix (yarış durumu): bardak sayısı artık atomik olarak, yalnızca
        // 8'in altındaysa artırılır. Zaten 8/8 ise (Math.min ile önceki
        // davranış da 8'i aşmıyordu) hiçbir şey değiştirmeden mevcut durumu
        // döndürürüz - hata değil, önceki davranışla tutarlı.
        let user = await User.findOneAndUpdate(
            { _id: userId, waterGlasses: { $lt: 8 } },
            { $inc: { waterGlasses: 1 } },
            { new: true }
        ).select('-password');

        if (!user) {
            user = await User.findById(userId).select('-password');
            if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
            return res.json({ message: `💧 Günlük 8/8 bardak hedefine zaten ulaştınız!`, waterGlasses: user.waterGlasses, points: user.points });
        }

        let bonusMsg = `💧 1 Bardak Su İçildi! (${user.waterGlasses}/8 Bardak)`;
        if (user.waterGlasses === 8) {
            // Bonus da atomik olarak ve sadece 'water' HENÜZ completedQuests
            // içinde değilse verilir - eşzamanlı iki isteğin 8. bardakta aynı
            // anda tetiklenip bonusu iki kez vermesini engeller. Yuvarlama da
            // (pipeline update / $round) AYNI atomik işlemde yapılır - ayrı bir
            // "sonradan yuvarla ve $set ile geri yaz" adımı kasıtlı olarak
            // kullanılmadı, çünkü o da eşzamanlı başka bir puan artışını
            // (ör. ads/watch) üzerine yazıp kaybettirebilirdi.
            const rewarded = await User.findOneAndUpdate(
                { _id: userId, completedQuests: { $ne: 'water' } },
                [{ $set: {
                    completedQuests: { $concatArrays: ['$completedQuests', ['water']] },
                    points: { $round: [{ $add: ['$points', 0.15] }, 2] }
                } }],
                { new: true, updatePipeline: true }
            ).select('-password');
            if (rewarded) {
                user = rewarded;
                bonusMsg = "🎉 Tebrikler! Günlük 2 Litre Su Hedefine ulaştınız ve +0.15 YürüPara kazandınız!";
            }
        }

        res.json({ message: bonusMsg, waterGlasses: user.waterGlasses, points: user.points });
    } catch (err) {
        res.status(500).json({ error: "Su takibi hatası." });
    }
});

// SAĞLIK GÖREVLERİ
app.post('/api/v2/health/quest', authMiddleware, async (req, res) => {
    try {
        const { questType } = req.body;
        const userId = req.user.id;
        const today = getTodayStr();
        await atomicEnsureDailyReset(userId, today);

        let rewardPoints = 0;
        let title = '';
        if (questType === 'sleep') {
            rewardPoints = 0.10;
            title = '8 Saat Uyu Görevi';
        } else if (questType === 'workout') {
            rewardPoints = 0.25;
            title = '30 Dk Antrenman Görevi';
        } else {
            return res.status(400).json({ error: "Geçersiz görev tipi." });
        }

        // Bug-fix (yarış durumu): görev tamamlama ve puan ödülü tek bir atomik
        // güncellemede; koşul (completedQuests içinde questType YOK) sağlanmazsa
        // (aynı görev için eşzamanlı ikinci istek) null döner - çift ödül yok.
        const user = await User.findOneAndUpdate(
            { _id: userId, completedQuests: { $ne: questType } },
            [{ $set: {
                completedQuests: { $concatArrays: ['$completedQuests', [questType]] },
                points: { $round: [{ $add: ['$points', rewardPoints] }, 2] }
            } }],
            { new: true, updatePipeline: true }
        ).select('-password');

        if (!user) {
            return res.status(400).json({ error: "Bu görevi bugün zaten tamamladınız!" });
        }

        res.json({ message: `🌟 Tebrikler! "${title}" tamamlandı ve +${rewardPoints} YürüPara kazanıldı!`, points: user.points });
    } catch (err) {
        res.status(500).json({ error: "Görev hatası." });
    }
});

// Şans Çarkı
app.post('/api/v2/wheel/spin', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayStr();

        const prizes = [0.05, 0.10, 0.15, 0.20, 0.25];
        const wonPoints = prizes[Math.floor(Math.random() * prizes.length)];

        // Bug-fix (yarış durumu): "bugün çevirdi mi" kontrolü ve puan/tarih
        // güncellemesi tek bir atomik işlemde; lastWheelSpinDate != today
        // koşulu sağlanmazsa (aynı gün eşzamanlı ikinci çevirme isteği) null
        // döner - günde birden fazla çevirme/ödül alınamaz.
        const user = await User.findOneAndUpdate(
            { _id: userId, lastWheelSpinDate: { $ne: today } },
            [{ $set: {
                points: { $round: [{ $add: ['$points', wonPoints] }, 2] },
                lastWheelSpinDate: today
            } }],
            { new: true, updatePipeline: true }
        ).select('-password');

        if (!user) {
            return res.status(400).json({ error: "Bugün zaten çark çevirdiniz!" });
        }

        res.json({ message: `🎡 Çark döndü ve +${wonPoints} YürüPara kazandınız!`, wonPoints, user });
    } catch (err) {
        res.status(500).json({ error: "Çark hatası." });
    }
});

// Davet Et Kazan: kullanıcının kendi kodu, bu haftaki ödül sayacı ve toplam
// davet istatistikleri. Eski (bu özellikten önce oluşmuş) hesaplarda kod
// yoksa burada ilk çağrıda üretilir.
app.get('/api/v2/referral/info', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        let user = await User.findById(userId).select('-password');

        // Bug-fix (yarış durumu): referralCode geç-üretimi ve haftalık
        // sayaç sıfırlaması tam bir save() yerine iki küçük koşullu atomik
        // güncellemeye ayrıldı; bu route sık çağrıldığından, eşzamanlı bir
        // isteğin (örn. referral ödülü $inc'i) o arada yazdığı alanları eski
        // bir kopyayla ezme (lost update) riski vardı.
        if (!user.referralCode) {
            const newCode = user._id.toString().slice(-6).toUpperCase();
            const updated = await User.findOneAndUpdate(
                { _id: userId, $or: [{ referralCode: { $exists: false } }, { referralCode: null }, { referralCode: '' }] },
                { $set: { referralCode: newCode } },
                { new: true }
            ).select('-password');
            if (updated) user = updated;
        }

        const weekStart = getWeekStartStr();
        if (user.referralWeekStart !== weekStart) {
            const updated = await User.findOneAndUpdate(
                { _id: userId, referralWeekStart: { $ne: weekStart } },
                { $set: { referralWeekStart: weekStart, referralWeekCount: 0 } },
                { new: true }
            ).select('-password');
            if (updated) user = updated;
        }

        const totalReferred = await User.countDocuments({ referredBy: user._id });
        const totalRewarded = await User.countDocuments({ referredBy: user._id, referralRewardGiven: true });

        res.json({
            referralCode: user.referralCode,
            weekCount: user.referralWeekCount,
            weekLimit: 10,
            rewardPerReferral: 10,
            totalReferred,
            totalRewarded
        });
    } catch (err) {
        res.status(500).json({ error: "Davet bilgisi alınamadı." });
    }
});

// Reklam İzle Kazan: gerçek bir reklam ağı entegrasyonu değildir (bir web
// sitesinde native AdMob SDK'sı çalışmaz) - istemci tarafında mevcut "2x
// Bonus" özelliğindekiyle aynı simüle reklam akışı kullanılır, bu uç nokta
// sadece o akış tamamlandıktan sonra ödülü günlük limit dahilinde verir.
app.post('/api/v2/ads/watch', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayStr();
        await atomicEnsureDailyReset(userId, today);

        const AD_REWARD = 0.20;
        const MAX_ADS_PER_DAY = 3;

        // Bug-fix (yarış durumu): günlük limit kontrolü ve artırım/ödül tek
        // atomik işlemde; adWatchesToday < MAX_ADS_PER_DAY koşulu sağlanmazsa
        // (limit dolu veya eşzamanlı istek arada doldurmuş) null döner.
        const user = await User.findOneAndUpdate(
            { _id: userId, adWatchesToday: { $lt: MAX_ADS_PER_DAY } },
            [{ $set: {
                adWatchesToday: { $add: [{ $ifNull: ['$adWatchesToday', 0] }, 1] },
                points: { $round: [{ $add: ['$points', AD_REWARD] }, 2] }
            } }],
            { new: true, updatePipeline: true }
        ).select('-password');

        if (!user) {
            return res.status(400).json({ error: `Bugünkü reklam izleme hakkınızı (${MAX_ADS_PER_DAY}) kullandınız. Yarın tekrar deneyin!` });
        }

        res.json({
            message: `📺 Reklam tamamlandı! +${AD_REWARD} YürüPara kazandınız. (${user.adWatchesToday}/${MAX_ADS_PER_DAY})`,
            adWatchesToday: user.adWatchesToday,
            maxAdsPerDay: MAX_ADS_PER_DAY,
            user
        });
    } catch (err) {
        res.status(500).json({ error: "Reklam ödülü hatası." });
    }
});

// Bug-fix (2x Bonus istismarı): önceden /api/v2/steps/convert istemciden gelen
// isDouble bayrağına doğrudan güveniyordu - istemci hiçbir "reklam" izlemeden
// doğrudan {isDouble:true} göndererek sınırsız, ücretsiz 2x YürüPara
// alabiliyordu. Şimdi istemci 5sn'lik simüle reklam akışını TAMAMLADIKTAN
// SONRA bu uç noktayı çağırır; bu, kısa ömürlü (60sn) bir sunucu-taraflı
// bayrak set eder ve /steps/convert bunu atomik olarak (aynı işlemde okuyup
// temizleyerek) tüketir. İstemci bu bayrağı hiç set etmeden isDouble:true
// göndermeye devam etse bile artık hiçbir etkisi olmaz (bkz. steps/convert
// içindeki boostCandidate kontrolü).
app.post('/api/v2/ads/confirm-double', authMiddleware, async (req, res) => {
    try {
        await User.updateOne(
            { _id: req.user.id },
            { $set: { pendingDoubleBoost: true, pendingDoubleBoostAt: new Date() } }
        );
        res.json({ message: "Bonus onaylandı." });
    } catch (err) {
        res.status(500).json({ error: "Bonus onay hatası." });
    }
});

// Bug-fix: önceden durationMs tamamen istemciden gelen değere güveniyordu -
// oyunu hiç oynamadan doğrudan {"durationMs": 180000} POST ederek anında
// ödül almak mümkündü. Şimdi süre, /games/start'ın sunucu-taraflı
// damgaladığı gameSessionStart alanından hesaplanır - istemci artık süreyi
// BİLDİRMEZ, yalnızca hangi oyunun (gameId) oynanacağını bildirip oturumu
// başlatır/bitirir.
app.post('/api/v2/games/start', authMiddleware, async (req, res) => {
    try {
        const { gameId } = req.body;
        if (!GAME_IDS.includes(gameId)) {
            return res.status(400).json({ error: "Geçersiz oyun." });
        }
        await User.updateOne({ _id: req.user.id }, { $set: { gameSessionStart: new Date(), activeGameId: gameId } });
        res.json({ message: "Oyun oturumu başlatıldı." });
    } catch (err) {
        res.status(500).json({ error: "Oyun başlatma hatası." });
    }
});

// Basit Oyunlar (v2.7 3-oyun revizyonu): paylaşımlı gün-içi havuz/kademeli
// süre ödülü kaldırıldı. Yeni model - her oyun (slice/balance/runner) için
// GÜNDE BİR kez, en az 1dk sürmüş bir oturumun ardından sabit 0.10 YP
// "ilk temiz oyun" ödülü verilir; aynı gün içindeki sonraki tamamlamalar
// ücretsiz pratik sayılır (hata değil, reward: 0 ile başarı döner). Süre
// hâlâ /games/start'ın sunucu-taraflı damgaladığı gameSessionStart'tan
// hesaplanır - istemci süreyi bildirmez.
app.post('/api/v2/games/reward', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayStr();
        await atomicEnsureDailyReset(userId, today);

        const preSnapshot = await User.findById(userId).select('gameSessionStart activeGameId gameStats');
        if (!preSnapshot) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

        if (!preSnapshot.gameSessionStart || !preSnapshot.activeGameId) {
            return res.status(400).json({ error: "Aktif bir oyun oturumu bulunamadı. Lütfen oyunu tekrar başlatın." });
        }

        const durationMs = Date.now() - new Date(preSnapshot.gameSessionStart).getTime();
        if (durationMs < 60000) {
            // Süre henüz yetersiz - oturumu BOZMADAN reddet. Süre her zaman
            // gameSessionStart'tan gerçek zamana göre hesaplandığı için erken
            // bir talebi reddetmek hiçbir güvenlik açığı doğurmaz (istemci art
            // arda deneyip dursa bile 60sn dolmadan asla ödül alamaz) - session'ı
            // burada temizlemek yalnızca meşru bir oyuncunun (ör. "Bitir"e
            // yanlışlıkla erken basan) o ana kadarki oynama süresini kaybedip
            // /games/start'ı tekrar çağırmaya zorlanmasına yol açardı.
            return res.status(400).json({ error: "Ödül kazanmak için en az 1 dakika oynamalısınız." });
        }

        const gameId = preSnapshot.activeGameId;
        const entry = (preSnapshot.gameStats || []).find(g => g.gameId === gameId);
        const alreadyClaimedToday = !!entry && entry.lastClaimDate === today;

        if (alreadyClaimedToday) {
            // Bugünkü ödül zaten alınmış - hata değil, serbest pratik. Yalnızca
            // oturumu, preSnapshot'ta okunan DEĞERLE eşleşme koşuluyla atomik
            // olarak temizler (lost-update/tekrar-talep önleme, aşağıdaki ödül
            // dalıyla aynı idiom).
            const updated = await User.findOneAndUpdate(
                { _id: userId, gameSessionStart: preSnapshot.gameSessionStart, activeGameId: gameId },
                { $set: { gameSessionStart: null, activeGameId: null } },
                { new: true }
            ).select('-password');
            if (!updated) return res.status(400).json({ error: "Oturum bulunamadı, lütfen tekrar deneyin." });
            return res.json({ reward: 0, alreadyClaimedToday: true, message: "Bugünkü ödülünü zaten aldın, pratik yapmaya devam edebilirsin!", user: updated });
        }

        // Bug-fix (yarış durumu + oturum tekrar kullanımı): gameSessionStart VE
        // activeGameId, preSnapshot'ta okunan DEĞERLERLE eşleşiyorsa güncellenir
        // ve AYNI atomik işlemde null'a çekilir - bu hem "lost update"i önler
        // hem de aynı oyun oturumunun iki kez ödül için talep edilmesini
        // imkansız kılar (ikinci istek geldiğinde gameSessionStart/activeGameId
        // artık null'dır, koşul eşleşmez). arrayFilters yerine pipeline-form
        // $map/$concatArrays kullanılıyor çünkü arrayFilters pipeline-form
        // update'lerle birlikte desteklenmiyor.
        const updated = entry
            ? await User.findOneAndUpdate(
                { _id: userId, gameSessionStart: preSnapshot.gameSessionStart, activeGameId: gameId },
                [{ $set: {
                    points: { $round: [{ $add: ['$points', 0.10] }, 2] },
                    gameSessionStart: null,
                    activeGameId: null,
                    gameStats: {
                        $map: {
                            input: '$gameStats',
                            as: 'g',
                            in: { $cond: [{ $eq: ['$$g.gameId', gameId] }, { gameId: gameId, lastClaimDate: today }, '$$g'] }
                        }
                    }
                } }],
                { new: true, updatePipeline: true }
            ).select('-password')
            : await User.findOneAndUpdate(
                { _id: userId, gameSessionStart: preSnapshot.gameSessionStart, activeGameId: gameId },
                [{ $set: {
                    points: { $round: [{ $add: ['$points', 0.10] }, 2] },
                    gameSessionStart: null,
                    activeGameId: null,
                    gameStats: { $concatArrays: [{ $ifNull: ['$gameStats', []] }, [{ gameId: gameId, lastClaimDate: today }]] }
                } }],
                { new: true, updatePipeline: true }
            ).select('-password');

        if (!updated) {
            return res.status(400).json({ error: "Oyun ödülü alınamadı, lütfen tekrar deneyin." });
        }

        res.json({ reward: 0.10, alreadyClaimedToday: false, message: "🎮 İlk temiz oyunun bugün! +0.10 YürüPara kazandın.", user: updated });
    } catch (err) {
        res.status(500).json({ error: "Oyun ödülü hatası." });
    }
});

// Kayıt sonrası veri koruma/gizlilik sözleşmesi onayı
app.post('/api/v2/user/accept-privacy', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        user.privacyAccepted = true;
        user.privacyAcceptedAt = new Date();
        await user.save();
        res.json({ message: "Onayınız kaydedildi.", user });
    } catch (err) {
        res.status(500).json({ error: "Onay kaydedilemedi." });
    }
});

app.get('/api/v2/leaderboard', async (req, res) => {
    try {
        const topUsers = await User.find().select('name steps points streak level multiplier').sort({ steps: -1 }).limit(10);
        res.json({ leaderboard: topUsers });
    } catch (err) {
        res.status(500).json({ error: "Liderlik alınamadı." });
    }
});

app.post('/api/v2/donate', authMiddleware, async (req, res) => {
    try {
        const { charityName, pointsToDonate } = req.body;
        const points = parseFloat(pointsToDonate);
        // Negatif/geçersiz bir değer göndermek "bağış" adı altında bakiyeye puan
        // EKLENMESİNE yol açabilirdi (user.points -= negatifSayı === toplama).
        if (!charityName || !Number.isFinite(points) || points <= 0) {
            return res.status(400).json({ error: "Geçersiz bağış miktarı." });
        }

        const roundedPoints = Math.round(points * 100) / 100;

        // Bug-fix (yarış durumu): bakiye kontrolü ve düşümü artık tek atomik
        // işlemde; points >= roundedPoints (küçük bir float toleransıyla)
        // koşulu sağlanmazsa (yetersiz bakiye VEYA eşzamanlı başka bir harcama
        // arada bakiyeyi düşürmüşse) güncelleme uygulanmaz - aynı bakiyeden
        // birden fazla eşzamanlı bağış "lost update" ile geçemez.
        const user = await User.findOneAndUpdate(
            { _id: req.user.id, points: { $gte: roundedPoints - POINTS_EPSILON } },
            [{ $set: {
                points: { $round: [{ $subtract: ['$points', roundedPoints] }, 2] },
                totalDonations: { $round: [{ $add: ['$totalDonations', roundedPoints] }, 2] }
            } }],
            { new: true, updatePipeline: true }
        ).select('-password');

        if (!user) return res.status(400).json({ error: "Yetersiz bakiye!" });

        const donation = new Donation({
            userId: user._id,
            charityName,
            stepsDonated: roundedPoints * 10000,
            pointsValue: roundedPoints,
            icon: charityName.includes('Mama') ? '🐶' : (charityName.includes('Fidan') ? '🌲' : (charityName.includes('Kitap') ? '📚' : '❤️'))
        });
        await donation.save();

        res.json({ message: `❤️ "${charityName}" için ${roundedPoints} YürüPara bağışlandı. Teşekkürler!`, user });
    } catch (err) {
        res.status(500).json({ error: "Bağış hatası." });
    }
});

app.get('/api/v2/rewards', async (req, res) => {
    try {
        const rewards = await Reward.find().sort({ pointsCost: 1 });
        res.json({ rewards });
    } catch (err) { res.status(500).json({ error: "Ödüller alınamadı." }); }
});

app.get('/api/v2/charities', async (req, res) => {
    try {
        const charities = await Charity.find().sort({ pointsCost: 1 });
        res.json({ charities });
    } catch (err) { res.status(500).json({ error: "Bağış kurumları alınamadı." }); }
});

// Bug-fix (en ciddi yarış durumu): önceden reward.stock ve user.points
// findById -> JS'de mutasyon -> save() (tam doküman üzerine yazma) ile
// değiştiriliyordu, hiçbir atomik koşul yoktu. Bir kullanıcının aynı ödül
// için N eşzamanlı talep göndermesi durumunda, N talebin HEPSİ birbirinden
// bağımsız aynı bayat bakiye anlık görüntüsünden okuyup "yeterli bakiye var"
// sonucuna varabiliyor ve N adet dijital kod (Steam/Spotify/vb.) üretilirken
// yalnızca SON save() gerçek bakiyeyi yansıtıyordu - kullanıcı tek ödeme ile
// sınırsız kod alabiliyordu. Aynı şekilde stok da negatife düşebiliyordu.
//
// Çözüm: puan düşümü ve stok düşümü iki AYRI dokümanın (User, Reward) birlikte
// tutarlı olması gereken bir işlem olduğu için (tam olarak review'da belirtilen
// "tek bir atomik güncellemenin ön koşulu ifade edemediği" durum), gerçek bir
// MongoDB transaction kullanılır: puan düşümü VE stok düşümü ya birlikte
// uygulanır ya da hiçbiri uygulanmaz (stok yetersizse puan düşümü otomatik
// olarak geri alınır - "hayalet düşüm" riski yok). Atlas cluster'ları her
// zaman replica set olduğundan (M0 dahil) transaction desteklenir.
app.post('/api/v2/rewards/claim', authMiddleware, async (req, res) => {
    const session = await mongoose.startSession();
    let httpStatus = 500;
    let httpPayload = { error: "Dijital kod alma hatası." };

    try {
        await session.withTransaction(async () => {
            const { rewardId } = req.body;
            const reward = await Reward.findById(rewardId).session(session);
            if (!reward) {
                httpStatus = 400; httpPayload = { error: "Stokta yok." };
                throw new Error('ABORT_CLAIM');
            }

            const isDiet = reward.code === 'DIET-PLAN-CUSTOM';
            if (!isDiet && reward.stock <= 0) {
                httpStatus = 400; httpPayload = { error: "Stokta yok." };
                throw new Error('ABORT_CLAIM');
            }

            // Bakiye kontrolü + düşümü tek atomik koşullu güncelleme: points
            // >= pointsCost sağlanmazsa (yetersiz bakiye VEYA eşzamanlı başka
            // bir talep arada bakiyeyi düşürmüşse) null döner.
            const user = await User.findOneAndUpdate(
                { _id: req.user.id, points: { $gte: reward.pointsCost - POINTS_EPSILON } },
                [{ $set: { points: { $round: [{ $subtract: ['$points', reward.pointsCost] }, 2] } } }],
                { new: true, session, updatePipeline: true }
            ).select('-password');

            if (!user) {
                httpStatus = 400;
                httpPayload = { error: `Yetersiz YürüPara! Bu ürün için ${reward.pointsCost} YP gereklidir.` };
                throw new Error('ABORT_CLAIM');
            }

            if (isDiet) {
                // Diyet planı sınırsız stokludur (orijinal davranışla aynı -
                // stok hiç düşürülmez).
                const uniqueCode = `DIET-UNLOCK-${Math.floor(100000 + Math.random() * 900000)}`;
                await Claim.create([{ userId: user._id, rewardTitle: reward.title, pointsSpent: reward.pointsCost, code: uniqueCode }], { session });

                httpStatus = 200;
                httpPayload = {
                    message: `🥗 Tebrikler! Kişiye özel diyetisyen planınız YürüPara ile açıldı. Profil sekmenizden planınızı inceleyebilirsiniz!`,
                    code: uniqueCode,
                    isDiet: true,
                    user
                };
                return;
            }

            // Stok atomik olarak, yalnızca hâlâ > 0 ise düşürülür (aynı
            // transaction içinde). Koşul sağlanmazsa (transaction başladıktan
            // sonra ama biz kontrol ettikten sonra başka bir transaction'ın
            // son birimi tükettiği nadir durum) yukarıdaki puan düşümü de
            // transaction abort edildiği için OTOMATİK GERİ ALINIR - kullanıcı
            // asla ödeme yapıp kod alamadan bakiyesini kaybetmez.
            const updatedReward = await Reward.findOneAndUpdate(
                { _id: reward._id, stock: { $gt: 0 } },
                { $inc: { stock: -1 } },
                { new: true, session }
            );
            if (!updatedReward) {
                httpStatus = 400; httpPayload = { error: "Stokta yok." };
                throw new Error('ABORT_CLAIM');
            }

            const uniqueDigitalCode = `${reward.code}-${Math.floor(100000 + Math.random() * 900000)}`;
            await Claim.create([{
                userId: user._id,
                rewardTitle: reward.title,
                pointsSpent: reward.pointsCost,
                code: uniqueDigitalCode
            }], { session });

            httpStatus = 200;
            httpPayload = {
                message: `🎉 Tebrikler! Dijital kodunuz anında hazırlandı. Kuponlarım sekmesinden kopyalayabilirsiniz.`,
                code: uniqueDigitalCode,
                user
            };
        });
    } catch (err) {
        if (err.message !== 'ABORT_CLAIM') {
            console.error('Ödül talep hatası:', err);
            httpStatus = 500;
            httpPayload = { error: "Dijital kod alma hatası." };
        }
    } finally {
        session.endSession();
    }

    res.status(httpStatus).json(httpPayload);
});

// --- v2.6 ADMIN ROTALARI ---

app.get('/api/v2/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalClaims = await Claim.countDocuments();
        const totalDonations = await Donation.countDocuments();
        
        const stepsAgg = await User.aggregate([{ $group: { _id: null, totalSteps: { $sum: "$steps" }, totalPoints: { $sum: "$points" } } }]);
        const totalSteps = stepsAgg[0]?.totalSteps || 0;
        const totalPoints = stepsAgg[0]?.totalPoints || 0;

        res.json({
            totalUsers,
            totalClaims,
            totalDonations,
            totalSteps,
            totalPoints: Math.round(totalPoints * 100) / 100
        });
    } catch (err) {
        res.status(500).json({ error: "Admin istatistik hatası." });
    }
});

app.get('/api/v2/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 }).limit(50);
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: "Kullanıcı listesi hatası." });
    }
});

// Bug-fix: /api/v2/admin/charities/add'in aksine burada hiç doğrulama yoktu.
// Boş/sayısal-olmayan bir pointsCost parseFloat ile NaN'a dönüşüyor ve
// Mongoose'un zorunlu-Number kontrolünü geçiyordu (typeof NaN === 'number').
// Bu ödülü talep eden herhangi bir kullanıcının points bakiyesi kalıcı olarak
// NaN'a bozuluyordu (currentPoints < NaN her zaman false olduğu için bakiye
// kontrolü asla engellemiyor, sonraki çıkarma işlemi de NaN'ı yayıyordu).
app.post('/api/v2/admin/rewards/add', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { title, description, pointsCost, category, code, icon, stock } = req.body;
        if (!title || !description) return res.status(400).json({ error: "Başlık ve açıklama zorunludur." });
        if (!code) return res.status(400).json({ error: "Ürün kodu zorunludur." });

        const cost = parseFloat(pointsCost);
        if (!Number.isFinite(cost) || cost <= 0) return res.status(400).json({ error: "Geçersiz fiyat." });

        const stockNum = parseInt(stock);
        const finalStock = Number.isFinite(stockNum) && stockNum >= 0 ? stockNum : 50;

        const newReward = new Reward({
            title, description, pointsCost: cost, category, code, icon, stock: finalStock
        });
        await newReward.save();
        res.json({ message: `🎁 "${title}" ürünü dijital mağazaya eklendi!`, reward: newReward });
    } catch (err) {
        res.status(500).json({ error: "Ödül ekleme hatası." });
    }
});

app.put('/api/v2/admin/rewards/:id/price', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const pointsCost = parseFloat(req.body.pointsCost);
        if (!Number.isFinite(pointsCost) || pointsCost <= 0) {
            return res.status(400).json({ error: "Geçersiz fiyat." });
        }
        const reward = await Reward.findByIdAndUpdate(req.params.id, { pointsCost }, { new: true });
        if (!reward) return res.status(404).json({ error: "Ürün bulunamadı." });
        res.json({ message: `"${reward.title}" fiyatı ${pointsCost} YP olarak güncellendi.`, reward });
    } catch (err) {
        res.status(500).json({ error: "Fiyat güncelleme hatası." });
    }
});

app.post('/api/v2/admin/charities/add', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { title, description, pointsCost, icon } = req.body;
        if (!title || !description) return res.status(400).json({ error: "Başlık ve açıklama zorunludur." });
        const cost = parseFloat(pointsCost);
        if (!Number.isFinite(cost) || cost <= 0) return res.status(400).json({ error: "Geçersiz değer." });

        const newCharity = new Charity({ title, description, pointsCost: cost, icon: icon || '❤️' });
        await newCharity.save();
        res.json({ message: `❤️ "${title}" bağış kurumu eklendi!`, charity: newCharity });
    } catch (err) {
        res.status(500).json({ error: "Bağış kurumu ekleme hatası." });
    }
});

app.put('/api/v2/admin/charities/:id/price', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const pointsCost = parseFloat(req.body.pointsCost);
        if (!Number.isFinite(pointsCost) || pointsCost <= 0) {
            return res.status(400).json({ error: "Geçersiz değer." });
        }
        const update = { pointsCost };
        // Açıklama isteğe bağlı - gönderilmezse mevcut açıklama korunur.
        if (typeof req.body.description === 'string' && req.body.description.trim()) {
            update.description = req.body.description.trim();
        }
        const charity = await Charity.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!charity) return res.status(404).json({ error: "Bağış kurumu bulunamadı." });
        res.json({ message: `"${charity.title}" güncellendi.`, charity });
    } catch (err) {
        res.status(500).json({ error: "Değer güncelleme hatası." });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 AdımKasası PRO (v2.6) Sunucusu http://localhost:${PORT} adresinde aktif!`);
});
