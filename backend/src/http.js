import {AppError,publicError} from './errors.js';
import {ORIGINS} from './config.js';
export function createHandler({authenticate,approvalService,purchases,contests,configured=true,health=async()=>({ready:configured}),clock=Date.now}) {
 const rates=new Map();
 return async(req,res)=>{
  const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(code===429?{'Retry-After':'60'}:{})});res.end(JSON.stringify(body));};
  try {
   if(req.headers.origin&&!ORIGINS.includes(req.headers.origin))throw new AppError('BAD_REQUEST',403);
   const url=new URL(req.url,'http://127.0.0.1:3001');
   const accountEntries=Boolean(contests&&url.pathname==='/api/account/entries');
   if(url.search&&(!accountEntries||[...url.searchParams.keys()].some(k=>k!=='cursor')||url.searchParams.getAll('cursor').length>1||url.searchParams.get('cursor')?.length>2048))throw new AppError('BAD_REQUEST',400);
   if(url.pathname==='/api/health'&&req.method==='GET'){send(200,await health());return;}
   const pool=/^\/api\/contests\/(\d+)\/pools\/(24h|48h|week)$/.exec(url.pathname);
   const round=/^\/api\/contests\/(\d+)$/.exec(url.pathname);
   if(contests&&req.method==='GET'&&(url.pathname==='/api/contests'||pool||round)){
    send(200,pool?await contests.pool(pool[1],pool[2]):round?await contests.round(round[1]):await contests.catalog());return;
   }
   if(purchases&&req.method==='GET'&&(url.pathname==='/api/contests'||pool)){
    send(200,pool?await purchases.pool(pool[1],pool[2]):await purchases.catalog());return;
   }
   const purchase=/^\/api\/purchases(?:\/([0-9a-f-]{36})(\/signed)?)?$/.exec(url.pathname);
   const approval=url.pathname==='/api/account/approval';
   if(!approval&&!accountEntries&&!(purchase&&purchases)){send(404,{status:'error',message:'Not found.'});return;}
   const allowed=approval?['GET','POST']:accountEntries?['GET']:purchase[2]?['POST']:purchase[1]?['GET','DELETE']:['GET','POST'];
   if(!allowed.includes(req.method)){send(405,{status:'error',message:'Method not allowed.'});return;}
   let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>(approval?1024:24000))throw new AppError('BAD_REQUEST',413);}
   let body={};if(text){try{body=JSON.parse(text);}catch{throw new AppError('BAD_REQUEST',400);}if(!body||Array.isArray(body)||typeof body!=='object')throw new AppError('BAD_REQUEST',400);}
   if(approval&&Object.keys(body).length)throw new AppError('BAD_REQUEST',400);
   if(!configured)throw new AppError('CONFIG_REQUIRED');
   const identity=await authenticate(req.headers.authorization),key=identity.userId+':'+req.method+':'+(approval?'approval':'purchase');
   const now=clock(),previous=rates.get(key),rate=previous&&previous.expires>now?previous:{count:0,expires:now+60000};
   rate.count++;rates.set(key,rate);if(rates.size>1000)for(const[k,v]of rates)if(v.expires<=now)rates.delete(k);
   if(rate.count>(req.method==='GET'?120:approval?10:25))throw new AppError('RATE_LIMITED',429);
   let result;
   if(accountEntries){if(Object.keys(body).length)throw new AppError('BAD_REQUEST',400);result=await contests.entries(identity,url.searchParams.get('cursor'));}
   else if(approval)result=await approvalService(identity,req.method==='POST');
   else if(purchase[2]){if(Object.keys(body).join(',')!=='signedTransaction')throw new AppError('BAD_REQUEST',400);result=await purchases.signed(purchase[1],identity,body.signedTransaction);}
   else if(purchase[1])result=req.method==='DELETE'?await purchases.cancel(purchase[1],identity):await purchases.get(purchase[1],identity);
   else result=req.method==='POST'?await purchases.create(identity,body,req.headers['idempotency-key']):await purchases.list(identity);
   send((approval&&result.status==='pending'&&req.method==='POST')||purchase?.[2]?202:200,result);
  }catch(e){const readRequest=/^\/api\/(contests|account\/entries)/.test(req.url);const paymentRequest=/^\/api\/purchases/.test(req.url);send(e instanceof AppError?e.status:503,publicError(e instanceof AppError?e:readRequest?new AppError('LIVE_DATA_UNAVAILABLE'):paymentRequest?new AppError('PAYMENTS_UNAVAILABLE'):e));}
 };
}
