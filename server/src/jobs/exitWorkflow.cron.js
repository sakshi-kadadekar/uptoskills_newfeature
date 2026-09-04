import cron from 'node-cron';
import { runDailyExitScan } from '../services/exitWorkflow.service.js';
import { logger } from '../utils/logger.js';

export function scheduleExitWorkflowJob() {
  return cron.schedule('0 1 * * *', async () => {
    try {
      const results = await runDailyExitScan();
      logger.info({ count: results.length }, 'exit-workflow: daily scan complete');
    } catch (err) {
      logger.error({ err }, 'exit-workflow: daily scan failed');
    }
  });
}

export default scheduleExitWorkflowJob;