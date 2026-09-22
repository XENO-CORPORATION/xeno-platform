import express from 'express';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { readAccountWorkspaceOperation,changeAccountWorkspaceOperation } from '../services/accountWorkspaceOperations.js';

export const accountWorkspaceOperationRoutes=express.Router();
// Parent router has already validated the DPoP method/URL/proof. A legacy bearer
// can still use its old routes, but cannot create canonical replay authority.
accountWorkspaceOperationRoutes.use((req,res,next)=>{
  if(req.auth?.kind!=='oidc'||!req.auth.dpopJkt)return res.status(401).json({success:false,error:'sender_bound_account_required'});
  if(!String(req.auth.scope).split(/\s+/).includes('team:manage')||!scopesForClient(req.auth.clientId)?.includes('team:manage'))return res.status(403).json({success:false,error:'insufficient_scope'});
  res.set('Cache-Control','no-store');next();
});
const handle=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(error=>res.status(error.status??503).json({success:false,error:error.status?error.code:'account_workspace_operation_failed'}));
accountWorkspaceOperationRoutes.get('/:operationId',handle(async(req,res)=>res.json({success:true,...await readAccountWorkspaceOperation(req.db,req.user.id,req.auth.clientId,req.params.operationId)})));
accountWorkspaceOperationRoutes.post('/:operationId/:phase',handle(async(req,res)=>{
  if(!req.body||Object.keys(req.body).some(k=>k!=='request'))return res.status(400).json({success:false,error:'invalid_account_workspace_request'});
  res.json({success:true,...await changeAccountWorkspaceOperation(req.db,req.user.id,req.auth.clientId,req.params.operationId,req.params.phase,req.body.request)});
}));
