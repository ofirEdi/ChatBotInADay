// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ActivityTypes, CardFactory } = require('botbuilder');
const { DialogSet, WaterfallDialog, TextPrompt, NumberPrompt, ChoicePrompt, DialogTurnStatus} = require('botbuilder-dialogs');
const util = require("util");
const {predict} = require('./luis');
const {generateAnswer} = require('./qnaMaker');
const logger = require("./logger/logger");
const redis = require("redis");
const {insertOrder} =  require('./db/mssql');

// Define state property accessor names.
const DIALOG_STATE_PROPERTY = 'dialogStateProperty';
const USER_PROFILE_PROPERTY = 'userProfileProperty';

// Dialogs
const ORDER_DIALOG = 'dialog-order';
const ADDRESS_DIALOG = 'dialog-address';
const PIZZA_QUANTITY_DIALOG = 'dialog-pizza-quantity';
const PIZZA_TOPPINGS_DIALOG = 'dialog-toppings';
const SUMMARY_DIALOG = 'dialog-summary';
const MAIN_DIALOG = 'dialog-main';

// Prompts
const SELECTION_PROMPT = 'prompt-choice';
const QUANTITY_PROMPT = 'prompt-quantity'
const ADDRESS_PROMPT = 'prompt-address';
const TOPPINGS_PROMPT = 'prompt-toppings'
const ORDER_PROMPT = 'prompt-order';

// luis intents
const luisIntents= {
 addToppings : "addToppings",
 pizzaDelivery: "pizzaDelivery",
 pizzaOrder: "pizzaOrder",
 pizzaPickup: "pizzaPickup",
 no: "no",
 none: "None"
};

// luis entities
const luisEntities = {
    number: "builtin.number",
    toppings: "toppings",
};

const prices = {
    pizza: 50,
    topping: 5
};

// connect to redis syncronously
let redisClient;
try {
    redisClient = redis.createClient(process.env.REDIS_URL);
    // promisify redis get method
    redisClient.get = util.promisify(redisClient.get);
} catch(error) {
    logger.error(error);
    process.exit(1);
}

class PizzaBot {
    constructor(conversationState, userState) {
        // Create the state property accessors and save the state management objects.
        this.dialogStateAccessor = conversationState.createProperty(DIALOG_STATE_PROPERTY);
        this.userProfileAccessor = userState.createProperty(USER_PROFILE_PROPERTY);
        this.conversationState = conversationState;
        this.userState = userState;

        // Create a dialog set for the bot. It requires a DialogState accessor, with which
        // to retrieve the dialog state from the turn context.
        this.dialogs = new DialogSet(this.dialogStateAccessor);

        // add prompts to dialog set
        this.dialogs
            .add(new ChoicePrompt(SELECTION_PROMPT))
            .add(new TextPrompt(QUANTITY_PROMPT, this.quantityValidator.bind(this)))
            .add(new TextPrompt(ADDRESS_PROMPT))
            .add(new TextPrompt(TOPPINGS_PROMPT, this.toppingsValidator.bind(this)))
            .add(new TextPrompt(ORDER_PROMPT, this.orderTypeValidator.bind(this)));

            this.dialogs.add(new WaterfallDialog(MAIN_DIALOG)
            .addStep(this.mainDialog.bind(this)));

            this.dialogs.add(new WaterfallDialog(PIZZA_QUANTITY_DIALOG)
            .addStep(this.getPizzaQuantity.bind(this))
            .addStep(this.processPizzaQuantity.bind(this)));

            this.dialogs.add(new WaterfallDialog(PIZZA_TOPPINGS_DIALOG)
            .addStep(this.getPizzaToppings.bind(this))
            .addStep(this.processPizzaToppings.bind(this)));

            this.dialogs.add(new WaterfallDialog(ORDER_DIALOG)
            .addStep(this.getUserOrderType.bind(this))
            .addStep(this.processUserOrderType.bind(this)));

            this.dialogs.add(new WaterfallDialog(ADDRESS_DIALOG)
            .addStep(this.getUserAddress.bind(this))
            .addStep(this.processUserAddress.bind(this)));

            this.dialogs.add(new WaterfallDialog(SUMMARY_DIALOG)
            .addStep(this.getUserConfirmation.bind(this))
            .addStep(this.processUserConfirmation.bind(this)));
    }

    async onTurn(turnContext) {
        if (turnContext.activity.type === ActivityTypes.Message) {
             // Run the DialogSet - let the framework identify the current state of the dialog from
            // the dialog stack and figure out what (if any) is the active dialog.
            const dialogContext = await this.dialogs.createContext(turnContext);
            const onGoingDialogs = await dialogContext.continueDialog();
            let userProfile = await this.userProfileAccessor.get(turnContext);
            switch(onGoingDialogs.status) {
                case DialogTurnStatus.empty:
                    console.log("Empty");
                    try {
                        // get prediction from LUIS and parse result
                        const luisPrediction = await predict(turnContext.activity.text);
                        await this.processLUISPredictionForEmptyState(luisPrediction, dialogContext, turnContext, userProfile);
                        //await turnContext.sendActivity(luisPrediction.topScoringIntent.intent);
                    } catch (error) {
                        logger.error(error);
                        await turnContext.sendActivity("I'm sorry for the inconvinience but i can't help" +
                        " you right now. Please try to contact me later");
                    }
                    break;
                case DialogTurnStatus.complete:
                    console.log("completed");
                    if (userProfile.post.status === "success") {
                        const orderPhrase = userProfile.in.orderType === "delivery" ? 'You should expect your delivery to in the next 30-40 minutes' :
                        'You will be able to pick-up your order in a 15-20 minutes';
                        await turnContext.sendActivity(`Thank you for you order! ${orderPhrase}`);
                        const pizzaGIF = CardFactory.animationCard('Bon Apetite!', [process.env.PIZZA_GIF]);
                        await turnContext.sendActivity({attachments: [pizzaGIF]});
                    } else {
                        await turnContext.sendActivity(`It's embarassing but we can't process your order at the moment. Sorry for the inconvinience. 
                        You can try and call our place at 03-6324422 or try me again later.`);
                    }
                    userProfile = PizzaBot.initUserProfile(userProfile.pre.user);
                    await this.userProfileAccessor.set(turnContext);
                    break;
                case DialogTurnStatus.waiting:
                    console.log("Waiting");
                    break;
                case DialogTurnStatus.cancelled:
                    console.log("cancelled");
                    await turnContext.sendActivity(`Your order is cancelled. feel free to reach me if you would like to make a new one`);
                    break;
            }
            console.log(turnContext.activity.text);
            // save conversation state
            await this.conversationState.saveChanges(turnContext);
            // save user profile
            await this.userState.saveChanges(turnContext);

        } else if ((turnContext.activity.type === ActivityTypes.ConversationUpdate || turnContext.activity.type === "event") &&
                    (turnContext.activity.membersAdded && turnContext.activity.membersAdded[0].name !== process.env.BOT_NAME)) {
            // get user state
            let userProfile = await this.userProfileAccessor.get(turnContext);
            //console.log("user profile", userProfile);
            //console.log(util.inspect(turnContext, {depth: 8, colors:true}));
            if(!userProfile) {
                // init profile
                userProfile = PizzaBot.initUserProfile(turnContext.activity.membersAdded[0].name || "defaultUser");
                // set user profile
                await this.userProfileAccessor.set(turnContext, userProfile);
                // save user profile
                await this.userState.saveChanges(turnContext);
                // send welcome message
                await turnContext.sendActivity(`Hi there ${turnContext.activity.membersAdded[0].name}. How can I help you?`);
            }
        }
    }

    // Generate default user profile
    static initUserProfile(from) {
        return {
           pre: {
               user: from
           },
           in: {},
           post: {} 
        }
    }

    // calculate order price
    static async calculateTotal(userProfile) {
        const pizzaPrice = parseInt(await redisClient.get("pizza"));
        const toppingPrice = parseInt(await redisClient.get("topping"));
        const onePizzaWithTopics = (userProfile.in.toppings.length * toppingPrice) + pizzaPrice;
        return onePizzaWithTopics * userProfile.in.quantity;
    }

    static closeRedisConnection() {
        redisClient.quit();
    }

    // Process initial LUIS Prediction
    async processLUISPredictionForEmptyState(luisPrediction, dialogContext ,turnContext, userProfile) {
        // act according to topIntent
        const topIntent = luisPrediction.topScoringIntent.intent;
        if(topIntent.includes("pizza")) {
            // check if intent indicates user order type
            if(topIntent === luisIntents.pizzaDelivery) {
                userProfile.in.orderType = "delivery";
            } else if (topIntent === luisIntents.pizzaPickup) {
                userProfile.in.orderType = "pickup";
            }
            // go over entites and try to get toppings and pizza quantity
            luisPrediction.entities.forEach((entity) => {
                if (entity.type === luisEntities.number && entity.resolution.subtype === "integer" && parseInt(entity.resolution.value) > 0) {
                    userProfile.in.quantity = parseInt(entity.resolution.value);
                } else if(entity.type === luisEntities.toppings) {
                    if (!userProfile.in.toppings) {
                        userProfile.in.toppings = [...entity.resolution.values];
                    } else {
                        userProfile.in.toppings.push(...entity.resolution.values);
                    }
                }
            });
            await this.userProfileAccessor.set(turnContext, userProfile);
            return await dialogContext.beginDialog(MAIN_DIALOG);
            
        } else {
            // send request to QnA maker
            try {
                const qnaResults = await generateAnswer({question: turnContext.activity.text});
                await turnContext.sendActivity(qnaResults.answers[0].answer);
            } catch (error) {
                logger.error(error);
                await turnContext.sendActivity("Tha't doesn't mean anything to me :/ Can you try to be more specific?");
            }
        }
    }

    async mainDialog(stepContext) {
        // get user details
        const userProfile = await this.userProfileAccessor.get(stepContext.context);
        // if order type was not established then begin order dialog
        if (!userProfile.in.orderType) {
            return await stepContext.replaceDialog(ORDER_DIALOG);
        }
        // 
        if (!userProfile.in.quantity) {
            return await stepContext.replaceDialog(PIZZA_QUANTITY_DIALOG);
        }
        // 
        if (!userProfile.in.toppings) {
            return await stepContext.replaceDialog(PIZZA_TOPPINGS_DIALOG);
        }
        if (userProfile.in.orderType === "delivery" && !userProfile.in.address) {
            return await stepContext.replaceDialog(ADDRESS_DIALOG);
        }
        return await stepContext.replaceDialog(SUMMARY_DIALOG);
    }

    async getUserOrderType(stepContext) {
        // prompt user for order type
        return await stepContext.prompt(ORDER_PROMPT, {
            prompt: "No problem! would you like to make a delivery or a pickup?",
            retryPrompt: "Your answer is unclear to me. is that a delivery or a pickup?"
        });
    }
    async processUserOrderType(stepContext) {
        // get user details
        const userProfile = await this.userProfileAccessor.get(stepContext.context);
        await stepContext.context.sendActivity(`Great! ${userProfile.in.orderType} it is`);
        return await stepContext.replaceDialog(MAIN_DIALOG);
    }
    async getPizzaQuantity(stepContext) {
         // prompt user for order type
         return await stepContext.prompt(QUANTITY_PROMPT, {
            prompt: "How many pizzas would you like to order?",
            retryPrompt: "I can't figure out the amount you want. Please try again"
        });
    }

    async processPizzaQuantity(stepContext) {
        await stepContext.context.sendActivity(`Alright!`);
        return await stepContext.replaceDialog(MAIN_DIALOG);
    }

    async getPizzaToppings(stepContext) {
        // prompt user for order type
        return await stepContext.prompt(TOPPINGS_PROMPT, {
            prompt: "What toppings would you like to add on your pizza?",
            retryPrompt: "Unfortunately we don't have theses toppings. Would you like anything else?"
        });
    }

    async processPizzaToppings(stepContext) {
        const userProfile = await this.userProfileAccessor.get(stepContext.context);
        userProfile.in.toppings.length > 0 ? 
        await stepContext.context.sendActivity("I like your choice! we will add to your pizza the toppings we offer.") :
        await stepContext.context.sendActivity("Plain pizza sounds perfect!");
        return await stepContext.replaceDialog(MAIN_DIALOG);
    }

    async getUserAddress(stepContext) {
        return await stepContext.prompt(ADDRESS_PROMPT, {
            prompt: "Where should i deliver your order?",
        });
    }

    async processUserAddress(stepContext) {
        const userProfile = await this.userProfileAccessor.get(stepContext.context);
        userProfile.in.address = stepContext.context.activity.text;
        await this.userProfileAccessor.set(stepContext.context, userProfile);
        return await stepContext.replaceDialog(MAIN_DIALOG);
    }

    async getUserConfirmation(stepContext) {
        const userProfile = await this.userProfileAccessor.get(stepContext.context);
        await stepContext.context.sendActivity(`We are almost done! I just want to validate that everything is OK with your order`);
        const pizzaQuantityPhrase = userProfile.in.quantity > 1 ? `${userProfile.in.quantity} pizzas` : "a pizza";
        const toppingsPhrase = userProfile.in.toppings.length > 0 ? userProfile.in.toppings.join(", ") : "no toppings" ;
        const addressPhrase = userProfile.in.orderType === "delivery" ? ` to ${userProfile.in.address}` : ``;
        await stepContext.context.sendActivity(`a ${userProfile.in.orderType} of ${pizzaQuantityPhrase} with ${toppingsPhrase}${addressPhrase}`);
        const price = await PizzaBot.calculateTotal(userProfile);
        userProfile.in.price = price;
        await this.userProfileAccessor.set(stepContext.context, userProfile);
        return await stepContext.prompt(SELECTION_PROMPT, {
        prompt: `Would you like to approve the order for a total of ${price} NIS?`,
        retryPrompt: `Please make a choice from the list`,
        choices: ['yes', 'no']
        });
    }

    async processUserConfirmation(stepContext) {
        let userProfile = await this.userProfileAccessor.get(stepContext.context);
        if (stepContext.result.value === 'yes') {
            try {
                await insertOrder({
                    type: userProfile.in.orderType,
                    quantity: userProfile.in.quantity,
                    toppings: userProfile.in.toppings.length > 0 ? userProfile.in.toppings.join(", ") : '',
                    price: userProfile.in.price,
                    username: userProfile.pre.user,
                    userAddress: userProfile.in.address ? userProfile.in.address : '',
                });
                userProfile.post.status = "success";
            } catch (error) {
                userProfile.post.status = "failure";
            }
            await this.userProfileAccessor.set(stepContext.context, userProfile);
            return await stepContext.endDialog();
        } else {
            userProfile = PizzaBot.initUserProfile(userProfile.pre.user);
            await this.userProfileAccessor.set(stepContext.context, userProfile);
            return await stepContext.cancelAllDialogs();
        }
    }

    /*****************************************  Validator Methods  ************************************** */
    // validates that the information received by the user 
    async quantityValidator(promptContext) {
        const userProfile = await this.userProfileAccessor.get(promptContext.context);
        let wasQuantityFound = false;
        try {
            // get luis prediction with user message after prompt
            const luisPrediction = await predict(promptContext.recognized.value);
            luisPrediction.entities.forEach((entity) => {
                if (entity.type === luisEntities.number && entity.resolution.subtype === "integer" 
                && parseInt(entity.resolution.value) > 0) {
                    userProfile.in.quantity = parseInt(entity.resolution.value);
                    wasQuantityFound = true;
                }
            })
            await this.userProfileAccessor.set(promptContext.context, userProfile);
            return wasQuantityFound;  
        } catch (error) {
            logger.error(error);
            await promptContext.context.sendActivity("I'm sorry for the inconvinience but i can't help" +
            " you right now. Please try to contact me later");
            return false;
        }
    }

    async toppingsValidator(promptContext) {
        const userProfile = await this.userProfileAccessor.get(promptContext.context);
        let wereToppingsFound = false;
        try {
            // get luis prediction with user message after prompt
            const luisPrediction = await predict(promptContext.recognized.value);
            const topIntent = luisPrediction.topScoringIntent.intent;
            if(topIntent === luisIntents.addToppings) {
                luisPrediction.entities.forEach((entity) => {
                    if(entity.type === luisEntities.toppings) {
                        wereToppingsFound = true;
                        if (!userProfile.in.toppings) {
                            userProfile.in.toppings = [...entity.resolution.values];
                        } else {
                            userProfile.in.toppings.push(...entity.resolution.values);
                        }
                    }
                });
                await this.userProfileAccessor.set(promptContext.context, userProfile);
                return wereToppingsFound;
            } else if (topIntent === luisIntents.no) {
                userProfile.in.toppings = [];
                await this.userProfileAccessor.set(promptContext.context, userProfile);
                return true;
            } else {
                return false;
            }
        } catch (error) {
            logger.error(error);
            await promptContext.context.sendActivity("I'm sorry for the inconvinience but i can't help" +
            " you right now. Please try to contact me later");
            return false;
        }
    }
    async orderTypeValidator(promptContext) {
        const userProfile = await this.userProfileAccessor.get(promptContext.context);
        try {
            // get luis prediction with user message after prompt
            const luisPrediction = await predict(promptContext.recognized.value);
            const topIntent = luisPrediction.topScoringIntent.intent;
            // update orderType if intent matches otherwise return false
            if(topIntent.includes("pizza") && topIntent !== luisIntents.pizzaOrder) {
                userProfile.in.orderType = topIntent === luisIntents.pizzaDelivery ? "delivery" : "pickup";
                await this.userProfileAccessor.set(promptContext.context, userProfile);
                return true;  
            } else {
                return false;
            }
        } catch (error) {
            logger.error(error);
            await promptContext.context.sendActivity("I'm sorry for the inconvinience but i can't help" +
            " you right now. Please try to contact me later");
            return false;
        }
    }
}
module.exports.PizzaBot = PizzaBot;
