const {createRequire}=require('module');
const sdkRequire=createRequire(require.resolve('@byteplus/vcloud-sdk-nodejs'));
const axios=sdkRequire('axios');
axios.interceptors.request.use(config=>{
 if(config.url?.startsWith('http://')){
   config.url=config.url.replace('http://','https://');
   config.timeout=90000;
   config._start=Date.now();
   console.log(JSON.stringify({part:new URL(config.url).searchParams.get('partNumber'),host:new URL(config.url).hostname,bytes:config.data?.length,protocol:'https'}));
 }
 return config;
});
axios.interceptors.response.use(response=>{if(response.config._start)console.log(JSON.stringify({http:response.status,ms:Date.now()-response.config._start}));return response;},error=>{console.log(JSON.stringify({http:error.response?.status,code:error.code,ms:Date.now()-(error.config?._start||Date.now())}));return Promise.reject(error);});
const {BytePlusVodService}=require('./dist/services/byteplus-vod.service');
const original=BytePlusVodService.prototype.uploadLocalVideo;
BytePlusVodService.prototype.uploadLocalVideo=function(input){
 const service=this.createSdkService();
 const upload=service.UploadMedia;
 service.UploadMedia=(args)=>upload({...args,maxConcurrency:1});
 this.vodService=service;
 return original.call(this,input);
};
require('./byteplus-resume18.cjs');
