const request = require("request");

function generateAnswer(body) {
    return new Promise((resolve, reject) => {
        request({
        body,
        json: true,
        headers: {
            Authorization: process.env.QNA_MAKER_AUTH
        },
        method: "POST",
        url: process.env.QNA_MAKER_ENDPOINT,
            }, (error, response, body) => {
            if (error) {
                console.log(`caught error when trying to query QNA Maker:\n\t${error}`);
                reject("QNA Maker is not available");
            } else if (response.statusCode === 200) {
                resolve(body);
            } else {
                console.log(`unexpected status code: ${response.statusCode} from QNA Maker: ${body}`);
                            // reject the error with action name and failure message.
                reject("Bad status from QNA Maker");
            }
        });
    });
}

module.exports = {
    generateAnswer
}