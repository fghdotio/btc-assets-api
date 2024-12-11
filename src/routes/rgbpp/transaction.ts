import { FastifyPluginCallback } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Server } from 'http';
import z from 'zod';
import { CKBVirtualResult } from './types';
import { Job } from 'bullmq';
import { CUSTOM_HEADERS } from '../../constants';
import { JwtPayload } from '../../plugins/jwt';

const transactionRoute: FastifyPluginCallback<Record<never, never>, Server, ZodTypeProvider> = (fastify, _, done) => {
  fastify.post(
    '/ckb-tx',
    {
      schema: {
        description: 'Submit a RGB++ CKB transaction',
        tags: ['RGB++'],
        body: z.object({
          btc_txid: z.string(),
          ckb_virtual_result: CKBVirtualResult.or(z.string()).transform((value) => {
            if (typeof value === 'string') {
              value = JSON.parse(value);
            }
            const parsed = CKBVirtualResult.safeParse(value);
            if (!parsed.success) {
              throw fastify.httpErrors.badRequest(
                `Invalid CKB virtual result: ${JSON.stringify(parsed.error.flatten())}`,
              );
            }
            return parsed.data;
          }),
        }),
        response: {
          200: z.object({
            state: z.string().describe('The state of the transaction, waiting by default'),
          }),
        },
      },
    },
    async (request, reply) => {
      const { btc_txid, ckb_virtual_result } = request.body;
      const jwt = (await request.jwtDecode()) as JwtPayload;
      const job: Job = await fastify.transactionProcessor.enqueueTransaction({
        txid: btc_txid,
        ckbVirtualResult: ckb_virtual_result,
        context: { jwt },
      });
      const state = await job.getState();
      reply.send({ state });
    },
  );

  // * 查找一条 btc 交易中的 utxo 对应的终态 rgb++ ckb 交易
  // * 对于 queryRgbppLockTxByBtcTx，btc_txid 是新生成的、未消费的、用于锁定的交易；
  // * 对于 queryBtcTimeLockTxByBtcTx，btc_txid 是已消费的、用于确权的交易；
  fastify.get(
    '/:btc_txid',
    {
      schema: {
        description: `Get the CKB transaction hash by BTC txid.`,
        tags: ['RGB++'],
        params: z.object({
          btc_txid: z.string().length(64, 'should be a 64-character hex string'),
        }),
        response: {
          200: z.object({
            txhash: z.string().describe('The CKB transaction hash'),
          }),
        },
      },
    },
    async (request, reply) => {
      const { btc_txid } = request.params;
      // get the transaction hash from the job if it exists
      const job = await fastify.transactionProcessor.getTransactionRequest(btc_txid);
      // * 当一个作业成功完成时，处理器（processor）返回的值会被存储在这个 returnvalue 属性中
      if (job?.returnvalue) {
        return { txhash: job.returnvalue };
      }

      const btcTx = await fastify.bitcoin.getTx({ txid: btc_txid });
      const rgbppLockTx = await fastify.rgbppCollector.queryRgbppLockTxByBtcTx(btcTx);
      if (rgbppLockTx) {
        reply.header(CUSTOM_HEADERS.ResponseCacheable, 'true');
        return { txhash: rgbppLockTx.txHash };
      }
      const btcTimeLockTx = await fastify.rgbppCollector.queryBtcTimeLockTxByBtcTx(btcTx);
      if (btcTimeLockTx) {
        reply.header(CUSTOM_HEADERS.ResponseCacheable, 'true');
        return { txhash: btcTimeLockTx.transaction.hash };
      }

      reply.status(404);
    },
  );

  const jobInfoSchema = z.object({
    state: z.string().describe('The state of the transaction'),
    attempts: z.number().describe('The number of attempts made to process the transaction'),
    failedReason: z.string().optional().describe('The reason why the transaction failed'),
    data: z
      .object({
        txid: z.string(),
        ckbVirtualResult: CKBVirtualResult,
      })
      .describe('The data of the transaction')
      .optional(),
  });

  fastify.get(
    '/:btc_txid/job',
    {
      schema: {
        description: `
          Get the job info of a transaction by BTC txid.

          The state of the transaction can be one of the following:
          * completed: The CKB transaction has been sent and confirmed.
          * failed: Something went wrong during the process, and it has failed.
          * delayed: The transaction has not been confirmed yet and is waiting for confirmation.
          * active: The transaction is currently being processed.
          * waiting: The transaction is pending and is waiting to be processed.
        `,
        tags: ['RGB++'],
        params: z.object({
          btc_txid: z.string().length(64, 'should be a 64-character hex string'),
        }),
        querystring: z.object({
          with_data: z.enum(['true', 'false']).default('false'),
        }),
        response: {
          200: jobInfoSchema,
        },
      },
    },
    async (request, reply) => {
      const { btc_txid } = request.params;
      const { with_data } = request.query;
      const job = await fastify.transactionProcessor.getTransactionRequest(btc_txid);
      if (!job) {
        reply.status(404);
        return;
      }
      const state = await job.getState();
      const attempts = job.attemptsMade;

      const jobInfo: z.infer<typeof jobInfoSchema> = {
        state,
        attempts,
      };

      if (with_data === 'true') {
        // * ckbVirtualResult 是不完整的，没有 btc tx id 和 spv proof
        const { txid, ckbVirtualResult } = job.data;
        jobInfo.data = {
          txid,
          ckbVirtualResult,
        };
      }

      if (state === 'failed') {
        jobInfo.failedReason = job.failedReason;
      }
      return jobInfo;
    },
  );

  fastify.post(
    '/retry',
    {
      schema: {
        description: 'Retry a failed transaction by BTC txid, only failed transactions can be retried.',
        tags: ['RGB++'],
        body: z.object({
          btc_txid: z.string(),
        }),
        response: {
          200: z.object({
            success: z.boolean().describe('Whether the transaction has been retried successfully'),
            state: z.string().describe('The state of the transaction'),
          }),
        },
      },
    },
    async (request, reply) => {
      const { btc_txid } = request.body;
      const job = await fastify.transactionProcessor.getTransactionRequest(btc_txid);
      if (!job) {
        reply.status(404);
        return;
      }
      const state = await job.getState();
      if (state === 'failed') {
        // * 调用 job.retry('failed') 时，BullMQ 会将这个任务从 failed 状态队列中移出
        await job.retry('failed');
        const newState = await job.getState();
        return {
          success: true,
          state: newState,
        };
      }
      return {
        success: false,
        state,
      };
    },
  );

  done();
};

export default transactionRoute;
