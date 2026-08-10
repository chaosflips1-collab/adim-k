const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    steps: { type: Number, default: 0 },
    unconvertedSteps: { type: Number, default: 0 },
    todayConvertedSteps: { type: Number, default: 0 },
    lastStepDate: { type: String, default: '' },
    points: { type: Number, default: 0 },
    calories: { type: Number, default: 0 },
    streak: { type: Number, default: 1 },
    lastStreakDate: { type: String, default: '' },
    lastWheelSpinDate: { type: String, default: '' },
    totalDonations: { type: Number, default: 0 },

    // BİLİMSEL KİŞİSEL SAĞLIK VERİLERİ (BOY & KİLO)
    height: { type: Number, default: 175 }, // cm
    weight: { type: Number, default: 70 }, // kg

    // v2.5 YENİ EKLENEN SAĞLIK & SEVİYE ALANLARI
    level: { type: Number, default: 1 }, // 1: Yürüyüşçü, 2: Tempolu, 3: Maratoncu, 4: Efsane
    multiplier: { type: Number, default: 1.0 }, // Puan katlama katsayısı (1.0x, 1.2x, 1.5x, 2.0x)
    waterGlasses: { type: Number, default: 0 }, // Günlük su içme sayısı (hedef 8 bardak)
    lastWaterDate: { type: String, default: '' },
    completedQuests: [{ type: String }], // 'sleep', 'workout', 'water'
    raffles: [{
        raffleTitle: String,
        ticketCode: String,
        boughtAt: { type: Date, default: Date.now }
    }],

    badges: [{
        name: String,
        icon: String,
        unlockedAt: { type: Date, default: Date.now }
    }],
    role: { type: String, default: 'user' },
    createdAt: { type: Date, default: Date.now },

    // v2.7: Davet Et ve Kazan
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referralRewardGiven: { type: Boolean, default: false },
    referralWeekStart: { type: String, default: '' },
    referralWeekCount: { type: Number, default: 0 },

    // v2.7: Reklam İzle Kazan (günlük sıfırlanır, bkz. ensureDailyReset)
    adWatchesToday: { type: Number, default: 0 },

    // v2.7: Basit Oyunlar - her oyun için ayrı günlük ilk-temiz-oyun ödülü
    // takibi (lastClaimDate, getTodayStr() ile aynı 'YYYY-MM-DD' formatında -
    // bugünle karşılaştırılarak türetilir, ayrı bir sıfırlama mantığı gerekmez).
    gameStats: [{ gameId: String, lastClaimDate: { type: String, default: '' } }],
    activeGameId: { type: String, default: null },

    // v2.7: Kayıt sonrası izin/veri koruma sözleşmesi onayı
    privacyAccepted: { type: Boolean, default: false },
    privacyAcceptedAt: { type: Date, default: null },

    // Bug-fix (bkz. server.js /api/v2/steps/convert, /api/v2/ads/confirm-double):
    // istemcinin gönderdiği isDouble bayrağına asla doğrudan güvenilmez. 5sn'lik
    // simüle reklam akışı tamamlandığında sunucu bu bayrağı kısa ömürlü (60sn)
    // olarak işaretler; /steps/convert bunu atomik "oku ve temizle" ile
    // tüketir. İşaretlenip biriktirilerek stoklanmasını önlemek için süresi
    // pendingDoubleBoostAt + 60sn'den sonra geçersiz sayılır.
    pendingDoubleBoost: { type: Boolean, default: false },
    pendingDoubleBoostAt: { type: Date, default: null },

    // Bug-fix (bkz. server.js /api/v2/games/start, /api/v2/games/reward):
    // istemcinin bildirdiği durationMs artık güvenilmez; oyun süresi bu
    // sunucu-taraflı zaman damgasından hesaplanır ve ödül talebinde atomik
    // olarak temizlenir (aynı oturumun iki kez talep edilmesini engeller).
    gameSessionStart: { type: Date, default: null }
});

module.exports = mongoose.model('User', UserSchema);
