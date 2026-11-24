import { config, validateEnv } from './src/config/env.js';
import { createApp } from './src/app.js';
import logger from './src/utils/logger.js';

validateEnv();

const app = createApp();
app.listen(config.port, () => {
  logger.info(`Backend API running on port ${config.port}`);
});