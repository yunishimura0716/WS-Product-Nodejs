const moment = require('moment');
const redis = require('redis');

/**
 * This file is middleware to implement rate limiting
 * Algorithm is sliding window counter
 */

const redis_client = redis.createClient(6379, 'redis');
const window_size_in_hours = 1;
const max_window_requests = 100;
const window_log_interval_in_minutes = 10;

module.exports = (req, res, next) => {
    try {
        // check if redis client exists
        if (!redis_client) {
            throw new Error("Redis client does not exist");
            process.exit(1);
        }
        // keep track records of current user by IP address
        redis_client.get(req.ip, function (err, record) {
            if (err) throw err;
            console.log(record);
            const curretn_request_time = moment();
            // if there is no record, create a new record for current user and save it to redis
            if (!record) {
                let new_record = [];
                let request_log = {
                    requestTimeStamp: curretn_request_time.unix(),
                    request_count: 1
                };
                new_record.push(request_log);
                redis_client.set(req.ip, JSON.stringify(new_record));
                next();
                return;
            }

            // if we found a record, parse it's value and calculate number of requests users has made within the last window
            let data = JSON.parse(record);
            console.log(data);
            let window_start_timestamp = moment().subtract(window_size_in_hours, 'hours').unix();
            let requests_within_window = data.filter(request => {
                return request.requestTimeStamp > window_start_timestamp;
            });
            console.log('requestsWithinWindow', requests_within_window);
            let total_window_requests = requests_within_window.reduce((total, request) => {
                return total + request.request_count;
            }, 0);
            if (total_window_requests >= max_window_requests) {
                res.status(429);
                throw new Error(`You have exceeded the ${max_window_requests} requests in ${window_size_in_hours} hrs limit!`);
            } else {
                // log new entry
                let last_requestLog = data[data.length - 1];
                let potentialCurrentWindowIntervalStartTimeStamp = curretn_request_time.subtract(window_log_interval_in_minutes, 'minutes').unix();
                //  if interval has not passed since last request log, increment counter
                if (last_requestLog.requestTimeStamp > potentialCurrentWindowIntervalStartTimeStamp) {
                    last_requestLog.request_count++;
                    data[data.length - 1] = last_requestLog;
                } else {
                    //  if interval has passed, log new entry for current user and timestamp
                    data.push({
                        requestTimeStamp: curretn_request_time.unix(),
                        request_count: 1
                    });
                }
                redis_client.set(req.ip, JSON.stringify(data));
                next();
            }
        });
    } catch (error) {
        next(error);
    }
};