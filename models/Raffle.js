const mongoose = require('mongoose');

const RaffleSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    ticketCost: { type: Number, required: true },
    totalTickets: { type: Number, default: 0 },
    icon: { type: String, default: '📱' },
    endDate: { type: String, default: '2026-08-31' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Raffle', RaffleSchema);
