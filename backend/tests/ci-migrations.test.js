import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate,migrationNamesFromFiles} from '../src/db.js';
import {deployRelease} from '../ci/deploy-release.mjs';
const repo='111122223333.dkr.ecr.ap-south-1.amazonaws.com/keystone-sales-tracking-api';
const release={image:repo+':release-test',digest:'sha256:'+'a'.repeat(64)};
const env={ECR_REPOSITORY_URI:repo,AWS_DEFAULT_REGION:'ap-south-1',MIGRATION_PROJECT_NAME:'keystone-sales-ops-migrations',APP_RUNNER_SERVICE_ARN:'arn:aws:apprunner:ap-south-1:111122223333:service/keystone-sales-ops-api/abc123'};
function harness({migration='SUCCEEDED',operation='SUCCEEDED',ready=true}={}){
 const calls=[];let updated=false;
 const previous={ImageRepository:{ImageRepositoryType:'ECR',ImageIdentifier:repo+':previous',ImageConfiguration:{Port:'8080',RuntimeEnvironmentSecrets:{DATABASE_URL:'arn:aws:ssm:database-secret'}}},AuthenticationConfiguration:{AccessRoleArn:'arn:aws:iam::111122223333:role/ecr'},AutoDeploymentsEnabled:false};
 const aws=async(service,action,input)=>{calls.push({service,action,input});switch(action){
 case 'describe-service':return {Service:{Status:'RUNNING',ServiceUrl:'sales-test.ap-south-1.awsapprunner.com',SourceConfiguration:updated?{...previous,ImageRepository:{...previous.ImageRepository,ImageIdentifier:release.image}}:previous}};
 case 'start-build':return {build:{id:'keystone-sales-ops-migrations:build123'}};
 case 'batch-get-builds':return {builds:[{buildStatus:migration}]};
 case 'update-service':updated=true;return {OperationId:'op123'};
 case 'list-operations':return {OperationSummaryList:[{Id:'op123',Status:operation}]};
 default:throw Error('Unexpected AWS action');}};
 return {calls,previous,options:{aws,pause:async()=>{},fetchUrl:async()=>({ok:ready,json:async()=>({status:'ready'})}),log:()=>{},maxPolls:2}};
}
test('successful CI release migrates the exact image before updating App Runner and preserves config',async()=>{
 const h=harness();await deployRelease(release,env,h.options);
 assert.ok(h.calls.findIndex(c=>c.action==='batch-get-builds')<h.calls.findIndex(c=>c.action==='update-service'));
 const migration=h.calls.find(c=>c.action==='start-build');assert.equal(migration.input.environmentVariablesOverride.find(v=>v.name==='RELEASE_IMAGE').value,release.image);assert.equal(migration.input.environmentVariablesOverride.find(v=>v.name==='EXPECTED_IMAGE_DIGEST').value,release.digest);
 const update=h.calls.find(c=>c.action==='update-service').input;assert.equal(update.SourceConfiguration.ImageRepository.ImageIdentifier,release.image);assert.deepEqual(update.SourceConfiguration.ImageRepository.ImageConfiguration,h.previous.ImageRepository.ImageConfiguration);assert.equal(h.previous.ImageRepository.ImageIdentifier,repo+':previous');
});
test('failed, stopped and timed out migrations never deploy',async()=>{
 for(const migration of ['FAILED','STOPPED','TIMED_OUT','IN_PROGRESS']){const h=harness({migration});await assert.rejects(()=>deployRelease(release,env,h.options),/Migration|Migration job/);assert.ok(!h.calls.some(c=>c.action==='update-service'));}
});
test('bootstrap runs migrations without needing or changing an App Runner service',async()=>{
 const h=harness();await deployRelease(release,{...env,DEPLOY_MODE:'bootstrap',APP_RUNNER_SERVICE_ARN:''},h.options);assert.ok(h.calls.every(c=>c.service==='codebuild'));
});
test('wrong resources are rejected before AWS and unhealthy deployment is reported',async()=>{
 const h=harness();await assert.rejects(()=>deployRelease(release,{...env,APP_RUNNER_SERVICE_ARN:'arn:aws:apprunner:ap-south-1:111122223333:service/keystone-team-portal-api/abc123'},h.options),/Sales Ops/);assert.equal(h.calls.length,0);
 await assert.rejects(()=>deployRelease({...release,image:repo+':latest'},env,h.options),/uniquely tagged/);
 const failure=harness({operation:'FAILED'});await assert.rejects(()=>deployRelease(release,env,failure.options),/Deployment FAILED/);
 const unhealthy=harness({ready:false});await assert.rejects(()=>deployRelease(release,env,unhealthy.options),/Readiness failed/);
});
test('SQL discovery is ordered; function semicolons work; reruns skip applied SQL and failures roll back',async()=>{
 assert.deepEqual(migrationNamesFromFiles(['010_last.sql','README.md','009_next.sql']),['009_next','010_last']);assert.throws(()=>migrationNamesFromFiles(['009_one.sql','009_two.sql']),/unique/);
 const db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});
 try{
  const sql={one:"CREATE TABLE automation_test(id integer PRIMARY KEY, note text); INSERT INTO automation_test VALUES(1,'first; note'); CREATE FUNCTION automation_note() RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN 'inside; function'; END; $$;",two:"INSERT INTO automation_test VALUES(2,'new migration');",bad:"INSERT INTO automation_test VALUES(3,'rollback'); SELECT * FROM table_that_does_not_exist;"};
  const read=async name=>sql[name];assert.deepEqual(await migrate(db,['one'],read),{applied:['one'],skipped:[]});assert.deepEqual(await migrate(db,['one'],()=>{throw Error('Already applied migration was read');}),{applied:[],skipped:['one']});await migrate(db,['one','two'],read);
  assert.equal((await db.query('SELECT automation_note() AS note')).rows[0].note,'inside; function');
  await assert.rejects(()=>migrate(db,['one','two','bad'],read));assert.equal((await db.query('SELECT count(*)::int AS count FROM automation_test')).rows[0].count,2);assert.equal((await db.query("SELECT count(*)::int AS count FROM schema_migrations WHERE name='bad'")).rows[0].count,0);
 }finally{await db.close();}
});
