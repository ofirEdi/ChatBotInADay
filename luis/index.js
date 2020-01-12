// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const dotenv = require('dotenv');
const path = require('path');
// Import required bot configuration.
const ENV_FILE = path.join(__dirname, '.env');
dotenv.config({ path: ENV_FILE });
const restify = require('restify');
const logger = require("./logger/logger");
const {initSQLConnection, closeSQLConnection} = require("./db/mssql");
const {initMongoDBClient, closeMongoDBClientConnection} = require('./db/mongodb');

// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
const {BotFrameworkAdapter, MemoryStorage, ConversationState, UserState } = require('botbuilder');

// This bot's main dialog.
const { PizzaBot } = require('./bot');

// establish DBS connection
const initDBSconnections = async () => {
    try {
        await initSQLConnection();
        await initMongoDBClient();
    } catch (error) {
        logger.error(error);
        process.emit('SIGINT');
    }
}

// establish db connections before starting server
initDBSconnections();

// Create HTTP server
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, () => {
    logger.info("service is running");
    console.log(`\n${ server.name } listening to ${ server.url }`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo talk to your bot, open the emulator select "Open Bot"');
});

// Create adapter.
// See https://aka.ms/about-bot-adapter to learn more about how bots work.
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    channelService: process.env.ChannelService,
    openIdMetadata: process.env.BotOpenIdMetadata
});

// Catch-all for errors.
adapter.onTurnError = async (context, error) => {
    // This check writes out errors to console log .vs. app insights.
    // NOTE: In production environment, you should consider logging this to Azure
    //       application insights.
    console.error(`\n [onTurnError] unhandled error: ${ error }`);

    // Send a trace activity, which will be displayed in Bot Framework Emulator
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${ error }`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // Send a message to the user
    await context.sendActivity('The bot encounted an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

// create Memory resources
const memoryStorage = new MemoryStorage();
const conversationState = new ConversationState(memoryStorage);
const userState = new UserState(memoryStorage);

// Create the main dialog.
const pizzaBot = new PizzaBot(conversationState, userState);

// Listen for incoming requests.
server.post('/api/messages', (req, res) => {
    adapter.processActivity(req, res, async (context) => {
        // Route to main dialog.
        await pizzaBot.onTurn(context);
    });
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function shutdown() {
    try {
        PizzaBot.closeRedisConnection();
        console.log("Successfully closed connection to Redis");
    } catch(error) {
        logger.error(error);
    }
    try {
        await closeSQLConnection();
        console.log("closed sql connection successfully");
    } catch (error) {
        logger.error(error);
    }
    try {
        await closeMongoDBClientConnection();
        console.log("closed mongoDB connection successfully");
    } catch (error) {
        logger.error(error);
    }
    try {
        server.close(() => {
            console.log("Shutdown server successfully");
        })
    } catch (error) {
        logger.error(error);
    }
}
