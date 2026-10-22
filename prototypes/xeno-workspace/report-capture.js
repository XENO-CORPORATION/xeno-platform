/* Explicit, local-only report evidence capture. No upload occurs in this module. */
(() => {
  const LIMIT=8*1024*1024;
  const stop=stream=>stream?.getTracks().forEach(track=>track.stop());
  async function attachment(blob,name){
    if(!blob.size || blob.size>LIMIT)throw new Error('Evidence must be between 1 byte and 8 MiB.');
    if(!['image/png','image/jpeg','image/webp','video/webm','video/mp4'].includes(blob.type.split(';')[0]))throw new Error('Attach a PNG, JPEG, WebP, WebM or MP4 file.');
    const bytes=new Uint8Array(await blob.arrayBuffer());
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('The evidence could not be read.'));reader.readAsDataURL(blob);});
    return {id:crypto.randomUUID(),name:name.replace(/[\r\n\x00-\x1f]/g,'').slice(0,120),type:blob.type.split(';')[0],bytes:blob.size,sha256:hash,data};
  }
  function share(){
    if(!navigator.mediaDevices?.getDisplayMedia)throw new Error('This browser cannot capture a tab here. You can attach an image or video file instead.');
    return navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:20,max:30}},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'exclude'});
  }
  async function videoFor(stream){
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;
    let timer,frame;const tracks=stream.getTracks();let abort;
    const interrupted=new Promise((_,reject)=>{abort=()=>reject(new Error('Capture stopped before the tab was ready. Your report is still here.'));timer=setTimeout(abort,10000);tracks.forEach(t=>t.addEventListener('ended',abort,{once:true}));addEventListener('pagehide',abort,{once:true});});
    const ready=(async()=>{await video.play();if(!video.videoWidth)await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('The selected tab could not be read.'));});if(video.requestVideoFrameCallback)await new Promise(resolve=>{frame=video.requestVideoFrameCallback(resolve);});return video;})();
    try{return await Promise.race([ready,interrupted]);}catch(error){video.pause();video.srcObject=null;throw error;}finally{clearTimeout(timer);if(frame)video.cancelVideoFrameCallback(frame);tracks.forEach(t=>t.removeEventListener('ended',abort));removeEventListener('pagehide',abort);video.onloadedmetadata=null;video.onerror=null;}
  }
  const png=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Screenshot failed.')),'image/png'));
  async function screenshot({area=false}={}){
    let stream;
    try{
      stream=await share();const video=await videoFor(stream);
      const scale=Math.min(1,1920/video.videoWidth),canvas=document.createElement('canvas');
      canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);video.srcObject=null;stop(stream);stream=null;
      const result=area?await selectArea(canvas):canvas;
      if(!result)return null;
      return attachment(await png(result),area?'selected-area.png':'page-screenshot.png');
    }finally{stop(stream);}
  }
  function selectArea(source){
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='xreport-area';dialog.setAttribute('aria-label','Choose screenshot area');
      const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d').drawImage(source,0,0);
      const ratio=Math.min((innerWidth-24)/source.width,(innerHeight-100)/source.height);canvas.style.width=`${source.width*ratio}px`;canvas.style.height=`${source.height*ratio}px`;
      const instructions=document.createElement('p');instructions.textContent='Drag around the issue. Only this selected area will be attached.';
      const selected=document.createElement('div');selected.className='xreport-selection';selected.hidden=true;
      const controls=document.createElement('div');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';const use=document.createElement('button');use.type='button';use.textContent='Use selected area';use.disabled=true;controls.append(cancel,use);
      dialog.append(instructions,canvas,selected,controls);document.body.append(dialog);dialog.showModal();
      let start=null,rect=null;
      const point=event=>{const box=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(source.width,(event.clientX-box.left)*source.width/box.width)),y:Math.max(0,Math.min(source.height,(event.clientY-box.top)*source.height/box.height))};};
      canvas.onpointerdown=event=>{start=point(event);canvas.setPointerCapture(event.pointerId);use.disabled=true;};
      canvas.onpointermove=event=>{if(!start)return;const end=point(event);rect={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};const box=canvas.getBoundingClientRect();Object.assign(selected.style,{left:`${box.left+rect.x*box.width/source.width}px`,top:`${box.top+rect.y*box.height/source.height}px`,width:`${rect.width*box.width/source.width}px`,height:`${rect.height*box.height/source.height}px`});selected.hidden=false;};
      canvas.onpointerup=()=>{start=null;use.disabled=!rect||rect.width<4||rect.height<4;};
      const done=value=>{dialog.close();dialog.remove();resolve(value);};
      cancel.onclick=()=>done(null);dialog.oncancel=event=>{event.preventDefault();done(null);};
      use.onclick=()=>{if(!rect||use.disabled)return;const output=document.createElement('canvas');output.width=Math.round(rect.width);output.height=Math.round(rect.height);output.getContext('2d').drawImage(source,rect.x,rect.y,rect.width,rect.height,0,0,output.width,output.height);done(output);};
    });
  }
  async function record(onProgress){
    if(typeof MediaRecorder==='undefined')throw new Error('Recording is not supported by this browser.');
    const stream=await share();let recorder;
    try{
      const type=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
      if(!type)throw new Error('This browser has no supported recording format.');
      recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:1_000_000});
    }catch(error){stop(stream);throw error;}
    return new Promise((resolve,reject)=>{
      const bar=document.createElement('div');bar.className='xreport-recording';bar.setAttribute('role','status');const label=document.createElement('span');const button=document.createElement('button');button.type='button';button.textContent='Stop recording';bar.append(label,button);document.body.append(bar);
      let chunks=[],bytes=0,finished=false,tooLarge=false;const began=performance.now();
      const finish=()=>{if(finished)return;finished=true;clearInterval(timer);if(recorder.state!=='inactive')recorder.stop();else{stop(stream);bar.remove();resolve(null);}};
      const tick=()=>{const seconds=Math.floor((performance.now()-began)/1000);label.textContent=`Recording · ${seconds}s / 30s · no audio`;onProgress?.(seconds);if(seconds>=30)finish();};
      const timer=setInterval(tick,250);tick();button.onclick=finish;
      recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;if(bytes>LIMIT){tooLarge=true;finish();}}};
      recorder.onerror=()=>{finished=true;clearInterval(timer);stop(stream);bar.remove();removeEventListener('pagehide',finish);reject(new Error('Recording failed. Your report is still here.'));};
      recorder.onstop=async()=>{clearInterval(timer);stop(stream);bar.remove();removeEventListener('pagehide',finish);try{if(tooLarge)throw new Error('The recording exceeded 8 MiB. Record a shorter clip.');resolve(await attachment(new Blob(chunks,{type:recorder.mimeType.split(';')[0]}),'issue-recording.'+(recorder.mimeType.includes('mp4')?'mp4':'webm')));}catch(error){reject(error);}finally{chunks=[];}};
      stream.getVideoTracks()[0].addEventListener('ended',finish,{once:true});
      window.addEventListener('pagehide',finish,{once:true});try{recorder.start(250);}catch(error){finished=true;clearInterval(timer);stop(stream);bar.remove();removeEventListener('pagehide',finish);reject(error);}
    });
  }
  window.XENO_REPORT_CAPTURE={screenshot,record,attachment};
})();
