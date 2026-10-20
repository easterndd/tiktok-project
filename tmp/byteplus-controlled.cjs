const {BytePlusVodService}=require('./dist/services/byteplus-vod.service');
const original=BytePlusVodService.prototype.uploadLocalVideo;
BytePlusVodService.prototype.uploadLocalVideo=function(input){
 const service=this.createSdkService();
 service.UploadMedia=undefined;
 this.vodService=service;
 this.uploadFetch=async(url,init)=>{
   const target=new URL(String(url).replace('http://','https://'));
   const start=Date.now();
   const response=await fetch(target,init);
   console.log(JSON.stringify({part:target.searchParams.get('partNumber'),http:response.status,ms:Date.now()-start}));
   return response;
 };
 return original.call(this,input);
};
require('./byteplus-resume17.cjs');
