# Chat Bot in a Day - Examples
This Repository includes examples of chatbots developed using Azure Bot Framework SDK in NodeJS.

## qnaMaker
Directory contains the following:
- **files** - different file types that QnA Maker can parse and create questions and answers from.
- **qnaClient** - simple web page that uses BotFramework-WebChat with Directline channel to send messages to a chatbot deployed on Azure.
- **qnaMakerExample** - implementation of a chatbot that gets answers from QnA Maker and present them to the user.

## luis
Directory contains a project of Pizza Chatbot with More advanced concepts of Azure Bot Framework (dialog status, nested dialogs, prompts validation and more). This Bot also has integration with Redis, SQLServer and MongoDB to Demonstrate integration of Azure Bot Framework to different technologies.

## Further reading

### Azure Bot Framework
- [Azure Bot Framework Documentation](https://docs.microsoft.com/he-il/azure/bot-service/?view=azure-bot-service-4.0)
- [Add Media to Messages](https://docs.microsoft.com/he-il/azure/bot-service/bot-builder-howto-add-media-attachments?view=azure-bot-service-4.0&tabs=javascript)
- [Implement sequential conversation flow](https://docs.microsoft.com/he-il/azure/bot-service/bot-builder-dialog-manage-conversation-flow?view=azure-bot-service-4.0&tabs=javascript)
- [Save user and conversation data](https://docs.microsoft.com/en-us/azure/bot-service/bot-builder-howto-v4-state?view=azure-bot-service-4.0&tabs=javascript)
- [Bot Framework Samples](https://github.com/microsoft/BotBuilder-Samples)

### Microsoft Bot Framework Composer (Preview)
- [Microsoft Bot Framework Composer](https://github.com/microsoft/BotFramework-Composer)

### Bot Framework Client
- [Working with Directline](https://docs.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-direct-line-3-0-concepts?view=azure-bot-service-4.0)
- [Bot Framework Web Chat](https://github.com/microsoft/BotFramework-WebChat)

### Misc.
[Properly send Welcome Message](https://blog.botframework.com/2018/07/12/how-to-properly-send-a-greeting-message-and-common-issues-from-customers/)
[QnA Maker Documentation](https://docs.microsoft.com/en-us/azure/cognitive-services/qnamaker/overview/overview)