import { z } from 'zod';

export const Status = z.object({
  confirmed: z.boolean(),
  block_height: z.number().optional(),
  block_hash: z.string().optional(),
  block_time: z.number().optional(),
});

export const Transaction = z.object({
  txid: z.string(),
  status: Status,
  // TODO: add more fields
});
