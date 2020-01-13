const logger = require('../logger/logger');
const sql = require('mssql');
const uuid = require('uuid/v4');

//configuration of Fenix potential insurees database
const config = {
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER,
    port: parseInt(process.env.SQL_PORT),
    database: process.env.SQL_DATABASE,
    pool: {
        max: parseInt(process.env.MAX_POOL),
        min: parseInt(process.env.MIN_POOL)
    }
}

let pool;

async function initSQLConnection() {
    pool = await new sql.ConnectionPool(config).connect();
    pool.on('error', err => {
     logger.error(`Error occured when tried to create db pool: ${err.message} ${err.stack}`);
    });
}

async function insertOrder(record) {
    return new Promise(async (resolve, reject) => {
        const ps = new sql.PreparedStatement(pool);
        ps.input('id', sql.NVarChar);
        ps.input('type', sql.NVarChar);
        ps.input('quantity', sql.Int);
        ps.input('toppings', sql.NVarChar);
        ps.input('price', sql.Int);
        ps.input('status', sql.NVarChar);
        ps.input('username', sql.NVarChar);
        ps.input('userAddress', sql.NVarChar);
        ps.prepare(`insert into orders  (id, type, quantity, toppings, price, status, username, userAddress)
         values (@id, @type, @quantity, @toppings, @price, @status, @username, @userAddress)`, err => {
            if(err) {
                logger.error(err);
                reject(err);
            }
            //execute query
            ps.execute({
                id: uuid(),
                type: record.type,
                quantity: record.quantity,
                toppings: record.toppings,
                price: record.price,
                status: 'new order',
                username: record.username,
                userAddress: record.userAddress
            }, (err, results) => {
                if(err) {
                    logger.error(err);
                    reject(err);
                }
                //release connection
                ps.unprepare(err => {
                if(err) {
                    logger.error(err);
                    reject(err);
                    }
                });
                resolve(true);
            });
        });
    });
}

async function closeSQLConnection() {
    await pool.close();
}

module.exports = {
    initSQLConnection,
    closeSQLConnection,
    insertOrder
}