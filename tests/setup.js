// Testler için tek seferlik kurulum: gerçek MongoDB Atlas'a DOKUNMAZ - her test
// koşumu için bellekte, izole bir mongod (mongodb-memory-server) başlatılır.
// server.js env değişkenlerine (MONGO_URI, JWT_SECRET) module-load anında
// bağlandığı için, bunlar server.js require edilmeden ÖNCE set edilmeli.
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let app;

async function getApp() {
    if (app) return app;

    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_only_secret_never_used_in_prod';

    // /api/v2/rewards/claim gerçek bir MongoDB transaction'ı (session.withTransaction)
    // kullanıyor - transaction'lar yalnızca replica set'lerde desteklenir (tek başına
    // bir standalone mongod'da DESTEKLENMEZ). Bu yüzden burada tek node'luk bir
    // replica set başlatıyoruz (production'daki Atlas cluster'ının davranışını
    // taklit eder - Atlas M0 dahil her zaman replica set'tir).
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGO_URI = mongod.getUri();

    // require server.js'i BURADA, env set edildikten sonra yapıyoruz - server.js
    // kendi mongoose.connect(MONGO_URI)'sini module-load anında (require edilir
    // edilmez) tetikler.
    app = require('../server.js');

    await new Promise((resolve, reject) => {
        if (mongoose.connection.readyState === 1) return resolve();
        mongoose.connection.once('open', resolve);
        mongoose.connection.once('error', reject);
    });

    return app;
}

async function closeAll() {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.connection.close();
    if (mongod) await mongod.stop();
}

/** Her testte temiz bir başlangıç için tüm koleksiyonları boşaltır (seed hariç). */
async function clearCollections() {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
        await collections[key].deleteMany({});
    }
}

module.exports = { getApp, closeAll, clearCollections };
