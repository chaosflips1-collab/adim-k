const mongoose = require('mongoose');

const ClaimSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rewardTitle: { type: String, required: true },
    pointsSpent: { type: Number, required: true },
    code: { type: String, required: true },
    claimedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Claim', ClaimSchema);
