const request = require('supertest');
const { getApp, closeAll, clearCollections } = require('./setup');
const { registerUser } = require('./helpers');

let app;
let User;

beforeAll(async () => {
    app = await getApp();
    User = require('../models/User');
}, 60000);
afterEach(async () => { await clearCollections(); });
afterAll(async () => { await closeAll(); });

describe('POST /api/v2/donate', () => {
    test('yetersiz bakiyeyle bağış reddedilir', async () => {
        const { token, user } = await registerUser(app);
        await User.updateOne({ _id: user._id }, { $set: { points: 1 } });

        const res = await request(app)
            .post('/api/v2/donate')
            .set('Authorization', `Bearer ${token}`)
            .send({ charityName: 'Test Kurumu', pointsToDonate: 5 });

        expect(res.status).toBe(400);
    });

    test('negatif miktar bakiyeye puan eklenmesine yol açmaz', async () => {
        const { token, user } = await registerUser(app);
        await User.updateOne({ _id: user._id }, { $set: { points: 10 } });

        const res = await request(app)
            .post('/api/v2/donate')
            .set('Authorization', `Bearer ${token}`)
            .send({ charityName: 'Test Kurumu', pointsToDonate: -5 });

        expect(res.status).toBe(400);
        const finalUser = await User.findById(user._id);
        expect(finalUser.points).toBe(10); // değişmemeli
    });

    test('geçerli bağış bakiyeyi doğru düşer', async () => {
        const { token, user } = await registerUser(app);
        await User.updateOne({ _id: user._id }, { $set: { points: 10 } });

        const res = await request(app)
            .post('/api/v2/donate')
            .set('Authorization', `Bearer ${token}`)
            .send({ charityName: 'Test Kurumu', pointsToDonate: 3 });

        expect(res.status).toBe(200);
        expect(res.body.user.points).toBeCloseTo(7, 5);
    });
});

describe('GET /api/v2/leaderboard', () => {
    test('auth olmadan reddedilir', async () => {
        const res = await request(app).get('/api/v2/leaderboard');
        expect(res.status).toBe(401);
    });

    test('geçerli token ile listeyi döner', async () => {
        const { token } = await registerUser(app);
        const res = await request(app).get('/api/v2/leaderboard').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.leaderboard)).toBe(true);
    });
});
