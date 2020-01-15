// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ActivityTypes } = require('botbuilder');
const { DialogSet, WaterfallDialog, TextPrompt, NumberPrompt, ChoicePrompt, DialogTurnStatus} = require('botbuilder-dialogs');
const util = require("util");
const {generateAnswer} = require('./qna');

// Define state property accessor names.
const DIALOG_STATE_PROPERTY = 'dialogStateProperty';
const USER_PROFILE_PROPERTY = 'userProfileProperty';
const SELECTION_PROMPT = 'prompt-choice';

// Define id for multi-turn dialog
const MULTI_TURN_DIALOG = "dialog-multi-turn";

class QnaBot {
    constructor(conversationState, userState) {
        // Create the state property accessors and save the state management objects.
        this.dialogStateAccessor = conversationState.createProperty(DIALOG_STATE_PROPERTY);
        this.userProfileAccessor = userState.createProperty(USER_PROFILE_PROPERTY);
        this.conversationState = conversationState;
        this.userState = userState;

        // Create a dialog set for the bot. It requires a DialogState accessor, with which
        // to retrieve the dialog state from the turn context.
        this.dialogs = new DialogSet(this.dialogStateAccessor);
        // add prompt possibility
        this.dialogs.add(new ChoicePrompt(SELECTION_PROMPT));

        // add multi-turn dialog
        this.dialogs.add(new WaterfallDialog(MULTI_TURN_DIALOG)
            .addStep(this.qnaPrompt.bind(this))
            .addStep(this.processQnaPromptAnswer.bind(this)));
    }

    async onTurn(turnContext) {
        if (turnContext.activity.type === ActivityTypes.Message) {
             // Run the DialogSet - let the framework identify the current state of the dialog from
            // the dialog stack and figure out what (if any) is the active dialog.
            const dialogContext = await this.dialogs.createContext(turnContext);
            const onGoingDialogs = await dialogContext.continueDialog();
            switch(onGoingDialogs.status) {
                case DialogTurnStatus.empty:
                    //console.log("Current status: " + onGoingDialogs.status);
                    let userProfile = await this.userProfileAccessor.get(turnContext);
                    try {
                        const qnaRequestBody = QnaBot.buildQnaRequestBody(userProfile, turnContext.activity.text);
                        const qnaResults = await generateAnswer(qnaRequestBody);
                        // console.log(util.inspect(qnaResults, {depth: 8, colors:true}));
                        QnaBot.processQnaAnswer(qnaResults, userProfile, turnContext.activity.text);
                        //console.log("user profile", userProfile);
                        // set user profile
                        await this.userProfileAccessor.set(turnContext, userProfile);
                        // prompt user or send activity
                        if (userProfile.in.qnaChoices.length === 0) {
                            await turnContext.sendActivity(userProfile.in.qnaAnswer);
                        } else {
                            await dialogContext.beginDialog(MULTI_TURN_DIALOG);
                        } 
                    } catch(error) {
                        console.log(error);
                        await turnContext.sendActivity(`Sorry for the inconvinience but QnA is not available :/`);
                    }
                    break;
                case DialogTurnStatus.complete:
                    console.log("completed");
                    break;
                case DialogTurnStatus.waiting:
                    console.log("Waiting");
                    break;
                case DialogTurnStatus.cancelled:
                    console.log("Waiting");
                    break;
            }
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
                userProfile = QnaBot.initUserProfile(turnContext.activity.membersAdded[0].name || "defaultUser");
                // set user profile
                await this.userProfileAccessor.set(turnContext, userProfile);
                // save user profile
                await this.userState.saveChanges(turnContext);
                // send welcome message
                await turnContext.sendActivity(`Welcome to QNA bot ${turnContext.activity.membersAdded[0].name}. Please ask a question`);
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

    // Process responses from QnaMaker generateQuestion API
    static processQnaAnswer(qnaResults, userProfile, userQuestion) {
        // update user question for multi-turn
        userProfile.in.qnaPreviousUserQuery = userQuestion;
        // get answer form qnaResults
        userProfile.in.qnaAnswer = qnaResults.answers[0].answer;
        // get previous question id from qnaResults
        userProfile.in.qnaPreviousId = qnaResults.answers[0].id;
        // generate empty array for choices from qna
        userProfile.in.qnaChoices = [];
        // check if it is a multi-turn
        if (qnaResults.answers[0].context.prompts.length > 0) {
            // map qna results to userProfile
            userProfile.in.qnaChoices = qnaResults.answers[0].context.prompts.map((promptValue) => {
                return {qnaId: promptValue.qnaId, text: promptValue.displayText};
            });
            // update that bot is in multi turn stage
            userProfile.in.isMultiTurn = true;
        } else {
            userProfile.in.isMultiTurn = false;
        }
    }

    // Build request body for qna maker 
    static buildQnaRequestBody(userProfile, userQuery) {
        // build request body. if it is a multiturn than add context
        if (userProfile.in.isMultiTurn) {
            const requestBody = {};
            // attach user current query
            requestBody.question = userQuery;
            // attach context
            requestBody.context = {
                previousQnAId: userProfile.in.qnaPreviousId,
                previousUserQuery: userProfile.in.qnaPreviousUserQuery,
            }
            // find the qnaId of the picked answer
            const qnaId = userProfile.in.qnaChoices.find((choice) => {
                return choice.text === userQuery;
            }).qnaId;
            // attach qnaId of the answer that was picked
            requestBody.qnaId =  qnaId;
            return requestBody;
        } else {
            // default request body
            return {question: userQuery}
        }
    }

    async qnaPrompt(stepContext) {
        // get user details
        const userProfile = await this.userProfileAccessor.get(stepContext.context);

        // send a prompt with answer and choices from qna maker
        return await stepContext.prompt(SELECTION_PROMPT, {
        prompt: userProfile.in.qnaAnswer,
        retryPrompt: `Please make a choice from the list`,
        choices: userProfile.in.qnaChoices.map((choice) => {
                return choice.text;
            }),
        });
    }

    async processQnaPromptAnswer(stepContext) {
        // get user details
        const userProfile = await this.userProfileAccessor.get(stepContext.context);
        // get user input
        const userMultiTurnQuery = stepContext.result.value;
        // build request body
        const qnaRequestBody = QnaBot.buildQnaRequestBody(userProfile, userMultiTurnQuery);
        // send request and process answer
        try {
            const qnaResults = await generateAnswer(qnaRequestBody);
            // console.log(util.inspect(qnaResults, {depth: 8, colors:true}));
            QnaBot.processQnaAnswer(qnaResults, userProfile, userMultiTurnQuery);
            console.log("user profile", userProfile);
            // set user profile
            await this.userProfileAccessor.set(stepContext.context, userProfile);
            // prompt user or send activity
            if (userProfile.in.qnaChoices.length === 0) {
                await stepContext.context.sendActivity(userProfile.in.qnaAnswer);
                // cancel conversation. change DialogTurnStatus to cancelled
                return await stepContext.cancelAllDialogs();
            } else {
                return await stepContext.replaceDialog(MULTI_TURN_DIALOG);
            }
        } catch (error) {

        }
    } 
}

module.exports.QnaBot = QnaBot;
