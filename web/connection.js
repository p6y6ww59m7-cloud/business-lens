(function(){
  'use strict';
  function create({token='',onChange=()=>{},host=window}={}){
    const local=!!token&&host.location.hostname==='127.0.0.1', file=host.location.protocol==='file:';
    let permitted=false,popup=null,channel='',helperOrigin='',closedTimer=null;
    const pending=new Map();
    const id=()=>host.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
    const notify=(connected,message,waiting=false)=>onChange({connected,message,waiting,permitted});
    function failPending(message){for(const task of pending.values()){clearTimeout(task.timer);task.cleanup?.();task.reject(new Error(message));}pending.clear();}
    function disconnected(message){permitted=false;clearInterval(closedTimer);failPending(message);notify(false,message);}
    function post(value){if(!popup||popup.closed)throw new Error('请先连接并在本机确认页允许访问。');popup.postMessage({type:'business-lens-request',channel,...value},helperOrigin);}
    async function request(method,payload={},signal){
      if(!permitted)throw new Error('请先允许连接这台电脑的 Codex。');
      if(local){
        const response=await host.fetch('/api/'+method,{method:'POST',headers:{'Content-Type':'application/json','X-Business-Session':token},body:JSON.stringify(payload),signal});
        let data;try{data=await response.json();}catch{throw new Error('本机连接没有返回结果，请重新启动连接后再试。');}
        if(!response.ok)throw new Error(data.error||'操作没有完成，请重试。');return data;
      }
      if(signal?.aborted)throw new Error('已取消分析。');
      const requestId=id();
      return new Promise((resolve,reject)=>{
        const cancel=()=>{try{post({id:id(),method:'cancel',requestId});}catch{}const task=pending.get(requestId);if(task){clearTimeout(task.timer);task.cleanup();pending.delete(requestId);reject(new Error('已取消分析。'));}};
        const timer=setTimeout(()=>{try{post({id:id(),method:'cancel',requestId});}catch{}pending.get(requestId)?.cleanup();pending.delete(requestId);reject(new Error('本机连接等待超时，请检查确认窗口是否仍打开。'));},method==='analyze'?420000:20000);
        const cleanup=()=>signal?.removeEventListener('abort',cancel);
        pending.set(requestId,{resolve,reject,timer,cleanup});signal?.addEventListener('abort',cancel,{once:true});
        try{post({id:requestId,method,payload});}catch(error){clearTimeout(timer);cleanup();pending.delete(requestId);reject(error);}
      });
    }
    function receive(event){
      const d=event.data;
      if(event.source!==popup||event.origin!==helperOrigin||!d||d.channel!==channel)return;
      if(d.type==='business-lens-ready'){
        permitted=true;notify(!!d.status?.loggedIn,d.status?.message||'本机已确认连接');return;
      }
      if(d.type==='business-lens-disconnected'){disconnected(d.message||'本机授权已断开。');return;}
      if(d.type==='business-lens-response'){
        const task=pending.get(d.id);if(!task)return;clearTimeout(task.timer);task.cleanup();pending.delete(d.id);
        if(d.error)task.reject(new Error(String(d.error)));else task.resolve(d.result);
      }
    }
    host.addEventListener('message',receive);
    async function connect(address='http://127.0.0.1:49321'){
      if(local){permitted=true;try{const status=await request('status');notify(!!status.loggedIn,status.message);return status;}catch(error){permitted=false;notify(false,error.message);throw error;}}
      const parsed=new URL(address);
      if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('请使用本机地址，例如 http://127.0.0.1:49321。');
      if(file){host.open(parsed.origin+'/','_blank','noopener');notify(false,'请在已打开的本机页面确认连接。');return;}
      if(host.location.protocol!=='https:'&&host.location.hostname!=='127.0.0.1')throw new Error('在线授权需要通过 HTTPS 网页打开。');
      failPending('正在建立新的本机连接。');if(popup&&!popup.closed)popup.close();clearInterval(closedTimer);permitted=false;
      channel=id();helperOrigin=parsed.origin;
      const url=new URL('/connect',helperOrigin);url.searchParams.set('origin',host.location.origin);url.searchParams.set('channel',channel);
      popup=host.open(url.href,'business-lens-'+channel,'popup,width=700,height=760');
      if(!popup)throw new Error('浏览器拦截了确认窗口，请允许此网页弹出窗口后重试。');
      notify(false,'等待你在本机确认页允许连接…',true);
      closedTimer=setInterval(()=>{if(popup?.closed)disconnected('本机确认窗口已关闭，网页连接已断开。');},1000);
    }
    function disconnect(){if(popup&&!popup.closed){try{post({id:id(),method:'disconnect'});}catch{}popup.close();}disconnected('已断开本页的 Codex 连接。');}
    function dispose(){clearInterval(closedTimer);host.removeEventListener('message',receive);if(popup&&!popup.closed)popup.close();permitted=false;failPending('页面已关闭。');}
    return {connect,request,disconnect,dispose,get permitted(){return permitted;},get local(){return local;}};
  }
  globalThis.BusinessConnection={create};
})();
