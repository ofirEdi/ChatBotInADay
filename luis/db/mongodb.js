const mongodb = require('mongodb');

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

// push object with user and bot messages to conversations collection.
async function upsertConversationTurn (conversationId, turnData) {
    return new Promise(async (resolve, reject) => {
        try {
           await mongodbPool.db(process.env.MONGO_DB_NAME)
           .collection(process.env.MONGO_CONVERSATIONS_COLLECTION)
           .updateOne({conversationId}, {$set: {updatedAt: new Date()}, $push: {turns: turnData}});
           resolve(true);
       } catch (err) {
           reject(err);
       }
   });
}

// create new MongoDB record in conversations collection
async function createConversationDocument (conversationId, user) {
    const currentDate = new Date();
    return new Promise(async (resolve, reject) => {
        try {
           await mongodbPool.db(process.env.MONGO_DB_NAME)
           .collection(process.env.MONGO_CONVERSATIONS_COLLECTION)
           .insertOne({conversationId, user, turns: [], createdAt: currentDate, updatedAt: currentDate});
           resolve(true);
       } catch (err) {
           reject(err);
       }
   });
}

async function closeMongoDBClientConnection () {
    mongodbPool.close();
}

module.exports = {
    initMongoDBClient,
    closeMongoDBClientConnection,
    upsertConversationTurn,
    createConversationDocument
}