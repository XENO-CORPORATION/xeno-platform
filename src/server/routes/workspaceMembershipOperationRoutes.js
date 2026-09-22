import express from 'express';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { readWorkspaceMembershipOperation, mutateWorkspaceMembership } from '../services/workspaceMembershipOperations.js';
export const workspaceMembershipOperationRoutes=express.Router({mergeParams:true});
function canonical(req,res,next) {
  if (req.auth?.kind !== 'oidc' || !req.auth.dpopJkt) return res.status(401).json({success:false,error:'sender_bound_account_required'});
  if (!String(req.auth.scope).split(/\s+/).includes('team:manage') || !scopesForClient(req.auth.clientId)?.includes('team:manage')) return res.status(403).json({success:false,error:'insufficient_scope'});
  res.set('Cache-Control','no-store');next();
}
const handle=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(error=>res.status(error.status ?? 503).json({success:false,error:error.status ? error.code : 'workspace_membership_operation_failed'}));
workspaceMembershipOperationRoutes.get('/membership-operations/:operationId',canonical,handle(async(req,res)=>res.json({success:true,...await readWorkspaceMembershipOperation(req.db,req.params.id,req.user.id,req.auth.clientId,req.params.operationId)})));
workspaceMembershipOperationRoutes.post('/membership-operations/:operationId/abandon',canonical,handle(async(req,res)=>{
  if(!req.body||Object.keys(req.body).some(key=>key!=='request')||!req.body.request||typeof req.body.request!=='object'||Array.isArray(req.body.request))return res.status(400).json({success:false,error:'invalid_membership_request'});
  const {action,...input}=req.body.request;
  const result=await mutateWorkspaceMembership(req.db,req.params.id,req.user.id,req.auth.clientId,req.params.operationId,action,input,{abandon:true});
  res.json({success:true,operation:result.operation,replayed:result.replayed});
}));
for (const [method,path,action,target] of [
  ['post','/invites','invite.create'],['delete','/invites/:inviteId','invite.revoke','inviteId'],['post','/invites/:inviteId/resend','invite.resend','inviteId'],
  ['patch','/members/:memberId','member.role','memberId'],['delete','/members/:memberId','member.remove','memberId'],['post','/owner-transfer','owner.transfer'],
]) workspaceMembershipOperationRoutes[method](path,(req,res,next)=>req.body?.operation_id === undefined ? next('route') : canonical(req,res,next),handle(async(req,res)=>{
  const {operation_id,...body}=req.body;
  const input={...body,...(target ? {[target]:req.params[target]} : {})};
  if (Object.hasOwn(input,'member_role')) {input.role=input.member_role;delete input.member_role;}
  if (Object.hasOwn(input,'new_owner_user_id')) {input.newOwnerId=input.new_owner_user_id;delete input.new_owner_user_id;}
  const result=await mutateWorkspaceMembership(req.db,req.params.id,req.user.id,req.auth.clientId,operation_id,action,input);
  res.json({success:true,operation:result.operation,replayed:result.replayed});
}));
