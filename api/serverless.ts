import { buildFastify } from '../src/app';

export const config = {
  maxDuration: 60,
};

const app = buildFastify();

export default async (req: Request, res: Response) => {
  await app.ready();
  app.server.emit('request', req, res);
};
