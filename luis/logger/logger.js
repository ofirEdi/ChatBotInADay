const fs = require("fs");
const path = require("path");
const { Logger, createLogger, format, transports } = require("winston");

// get environment for logging level
const env = process.env.NODE_ENV || "development";
const logDir = process.env.LOG_DIR || "logs";
const filename = path.join(logDir, process.env.LOG_FILE || "pizzaBot.log");

// create log dir if not exists
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logger = createLogger({
    level: env === "development" ? 'debug' : 'info',
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
          }),
          format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
    ),
    transports: [
        new transports.File({filename})
    ]
});

module.exports = logger;