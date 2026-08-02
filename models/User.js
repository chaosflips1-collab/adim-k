const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true 
    },
    email: { 
        type: String, 
        required: true, 
        unique: true 
    },
    password: { 
        type: String, 
        required: true 
    },
    steps: { 
        type: Number, 
        default: 0 
    },
    unconvertedSteps: {
        type: Number,
        default: 0
    },
    todayConvertedSteps: {
        type: Number,
        default: 0
    },
    lastStepDate: {
        type: String,
        default: '' // YYYY-MM-DD formatında tutulur
    },
    points: { 
        type: Number, 
        default: 0 
    },
    calories: { 
        type: Number, 
        default: 0 
    },
    streak: {
        type: Number,
        default: 1
    },
    lastStreakDate: {
        type: String,
        default: ''
    },
    lastWheelSpinDate: {
        type: String,
        default: ''
    },
    totalDonations: {
        type: Number,
        default: 0
    },
    badges: [{
        name: String,
        icon: String,
        unlockedAt: { type: Date, default: Date.now }
    }],
    role: { 
        type: String, 
        default: 'user'
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('User', UserSchema);
