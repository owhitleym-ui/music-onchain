export function createApprovalClient({fetcher=(...args)=>fetch(...args)}={}) {
  return async ({token,method='GET',signal}) => {
    if(!token)throw new Error('Please sign in again to activate your account.');
    let response,body;
    try {
      response=await fetcher('/api/account/approval',{
        method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},cache:'no-store',
        ...(method==='POST'?{body:'{}'}:{}),signal,
      });
      body=await response.json();
    } catch {throw new Error('Account activation is temporarily unavailable. Please try again.');}
    if(!response.ok)throw new Error(body?.message||'Account activation is temporarily unavailable. Please try again.');
    if(!['pending','approved','revoked','error'].includes(body.status)||!/^0x[\da-f]{40}$/i.test(body.walletAddress??''))throw new Error('Account activation is temporarily unavailable. Please try again.');
    return body;
  };
}

export function createApprovalController({getSession,getToken,client,onChange,pollMs=2000,durationMs=60000,timeoutMs=15000,clock=Date.now}) {
  let epoch=0,pending=null,timer=null,deadline=0,controller=null,disposed=false;
  function cancel() {epoch++;clearTimeout(timer);timer=null;controller?.abort();controller=null;pending=null;}
  function active(mark,userId,address) {const s=getSession();return !disposed&&mark===epoch&&s.authenticated&&s.userId===userId&&s.address?.toLowerCase()===address;}
  async function request(method) {
    const s=getSession();
    if(disposed||!s.authenticated||!s.address)return;
    if(pending)return pending.promise;
    clearTimeout(timer);timer=null;
    const mark=epoch,userId=s.userId,address=s.address.toLowerCase();
    const localController=new AbortController();
    controller=localController;
    const signal=localController.signal;
    const operation={};
    onChange({approvalStatus:'checking',approvalError:'',approvalCanRetry:false});
    const promise=(async()=>{
      let timeout;
      try {
        const result=await Promise.race([
          (async()=>{
            const token=await getToken();
            if(!active(mark,userId,address))return null;
            return client({token,method,signal});
          })(),
          new Promise((_,reject)=>{timeout=setTimeout(()=>{localController.abort();reject(new Error('Account activation is taking longer than expected. Please try again.'));},timeoutMs);}),
          new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(new Error('Account activation was interrupted. Please try again.')),{once:true});}),
        ]);
        if(!active(mark,userId,address)||!result)return;
        if(result.walletAddress?.toLowerCase()!==address)throw new Error('Your account changed. Please refresh and try again.');
        if(result.status==='approved')onChange({approvalStatus:'approved',approvalError:'',approvalCanRetry:false});
        else if(result.status==='revoked')onChange({approvalStatus:'revoked',approvalError:'Account activation has been disabled. Please contact the organizer.',approvalCanRetry:false});
        else if(result.status==='error')onChange({approvalStatus:'error',approvalError:result.message||'Account activation could not finish. Please try again.',approvalCanRetry:true});
        else {
          const expired=clock()>=deadline;
          onChange({approvalStatus:'pending',approvalError:'',approvalCanRetry:expired});
          if(!expired) {timer=setTimeout(()=>void request('GET'),pollMs);timer.unref?.();}
        }
      } catch(error) {
        if(active(mark,userId,address))onChange({approvalStatus:'error',approvalError:error?.message||'Account activation could not finish. Please try again.',approvalCanRetry:true});
      } finally {clearTimeout(timeout);if(pending?.operation===operation)pending=null;}
    })();
    pending={operation,promise};
    return promise;
  }
  return {
    start(){cancel();deadline=clock()+durationMs;return request('POST');},
    retry(){if(pending)return pending.promise;deadline=clock()+durationMs;return request('POST');},
    refresh(){deadline=clock()+durationMs;return request('GET');},
    cancel,
    dispose(){disposed=true;cancel();},
  };
}
