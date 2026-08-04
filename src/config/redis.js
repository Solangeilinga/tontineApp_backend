// src/config/redis.js
const logger = require('../config/logger');
const { createClient } = require('redis');

let redisClient;

const getRedisClient = async () => {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });

    redisClient.on('error', (err) => {
      logger.error('❌ Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis connecté');
    });

    await redisClient.connect();
  }
  return redisClient;
};

module.exports = { getRedisClient };
