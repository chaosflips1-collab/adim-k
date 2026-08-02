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
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
