import { createServer } from './server.js';

const { app, session, host, port } = await createServer();
await app.listen({ host, port });
app.log.info({ host, port, token: session.token, csrf: session.csrf }, 'RoleFlock daemon listening; keep token private');
