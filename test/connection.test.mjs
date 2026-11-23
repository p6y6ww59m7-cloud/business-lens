import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {startServer} from '../server/local-server.mjs';

const source=await readFile(new URL('../web/connection.js',import.meta.url),'utf8');
const siteOrigin='https://p6y6ww59m7-cloud.github.io';
function remote(t){
  const sent=[],updates=[],popup={closed:false,postMessage(data,origin){sent.push({data,origin});},close(){this.closed=true;}};
  const dom=new JSDOM('<!doctype html><p>site</p>',{url:siteOrigin+'/business-lens/',runScripts:'dangerously'});
  dom.window.open=()=>popup;dom.window.eval(source);
  const connection=dom.window.BusinessConnection.create({onChange:s=>updates.push(s)});
  t.after(()=>{connection.dispose();dom.window.close();});
  function dispatch(data,{origin='http://127.0.0.1:49321',sender=popup}={}){dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data,origin,source:sender}));}
  return {dom,popup,sent,updates,connection,dispatch};
}
test('online site cannot call before local confirmation; rejects wrong origin, window, and channel',async t=>{
  const x=remote(t);await assert.rejects(x.connection.request('status'),/先允许/);
  let openedURL;x.dom.window.open=url=>{openedURL=url;return x.popup;};await x.connection.connect();
  const channel=new URL(openedURL).searchParams.get('channel');
  const ready={type:'business-lens-ready',channel,status:{loggedIn:true,message:'ready'}};
  x.dispatch(ready,{origin:'https://attacker.example'});assert.equal(x.connection.permitted,false);
  x.dispatch(ready,{sender:{}});assert.equal(x.connection.permitted,false);
  x.dispatch({...ready,channel:'wrong'});assert.equal(x.connection.permitted,false);
  x.dispatch(ready);assert.equal(x.connection.permitted,true);
  const promise=x.connection.request('analyze',{brief:'摄影课'});
  const request=x.sent.at(-1);assert.equal(request.origin,'http://127.0.0.1:49321');
  x.dispatch({type:'business-lens-response',channel,id:request.data.id,result:{report:'ok'}});
  assert.deepEqual(await promise,{report:'ok'});
  x.connection.disconnect();await assert.rejects(x.connection.request('status'),/先允许/);
});
test('cancel forwards only the active request; no credentials are sent to the website',async t=>{
  const x=remote(t);let openedURL;x.dom.window.open=url=>{openedURL=url;return x.popup;};await x.connection.connect();
  const channel=new URL(openedURL).searchParams.get('channel');x.dispatch({type:'business-lens-ready',channel,status:{loggedIn:true}});
  const abort=new AbortController();const call=x.connection.request('analyze',{brief:'摄影课'},abort.signal);
  abort.abort();await assert.rejects(call,/取消/);
  assert.equal(x.sent.at(-1).data.method,'cancel');
  assert.equal(JSON.stringify(x.sent).includes('Business-Session'),false);
});
test('local confirmation page ignores requests before approval and after revocation',async t=>{
  const {server,url}=await startServer({port:0,status:async()=>({loggedIn:true}),analyze:async()=>({})});
  t.after(()=>{server.closeAllConnections();server.close();});
  const channel='12345678-1234-1234-1234-123456789abc';
  const address=new URL('/connect',url);address.searchParams.set('origin',siteOrigin);address.searchParams.set('channel',channel);
  const html=await(await fetch(address)).text();
  const messages=[],calls=[];const opener={closed:false,postMessage:(data,origin)=>messages.push({data,origin})};
  const console=new VirtualConsole();const errors=[];console.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{url:address.href,runScripts:'dangerously',virtualConsole:console,beforeParse(window){
    Object.defineProperty(window,'opener',{value:opener});window.fetch=async(route,options)=>{calls.push(route);return Response.json(route.endsWith('status')?{loggedIn:true,message:'ready'}:{report:'safe'});};
  }});
  t.after(()=>dom.window.close());
  const message=(origin=siteOrigin,sender=opener,method='analyze')=>dom.window.dispatchEvent(new dom.window.MessageEvent('message',{origin,source:sender,data:{type:'business-lens-request',channel,id:'request1',method,payload:{brief:'test'}}}));
  message();assert.equal(calls.length,0);
  dom.window.document.getElementById('approve').click();await new Promise(r=>setTimeout(r,0));
  assert.equal(messages[0].data.type,'business-lens-ready');assert.equal(messages[0].origin,siteOrigin);
  assert.equal('token' in messages[0].data,false);
  message('https://attacker.example');message(siteOrigin,{});message(siteOrigin,opener,'shutdown');assert.equal(calls.length,1);
  message();await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,2);assert.equal(messages.at(-1).data.result.report,'safe');
  dom.window.document.getElementById('revoke').click();message();assert.equal(calls.length,2);
  assert.equal(errors.length,0);
});
