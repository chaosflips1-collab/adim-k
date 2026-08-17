const request = require('supertest');

let counter = 0;

/** Benzersiz e-postalı bir test kullanıcısı oluşturup token'ını döndürür. */
async function registerUser(app, overrides = {}) {
    counter += 1;
    const email = overrides.email || `testuser${Date.now()}_${counter}@example.com`;
    const res = await request(app).post('/api/v2/register').send({
        name: overrides.name || 'Test Kullanıcı',
        email,
        password: overrides.password || 'sifre123',
        height: overrides.height,
        weight: overrides.weight
    });
    if (res.status !== 201) {
        throw new Error(`registerUser başarısız: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return { token: res.body.token, user: res.body.user, email };
}

module.exports = { registerUser };
