import { createGameServer } from './app';

const server = createGameServer();
const port = Number(process.env.PORT || 3001);
server.http.listen(port, '0.0.0.0', () => console.log(`THROW DOWN multiplayer listening on http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
