const request = require("request");

const luisUrl =  process.env.LUIS_ENDPOINT + process.env.LUIS_APP_ID;

function predict(userQuery) {
    return new Promise((resolve, reject) => {
        request({
        url: luisUrl,
        qs: {
            verbose: "true",
            "subscription-key": process.env.LUIS_SUBSCRIPTION_KEY,
            q: userQuery
        },
        json: true,
        method: "GET",
            }, (error, response, body) => {
                if (error) {
                    console.log(`caught error when trying to query LUIS:\n\t${error}`);
                    reject("LUIS is not available");
                } else if (response.statusCode === 200) {
                    resolve(body);
                } else {
                    console.log(`unexpected status code: ${response.statusCode} from LUIS: ${body}`);
                                // reject the error with action name and failure message.
                    reject("Bad status from LUIS");
                }
            });
     });
}

module.exports = {
    predict
}