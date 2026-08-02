const mongoose = require('mongoose');

const DonationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    charityName: { type: String, required: true }, // örn: HAAP Barınak Mama Bağışı, TEMA Fidan
    stepsDonated: { type: Number, required: true },
    pointsValue: { type: Number, required: true },
    icon: { type: String, default: '🐾' },
    donatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Donation', DonationSchema);
