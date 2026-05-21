'use strict';

/**
 * Shared MongoDB connection utility for all microservices.
 *
 * Usage in each service:
 *   const { connectDB } = require('./db/mongoConnection');
 *   connectDB('ServiceName').then(() => app.listen(...));
 *
 * Environment variable:
 *   MONGO_URL  — provided by Railway's MongoDB plugin (preferred)
 *   MONGO_URI  — legacy fallback (not used in Railway deployments)
 */

const mongoose = require('mongoose');

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Connect to MongoDB with retry logic and proper connection options.
 *
 * @param {string} serviceName  Human-readable label used in log output.
 * @returns {Promise<typeof mongoose>}
 */
async function connectDB(serviceName = 'Service') {
  const uri = process.env.MONGO_URL || process.env.MONGO_URI;

  if (!uri) {
    console.error(
      `[${serviceName}] FATAL: No MongoDB URI found. ` +
      'Set the MONGO_URL environment variable (provided by Railway MongoDB plugin).'
    );
    process.exit(1);
  }

  // Mask credentials in logs
  const maskedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//****:****@');
  console.log(`[${serviceName}] Connecting to MongoDB at: ${maskedUri}`);

  const options = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000,
  };

  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      await mongoose.connect(uri, options);
      console.log(`[${serviceName}] MongoDB connected successfully`);
      return mongoose;
    } catch (err) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.error(
        `[${serviceName}] MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`
      );

      if (attempt >= MAX_RETRIES) {
        console.error(`[${serviceName}] All ${MAX_RETRIES} connection attempts exhausted. Exiting.`);
        process.exit(1);
      }

      console.log(`[${serviceName}] Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Connection lost — mongoose will attempt to reconnect automatically.');
});

mongoose.connection.on('reconnected', () => {
  console.log('[MongoDB] Reconnected successfully.');
});

module.exports = { connectDB, mongoose };
