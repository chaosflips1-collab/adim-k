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

// Günlük sıfırlama kontrolü tek bir yerde: önceden bu mantık sadece
// /api/v2/steps/add içindeydi, bu yüzden bir kullanıcı yeni bir günde önce su
// takibi veya görev tamamlama gibi başka bir uç noktayı çağırırsa
// waterGlasses/completedQuests hiç sıfırlanmadan bir önceki günden kalıyor ve
// o gün için görev/su bonusu kalıcı olarak engelleniyordu.
function ensureDailyReset(user) {
    const today = getTodayStr();
    if (user.lastStepDate !== today) {
        user.todayConvertedSteps = 0;
        user.waterGlasses = 0;
        user.completedQuests = [];
        user.lastStepDate = today;
    }
    return today;
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
        const { name, email, password, height, weight } = req.body;
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
        if (user.lastStreakDate !== today) {
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            user.streak = (user.lastStreakDate === yesterday) ? user.streak + 1 : 1;
            user.lastStreakDate = today;
            await user.save();
        }

        const token = jwt.sign({ id: user._id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        const userSafe = user.toObject();
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
    const url = googleClient.generateAuthUrl({
        access_type: 'online',
        scope: ['profile', 'email'],
        prompt: 'select_account'
    });
    res.redirect(url);
});

// Google Cloud Console'da tanımlı "Authorized redirect URI" ile bu yolun
// (GOOGLE_CALLBACK_URL) BİREBİR aynı olması gerekir.
app.get('/auth/google/callback', async (req, res) => {
    try {
        if (!googleClient) return res.redirect('/index.html?googleError=1');
        const { code } = req.query;
        if (!code) return res.redirect('/index.html?googleError=1');

        const { tokens } = await googleClient.getToken(code);
        const ticket = await googleClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email) return res.redirect('/index.html?googleError=1');

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
        }

        const token = jwt.sign({ id: user._id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.redirect(`/dashboard.html?token=${encodeURIComponent(token)}`);
    } catch (err) {
        console.error('Google OAuth callback hatası:', err.message);
        res.redirect('/index.html?googleError=1');
    }
});

app.get('/api/v2/user/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

        const claims = await Claim.find({ userId: user._id }).sort({ claimedAt: -1 });
        const donations = await Donation.find({ userId: user._id }).sort({ donatedAt: -1 });

        const lvlData = calculateLevel(user.steps);
        user.level = lvlData.level;
        user.multiplier = lvlData.multiplier;
        await user.save();

        res.json({ user, claims, donations, levelInfo: lvlData });
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
        const user = await User.findById(req.user.id).select('-password');
        ensureDailyReset(user);

        user.steps += amount;
        user.unconvertedSteps += amount;

        const userWeight = user.weight || 70;
        const calFactorPerStep = userWeight * 0.00057;
        const burnedCalories = amount * calFactorPerStep;
        // Aynı ondalık birikim hatası (bkz. points) burada da oluşabilir; her
        // eklemeden sonra yuvarlıyoruz.
        user.calories = Math.round((user.calories + burnedCalories) * 10) / 10;

        const lvlData = calculateLevel(user.steps);
        user.level = lvlData.level;
        user.multiplier = lvlData.multiplier;

        await user.save();
        res.json({ message: `${amount} adım senkronize edildi!`, user });
    } catch (err) {
        res.status(500).json({ error: "Adım ekleme hatası." });
    }
});

app.post('/api/v2/user/update-body', authMiddleware, async (req, res) => {
    try {
        const { height, weight } = req.body;
        const user = await User.findById(req.user.id).select('-password');

        if (height) user.height = parseInt(height);
        if (weight) user.weight = parseInt(weight);

        await user.save();
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
        const isDouble = req.body.isDouble === true;
        const user = await User.findById(req.user.id).select('-password');
        ensureDailyReset(user);

        const DAILY_MAX_CAP = 15000;
        if (user.todayConvertedSteps >= DAILY_MAX_CAP) {
            return res.status(400).json({ error: "Günlük maksimum 15.000 adım dönüştürme limitine ulaştınız!" });
        }

        const availableToConvert = Math.min(user.unconvertedSteps, DAILY_MAX_CAP - user.todayConvertedSteps);
        if (availableToConvert < 1000) {
            return res.status(400).json({ error: "Dönüştürmek için en az 1.000 birikmiş adımınız olmalıdır." });
        }

        const convertAmount = Math.floor(availableToConvert / 1000) * 1000;
        const lvlData = calculateLevel(user.steps);
        
        let earnedPoints = (convertAmount / 1000) * 0.10 * lvlData.multiplier;
        if (isDouble) earnedPoints *= 2;

        user.unconvertedSteps -= convertAmount;
        user.todayConvertedSteps += convertAmount;
        user.points = Math.round((user.points + earnedPoints) * 100) / 100;
        user.level = lvlData.level;
        user.multiplier = lvlData.multiplier;

        await user.save();
        res.json({
            message: `🎉 ${convertAmount.toLocaleString('tr-TR')} adım dönüştürüldü! (+${(Math.round(earnedPoints * 100) / 100)} YürüPara)`,
            earnedPoints,
            user
        });
    } catch (err) {
        res.status(500).json({ error: "Dönüştürme hatası." });
    }
});

// SU TAKİBİ
app.post('/api/v2/health/water', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        ensureDailyReset(user);
        user.waterGlasses = Math.min((user.waterGlasses || 0) + 1, 8);

        let bonusMsg = `💧 1 Bardak Su İçildi! (${user.waterGlasses}/8 Bardak)`;
        if (user.waterGlasses === 8 && !user.completedQuests.includes('water')) {
            user.completedQuests.push('water');
            user.points = Math.round((user.points + 0.15) * 100) / 100;
            bonusMsg = "🎉 Tebrikler! Günlük 2 Litre Su Hedefine ulaştınız ve +0.15 YürüPara kazandınız!";
        }

        await user.save();
        res.json({ message: bonusMsg, waterGlasses: user.waterGlasses, points: user.points });
    } catch (err) {
        res.status(500).json({ error: "Su takibi hatası." });
    }
});

// SAĞLIK GÖREVLERİ
app.post('/api/v2/health/quest', authMiddleware, async (req, res) => {
    try {
        const { questType } = req.body;
        const user = await User.findById(req.user.id).select('-password');
        ensureDailyReset(user);

        if (user.completedQuests.includes(questType)) {
            return res.status(400).json({ error: "Bu görevi bugün zaten tamamladınız!" });
        }

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

        user.completedQuests.push(questType);
        user.points = Math.round((user.points + rewardPoints) * 100) / 100;

        await user.save();
        res.json({ message: `🌟 Tebrikler! "${title}" tamamlandı ve +${rewardPoints} YürüPara kazanıldı!`, points: user.points });
    } catch (err) {
        res.status(500).json({ error: "Görev hatası." });
    }
});

// Şans Çarkı
app.post('/api/v2/wheel/spin', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        const today = getTodayStr();

        if (user.lastWheelSpinDate === today) {
            return res.status(400).json({ error: "Bugün zaten çark çevirdiniz!" });
        }

        const prizes = [0.05, 0.10, 0.15, 0.20, 0.25];
        const wonPoints = prizes[Math.floor(Math.random() * prizes.length)];

        user.points = Math.round((user.points + wonPoints) * 100) / 100;
        user.lastWheelSpinDate = today;
        await user.save();

        res.json({ message: `🎡 Çark döndü ve +${wonPoints} YürüPara kazandınız!`, wonPoints, user });
    } catch (err) {
        res.status(500).json({ error: "Çark hatası." });
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

        const user = await User.findById(req.user.id).select('-password');
        // Ondalık toplama/çıkarma birikimi kayan nokta hatası üretir (ör. 1.00
        // yerine 0.9999999999999999 saklanabilir); 2 ondalığa yuvarlayarak hem
        // önceden birikmiş sapmayı düzeltiyoruz hem de "bakiyem yetiyor görünüyor
        // ama reddediliyor" şikayetini engelliyoruz.
        const currentPoints = Math.round(user.points * 100) / 100;
        if (currentPoints < points) return res.status(400).json({ error: "Yetersiz bakiye!" });

        user.points = Math.round((currentPoints - points) * 100) / 100;
        user.totalDonations = Math.round((user.totalDonations + points) * 100) / 100;

        const donation = new Donation({
            userId: user._id,
            charityName,
            stepsDonated: points * 10000,
            pointsValue: points,
            icon: charityName.includes('Mama') ? '🐶' : (charityName.includes('Fidan') ? '🌲' : (charityName.includes('Kitap') ? '📚' : '❤️'))
        });

        await user.save();
        await donation.save();

        res.json({ message: `❤️ "${charityName}" için ${points} YürüPara bağışlandı. Teşekkürler!`, user });
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

app.post('/api/v2/rewards/claim', authMiddleware, async (req, res) => {
    try {
        const { rewardId } = req.body;
        const reward = await Reward.findById(rewardId);
        if (!reward || reward.stock <= 0) return res.status(400).json({ error: "Stokta yok." });

        const user = await User.findById(req.user.id).select('-password');
        // Bkz. /api/v2/donate: ondalık birikim hatasına karşı yuvarlanmış bakiye
        // ile karşılaştırıyoruz.
        const currentPoints = Math.round(user.points * 100) / 100;
        if (currentPoints < reward.pointsCost) return res.status(400).json({ error: `Yetersiz YürüPara! Bu ürün için ${reward.pointsCost} YP gereklidir.` });

        user.points = Math.round((currentPoints - reward.pointsCost) * 100) / 100;

        if (reward.code === 'DIET-PLAN-CUSTOM') {
            const uniqueCode = `DIET-UNLOCK-${Math.floor(100000 + Math.random() * 900000)}`;
            const claim = new Claim({ userId: user._id, rewardTitle: reward.title, pointsSpent: reward.pointsCost, code: uniqueCode });
            await user.save();
            await claim.save();

            return res.json({ 
                message: `🥗 Tebrikler! Kişiye özel diyetisyen planınız YürüPara ile açıldı. Profil sekmenizden planınızı inceleyebilirsiniz!`, 
                code: uniqueCode, 
                isDiet: true,
                user 
            });
        }

        reward.stock -= 1;
        const uniqueDigitalCode = `${reward.code}-${Math.floor(100000 + Math.random() * 900000)}`;

        const claim = new Claim({ 
            userId: user._id, 
            rewardTitle: reward.title, 
            pointsSpent: reward.pointsCost, 
            code: uniqueDigitalCode 
        });

        await user.save();
        await reward.save();
        await claim.save();

        res.json({ 
            message: `🎉 Tebrikler! Dijital kodunuz anında hazırlandı. Kuponlarım sekmesinden kopyalayabilirsiniz.`, 
            code: uniqueDigitalCode, 
            user 
        });
    } catch (err) { res.status(500).json({ error: "Dijital kod alma hatası." }); }
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

app.post('/api/v2/admin/rewards/add', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { title, description, pointsCost, category, code, icon, stock } = req.body;
        const newReward = new Reward({
            title, description, pointsCost: parseFloat(pointsCost), category, code, icon, stock: parseInt(stock) || 50
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 AdımKasası PRO (v2.6) Sunucusu http://localhost:${PORT} adresinde aktif!`);
});
