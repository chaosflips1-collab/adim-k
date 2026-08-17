const request = require('supertest');
const { getApp, closeAll, clearCollections } = require('./setup');
const { registerUser } = require('./helpers');

let app;

beforeAll(async () => { app = await getApp(); }, 60000);
afterEach(async () => { await clearCollections(); });
afterAll(async () => { await closeAll(); });

describe('POST /api/v2/steps/convert - eşzamanlılık (lost-update) koruması', () => {
    test('1500 birikmiş adımla eşzamanlı 5 dönüştürme isteğinden yalnızca biri başarılı olur', async () => {
        const { token } = await registerUser(app);

        // 1500 adım biriktir (tek istekte, 2000 tavanının altında).
        const addRes = await request(app)
            .post('/api/v2/steps/add')
            .set('Authorization', `Bearer ${token}`)
            .send({ amount: 1500 });
        expect(addRes.status).toBe(200);
        expect(addRes.body.user.unconvertedSteps).toBe(1500);

        // 5 eşzamanlı dönüştürme isteği - 1500 sadece 1000'lik TEK bir dilime
        // dönüştürülebilir (floor(1500/1000)*1000=1000), kalan 500 minimum 1000
        // eşiğinin altında kalır. Bu yüzden en fazla BİR istek başarılı olmalı.
        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                request(app).post('/api/v2/steps/convert').set('Authorization', `Bearer ${token}`).send({})
            )
        );

        const successes = results.filter(r => r.status === 200);
        const failures = results.filter(r => r.status !== 200);

        expect(successes.length).toBe(1);
        expect(failures.length).toBe(4);
        expect(successes[0].body.user.unconvertedSteps).toBe(500);
        expect(successes[0].body.user.todayConvertedSteps).toBe(1000);
    });

    test('1000 adımın altında dönüştürme reddedilir', async () => {
        const { token } = await registerUser(app);
        await request(app).post('/api/v2/steps/add').set('Authorization', `Bearer ${token}`).send({ amount: 500 });

        const res = await request(app).post('/api/v2/steps/convert').set('Authorization', `Bearer ${token}`).send({});
        expect(res.status).toBe(400);
    });

    test('isDouble bayrağı sunucu tarafı onay olmadan görmezden gelinir (istismar koruması)', async () => {
        const { token } = await registerUser(app);
        await request(app).post('/api/v2/steps/add').set('Authorization', `Bearer ${token}`).send({ amount: 1000 });

        const res = await request(app)
            .post('/api/v2/steps/convert')
            .set('Authorization', `Bearer ${token}`)
            .send({ isDouble: true }); // confirm-double hiç çağrılmadı

        expect(res.status).toBe(200);
        expect(res.body.usedDouble).toBe(false);
        // 1000 adım * 0.10 * 1.0 (level 1 multiplier) = 0.10, 2x UYGULANMAMALI.
        expect(res.body.earnedPoints).toBeCloseTo(0.10, 5);
    });
});
