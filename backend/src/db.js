import {readFile,readdir} from 'node:fs/promises';
import {Pool,types} from 'pg';
import {HttpError} from './domain.js';
types.setTypeParser(20,Number);
types.setTypeParser(1082,v=>v);
export async function openDatabase(env=process.env) {
 if(env.DEV_EMBEDDED_DB==='true') {
  if(env.NODE_ENV==='production') throw Error('Embedded database is forbidden in production');
  const {PGlite}=await import('@electric-sql/pglite');
  const db=new PGlite(env.EMBEDDED_PATH || '.local-data');
  // PGlite has one connection: serialize whole transactions, not individual queries.
  let pending=Promise.resolve();
  const exclusive=fn=>{ const task=pending.then(fn); pending=task.catch(()=>{}); return task; };
  return {query:(...args)=>exclusive(()=>db.query(...args)), transaction:fn=>exclusive(()=>db.transaction(fn)), close:()=>db.close(), embedded:true};
 }
 if(!env.DATABASE_URL) throw Error('DATABASE_URL is required');
 if(env.NODE_ENV==='production' && !env.DATABASE_CA_FILE) throw Error('DATABASE_CA_FILE is required for verified RDS TLS');
 const databaseUrl=new URL(env.DATABASE_URL);
 if(env.DATABASE_CA_FILE)for(const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])databaseUrl.searchParams.delete(key);
 const pool=new Pool({connectionString:databaseUrl.toString(),max:5,connectionTimeoutMillis:5000,
  ssl:env.DATABASE_CA_FILE?{ca:await readFile(env.DATABASE_CA_FILE,'utf8'),rejectUnauthorized:true}:undefined});
 return {query:(...args)=>pool.query(...args),transaction:async fn=>{
  const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 },close:()=>pool.end(),embedded:false};
}
export function migrationNamesFromFiles(files){
 const sql=files.filter(file=>file.endsWith('.sql'));
 if(sql.some(file=>!/^\d{3}_[a-z0-9_]+\.sql$/.test(file)))throw Error('Migration filenames must use NNN_name.sql');
 const names=sql.sort().map(file=>file.slice(0,-4));
 if(new Set(names.map(name=>name.slice(0,3))).size!==names.length)throw Error('Migration sequence numbers must be unique');
 return names;
}
export async function migrate(db, migrationNames, readMigration=name=>readFile(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8')) {
 migrationNames= migrationNames??migrationNamesFromFiles(await readdir(new URL('../migrations/',import.meta.url)));
 const result={applied:[],skipped:[]};
 return db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(741029)');
  await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of migrationNames){
   const applied=await tx.query('SELECT name FROM schema_migrations WHERE name=$1',[name]);
   if(applied.rows.length){result.skipped.push(name);continue;}
   const sql=await readMigration(name);
   if(tx.exec)await tx.exec(sql);else await tx.query(sql);
   await tx.query('INSERT INTO schema_migrations(name) VALUES ($1)',[name]);
   result.applied.push(name);
  }
  return result;
 });
}
export async function one(tx,sql,args) { const result=await tx.query(sql,args); if(!result.rows[0])throw new HttpError(404,'Record not found');return result.rows[0]; }
