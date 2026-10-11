import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { assertPublicHttpUrl, isPrivateIp } from './urlGuard.js';
import { generationError } from '../services/mediaGenerationCatalog.js';
export const MAX_RESULT_BYTES=128*1024*1024;
// Guard every redirect and pin DNS at connect time. No gateway Authorization ever crosses here.
export async function fetchMediaResult(raw,{maxBytes=MAX_RESULT_BYTES,timeoutMs=30000}={}){
  const deadline=Date.now()+timeoutMs;
  for(let redirect=0;redirect<4;redirect++){
    const url=await assertPublicHttpUrl(raw);
    if(url.username||url.password||url.hash)throw generationError('result_url_forbidden',422);
    const remaining=deadline-Date.now();if(remaining<=0)throw generationError('result_timeout',502);
    const result=await new Promise((resolve,reject)=>{
      const request=(url.protocol==='https:'?https:http).get(url,{timeout:remaining,lookup:(host,options,callback)=>{
        dns.lookup(host,{all:true,verbatim:true}).then(rows=>{if(!rows.length||rows.some(r=>isPrivateIp(r.address)))throw generationError('result_url_forbidden',422);
          if(options.all)callback(null,rows);else callback(null,rows[0].address,rows[0].family);
        }).catch(callback);
      }},response=>{
        if(isPrivateIp(response.socket.remoteAddress)&&net.isIP(response.socket.remoteAddress)){response.destroy();reject(generationError('result_url_forbidden',422));return;}
        if([301,302,303,307,308].includes(response.statusCode)){response.resume();resolve({redirect:response.headers.location});return;}
        if(response.statusCode!==200||Number(response.headers['content-length'])>maxBytes){response.destroy();reject(generationError('result_download_refused',502));return;}
        const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){response.destroy(generationError('result_too_large',413));return;}chunks.push(chunk);});
        response.on('error',reject);response.on('end',()=>resolve({bytes:Buffer.concat(chunks),mime:String(response.headers['content-type']||'').split(';')[0]}));
      });request.on('timeout',()=>request.destroy(generationError('result_timeout',502)));request.on('error',reject);
    });
    if(!result.redirect)return result;
    raw=new URL(result.redirect,url).toString();
  }
  throw generationError('result_redirect_limit',502);
}
