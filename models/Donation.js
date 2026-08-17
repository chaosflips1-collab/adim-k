const mongoose = require('mongoose');

const DonationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    charityName: { type: String, required: true }, // örn: HAAP Barınak Mama Bağışı, TEMA Fidan
    stepsDonated: { type: Number, required: true },
    pointsValue: { type: Number, required: true },
    icon: { type: String, default: '🐾' },
    donatedAt: { type: Date, default: Date.now },

    // Kullanıcının puanı düşülüyor ama kuruma (HAAP/TEMA/LÖSEV vb.) fiili bir
    // aktarım/mutabakat henüz otomatik değil. Bu alan, admin'in dönemsel olarak
    // gerçek transferi yapıp toplu işaretleyebilmesi için var - bkz.
    // /api/v2/admin/donations/mark-transferred ve Obsidian notu.
    transferStatus: { type: String, enum: ['pending', 'transferred'], default: 'pending' },
    transferredAt: { type: Date, default: null }
});

module.exports = mongoose.model('Donation', DonationSchema);
