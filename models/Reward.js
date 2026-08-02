const mongoose = require('mongoose');

const RewardSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    pointsCost: { type: Number, required: true },
    category: { type: String, default: 'Genel' },
    code: { type: String, required: true },
    stock: { type: Number, default: 10 },
    icon: { type: String, default: '🎁' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Reward', RewardSchema);
