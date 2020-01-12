const mongodb = require('mongodb');
const logger = require('../logger/logger');

let mongodbPool;

// build connection string for mongodb
const compileMongoUrl = () => {
    let mongoUrl = process.env.MONGO_CONNECTION_STRING_PREFIX;
        // only add authentication values if they are not empty (encode username and password as it might contain
        // special charactres).
        if (process.env.MONGO_USERNAME.length > 0 && process.env.MONGO_PASSWORD.length > 0) {
            mongoUrl += encodeURIComponent(process.env.MONGO_USERNAME) + ":" +
            encodeURIComponent(process.env.MONGO_PASSWORD) + "@";
        }

        mongoUrl += process.env.MONGO_HOST + `?retryWrites=true`;
        return mongoUrl;
}

async function initMongoDBClient () {
    const mongoUrl = compileMongoUrl();
    mongodbPool = await mongodb.connect(mongoUrl, {
        poolSize: process.env.MONGO_POOL_SIZE,
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
}

async function closeMongoDBClientConnection () {
    mongodbPool.close();
}

module.exports = {
    initMongoDBClient,
    closeMongoDBClientConnection,
}