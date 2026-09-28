// Money movement requires a sender-bound account session and recent authentication.
// The body can name neither the contributor nor the client's receipt namespace.
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { requireRecentOidcAuth } from '../middleware/recentOidcAuth.js';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { API_KEY_WORKFORCE_GRANT_CLIENTS } from '../services/apiKeyWorkforceCapabilities.js';
import * as funding from '../services/workforceFunding.js';
import { releaseUndispatchedFunding } from '../services/workforceRunFunding.js';

const router=express.Router();
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');res.vary('Authorization');next();});
router.use(authMiddleware,requireDpopIfBound,(req,res,next)=>{
  if(req.auth?.kind!=='oidc'||!req.auth.sid||!req.auth.dpopJkt) return res.status(401).json({success:false,code:'denied',error:'Sender-bound account session required.'});
  if(!String(req.auth.scope).split(/\s+/).includes('workforce:manage')||!scopesForClient(req.auth.clientId)?.includes('workforce:manage')) {
    return res.status(403).json({success:false,code:'denied',error:'Workforce management scope required.'});
  }
  next();
},express.json({limit:'64kb',strict:true}));
const recent=requireRecentOidcAuth({scope:'workforce:manage',clients:API_KEY_WORKFORCE_GRANT_CLIENTS});
// Configuration authority is never spending authority, even for a recent DPoP session.
const spend=(req,res,next)=>{
  if(!String(req.auth.scope).split(/\s+/).includes('ledger:spend')||!scopesForClient(req.auth.clientId)?.includes('ledger:spend')) {
    return res.status(403).json({success:false,code:'denied',error:'Ledger spending scope required.'});
  }
  next();
};
const handle=service=>async(req,res)=>{
  try {
    if(!req.body||Array.isArray(req.body)||typeof req.body!=='object'||Buffer.byteLength(JSON.stringify(req.body))>65536) {
      return res.status(400).json({success:false,code:'bad_input'});
    }
    const result=await service(req.db,{actorUserId:req.user.id,clientId:req.auth.clientId},req.body);
    return res.json({success:true,result});
  } catch(error) {
    if(error instanceof funding.FundingError) return res.status(error.status).json({success:false,code:error.code,details:error.details});
    const reasons={CONTRIBUTION_ACCOUNT_UNAVAILABLE:403,CONTRIBUTION_CONSENT_REQUIRED:403,
      CONTRIBUTION_DESTINATION_UNAVAILABLE:403,INSUFFICIENT_CONTRIBUTABLE_CREDITS:409,INVALID_CONTRIBUTION_AMOUNT:400,
      CONTRIBUTION_NOT_FOUND:404,CONTRIBUTION_NOT_RETURNABLE:409,CONTRIBUTION_ORIGIN_QUARANTINED:409,CONTRIBUTION_RESERVED:409};
    if(Object.hasOwn(reasons,error.code)) return res.status(reasons[error.code]).json({success:false,code:error.code});
    return res.status(503).json({success:false,code:'unavailable',error:'Funding operation unavailable; reconcile the same operation before retrying.'});
  }
};
router.post('/campaigns',recent,handle(funding.createFundingCampaign));
router.post('/milestones',recent,handle(funding.createFundingMilestone));
router.post('/campaigns/open',recent,handle(funding.openFundingCampaign));
router.post('/campaigns/status',recent,handle(funding.setFundingCampaignStatus));
router.post('/offers/read',handle(funding.readFundingOffer));
router.post('/runs/release-undispatched',spend,recent,handle(async(db,ctx,value)=>{
  try{return await releaseUndispatchedFunding(db,ctx,value);}
  catch(error){if(error.code==='needs_approval')throw new funding.FundingError('conflict',error.details.reason);throw error;}
}));
router.post('/scope-caps',recent,handle(funding.proposeScopeSpendCap));
router.post('/scope-caps/decide',spend,recent,handle(funding.decideScopeSpendCap));
router.post('/scope-caps/read',handle(funding.readScopeSpendCaps));
router.post('/budgets/price',handle(funding.readFundingPrice));
router.post('/budgets',recent,handle(funding.proposeFundingBudget));
router.post('/budgets/decide',spend,recent,handle(funding.decideFundingBudget));
router.post('/budgets/read',handle(funding.readFundingBudget));
router.post('/budgets/revoke',spend,recent,handle(funding.revokeFundingBudget));
router.post('/contributions',spend,recent,handle(funding.contributeFunding));
router.post('/contributions/read',handle(funding.readFundingContribution));
router.post('/contributions/return',spend,recent,handle(funding.returnFundingContribution));
router.use((error,_req,res,_next)=>res.status(error?.type==='entity.too.large'||error?.type==='entity.parse.failed'?400:503)
  .json({success:false,code:'bad_input',error:'Invalid funding request.'}));
export default router;
