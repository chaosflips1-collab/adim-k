const mongoose = require('mongoose');

const ClaimSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rewardTitle: { type: String, required: true },
    pointsSpent: { type: Number, required: true },
    code: { type: String, required: true },
    claimedAt: { type: Date, default: Date.now },

    // Kod şu an sunucuda RASTGELE üretiliyor - gerçek bir tedarikçi (Steam/Spotify/
    // Google Play/Trendyol vb.) API'siyle doğrulanmıyor. Bu alan, gerçek entegrasyon
    // gelene kadar admin'in kodları elle doğrulayıp/tedarik edip işaretleyebilmesi
    // için var - kullanıcıya "kodun hazırlanıyor/doğrulanıyor" demek, sessizce
      // çalışmayan bir kod vermekten daha dürüst bir arayüz.
    fulfillmentStatus: { type: String, enum: ['unverified', 'verified', 'failed'], default: 'unverified' },
    fulfillmentNote: { type: String, default: '' }
});

module.exports = mongoose.model('Claim', ClaimSchema);
