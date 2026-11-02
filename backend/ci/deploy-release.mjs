import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const run=promisify(execFile);
export function validateRelease(release,env){
 const match=/^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/[a-z0-9._/-]+:([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$/.exec(release.image||'');
 if(!match||match[3]==='latest'||!/^sha256:[0-9a-f]{64}$/.test(release.digest||''))throw Error('A uniquely tagged image and SHA256 digest are required');
 if(release.image.slice(0,release.image.lastIndexOf(':'))!==env.ECR_REPOSITORY_URI)throw Error('Release image is outside the configured Sales Ops repository');
 if(match[2]!==env.AWS_DEFAULT_REGION)throw Error('AWS region mismatch');
 if(!/^keystone-sales-[a-z0-9-]+$/.test(env.MIGRATION_PROJECT_NAME||''))throw Error('Set a dedicated Sales Ops migration project');
 const mode=env.DEPLOY_MODE||'deploy';if(!['deploy','bootstrap'].includes(mode))throw Error('DEPLOY_MODE must be deploy or bootstrap');
 if(mode==='deploy'){
  const service=new RegExp(`^arn:aws:apprunner:${match[2]}:${match[1]}:service/keystone-sales-[a-z0-9-]+/[a-zA-Z0-9]+$`);
  if(!service.test(env.APP_RUNNER_SERVICE_ARN||''))throw Error('Set the Sales Ops App Runner service ARN in the same account/region');
 }
 return mode;
}
export async function awsCli(service,action,input){
 const dir=await mkdtemp(join(tmpdir(),'sales-ops-aws-'));
 try{
  const file=join(dir,'input.json');await writeFile(file,JSON.stringify(input),{mode:0o600});
  const {stdout}=await run('aws',[service,action,'--cli-input-json',`file://${file}`,'--output','json','--no-cli-pager'],{maxBuffer:8*1024*1024});
  return stdout.trim()?JSON.parse(stdout):{};
 }catch{throw Error(`AWS ${service} ${action} failed; check the build role, service state and AWS logs`);}
 finally{await rm(dir,{recursive:true,force:true});}
}
export async function deployRelease(release,env,{aws=awsCli,pause=ms=>new Promise(r=>setTimeout(r,ms)),fetchUrl=fetch,log=console.log,maxPolls=80}={}){
 const mode=validateRelease(release,env);let previous,service;
 if(mode==='deploy'){
  service=(await aws('apprunner','describe-service',{ServiceArn:env.APP_RUNNER_SERVICE_ARN})).Service;
  if(service?.Status!=='RUNNING')throw Error('App Runner must be RUNNING before release');
  previous=service.SourceConfiguration;if(previous?.ImageRepository?.ImageRepositoryType!=='ECR')throw Error('App Runner must use a private ECR image');
 }
 const started=await aws('codebuild','start-build',{projectName:env.MIGRATION_PROJECT_NAME,environmentVariablesOverride:[{name:'RELEASE_IMAGE',value:release.image,type:'PLAINTEXT'},{name:'EXPECTED_IMAGE_DIGEST',value:release.digest,type:'PLAINTEXT'}]});
 const id=started.build?.id;if(!id)throw Error('Migration build ID is missing');log(`Migration job: ${id}`);
 let migrated=false;
 for(let poll=0;poll<maxPolls;poll++){
  const response=await aws('codebuild','batch-get-builds',{ids:[id]});const build=response.builds?.[0];
  if(!build||response.buildsNotFound?.length)throw Error('Migration job could not be found; deployment stopped');
  if(build.buildStatus==='SUCCEEDED'){migrated=true;break;}
  if(['FAILED','FAULT','STOPPED','TIMED_OUT'].includes(build.buildStatus))throw Error(`Migration ${build.buildStatus}; App Runner was not updated. See CodeBuild logs.`);
  await pause(15000);
 }
 if(!migrated)throw Error('Migration job timed out; App Runner was not updated. Check the migration job before retrying.');
 log('Migrations succeeded.');
 if(mode==='bootstrap'){log(`Database initialized. Create App Runner using ${release.image}`);return {image:release.image,migrationBuildId:id,mode};}
 const next=structuredClone(previous);next.ImageRepository.ImageIdentifier=release.image;next.AutoDeploymentsEnabled=false;
 const operation=(await aws('apprunner','update-service',{ServiceArn:env.APP_RUNNER_SERVICE_ARN,SourceConfiguration:next})).OperationId;
 if(!operation)throw Error('App Runner operation ID is missing');let deployed=false;
 for(let poll=0;poll<maxPolls;poll++){
  const operations=await aws('apprunner','list-operations',{ServiceArn:env.APP_RUNNER_SERVICE_ARN});const status=operations.OperationSummaryList?.find(item=>item.Id===operation)?.Status;
  if(status==='SUCCEEDED'){deployed=true;break;}
  if(['FAILED','ROLLBACK_SUCCEEDED','ROLLBACK_FAILED'].includes(status))throw Error(`Deployment ${status}; previous image: ${previous.ImageRepository.ImageIdentifier}. Database migrations are not automatically reversed.`);
  await pause(15000);
 }
 if(!deployed)throw Error('Timed out waiting for App Runner. Inspect its operation before retrying.');
 const live=(await aws('apprunner','describe-service',{ServiceArn:env.APP_RUNNER_SERVICE_ARN})).Service;
 if(live?.SourceConfiguration?.ImageRepository?.ImageIdentifier!==release.image)throw Error('Running image does not match the release');
 if(!/^[a-z0-9.-]+\.awsapprunner\.com$/.test(live.ServiceUrl||''))throw Error('Unexpected App Runner service URL');
 let healthy=false;
 for(let attempt=0;attempt<8;attempt++){
  try{const response=await fetchUrl(`https://${live.ServiceUrl}/readyz`,{signal:AbortSignal.timeout(15000)});if(response.ok&&(await response.json()).status==='ready'){healthy=true;break;}}catch{}
  await pause(5000);
 }
 if(!healthy)throw Error(`Readiness failed; previous image: ${previous.ImageRepository.ImageIdentifier}. Review logs before rollback; database migrations are not reversed.`);
 log(`Release ready: https://${live.ServiceUrl}`);return {image:release.image,migrationBuildId:id,mode};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const release=JSON.parse(await readFile('.release/image.json','utf8'));await deployRelease(release,process.env);}catch(error){console.error(error.message);process.exitCode=1;}
}
