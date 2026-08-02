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
const Raffle = require('./models/Raffle');
const authMiddleware = require('./middleware/auth');
const { JWT_SECRET } = authMiddleware;

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Adimkasasi:112233Okan@cluster0.g6ldbkz.mongodb.net/adimkasasi_v2?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('MongoDB Atlas (v2.5 DB) bağlandı!');
        await seedDemoData();
    })
    .catch((err) => console.log('MongoDB bağlantı hatası:', err));

// Demo Verilerini Tohumlama (Seed)
async function seedDemoData() {
    try {
        // 1. Ödüller
        const rewardCount = await Reward.countDocuments();
        if (rewardCount === 0) {
            await Reward.insertMany([
                { title: 'Starbucks Kahve Kuponu', description: 'Tüm küçük boy kahvelerde geçerli hediye kodu.', pointsCost: 150, category: 'Yiyecek & İçecek', code: 'STB-PRO-8842', icon: '☕', stock: 50 },
                { title: 'Trendyol 200 TL Hediye Çeki', description: 'Tüm kategorilerde geçerli alışveriş kuponu.', pointsCost: 800, category: 'Alışveriş', code: 'TRND-200-PRO', icon: '🛍️', stock: 20 },
                { title: 'Steam 100 TL Cüzdan Kodu', description: 'Steam hesabınıza bakiye yükleyin.', pointsCost: 650, category: 'Oyun', code: 'STEAM-100TL-PRO', icon: '🎮', stock: 25 },
                { title: 'Valorant 1000 VP', description: 'Valorant mağazasında geçerli Points kodu.', pointsCost: 600, category: 'Oyun', code: 'VALO-1000VP-PRO', icon: '🎯', stock: 30 }
            ]);
        }

        // 2. Çekilişler (Raffling)
        const raffleCount = await Raffle.countDocuments();
        if (raffleCount === 0) {
            await Raffle.insertMany([
                { title: 'iPhone 16 Pro 256GB Çekilişi', description: 'Sadece 25 AP vererek dev iPhone çekilişine katılın!', ticketCost: 25, icon: '📱', endDate: '31 Ağustos 2026' },
                { title: 'PlayStation 5 Slim Çekilişi', description: '50 AP vererek oyun konsolu çekiliş biletinizi alın!', ticketCost: 50, icon: '🎮', endDate: '15 Eylül 2026' },
                { title: 'Apple AirPods Pro 2 Çekilişi', description: '20 AP ile kablosuz kulaklık çekilişine dahil olun!', ticketCost: 20, icon: '🎧', endDate: '30 Ağustos 2026' }
            ]);
            console.log('v2.5 Çekiliş verileri yüklendi.');
        }

        // 3. Demo Liderlik Tablosu
        const userCount = await User.countDocuments();
        if (userCount < 5) {
            const dummyPassword = await bcrypt.hash('123456', 10);
            const dummyUsers = [
                { name: 'Ahmet Yılmaz 🥇', email: 'ahmet@adimkasasi.com', password: dummyPassword, steps: 142500, points: 1425, calories: 5700, streak: 12, level: 4, multiplier: 2.0, role: 'user' },
                { name: 'Zeynep Kaya 🥈', email: 'zeynep@adimkasasi.com', password: dummyPassword, steps: 118400, points: 1184, calories: 4736, streak: 9, level: 4, multiplier: 2.0, role: 'user' },
                { name: 'Burak Demir 🥉', email: 'burak@adimkasasi.com', password: dummyPassword, steps: 95200, points: 952, calories: 3808, streak: 7, level: 3, multiplier: 1.5, role: 'user' }
            ];
            await User.insertMany(dummyUsers);
        }
    } catch (err) {
        console.error('Seed hatası:', err);
    }
}

function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

// Seviye ve Çarpan Hesabı
function calculateLevel(steps) {
    if (steps >= 100000) return { level: 4, title: 'Efsane', multiplier: 2.0 };
    if (steps >= 50000) return { level: 3, title: 'Maratoncu', multiplier: 1.5 };
    if (steps >= 20000) return { level: 2, title: 'Tempolu', multiplier: 1.2 };
    return { level: 1, title: 'Yürüyüşçü', multiplier: 1.0 };
}

// --- API ROTALARI ---

// 1. Kayıt Ol (v2.5)
app.post('/api/v2/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: "Tüm alanları doldurun." });

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) return res.status(400).json({ error: "E-posta kullanımda." });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            name,
            email: email.toLowerCase(),
            password: hashedPassword,
            steps: 3000,
            unconvertedSteps: 3000,
            calories: 120,
            streak: 1,
            level: 1,
            multiplier: 1.0,
            lastStepDate: getTodayStr(),
            badges: [{ name: 'Aramıza Hoş Geldin!', icon: '👟' }]
        });

        await newUser.save();
        const token = jwt.sign({ id: newUser._id, email: newUser.email, name: newUser.name, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({ message: "Hesap oluşturuldu!", token, user: newUser });
    } catch (err) {
        res.status(500).json({ error: "Kayıt hatası." });
    }
});

// 2. Giriş Yap (v2.5)
app.post('/api/v2/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
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
        res.json({ message: "Giriş başarılı!", token, user });
    } catch (err) {
        res.status(500).json({ error: "Giriş hatası." });
    }
});

// Google Auth
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

        if (!userEmail) return res.status(400).json({ error: "Google e-posta alınamadı." });

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
                level: 1,
                multiplier: 1.0,
                lastStepDate: getTodayStr(),
                badges: [{ name: 'Google İle Bağlandı', icon: '🌐' }]
            });
            await user.save();
        }

        const token = jwt.sign({ id: user._id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ message: `Google ile giriş yapıldı! Hoş geldin ${user.name}`, token, user });
    } catch (err) {
        res.status(500).json({ error: "Google giriş hatası." });
    }
});

// 3. Me (Profil & Seviye Detayı)
app.get('/api/v2/user/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

        const claims = await Claim.find({ userId: user._id }).sort({ claimedAt: -1 });
        const donations = await Donation.find({ userId: user._id }).sort({ donatedAt: -1 });

        // Seviye Güncellemesi
        const lvlData = calculateLevel(user.steps);
        user.level = lvlData.level;
        user.multiplier = lvlData.multiplier;
        await user.save();

        res.json({ user, claims, donations, levelInfo: lvlData });
    } catch (err) {
        res.status(500).json({ error: "Veri alınamadı." });
    }
});

// 4. Adım Ekleme
app.post('/api/v2/steps/add', authMiddleware, async (req, res) => {
    try {
        const amount = parseInt(req.body.amount) || 500;
        const user = await User.findById(req.user.id);
        const today = getTodayStr();

        if (user.lastStepDate !== today) {
            user.todayConvertedSteps = 0;
            user.waterGlasses = 0;
            user.completedQuests = [];
            user.lastStepDate = today;
        }

        user.steps += amount;
        user.unconvertedSteps += amount;
        user.calories += Math.round(amount * 0.04);

        // Seviye Kontrolü
        const lvlData = calculateLevel(user.steps);
        user.level = lvlData.level;
        user.multiplier = lvlData.multiplier;

        await user.save();
        res.json({ message: `${amount} adım senkronize edildi! (Seviye: ${lvlData.title})`, user });
    } catch (err) {
        res.status(500).json({ error: "Adım ekleme hatası." });
    }
});

// 5. Adımları Dönüştür (Seviye Çarpanı + 2x Bonus)
app.post('/api/v2/steps/convert', authMiddleware, async (req, res) => {
    try {
        const isDouble = req.body.isDouble === true;
        const user = await User.findById(req.user.id);
        const today = getTodayStr();

        if (user.lastStepDate !== today) {
            user.todayConvertedSteps = 0;
            user.lastStepDate = today;
        }

        const DAILY_MAX_CAP = 15000;
        if (user.todayConvertedSteps >= DAILY_MAX_CAP) {
            return res.status(400).json({ error: "Günlük maksimum 15.000 adım dönüştürme limitine ulaştınız!" });
        }

        const availableToConvert = Math.min(user.unconvertedSteps, DAILY_MAX_CAP - user.todayConvertedSteps);
        if (availableToConvert < 100) {
            return res.status(400).json({ error: "En az 100 birikmiş adımınız olmalıdır." });
        }

        const convertAmount = Math.floor(availableToConvert / 100) * 100;
        
        // Seviye Çarpanlı Puan Hesabı!
        const lvlData = calculateLevel(user.steps);
        let earnedPoints = (convertAmount / 100) * 10 * lvlData.multiplier;

        if (isDouble) earnedPoints *= 2; // 2x Sponsor Çarpanı

        user.unconvertedSteps -= convertAmount;
        user.todayConvertedSteps += convertAmount;
        user.points += Math.round(earnedPoints);
        user.level = lvlData.level;
        user.multiplier = lvlData.multiplier;

        await user.save();
        res.json({
            message: `🎉 ${convertAmount} adım dönüştürüldü! (${lvlData.multiplier}x Seviye Çarpanı ile ${Math.round(earnedPoints)} AP kazandınız)`,
            earnedPoints,
            user
        });
    } catch (err) {
        res.status(500).json({ error: "Dönüştürme hatası." });
    }
});

// 6. SU TAKİBİ (Water Tracker)
app.post('/api/v2/health/water', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        user.waterGlasses = (user.waterGlasses || 0) + 1;
        
        let bonusMsg = `💧 1 Bardak Su İçildi! (${user.waterGlasses}/8 Bardak)`;
        if (user.waterGlasses === 8 && !user.completedQuests.includes('water')) {
            user.completedQuests.push('water');
            user.points += 50; // 50 AP Hedef Bonusu
            bonusMsg = "🎉 Tebrikler! Günlük 2 Litre Su Hedefine ulaştınız ve +50 AdımPuan kazandınız!";
        }

        await user.save();
        res.json({ message: bonusMsg, waterGlasses: user.waterGlasses, points: user.points });
    } catch (err) {
        res.status(500).json({ error: "Su takibi hatası." });
    }
});

// 7. GÜNLÜK SAĞLIK GÖREVLERİ (Health Quests)
app.post('/api/v2/health/quest', authMiddleware, async (req, res) => {
    try {
        const { questType } = req.body; // 'sleep' or 'workout'
        const user = await User.findById(req.user.id);

        if (user.completedQuests.includes(questType)) {
            return res.status(400).json({ error: "Bu görevi bugün zaten tamamladınız!" });
        }

        let rewardPoints = 0;
        let title = '';

        if (questType === 'sleep') {
            rewardPoints = 100;
            title = '8 Saat Uyu Görevi';
        } else if (questType === 'workout') {
            rewardPoints = 150;
            title = '30 Dk Antrenman Görevi';
        } else {
            return res.status(400).json({ error: "Geçersiz görev tipi." });
        }

        user.completedQuests.push(questType);
        user.points += rewardPoints;

        await user.save();
        res.json({ message: `🌟 Tebrikler! "${title}" tamamlandı ve +${rewardPoints} AdımPuan kazanıldı!`, points: user.points });
    } catch (err) {
        res.status(500).json({ error: "Görev hatası." });
    }
});

// 8. ÇEKİLİŞLER (Raffles) & BİLET ALMA
app.get('/api/v2/raffles', async (req, res) => {
    try {
        const raffles = await Raffle.find();
        res.json({ raffles });
    } catch (err) {
        res.status(500).json({ error: "Çekilişler getirilemedi." });
    }
});

app.post('/api/v2/raffles/buy', authMiddleware, async (req, res) => {
    try {
        const { raffleId } = req.body;
        const raffle = await Raffle.findById(raffleId);
        if (!raffle) return res.status(404).json({ error: "Çekiliş bulunamadı." });

        const user = await User.findById(req.user.id);
        if (user.points < raffle.ticketCost) {
            return res.status(400).json({ error: `Yetersiz bakiye! Bilet fiyatı: ${raffle.ticketCost} AP` });
        }

        user.points -= raffle.ticketCost;
        raffle.totalTickets += 1;

        const ticketCode = `TICKET-${Math.floor(100000 + Math.random() * 900000)}`;
        user.raffles.push({
            raffleTitle: raffle.title,
            ticketCode
        });

        await user.save();
        await raffle.save();

        res.json({ message: `🎟️ Tebrikler! "${raffle.title}" için çekiliş biletiniz alındı. Bilet No: ${ticketCode}`, ticketCode, points: user.points });
    } catch (err) {
        res.status(500).json({ error: "Bilet alma hatası." });
    }
});

// 9. Şans Çarkı, Liderlik & Bağış
app.post('/api/v2/wheel/spin', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const today = getTodayStr();

        if (user.lastWheelSpinDate === today) {
            return res.status(400).json({ error: "Bugün zaten çark çevirdiniz!" });
        }

        const prizes = [50, 100, 150, 200, 300, 500];
        const wonPoints = prizes[Math.floor(Math.random() * prizes.length)];

        user.points += wonPoints;
        user.lastWheelSpinDate = today;
        await user.save();

        res.json({ message: `🎡 Çark döndü ve +${wonPoints} AdımPuan kazandınız!`, wonPoints, user });
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
        const points = parseInt(pointsToDonate);

        const user = await User.findById(req.user.id);
        if (user.points < points) return res.status(400).json({ error: "Yetersiz bakiye!" });

        user.points -= points;
        user.totalDonations += points;

        const donation = new Donation({
            userId: user._id,
            charityName,
            stepsDonated: points * 10,
            pointsValue: points,
            icon: charityName.includes('Mama') ? '🐶' : (charityName.includes('Fidan') ? '🌲' : (charityName.includes('Kitap') ? '📚' : '❤️'))
        });

        await user.save();
        await donation.save();

        res.json({ message: `❤️ "${charityName}" için ${points} AP bağışlandı. Teşekkürler!`, user });
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
        if (!reward || reward.stock <= 0) return res.status(400).json({ error: "Stok yok." });

        const user = await User.findById(req.user.id);
        if (user.points < reward.pointsCost) return res.status(400).json({ error: "Yetersiz Bakiye!" });

        user.points -= reward.pointsCost;
        reward.stock -= 1;
        const uniqueCode = `${reward.code}-${Math.floor(1000 + Math.random() * 9000)}`;

        const claim = new Claim({ userId: user._id, rewardTitle: reward.title, pointsSpent: reward.pointsCost, code: uniqueCode });
        await user.save();
        await reward.save();
        await claim.save();

        res.json({ message: `🎉 Kodunuz: ${uniqueCode}`, code: uniqueCode, user });
    } catch (err) { res.status(500).json({ error: "Claim hatası." }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 AdımKasası PRO (v2.5) Sunucusu http://localhost:${PORT} adresinde aktif!`);
});
