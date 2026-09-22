import pg from 'pg';
import {deliverWorkspaceInviteBatch} from '../../src/server/services/workspaceInviteDelivery.js';
const url=new URL(process.env.WORKSPACE_KEY_TEST_DATABASE_URL);
const schema=process.env.WORKSPACE_MEMBERSHIP_TEST_SCHEMA;
if(url.hostname!=='127.0.0.1'||url.pathname!=='/workspacekeyproof'||!/^membership_[a-f0-9]{16}$/.test(schema))throw new Error('Owned fixture only');
const pool=new pg.Pool({connectionString:url.href,options:`-c search_path=${schema}`});let calls=0;
try{await deliverWorkspaceInviteBatch(pool,{send:async()=>{calls++;return{success:true};}});process.stdout.write(JSON.stringify({calls,pid:process.pid}));}finally{await pool.end();}
