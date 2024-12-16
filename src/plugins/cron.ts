import fp from 'fastify-plugin';
import TransactionProcessor from '../services/transaction';
import cron from 'fastify-cron';
import { Env } from '../env';
import Unlocker from '../services/unlocker';
import RgbppCollector from '../services/rgbpp';
import UTXOSyncer2 from '../services/utxo2';

export default fp(async (fastify) => {
  try {
    const env: Env = fastify.container.resolve('env');

    const getSentryCheckIn = (monitorSlug: string, crontab: string) => {
      const checkInId = fastify.Sentry.captureCheckIn(
        {
          monitorSlug,
          status: 'in_progress',
        },
        {
          schedule: {
            type: 'crontab',
            value: crontab,
          },
          // create a new issue when 3 times missed or error check-ins are processed
          failure_issue_threshold: 3,
          // close the issue when 3 times ok check-ins are processed
          recovery_threshold: 3,
        },
      );
      return {
        ok: () => {
          fastify.Sentry.captureCheckIn({
            checkInId,
            monitorSlug,
            status: 'ok',
          });
        },
        error: () => {
          fastify.Sentry.captureCheckIn({
            checkInId,
            monitorSlug,
            status: 'error',
          });
        },
      };
    };

    // processing rgb++ ckb transaction
    const transactionProcessor: TransactionProcessor = fastify.container.resolve('transactionProcessor');
    fastify.addHook('onReady', async () => {
      transactionProcessor.startProcess({
        onActive: (job) => {
          fastify.log.info(`[TransactionProcessor] job active: ${job.id}`);
        },
        onCompleted: (job) => {
          fastify.log.info(`[TransactionProcessor] job completed: ${job.id}`);
        },
      });
    });
    fastify.addHook('onClose', async () => {
      transactionProcessor.closeProcess();
    });

    const retryMissingTransactionsJob = {
      name: `retry-missing-transacitons-${env.NETWORK}`,
      cronTime: '*/5 * * * *',
      onTick: async () => {
        fastify.Sentry.startSpan({ op: 'cron', name: 'retry-missing-transactions' }, async () => {
          const { name, cronTime } = retryMissingTransactionsJob;
          const checkIn = getSentryCheckIn(name, cronTime);
          try {
            await transactionProcessor.retryMissingTransactions();
            checkIn.ok();
          } catch (err) {
            checkIn.error();
            fastify.log.error(err);
            fastify.Sentry.captureException(err);
          }
        });
      },
    };

    if (env.UTXO_SYNC_DATA_CACHE_ENABLE) {
      const utxoSyncer: UTXOSyncer2 = fastify.container.resolve('utxoSyncer');
      fastify.addHook('onReady', async () => {
        utxoSyncer.startProcess({
          onActive: (job) => {
            fastify.log.info(`[UTXOSyncer2] job active: ${job.id}`);
          },
          onCompleted: async (job) => {
            fastify.log.info(`[UTXOSyncer2] job completed: ${job.id}`);
            if (env.RGBPP_COLLECT_DATA_CACHE_ENABLE) {
              const { address, coinType } = job.data;
              const rgbppCollector: RgbppCollector = fastify.container.resolve('rgbppCollector');
              await rgbppCollector.enqueueCollectJob(address, coinType, true);
            }
          },
        });
      });
      fastify.addHook('onClose', async () => {
        utxoSyncer.closeProcess();
      });
    }

    if (env.RGBPP_COLLECT_DATA_CACHE_ENABLE) {
      const rgbppCollector: RgbppCollector = fastify.container.resolve('rgbppCollector');
      fastify.addHook('onReady', async () => {
        rgbppCollector.startProcess({
          onActive: (job) => {
            fastify.log.info(`[RgbppCollector] job active: ${job.id}`);
          },
          onCompleted: (job) => {
            fastify.log.info(`[RgbppCollector] job completed: ${job.id}`);
          },
        });
      });
      fastify.addHook('onClose', async () => {
        rgbppCollector.closeProcess();
      });
    }

    // processing unlock BTC_TIME_LOCK cells
    const unlocker: Unlocker = fastify.container.resolve('unlocker');
    const monitorSlug = env.UNLOCKER_MONITOR_SLUG;
    const unlockBTCTimeLockCellsJob = {
      name: monitorSlug,
      cronTime: env.UNLOCKER_CRON_SCHEDULE,
      onTick: async () => {
        fastify.Sentry.startSpan({ op: 'cron', name: monitorSlug }, async () => {
          const { name, cronTime } = unlockBTCTimeLockCellsJob;
          const checkIn = getSentryCheckIn(name, cronTime);
          try {
            await unlocker.unlockCells();
            checkIn.ok();
          } catch (err) {
            checkIn.error();
            fastify.log.error(err);
            fastify.Sentry.captureException(err);
          }
        });
      },
    };

    fastify.register(cron, {
      jobs: [retryMissingTransactionsJob, unlockBTCTimeLockCellsJob],
    });
  } catch (err) {
    fastify.log.error(err);
    fastify.Sentry.captureException(err);
  }
});
