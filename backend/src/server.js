import {openDatabase,migrate} from './db.js';
import {configFrom} from './config.js';
import {createApp} from './app.js';
import {seedDevelopment} from './seed.js';
const config=configFrom();const db=await openDatabase();
if(db.embedded){await migrate(db);if(process.env.DEV_SEED==='true')await seedDevelopment(db);}
const server=createApp(db,config).listen(config.port,'0.0.0.0',()=>console.log(`Sales Ops API: http://localhost:${config.port} (${db.embedded?'local PostgreSQL engine':'PostgreSQL'})`));
let stopping=false;
function shutdown(){if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),20000);timer.unref();server.close(async()=>{await db.close();clearTimeout(timer);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
