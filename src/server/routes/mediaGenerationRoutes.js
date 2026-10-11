import express from 'express';
import { generationCatalog } from '../services/mediaGenerationCatalog.js';
import { mediaGateway } from '../utils/mediaGenerationGateway.js';
import { quoteGeneration,createGeneration,getGeneration,listGenerations,approveGeneration,cancelGeneration,retryGeneration } from '../services/mediaGenerations.js';
export function createMediaGenerationRouter(options={}){
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const route=handler=>async(req,res)=>{try{await handler(req,res);}catch(error){const status=Number(error.status)||Number(error.http)||(['INSUFFICIENT_CREDITS','QUOTA_EXHAUSTED'].includes(error.code)?402:500);res.status(status).json({error:status<500?error.code||'invalid_generation':'generation_unavailable',...(status<500?{code:error.code}:{})});}};
  const actor=req=>req.user?.id;
  router.get('/catalog',route(async(req,res)=>res.json(await generationCatalog({models:options.gateway?.models||mediaGateway.models}))));
  router.post('/quote',route(async(req,res)=>res.json(await quoteGeneration(req.db,actor(req),req.body,options))));
  router.post('/',route(async(req,res)=>res.status(202).json({generation:await createGeneration(req.db,actor(req),req.body,options)})));
  router.get('/',route(async(req,res)=>res.json({generations:await listGenerations(req.db,actor(req),{type:req.query.type,projectId:req.query.projectId,conversationId:req.query.conversationId})})));
  router.get('/:id',route(async(req,res)=>res.json({generation:await getGeneration(req.db,actor(req),req.params.id)})));
  router.post('/:id/approve',route(async(req,res)=>res.json({generation:await approveGeneration(req.db,actor(req),req.params.id,req.body,options)})));
  router.post('/:id/cancel',route(async(req,res)=>res.json({generation:await cancelGeneration(req.db,actor(req),req.params.id)})));
  router.post('/:id/retry',route(async(req,res)=>res.status(202).json({generation:await retryGeneration(req.db,actor(req),req.params.id,req.body,options)})));
  return router;
}
export default createMediaGenerationRouter();
