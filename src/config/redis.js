// src/config/redis.js
const { createClient } = require('redis');

let redisClient;

const getRedisClient = async () => {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });

    redisClient.on('error', (err) => {
      console.error('❌ Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connecté');
    });

    await redisClient.connect();
  }
  return redisClient;
};

module.exports = { getRedisClient };
