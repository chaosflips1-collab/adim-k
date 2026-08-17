const request = require('supertest');
const mongoose = require('mongoose');
const { getApp, closeAll, clearCollections } = require('./setup');
const { registerUser } = require('./helpers');

let app;
let User, Reward;

beforeAll(async () => {
    app = await getApp();
    User = require('../models/User');
    Reward = require('../models/Reward');
}, 60000);
afterEach(async () => { await clearCollections(); });
afterAll(async () => { await closeAll(); });

describe('POST /api/v2/rewards/claim - transaction ile stok/bakiye tutarlılığı', () => {
    test('stok=1 ürüne eşzamanlı 5 talepten yalnızca biri başarılı olur, stok negatife düşmez', async () => {
        const { token, user } = await registerUser(app);

        // Kullanıcıya yeterli bakiye ver (normal kazanma akışını bypass ederek,
        // testin odağı harcama tarafının atomikliği).
        await User.updateOne({ _id: user._id }, { $set: { points: 100 } });

        const reward = await Reward.create({
            title: 'Test Ürünü', description: 'Test', pointsCost: 10,
            category: 'Test', code: 'TEST-CODE', icon: '🎁', stock: 1
        });

        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                request(app).post('/api/v2/rewards/claim').set('Authorization', `Bearer ${token}`).send({ rewardId: reward._id.toString() })
            )
        );

        const successes = results.filter(r => r.status === 200);
        const failures = results.filter(r => r.status !== 200);

        expect(successes.length).toBe(1);
        expect(failures.length).toBe(4);

        const finalReward = await Reward.findById(reward._id);
        expect(finalReward.stock).toBe(0);

        const finalUser = await User.findById(user._id);
        // Sadece BİR kez 10 puan düşülmüş olmalı (100 - 10 = 90), 5 kez değil.
        expect(finalUser.points).toBe(90);
    });

    test('yetersiz bakiyeyle talep reddedilir, stok değişmez', async () => {
        const { token, user } = await registerUser(app);
        await User.updateOne({ _id: user._id }, { $set: { points: 1 } });

        const reward = await Reward.create({
            title: 'Pahalı Ürün', description: 'Test', pointsCost: 50,
            category: 'Test', code: 'TEST-CODE-2', icon: '🎁', stock: 5
        });

        const res = await request(app).post('/api/v2/rewards/claim').set('Authorization', `Bearer ${token}`).send({ rewardId: reward._id.toString() });
        expect(res.status).toBe(400);

        const finalReward = await Reward.findById(reward._id);
        expect(finalReward.stock).toBe(5);
    });
});
