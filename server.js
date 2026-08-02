const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const User = require('./models/User');
const Reward = require('./models/Reward');
const Claim = require('./models/Claim');
const Donation = require('./models/Donation');
const authMiddleware = require('./middleware/auth');
const { JWT_SECRET } = authMiddleware;

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Adimkasasi:112233Okan@cluster0.g6ldbkz.mongodb.net/adimkasasi_v2?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('MongoDB Atlas (v2 DB) bağlandı!');
        await seedDemoData();
    })
    .catch((err) => console.log('MongoDB bağlantı hatası:', err));

// Demo Liderlik Tablosu & Mağaza Verilerini Tohumlama (Seed)
async function seedDemoData() {
    try {
        // 1. Ödüller
        const rewardCount = await Reward.countDocuments();
        if (rewardCount === 0) {
            await Reward.insertMany([
                { title: 'Starbucks Kahve Kuponu', description: 'Tüm küçük boy kahvelerde geçerli hediye kodu.', pointsCost: 150, category: 'Yiyecek & İçecek', code: 'STB-PRO-8842', icon: '☕', stock: 50 },
                { title: 'Trendyol 200 TL Hediye Çeki', description: 'Tüm kategorilerde geçerli alışveriş kuponu.', pointsCost: 800, category: 'Alışveriş', code: 'TRND-200-PRO', icon: '🛍️', stock: 20 },
                { title: 'Steam 100 TL Cüzdan Kodu', description: 'Steam hesabınıza bakiye yükleyin.', pointsCost: 650, category: 'Oyun', code: 'STEAM-100TL-PRO', icon: '🎮', stock: 25 },
                { title: 'Valorant 1000 VP', description: 'Valorant mağazasında geçerli Points kodu.', pointsCost: 600, category: 'Oyun', code: 'VALO-1000VP-PRO', icon: '🎯', stock: 30 },
                { title: 'Getir 100 TL İndirim Kodu', description: 'GetirYemek ve GetirSu siparişlerinde geçerli.', pointsCost: 350, category: 'Yiyecek', code: 'GETIR-100-PRO', icon: '🛵', stock: 40 }
            ]);
            console.log('v2 Mağaza ödülleri yüklendi.');
        }

        // 2. Demo Liderlik Tablosu Kullanıcıları
        const userCount = await User.countDocuments();
        if (userCount < 5) {
            const dummyPassword = await bcrypt.hash('123456', 10);
            const dummyUsers = [
                { name: 'Ahmet Yılmaz 🥇', email: 'ahmet@adimkasasi.com', password: dummyPassword, steps: 142500, points: 1425, calories: 5700, streak: 12, role: 'user' },
                { name: 'Zeynep Kaya 🥈', email: 'zeynep@adimkasasi.com', password: dummyPassword, steps: 118400, points: 1184, calories: 4736, streak: 9, role: 'user' },
                { name: 'Burak Demir 🥉', email: 'burak@adimkasasi.com', password: dummyPassword, steps: 95200, points: 952, calories: 3808, streak: 7, role: 'user' },
                { name: 'Elif Şahin 🌟', email: 'elif@adimkasasi.com', password: dummyPassword, steps: 83000, points: 830, calories: 3320, streak: 5, role: 'user' }
            ];
            await User.insertMany(dummyUsers);
            console.log('v2 Liderlik tablosu demo kullanıcıları yüklendi.');
        }
    } catch (err) {
        console.error('Seed hatası:', err);
    }
}

// Bugünü YYYY-MM-DD formatında al
function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

// --- API ROTALARI ---

// 1. Kayıt Ol (v2)
app.post('/api/v2/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "Lütfen tüm alanları doldurun!" });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: "Bu e-posta adresi zaten kullanımda!" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const isFirst = (await User.countDocuments({ role: 'admin' })) === 0;

        const newUser = new User({
            name,
            email: email.toLowerCase(),
            password: hashedPassword,
            steps: 3000,
            unconvertedSteps: 3000,
            calories: 120,
            streak: 1,
            lastStepDate: getTodayStr(),
            role: isFirst ? 'admin' : 'user',
            badges: [{ name: 'Aramıza Hoş Geldin!', icon: '👟' }]
        });

        await newUser.save();

        const token = jwt.sign(
            { id: newUser._id, email: newUser.email, name: newUser.name, role: newUser.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: "AdımKasası PRO'ya hoş geldin!",
            token,
            user: newUser
        });
    } catch (err) {
        res.status(500).json({ error: "Kayıt sırasında sunucu hatası oluştu." });
    }
});

// 2. Giriş Yap (v2)
app.post('/api/v2/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(400).json({ error: "E-posta veya şifre hatalı!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "E-posta veya şifre hatalı!" });

        // Streak (Seri) Kontrolü
        const today = getTodayStr();
        if (user.lastStreakDate !== today) {
            // Dün girdiyse streak artır, girmediyse 1 yap
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            if (user.lastStreakDate === yesterday) {
                user.streak += 1;
            } else if (user.lastStreakDate !== today) {
                user.streak = 1;
            }
            user.lastStreakDate = today;
            await user.save();
        }

        const token = jwt.sign(
            { id: user._id, email: user.email, name: user.name, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ message: "Giriş başarılı!", token, user });
    } catch (err) {
        res.status(500).json({ error: "Giriş sırasında hata oluştu." });
    }
});

// Google ile Giriş / Kayıt Ol (v2)
app.post('/api/v2/auth/google', async (req, res) => {
    try {
        const { googleToken, name, email } = req.body;
        
        let userEmail = email ? email.toLowerCase() : '';
        let userName = name || 'Google Kullanıcısı';

        if (googleToken) {
            const decoded = jwt.decode(googleToken);
            if (decoded && decoded.email) {
                userEmail = decoded.email.toLowerCase();
                userName = decoded.name || userName;
            }
        }

        if (!userEmail) {
            return res.status(400).json({ error: "Google hesabından e-posta alınamadı." });
        }

        let user = await User.findOne({ email: userEmail });

        if (!user) {
            const dummyPassword = await bcrypt.hash(Math.random().toString(36), 10);
            user = new User({
                name: userName,
                email: userEmail,
                password: dummyPassword,
                steps: 3000,
                unconvertedSteps: 3000,
                calories: 120,
                streak: 1,
                lastStepDate: getTodayStr(),
                badges: [{ name: 'Google İle Bağlandı', icon: '🌐' }]
            });
            await user.save();
        }

        const token = jwt.sign(
            { id: user._id, email: user.email, name: user.name, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: `Google ile giriş başarılı! Hoş geldin, ${user.name}!`,
            token,
            user
        });
    } catch (err) {
        res.status(500).json({ error: "Google girişi sırasında hata oluştu." });
    }
});

// 3. Kullanıcı Detayları (v2)
app.get('/api/v2/user/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

        const claims = await Claim.find({ userId: user._id }).sort({ claimedAt: -1 });
        const donations = await Donation.find({ userId: user._id }).sort({ donatedAt: -1 });

        res.json({ user, claims, donations });
    } catch (err) {
        res.status(500).json({ error: "Veri alınamadı." });
    }
});

// 4. Adım Ekleme (Anti-Cheat & İvme Kontrollü)
app.post('/api/v2/steps/add', authMiddleware, async (req, res) => {
    try {
        const amount = parseInt(req.body.amount) || 500;

        // Anti-cheat limit kontrolü (tek seferde 10.000 adımdan fazla yükleme engeli)
        if (amount > 10000) {
            return res.status(400).json({ error: "Güvenlik Uyarısı: Tek seferde maksimum 10.000 adım eklenebilir." });
        }

        const user = await User.findById(req.user.id);
        const today = getTodayStr();

        if (user.lastStepDate !== today) {
            user.todayConvertedSteps = 0; // Yeni gün sıfırlaması
            user.lastStepDate = today;
        }

        user.steps += amount;
        user.unconvertedSteps += amount;
        user.calories += Math.round(amount * 0.04);

        await user.save();

        res.json({
            message: `${amount} adım başarıyla senkronize edildi!`,
            user: { steps: user.steps, unconvertedSteps: user.unconvertedSteps, calories: user.calories }
        });
    } catch (err) {
        res.status(500).json({ error: "Adım senkronizasyon hatası." });
    }
});

// 5. Adımları Kasaya Çevir (Günlük 15.000 Adım Limitli + 2x Sponsorlu Bonusu)
app.post('/api/v2/steps/convert', authMiddleware, async (req, res) => {
    try {
        const isDouble = req.body.isDouble === true; // 2x Sponsorlu reklam çarpanı
        const user = await User.findById(req.user.id);
        const today = getTodayStr();

        if (user.lastStepDate !== today) {
            user.todayConvertedSteps = 0;
            user.lastStepDate = today;
        }

        const DAILY_MAX_CAP = 15000;
        if (user.todayConvertedSteps >= DAILY_MAX_CAP) {
            return res.status(400).json({ error: "Günlük maksimum 15.000 adım dönüştürme limitine ulaştınız! Yarın tekrar yürümeye devam edin." });
        }

        const availableToConvert = Math.min(user.unconvertedSteps, DAILY_MAX_CAP - user.todayConvertedSteps);
        if (availableToConvert < 100) {
            return res.status(400).json({ error: "Dönüştürmek için en az 100 dönüştürülmemiş adımınız olmalıdır." });
        }

        const convertAmount = Math.floor(availableToConvert / 100) * 100;
        let earnedPoints = (convertAmount / 100) * 10;

        if (isDouble) {
            earnedPoints *= 2; // 2x Sponsor Çarpanı!
        }

        user.unconvertedSteps -= convertAmount;
        user.todayConvertedSteps += convertAmount;
        user.points += earnedPoints;

        // Rozet Kontrolleri
        if (user.steps >= 100000 && !user.badges.some(b => b.name === '100K Maratonu')) {
            user.badges.push({ name: '100K Maratonu', icon: '🏆' });
        }

        await user.save();

        res.json({
            message: `🎉 Tebrikler! ${convertAmount} adım dönüştürüldü ve ${earnedPoints} AdımPuanı kazandınız! ${isDouble ? '(2x Sponsorlu Bonus Uygulandı!)' : ''}`,
            earnedPoints,
            user
        });
    } catch (err) {
        res.status(500).json({ error: "Dönüştürme hatası." });
    }
});

// 6. Günlük Şans Çarkı (Spin the Wheel)
app.post('/api/v2/wheel/spin', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const today = getTodayStr();

        if (user.lastWheelSpinDate === today) {
            return res.status(400).json({ error: "Bugünkü ücretsiz çark çevirme hakkınızı zaten kullandınız! Yarın tekrar gelin." });
        }

        const prizes = [50, 100, 150, 200, 300, 500];
        const wonPoints = prizes[Math.floor(Math.random() * prizes.length)];

        user.points += wonPoints;
        user.lastWheelSpinDate = today;
        await user.save();

        res.json({
            message: `🎡 Çark döndü ve şansınıza ${wonPoints} AdımPuanı kazandınız!`,
            wonPoints,
            user: { points: user.points }
        });
    } catch (err) {
        res.status(500).json({ error: "Çark çevirme hatası." });
    }
});

// 7. Liderlik Tablosu (Leaderboard)
app.get('/api/v2/leaderboard', async (req, res) => {
    try {
        const topUsers = await User.find()
            .select('name steps points streak badges')
            .sort({ steps: -1 })
            .limit(10);

        res.json({ leaderboard: topUsers });
    } catch (err) {
        res.status(500).json({ error: "Liderlik tablosu alınamadı." });
    }
});

// 8. STK & Hayvan/Doğa Bağışı Yap (Help Steps Modeli)
app.post('/api/v2/donate', authMiddleware, async (req, res) => {
    try {
        const { charityName, pointsToDonate } = req.body;
        const points = parseInt(pointsToDonate);

        if (!charityName || !points || points <= 0) {
            return res.status(400).json({ error: "Geçerli bir bağış miktarı giriniz." });
        }

        const user = await User.findById(req.user.id);
        if (user.points < points) {
            return res.status(400).json({ error: `Yetersiz bakiye! ${points} puan bağışlamak için yeterli Puanınız yok.` });
        }

        user.points -= points;
        user.totalDonations += points;

        if (user.totalDonations >= 500 && !user.badges.some(b => b.name === 'Doğa Dostu')) {
            user.badges.push({ name: 'Doğa Dostu', icon: '🌲' });
        }

        const donation = new Donation({
            userId: user._id,
            charityName,
            stepsDonated: points * 10,
            pointsValue: points,
            icon: charityName.includes('Mama') ? '🐶' : (charityName.includes('Fidan') ? '🌲' : '❤️')
        });

        await user.save();
        await donation.save();

        res.json({
            message: `❤️ Harika bir harekette bulundunuz! ${charityName} için ${points} AdımPuanı bağışlandı. Teşekkür ederiz!`,
            user: { points: user.points, totalDonations: user.totalDonations }
        });
    } catch (err) {
        res.status(500).json({ error: "Bağış sırasında hata oluştu." });
    }
});

// 9. Mağaza & Claim
app.get('/api/v2/rewards', async (req, res) => {
    try {
        const rewards = await Reward.find().sort({ pointsCost: 1 });
        res.json({ rewards });
    } catch (err) {
        res.status(500).json({ error: "Ödüller alınamadı." });
    }
});

app.post('/api/v2/rewards/claim', authMiddleware, async (req, res) => {
    try {
        const { rewardId } = req.body;
        const reward = await Reward.findById(rewardId);
        if (!reward || reward.stock <= 0) return res.status(400).json({ error: "Ödül stokta yok veya bulunamadı." });

        const user = await User.findById(req.user.id);
        if (user.points < reward.pointsCost) return res.status(400).json({ error: "Yetersiz AdımPuanı bakiyesi!" });

        user.points -= reward.pointsCost;
        reward.stock -= 1;
        const uniqueCode = `${reward.code}-${Math.floor(1000 + Math.random() * 9000)}`;

        const claim = new Claim({
            userId: user._id,
            rewardTitle: reward.title,
            pointsSpent: reward.pointsCost,
            code: uniqueCode
        });

        await user.save();
        await reward.save();
        await claim.save();

        res.json({ message: `🎉 "${reward.title}" hediye kodunuz başarıyla alındı!`, code: uniqueCode, user: { points: user.points } });
    } catch (err) {
        res.status(500).json({ error: "Ödül alma hatası." });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 AdımKasası PRO (v2) Sunucusu http://localhost:${PORT} adresinde aktif!`);
});
