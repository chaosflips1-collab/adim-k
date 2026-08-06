const mongoose = require('mongoose');

const CharitySchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    pointsCost: { type: Number, required: true },
    icon: { type: String, default: '❤️' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Charity', CharitySchema);
